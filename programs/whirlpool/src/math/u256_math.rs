use std::{
    cmp::Ordering,
    fmt::{Display, Formatter, Result as FmtResult},
    str::from_utf8_unchecked,
};

use crate::errors::ErrorCode;

const NUM_WORDS: usize = 4;

#[derive(Copy, Clone, Debug)]
pub struct U256Muldiv {
    pub items: [u64; NUM_WORDS],
}

impl U256Muldiv {
    pub fn new(h: u128, l: u128) -> Self {
        U256Muldiv {
            items: [l.lo(), l.hi(), h.lo(), h.hi()],
        }
    }

    fn copy(&self) -> Self {
        let mut items: [u64; NUM_WORDS] = [0; NUM_WORDS];
        items.copy_from_slice(&self.items);
        U256Muldiv { items }
    }

    fn update_word(&mut self, index: usize, value: u64) {
        self.items[index] = value;
    }

    fn num_words(&self) -> usize {
        for i in (0..self.items.len()).rev() {
            if self.items[i] != 0 {
                return i + 1;
            }
        }
        0
    }

    pub fn get_word(&self, index: usize) -> u64 {
        self.items[index]
    }

    pub fn get_word_u128(&self, index: usize) -> u128 {
        self.items[index] as u128
    }

    // Logical-left shift, does not trigger overflow
    pub fn shift_word_left(&self) -> Self {
        let mut result = U256Muldiv::new(0, 0);

        for i in (0..NUM_WORDS - 1).rev() {
            result.items[i + 1] = self.items[i];
        }

        result
    }

    pub fn checked_shift_word_left(&self) -> Option<Self> {
        let last_element = self.items.last();

        match last_element {
            None => Some(self.shift_word_left()),
            Some(element) => {
                if *element > 0 {
                    None
                } else {
                    Some(self.shift_word_left())
                }
            }
        }
    }

    // Logical-left shift, does not trigger overflow
    pub fn shift_left(&self, mut shift_amount: u32) -> Self {
        // Return 0 if shift is greater than number of bits
        if shift_amount >= U64_RESOLUTION * (NUM_WORDS as u32) {
            return U256Muldiv::new(0, 0);
        }

        let mut result = self.copy();

        while shift_amount >= U64_RESOLUTION {
            result = result.shift_word_left();
            shift_amount -= U64_RESOLUTION;
        }

        if shift_amount == 0 {
            return result;
        }

        for i in (1..NUM_WORDS).rev() {
            result.items[i] = (result.items[i] << shift_amount)
                | (result.items[i - 1] >> (U64_RESOLUTION - shift_amount));
        }

        result.items[0] <<= shift_amount;

        result
    }

    // Logical-right shift, does not trigger overflow
    pub fn shift_word_right(&self) -> Self {
        let mut result = U256Muldiv::new(0, 0);

        for i in 0..NUM_WORDS - 1 {
            result.items[i] = self.items[i + 1]
        }

        result
    }

    // Logical-right shift, does not trigger overflow
    pub fn shift_right(&self, mut shift_amount: u32) -> Self {
        // Return 0 if shift is greater than number of bits
        if shift_amount >= U64_RESOLUTION * (NUM_WORDS as u32) {
            return U256Muldiv::new(0, 0);
        }

        let mut result = self.copy();

        while shift_amount >= U64_RESOLUTION {
            result = result.shift_word_right();
            shift_amount -= U64_RESOLUTION;
        }

        if shift_amount == 0 {
            return result;
        }

        for i in 0..NUM_WORDS - 1 {
            result.items[i] = (result.items[i] >> shift_amount)
                | (result.items[i + 1] << (U64_RESOLUTION - shift_amount));
        }

        result.items[3] >>= shift_amount;

        result
    }

    #[allow(clippy::should_implement_trait)]
    pub fn eq(&self, other: U256Muldiv) -> bool {
        for i in 0..self.items.len() {
            if self.items[i] != other.items[i] {
                return false;
            }
        }

        true
    }

    pub fn lt(&self, other: U256Muldiv) -> bool {
        for i in (0..self.items.len()).rev() {
            match self.items[i].cmp(&other.items[i]) {
                Ordering::Less => return true,
                Ordering::Greater => return false,
                Ordering::Equal => {}
            }
        }

        false
    }

    pub fn gt(&self, other: U256Muldiv) -> bool {
        for i in (0..self.items.len()).rev() {
            match self.items[i].cmp(&other.items[i]) {
                Ordering::Less => return false,
                Ordering::Greater => return true,
                Ordering::Equal => {}
            }
        }

        false
    }

    pub fn lte(&self, other: U256Muldiv) -> bool {
        for i in (0..self.items.len()).rev() {
            match self.items[i].cmp(&other.items[i]) {
                Ordering::Less => return true,
                Ordering::Greater => return false,
                Ordering::Equal => {}
            }
        }

        true
    }

    pub fn gte(&self, other: U256Muldiv) -> bool {
        for i in (0..self.items.len()).rev() {
            match self.items[i].cmp(&other.items[i]) {
                Ordering::Less => return false,
                Ordering::Greater => return true,
                Ordering::Equal => {}
            }
        }

        true
    }

    pub fn try_into_u128(&self) -> Result<u128, ErrorCode> {
        if self.num_words() > 2 {
            return Err(ErrorCode::NumberDownCastError);
        }

        Ok(((self.items[1] as u128) << U64_RESOLUTION) | (self.items[0] as u128))
    }

    pub fn is_zero(self) -> bool {
        for i in 0..NUM_WORDS {
            if self.items[i] != 0 {
                return false;
            }
        }

        true
    }

    // Input:
    //  m = U256::MAX + 1 (which is the amount used for overflow)
    //  n = input value
    // Output:
    //  r = smallest positive additive inverse of n mod m
    //
    // We wish to find r, s.t., r + n ≡ 0 mod m;
    // We generally wish to find this r since r ≡ -n mod m
    // and can make operations with n with large number of bits
    // fit into u256 space without overflow
    pub fn get_add_inverse(&self) -> Self {
        // Additive inverse of 0 is 0
        if self.eq(U256Muldiv::new(0, 0)) {
            return U256Muldiv::new(0, 0);
        }
        // To ensure we don't overflow, we begin with max and do a subtraction
        U256Muldiv::new(u128::MAX, u128::MAX)
            .sub(*self)
            .add(U256Muldiv::new(0, 1))
    }

    // Result overflows if the result is greater than 2^256-1
    pub fn add(&self, other: U256Muldiv) -> Self {
        let mut result = U256Muldiv::new(0, 0);

        let mut carry = 0;
        for i in 0..NUM_WORDS {
            let x = self.get_word_u128(i);
            let y = other.get_word_u128(i);
            let t = x + y + carry;
            result.update_word(i, t.lo());

            carry = t.hi_u128();
        }

        result
    }

    // Result underflows if the result is greater than 2^256-1
    pub fn sub(&self, other: U256Muldiv) -> Self {
        let mut result = U256Muldiv::new(0, 0);

        let mut carry = 0;
        for i in 0..NUM_WORDS {
            let x = self.get_word(i);
            let y = other.get_word(i);
            let (t0, overflowing0) = x.overflowing_sub(y);
            let (t1, overflowing1) = t0.overflowing_sub(carry);
            result.update_word(i, t1);

            carry = if overflowing0 || overflowing1 { 1 } else { 0 };
        }

        result
    }

    // Result overflows if great than 2^256-1
    pub fn mul(&self, other: U256Muldiv) -> Self {
        let mut result = U256Muldiv::new(0, 0);

        let m = self.num_words();
        let n = other.num_words();

        for j in 0..n {
            let mut k = 0;
            for i in 0..m {
                let x = self.get_word_u128(i);
                let y = other.get_word_u128(j);
                if i + j < NUM_WORDS {
                    let z = result.get_word_u128(i + j);
                    let t = x.wrapping_mul(y).wrapping_add(z).wrapping_add(k);
                    result.update_word(i + j, t.lo());
                    k = t.hi_u128();
                }
            }

            // Don't update the carry word
            if j + m < NUM_WORDS {
                result.update_word(j + m, k as u64);
            }
        }

        result
    }

    // Result returns 0 if divide by zero
    pub fn div(&self, mut divisor: U256Muldiv, return_remainder: bool) -> (Self, Self) {
        let mut dividend = self.copy();
        let mut quotient = U256Muldiv::new(0, 0);

        let num_dividend_words = dividend.num_words();
        let num_divisor_words = divisor.num_words();

        if num_divisor_words == 0 {
            panic!("divide by zero");
        }

        // Case 0. If either the dividend or divisor is 0, return 0
        if num_dividend_words == 0 {
            return (U256Muldiv::new(0, 0), U256Muldiv::new(0, 0));
        }

        // Case 1. Dividend is smaller than divisor, quotient = 0, remainder = dividend
        if num_dividend_words < num_divisor_words {
            if return_remainder {
                return (U256Muldiv::new(0, 0), dividend);
            } else {
                return (U256Muldiv::new(0, 0), U256Muldiv::new(0, 0));
            }
        }

        // Case 2. Dividend is smaller than u128, divisor <= dividend, perform math in u128 space
        if num_dividend_words < 3 {
            let dividend = dividend.try_into_u128().unwrap();
            let divisor = divisor.try_into_u128().unwrap();
            let quotient = dividend / divisor;
            if return_remainder {
                let remainder = dividend % divisor;
                return (U256Muldiv::new(0, quotient), U256Muldiv::new(0, remainder));
            } else {
                return (U256Muldiv::new(0, quotient), U256Muldiv::new(0, 0));
            }
        }

        // Case 3. Divisor is single-word, we must isolate this case for correctness
        if num_divisor_words == 1 {
            let mut k = 0;
            for j in (0..num_dividend_words).rev() {
                let d1 = hi_lo(k.lo(), dividend.get_word(j));
                let d2 = divisor.get_word_u128(0);
                let q = d1 / d2;
                k = d1 - d2 * q;
                quotient.update_word(j, q.lo());
            }

            if return_remainder {
                return (quotient, U256Muldiv::new(0, k));
            } else {
                return (quotient, U256Muldiv::new(0, 0));
            }
        }

        // Normalize the division by shifting left
        let s = divisor.get_word(num_divisor_words - 1).leading_zeros();
        let b = dividend.get_word(num_dividend_words - 1).leading_zeros();

        // Conditional carry space for normalized division
        let mut dividend_carry_space: u64 = 0;
        if num_dividend_words == NUM_WORDS && b < s {
            dividend_carry_space = dividend.items[num_dividend_words - 1] >> (U64_RESOLUTION - s);
        }
        dividend = dividend.shift_left(s);
        divisor = divisor.shift_left(s);

        for j in (0..num_dividend_words - num_divisor_words + 1).rev() {
            let result = div_loop(
                j,
                num_divisor_words,
                dividend,
                &mut dividend_carry_space,
                divisor,
                quotient,
            );
            quotient = result.0;
            dividend = result.1;
        }

        if return_remainder {
            dividend = dividend.shift_right(s);
            (quotient, dividend)
        } else {
            (quotient, U256Muldiv::new(0, 0))
        }
    }
}

impl Display for U256Muldiv {
    fn fmt(&self, f: &mut Formatter) -> FmtResult {
        let mut buf = [0_u8; NUM_WORDS * 20];
        let mut i = buf.len() - 1;

        let ten = U256Muldiv::new(0, 10);
        let mut current = *self;

        loop {
            let (quotient, remainder) = current.div(ten, true);
            let digit = remainder.get_word(0) as u8;
            buf[i] = digit + b'0';
            current = quotient;

            if current.is_zero() {
                break;
            }

            i -= 1;
        }

        let s = unsafe { from_utf8_unchecked(&buf[i..]) };

        f.write_str(s)
    }
}

impl From<u128> for U256Muldiv {
    fn from(value: u128) -> Self {
        // A u128 value only occupies the low 128 bits (l) of the U256Muldiv.
        // The high 128 bits (h) are set to 0.
        U256Muldiv::new(0, value)
    }
}

impl From<u64> for U256Muldiv {
    fn from(value: u64) -> Self {
        // A u64 value only occupies the low 64 bits of the lower 128 bits (l) of the U256Muldiv.
        // The high 64 bits of the lower 128 bits (l) are set to 0 by type casting.
        // The high 128 bits (h) are set to 0 below.
        U256Muldiv::new(0, value as u128)
    }
}

const U64_MAX: u128 = u64::MAX as u128;
const U64_RESOLUTION: u32 = 64;

pub trait LoHi {
    fn lo(self) -> u64;
    fn hi(self) -> u64;
    fn lo_u128(self) -> u128;
    fn hi_u128(self) -> u128;
}

impl LoHi for u128 {
    fn lo(self) -> u64 {
        (self & U64_MAX) as u64
    }
    fn lo_u128(self) -> u128 {
        self & U64_MAX
    }
    fn hi(self) -> u64 {
        (self >> U64_RESOLUTION) as u64
    }
    fn hi_u128(self) -> u128 {
        self >> U64_RESOLUTION
    }
}

pub fn hi_lo(hi: u64, lo: u64) -> u128 {
    ((hi as u128) << U64_RESOLUTION) | (lo as u128)
}

pub fn mul_u256(v: u128, n: u128) -> U256Muldiv {
    // do 128 bits multiply
    //                   nh   nl
    //                *  vh   vl
    //                ----------
    // a0 =              vl * nl
    // a1 =         vl * nh
    // b0 =         vh * nl
    // b1 =  + vh * nh
    //       -------------------
    //        c1h  c1l  c0h  c0l
    //
    // "a0" is optimized away, result is stored directly in c0.  "b1" is
    // optimized away, result is stored directly in c1.
    //

    let mut c0 = v.lo_u128() * n.lo_u128();
    let a1 = v.lo_u128() * n.hi_u128();
    let b0 = v.hi_u128() * n.lo_u128();

    // add the high word of a0 to the low words of a1 and b0 using c1 as
    // scrach space to capture the carry.  the low word of the result becomes
    // the final high word of c0
    let mut c1 = c0.hi_u128() + a1.lo_u128() + b0.lo_u128();

    c0 = hi_lo(c1.lo(), c0.lo());

    // add the carry from the result above (found in the high word of c1) and
    // the high words of a1 and b0 to b1, the result is c1.
    c1 = v.hi_u128() * n.hi_u128() + c1.hi_u128() + a1.hi_u128() + b0.hi_u128();

    U256Muldiv::new(c1, c0)
}

fn div_loop(
    index: usize,
    num_divisor_words: usize,
    mut dividend: U256Muldiv,
    dividend_carry_space: &mut u64,
    divisor: U256Muldiv,
    mut quotient: U256Muldiv,
) -> (U256Muldiv, U256Muldiv) {
    let use_carry = (index + num_divisor_words) == NUM_WORDS;
    let div_hi = if use_carry {
        *dividend_carry_space
    } else {
        dividend.get_word(index + num_divisor_words)
    };
    let d0 = hi_lo(div_hi, dividend.get_word(index + num_divisor_words - 1));
    let d1 = divisor.get_word_u128(num_divisor_words - 1);

    let mut qhat = d0 / d1;
    let mut rhat = d0 - d1 * qhat;

    let d0_2 = dividend.get_word(index + num_divisor_words - 2);
    let d1_2 = divisor.get_word_u128(num_divisor_words - 2);

    let mut cmp1 = hi_lo(rhat.lo(), d0_2);
    let mut cmp2 = qhat.wrapping_mul(d1_2);

    while qhat.hi() != 0 || cmp2 > cmp1 {
        qhat -= 1;
        rhat += d1;
        if rhat.hi() != 0 {
            break;
        }

        cmp1 = hi_lo(rhat.lo(), cmp1.lo());
        cmp2 -= d1_2;
    }

    let mut k = 0;
    let mut t;
    for i in 0..num_divisor_words {
        let p = qhat * (divisor.get_word_u128(i));
        t = (dividend.get_word_u128(index + i))
            .wrapping_sub(k)
            .wrapping_sub(p.lo_u128());
        dividend.update_word(index + i, t.lo());
        k = ((p >> U64_RESOLUTION) as u64).wrapping_sub((t >> U64_RESOLUTION) as u64) as u128;
    }

    let d_head = if use_carry {
        *dividend_carry_space as u128
    } else {
        dividend.get_word_u128(index + num_divisor_words)
    };

    t = d_head.wrapping_sub(k);
    if use_carry {
        *dividend_carry_space = t.lo();
    } else {
        dividend.update_word(index + num_divisor_words, t.lo());
    }

    if k > d_head {
        qhat -= 1;
        k = 0;
        for i in 0..num_divisor_words {
            t = dividend
                .get_word_u128(index + i)
                .wrapping_add(divisor.get_word_u128(i))
                .wrapping_add(k);
            dividend.update_word(index + i, t.lo());
            k = t >> U64_RESOLUTION;
        }

        let new_carry = dividend
            .get_word_u128(index + num_divisor_words)
            .wrapping_add(k)
            .lo();
        if use_carry {
            *dividend_carry_space = new_carry
        } else {
            dividend.update_word(
                index + num_divisor_words,
                dividend
                    .get_word_u128(index + num_divisor_words)
                    .wrapping_add(k)
                    .lo(),
            );
        }
    }

    quotient.update_word(index, qhat.lo());

    (quotient, dividend)
}

#[cfg(test)]
mod fuzz_tests {
    use proptest::prelude::*;

    use crate::math::{mul_u256, U256Muldiv, U256};

    fn assert_equality(n0: U256Muldiv, n1: U256) {
        assert_eq!(n0.get_word(0), n1.0[0], "failed: 0");
        assert_eq!(n0.get_word(1), n1.0[1], "failed: 1");
        assert_eq!(n0.get_word(2), n1.0[2], "failed: 2");
        assert_eq!(n0.get_word(3), n1.0[3], "failed: 3");
    }

    proptest! {
        #[test]
        fn test_lt(n0_lo in 0..u128::MAX, n0_hi in 0..u128::MAX, n1_lo in 0..u128::MAX, n1_hi in 0..u128::MAX) {
            let n0 = U256Muldiv::new(n0_hi, n0_lo);
            let n1 = U256Muldiv::new(n1_hi, n1_lo);

            let result = n0.lt(n1);

            let other_n0 = (U256::from(n0_hi) << 128) + U256::from(n0_lo);
            let other_n1 = (U256::from(n1_hi) << 128) + U256::from(n1_lo);

            let other_result = other_n0 < other_n1;

            assert_eq!(result, other_result);
        }

        #[test]
        fn test_gt(n0_lo in 0..u128::MAX, n0_hi in 0..u128::MAX, n1_lo in 0..u128::MAX, n1_hi in 0..u128::MAX) {
            let n0 = U256Muldiv::new(n0_hi, n0_lo);
            let n1 = U256Muldiv::new(n1_hi, n1_lo);

            let result = n0.gt(n1);

            let other_n0 = (U256::from(n0_hi) << 128) + U256::from(n0_lo);
            let other_n1 = (U256::from(n1_hi) << 128) + U256::from(n1_lo);

            let other_result = other_n0 > other_n1;

            assert_eq!(result, other_result);
        }

        #[test]
        fn test_lte(n0_lo in 0..u128::MAX, n0_hi in 0..u128::MAX, n1_lo in 0..u128::MAX, n1_hi in 0..u128::MAX) {
            let n0 = U256Muldiv::new(n0_hi, n0_lo);
            let n1 = U256Muldiv::new(n1_hi, n1_lo);

            let result = n0.lte(n1);

            let other_n0 = (U256::from(n0_hi) << 128) + U256::from(n0_lo);
            let other_n1 = (U256::from(n1_hi) << 128) + U256::from(n1_lo);

            let other_result = other_n0 <= other_n1;

            assert_eq!(result, other_result);
        }

        #[test]
        fn test_gte(n0_lo in 0..u128::MAX, n0_hi in 0..u128::MAX, n1_lo in 0..u128::MAX, n1_hi in 0..u128::MAX) {
            let n0 = U256Muldiv::new(n0_hi, n0_lo);
            let n1 = U256Muldiv::new(n1_hi, n1_lo);

            let result = n0.gte(n1);

            let other_n0 = (U256::from(n0_hi) << 128) + U256::from(n0_lo);
            let other_n1 = (U256::from(n1_hi) << 128) + U256::from(n1_lo);

            let other_result = other_n0 >= other_n1;

            // Should always be >= to itself
            assert!(n0.gte(n0));

            // Should be equivalent to u256 operation
            assert_eq!(result, other_result);
        }

        #[test]
        fn test_eq(n0_lo in 0..u128::MAX, n0_hi in 0..u128::MAX, n1_lo in 0..u128::MAX, n1_hi in 0..u128::MAX) {
            let n0 = U256Muldiv::new(n0_hi, n0_lo);
            let n1 = U256Muldiv::new(n1_hi, n1_lo);

            let result_self = n0.eq(n0);
            let result = n0.eq(n1);
            let result2 = n1.eq(n0);

            let other_n0 = (U256::from(n0_hi) << 128) + U256::from(n0_lo);
            let other_n1 = (U256::from(n1_hi) << 128) + U256::from(n1_lo);

            let other_result = other_n0 == other_n1;

            // Should always be = to itself
            assert!(result_self);

            // Should be equivalent to using u256 space
            assert_eq!(result, other_result);
            assert_eq!(result2, other_result);

            // Property should be symmetric, n0.eq(n1) == n1.eq(n0)
            assert_eq!(result, result2);
        }

        #[test]
        fn test_div(dividend_hi in 0..u128::MAX, dividend_lo in 0..u128::MAX, divisor_hi in 0..u128::MAX, divisor_lo in 0..u128::MAX) {
            let dividend = U256Muldiv::new(dividend_hi, dividend_lo);
            let divisor = U256Muldiv::new(divisor_hi, divisor_lo);

            let result = dividend.div(divisor, false).0;

            let other_dividend = (U256::from(dividend_hi) << 128) + U256::from(dividend_lo);
            let other_divisor = (U256::from(divisor_hi) << 128) + U256::from(divisor_lo);

            let other_result = other_dividend / other_divisor;

            assert_equality(result, other_result);
        }

        #[test]
        fn test_add(n0_lo in 0..u128::MAX, n0_hi in 0..u128::MAX, n1_lo in 0..u128::MAX, n1_hi in 0..u128::MAX) {
            let n0 = U256Muldiv::new(n0_hi, n0_lo);
            let n1 = U256Muldiv::new(n1_hi, n1_lo);

            let result = n0.add(n1);
            let result2 = n1.add(n0);
            let add_zero = n0.add(U256Muldiv::new(0, 0));

            let other_n0 = (U256::from(n0_hi) << 128) + U256::from(n0_lo);
            let other_n1 = (U256::from(n1_hi) << 128) + U256::from(n1_lo);

            // Assert addition is symmetric
            assert!(result.eq(result2));

            // Adding 0 is no-op
            assert!(n0.eq(add_zero));

            match other_n0.checked_add(other_n1) {
                Some(other_result) => {
                    // Assert results equal to addition in U256 space
                    assert_equality(result, other_result);
                },
                None => {
                    // U256 has overflowed, we allow overflow, so the overflow amount should be (n0 + n1) mod (U256::MAX + 1)

                    // Since we know that n0 + n1 >= U256::MAX + 1, their sum of additive inverses must be < U256::MAX + 1
                    // Thus we calculate neg_sum = -n0 + -n1 mod U256::MAX + 1
                    let add_inv_0 = n0.get_add_inverse();
                    let add_inv_1 = n1.get_add_inverse();
                    let neg_sum = add_inv_0.add(add_inv_1);

                    // We then invert the neg_sum to get the expected overflow which should be the equivalent of n0 + n1 mod U256::MAX
                    // without any overflowing operations
                    let overflow = neg_sum.get_add_inverse();

                    assert!(result.eq(overflow));
                },
            }
        }

        #[test]
        fn test_overflow_equality(lo in 0..u128::MAX, hi in 0..u128::MAX) {
            let n0 = U256Muldiv::new(hi, lo);

            // Overflowing in either direction should be equivalent
            let n1 = n0.add(U256Muldiv::new(u128::MAX, u128::MAX)).add(U256Muldiv::new(0, 1));
            let n2 = n0.sub(U256Muldiv::new(u128::MAX, u128::MAX)).sub(U256Muldiv::new(0, 1));

            assert!(n0.eq(n1));
            assert!(n0.eq(n2));
        }

        #[test]
        fn test_sub(n0_lo in 0..u128::MAX, n0_hi in 0..u128::MAX, n1_lo in 0..u128::MAX, n1_hi in 0..u128::MAX) {
            let n0 = U256Muldiv::new(n0_hi, n0_lo);
            let n1 = U256Muldiv::new(n1_hi, n1_lo);

            let result = n0.sub(n1);
            let result2 = n0.sub(U256Muldiv::new(0, 0));

            let other_n0 = (U256::from(n0_hi) << 128) + U256::from(n0_lo);
            let other_n1 = (U256::from(n1_hi) << 128) + U256::from(n1_lo);

            // Subtracting zero is no-op
            assert!(result2.eq(n0));

            match n0.gt(n1) {
                true => {
                    let other_result = other_n0 - other_n1;
                    assert_equality(result, other_result);
                },
                false => {
                    // n1 >= n0 so we know that n1 - n0 does not overflow
                    // n1 - n0 ≡ -(n0 - n1) mod U256::MAX + 1
                    let neg = n1.sub(n0);
                    let overflow = neg.get_add_inverse();
                    assert!(result.eq(overflow));
                }
            }
        }

        #[test]
        fn test_fmt(n_lo in 0..u128::MAX, n_hi in 0..u128::MAX) {
            let n = U256Muldiv::new(n_hi, n_lo);

            let other_n = (U256::from(n_hi) << 128) + U256::from(n_lo);

            assert_eq!(format!("{}", n), format!("{}", other_n));
        }

        #[test]
        fn test_mul_u256(n0 in 0..u128::MAX, n1 in 0..u128::MAX) {
            let result = mul_u256(n0, n1);

            let other_result = U256::from(n0) * U256::from(n1);

            assert_equality(result, other_result);
        }

        #[test]
        fn test_get_add_inv(n_hi in 0..u128::MAX, n_lo in 0..u128::MAX) {
            let n = U256Muldiv::new(n_hi, n_lo);
            let inverse = n.get_add_inverse();

            let result = n.add(inverse);
            assert!(result.eq(U256Muldiv::new(0, 0)));
        }

        #[test]
        fn test_shift_right(n_hi in 1..u128::MAX, n_lo in 0..u128::MAX, shift_amount in 1u32..128) {
            let n = U256Muldiv::new(n_hi, n_lo);
            let result = n.shift_right(shift_amount);

            let other_n = (U256::from(n_hi) << 128) + U256::from(n_lo);
            let other_result = other_n >> shift_amount;

            assert_equality(result, other_result);
        }

        #[test]
        fn test_shift_left(n_hi in 0u128..(u32::MAX as u128), n_lo in 0..u128::MAX, shift_amount in 1u32..96) {
            let n = U256Muldiv::new(n_hi, n_lo);
            let result = n.shift_left(shift_amount);

            let other_n = (U256::from(n_hi) << 128) + U256::from(n_lo);
            let other_result = other_n << shift_amount;

            assert_equality(result, other_result);
        }

        #[test]
        fn test_checked_shift_word_left(n_hi in 0u128..(u64::MAX as u128), n_lo in 0..u128::MAX) {
            let n = U256Muldiv::new(n_hi, n_lo);
            let result = n.checked_shift_word_left();

            let other_n = (U256::from(n_hi) << 128) + U256::from(n_lo);
            let other_result = other_n << 64;

            let final_result = result.unwrap();
            assert_equality(final_result, other_result);
        }

        #[test]
        fn test_checked_shift_word_left_overflow(n_hi in u64::MAX as u128..u128::MAX, n_lo in 0..u128::MAX) {
            let n = U256Muldiv::new(n_hi, n_lo);
            let result = n.checked_shift_word_left();

            assert!(result.is_none())
        }

        #[test]
        fn test_mul(n0_hi in 0..u128::MAX, n0_lo in 0..u128::MAX, n1_hi in 0..u128::MAX, n1_lo in 0..u128::MAX) {
            let n0 = U256Muldiv::new(n0_hi, n0_lo);
            let n1 = U256Muldiv::new(n1_hi, n1_lo);
            let result = n0.mul(n1);

            let other_n0 = (U256::from(n0_hi) << 128) + U256::from(n0_lo);
            let other_n1 = (U256::from(n1_hi) << 128) + U256::from(n1_lo);

            match other_n0.checked_mul(other_n1) {
                Some(other_result) => {
                    // Assert results equal to addition in U256 space
                    assert_equality(result, other_result);
                },
                None => {
                    // The intention here is to enforce that the total number of bits <= 256
                    // If either of the values are larger than 2 words, we use the additive inverse
                    // which is congruent to the negative value mod U256::MAX + 1
                    // We are guaranteed that at least one of the values is > 2 words since we have overflowed
                    let should_inv_n0 = n0.num_words() > 2;
                    let should_inv_n1 = n1.num_words() > 2;

                    let maybe_inv_n0 = if should_inv_n0 {
                        n0.get_add_inverse()
                    } else {
                        n0
                    };
                    let maybe_inv_n1 = if should_inv_n1 {
                        n1.get_add_inverse()
                    } else {
                        n1
                    };

                    let prod = maybe_inv_n0.mul(maybe_inv_n1);

                    let overflow = if should_inv_n0 == should_inv_n1 {
                        // If we have inverted both n0 and n1, the inversions cancel out
                        prod
                    } else {
                        // Otherwise, invert the product again
                        prod.get_add_inverse()
                    };
                    assert!(result.eq(overflow));
                },
            }
        }
    }
}

#[cfg(test)]
mod test_add {
    use crate::math::U256Muldiv;

    #[test]
    fn test_add_overflow_0() {
        let n0 = U256Muldiv::new(u128::MAX, u128::MAX);
        let n1 = n0.copy();

        let result = n0.add(n1);

        assert!(result.eq(U256Muldiv::new(u128::MAX, u128::MAX - 1)));
    }

    #[test]
    fn test_add_overflow_1() {
        let n0 = U256Muldiv::new(u128::MAX, u128::MAX);
        let n1 = U256Muldiv::new(0, 1);

        let result = n0.add(n1);

        assert!(result.eq(U256Muldiv::new(0, 0)));
    }
}

#[cfg(test)]
mod test_sub {
    use crate::math::U256Muldiv;

    #[test]
    fn test_sub_underflow_0() {
        let n0 = U256Muldiv::new(u128::MAX, u128::MAX - 1);
        let n1 = U256Muldiv::new(u128::MAX, u128::MAX);

        let result = n0.sub(n1);

        assert!(result.eq(U256Muldiv::new(u128::MAX, u128::MAX)));
    }

    #[test]
    fn test_sub_underflow_1() {
        let n0 = U256Muldiv::new(0, 0);
        let n1 = U256Muldiv::new(0, 1);

        let result = n0.sub(n1);

        assert!(result.eq(U256Muldiv::new(u128::MAX, u128::MAX)));
    }
}

#[cfg(test)]
mod test_div {
    use crate::math::U256;

    use super::U256Muldiv;

    #[test]
    fn test_div_0() {
        let dividend = U256Muldiv::new(50 << 64, 100 << 64);
        let divisor = U256Muldiv::new(0, 100 << 64);
        let result = dividend.div(divisor, true);

        let result2 = ((U256::from(50u128 << 64) << 128) + U256::from(100u128 << 64))
            .div_mod(U256::from(100u128 << 64));

        assert!(format!("{}", result.0) == format!("{}", result2.0));
        assert!(format!("{}", result.1) == format!("{}", result2.1));
    }

    #[test]
    fn test_div_1() {
        let dividend = U256Muldiv::new(100, 100);
        let divisor = U256Muldiv::new(0, 50 << 64);
        let result = dividend.div(divisor, true);

        let result2 =
            ((U256::from(100u128) << 128) + U256::from(100u128)).div_mod(U256::from(50u128 << 64));

        assert!(format!("{}", result.0) == format!("{}", result2.0));
        assert!(format!("{}", result.1) == format!("{}", result2.1));
    }

    #[test]
    fn test_div_2() {
        let dividend = U256Muldiv::new(50, 100 << 64);
        let divisor = U256Muldiv::new(0, 100 << 64);
        let result = dividend.div(divisor, true);

        let result2 = ((U256::from(50u128) << 128) + U256::from(100u128 << 64))
            .div_mod(U256::from(100u128 << 64));

        assert!(format!("{}", result.0) == format!("{}", result2.0));
        assert!(format!("{}", result.1) == format!("{}", result2.1));
    }

    #[test]
    fn test_div_3() {
        let dividend = U256Muldiv::new(50, 100 << 64);
        let divisor = U256Muldiv::new(0, 66);
        let result = dividend.div(divisor, true);

        let result2 =
            ((U256::from(50) << 128) + U256::from(100u128 << 64)).div_mod(U256::from(66u128));

        assert!(format!("{}", result.0) == format!("{}", result2.0));
        assert!(format!("{}", result.1) == format!("{}", result2.1));
    }

    #[test]
    fn test_div_4() {
        let dividend = U256Muldiv::new(100 << 64, 0);
        let divisor = U256Muldiv::new(1 << 63, u64::MAX as u128);
        let result = dividend.div(divisor, true);

        let result2 = (U256::from(100u128 << 64) << 128)
            .div_mod((U256::from(1u128 << 63) << 128) + U256::from(u64::MAX));

        assert!(format!("{}", result.0) == format!("{}", result2.0));
        assert!(format!("{}", result.1) == format!("{}", result2.1));
    }

    #[test]
    fn test_div_5() {
        let dividend = U256Muldiv::new(100 << 64, 0);
        let divisor = U256Muldiv::new(1 << 63, 0);
        let result = dividend.div(divisor, true);

        let result2 = (U256::from(100u128 << 64) << 128).div_mod(U256::from(1u128 << 63) << 128);

        assert!(format!("{}", result.0) == format!("{}", result2.0));
        assert!(format!("{}", result.1) == format!("{}", result2.1));
    }

    #[test]
    fn test_div_6() {
        let dividend = U256Muldiv::new(1 << 63, 0);
        let divisor = U256Muldiv::new(1 << 63, 1);
        let result = dividend.div(divisor, true);

        let result2 =
            (U256::from(1u128 << 63) << 128).div_mod((U256::from(1u128 << 63) << 128) + 1);

        assert!(format!("{}", result.0) == format!("{}", result2.0));
        assert!(format!("{}", result.1) == format!("{}", result2.1));
    }

    #[test]
    #[should_panic(expected = "divide by zero")]
    fn test_div_7() {
        let dividend = U256Muldiv::new(1 << 63, 0);
        let divisor = U256Muldiv::new(0, 0);
        let _ = dividend.div(divisor, true);
    }
}

#[cfg(test)]
mod test_u128_to_u256 {
    use super::U256Muldiv;

    #[test]
    fn test_zero() {
        let v = 0u128;
        let u = U256Muldiv::from(v);
        assert!(u.eq(U256Muldiv::new(0, v)));
        assert_eq!(u.try_into_u128().unwrap(), v);
    }

    #[test]
    fn test_small_values() {
        for v in [1u128, 42u128, (1u128 << 64) + 3u128] {
            let u = U256Muldiv::from(v);
            assert!(u.eq(U256Muldiv::new(0, v)));
            assert_eq!(u.try_into_u128().unwrap(), v);
        }
    }

    #[test]
    fn test_max() {
        let v = u128::MAX;
        let u = U256Muldiv::from(v);
        assert!(u.eq(U256Muldiv::new(0, v)));
        assert_eq!(u.try_into_u128().unwrap(), v);
    }
}
