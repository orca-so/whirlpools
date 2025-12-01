//use anchor_lang::{prelude::*, system_program};

use arrayvec::ArrayVec;
use pinocchio::{
    account_info::AccountInfo,
    pubkey::{pubkey_eq, Pubkey},
};

use crate::pinocchio::errors::WhirlpoolErrorCode;
use crate::pinocchio::state::whirlpool::tick_array::loader::{
    load_tick_array_mut, LoadedTickArrayMut,
};
use crate::pinocchio::Result;
use crate::{
    math::floor_division,
    pinocchio::{
        constants::address::{SYSTEM_PROGRAM_ID, WHIRLPOOL_PROGRAM_ID},
        ported::util_swap_tick_sequence::SwapTickSequence,
        state::whirlpool::{proxy::ProxiedTickArray, TickArray, TICK_ARRAY_SIZE},
    },
    state::Tick,
};

// TODO: rename
const MAX_TRAVERSABLE_TICK_ARRAYS_LEN: usize = 3;
const MAX_TICK_ARRAY_ACCOUNT_INFOS_LEN: usize =
    MAX_TRAVERSABLE_TICK_ARRAYS_LEN + crate::util::MAX_SUPPLEMENTAL_TICK_ARRAYS_LEN;

pub struct SparseSwapTickSequenceBuilder<'a> {
    // AccountInfo ownership must be kept while using RefMut.
    // This is why try_from and build are separated and SparseSwapTickSequenceBuilder struct is used.
    tick_array_account_infos: ArrayVec<&'a AccountInfo, MAX_TICK_ARRAY_ACCOUNT_INFOS_LEN>,
}

impl<'a> SparseSwapTickSequenceBuilder<'a> {
    /// Create a new SparseSwapTickSequenceBuilder from the given tick array accounts.
    ///
    /// static_tick_array_account_infos and supplemental_tick_array_account_infos will be merged,
    /// and deduplicated by key. TickArray accounts can be provided in any order.
    ///
    /// Even if over three tick arrays are provided, only three tick arrays are used in the single swap.
    /// The extra TickArray acts as a fallback in case the current price moves.
    pub fn new(
        tick_array_0_info: &'a AccountInfo,
        tick_array_1_info: &'a AccountInfo,
        tick_array_2_info: &'a AccountInfo,
        supplemental_tick_arrays: &Option<Vec<&'a AccountInfo>>,
    ) -> Self {
        let mut all_tick_array_account_infos: ArrayVec<
            &AccountInfo,
            MAX_TICK_ARRAY_ACCOUNT_INFOS_LEN,
        > = ArrayVec::new();

        all_tick_array_account_infos.push(tick_array_0_info);
        all_tick_array_account_infos.push(tick_array_1_info);
        all_tick_array_account_infos.push(tick_array_2_info);
        if let Some(supplemental_tick_arrays) = supplemental_tick_arrays {
            all_tick_array_account_infos.extend(supplemental_tick_arrays.iter().copied());
        }

        // dedup by key
        all_tick_array_account_infos.sort_by_key(|info| info.key());
        let mut tick_array_account_infos: ArrayVec<&AccountInfo, MAX_TICK_ARRAY_ACCOUNT_INFOS_LEN> =
            ArrayVec::new();
        tick_array_account_infos.push(all_tick_array_account_infos[0]);
        for info in all_tick_array_account_infos.iter().skip(1) {
            if !pubkey_eq(info.key(), tick_array_account_infos.last().unwrap().key()) {
                tick_array_account_infos.push(info);
            }
        }

        Self {
            tick_array_account_infos,
        }
    }

    /// # Parameters
    /// - `whirlpool_key` - Whirlpool account Pubkey
    /// - `tick_current_index` - Current tick index of the whirlpool
    /// - `tick_spacing` - Tick spacing of the whirlpool
    /// - `a_to_b` - Direction of the swap
    ///
    /// # Errors
    /// - `DifferentWhirlpoolTickArrayAccount` - If the provided TickArray account is not for the whirlpool
    /// - `InvalidTickArraySequence` - If no valid TickArray account for the swap is found
    /// - `AccountNotMutable` - If the provided TickArray account is not mutable
    /// - `AccountOwnedByWrongProgram` - If the provided initialized TickArray account is not owned by this program
    /// - `AccountDiscriminatorNotFound` - If the provided TickArray account does not have a discriminator
    /// - `AccountDiscriminatorMismatch` - If the provided TickArray account has a mismatched discriminator
    pub fn try_build(
        &self,
        whirlpool_key: &Pubkey,
        tick_current_index: i32,
        tick_spacing: u16,
        a_to_b: bool,
    ) -> Result<SwapTickSequence<'a>> {
        let mut loaded_tick_arrays: ArrayVec<LoadedTickArrayMut, MAX_TICK_ARRAY_ACCOUNT_INFOS_LEN> =
            ArrayVec::new();
        for tick_array_info in self.tick_array_account_infos.iter() {
            if let Some(loaded_tick_array) = maybe_load_tick_array(tick_array_info, whirlpool_key)?
            {
                loaded_tick_arrays.push(loaded_tick_array);
            }
        }

        let start_tick_indexes = get_start_tick_indexes(tick_current_index, tick_spacing, a_to_b);
        let mut required_tick_arrays: ArrayVec<ProxiedTickArray, MAX_TRAVERSABLE_TICK_ARRAYS_LEN> =
            ArrayVec::new();
        for start_tick_index in start_tick_indexes.iter() {
            let pos = loaded_tick_arrays
                .iter()
                .position(|tick_array| tick_array.start_tick_index() == *start_tick_index);
            if let Some(pos) = pos {
                let tick_array = loaded_tick_arrays.remove(pos);
                required_tick_arrays.push(ProxiedTickArray::new_initialized(tick_array));
                continue;
            }

            let tick_array_pda = derive_tick_array_pda(whirlpool_key, *start_tick_index);
            let has_account_info = self
                .tick_array_account_infos
                .iter()
                .any(|account_info| pubkey_eq(account_info.key(), &tick_array_pda));
            if has_account_info {
                required_tick_arrays.push(ProxiedTickArray::new_uninitialized(*start_tick_index));
                continue;
            }
            break;
        }

        if required_tick_arrays.is_empty() {
            return Err(WhirlpoolErrorCode::InvalidTickArraySequence.into());
        }

        // Reverse to pop from the front efficiently
        required_tick_arrays.reverse();
        Ok(SwapTickSequence::new_with_proxy(
            required_tick_arrays.pop().unwrap(),
            required_tick_arrays.pop(),
            required_tick_arrays.pop(),
        ))
    }
}

fn derive_tick_array_pda(whirlpool_key: &Pubkey, start_tick_index: i32) -> Pubkey {
    crate::pinocchio::utils::pda::find_program_address(
        &[
            b"tick_array",
            whirlpool_key.as_ref(),
            start_tick_index.to_string().as_bytes(),
        ],
        &WHIRLPOOL_PROGRAM_ID,
    )
    .0
}

fn maybe_load_tick_array<'a>(
    account_info: &'a AccountInfo,
    whirlpool_key: &Pubkey,
) -> Result<Option<LoadedTickArrayMut<'a>>> {
    if account_info.is_owned_by(&SYSTEM_PROGRAM_ID) && account_info.data_is_empty() {
        return Ok(None);
    }

    let tick_array = load_tick_array_mut(account_info, whirlpool_key)?;
    Ok(Some(tick_array))
}

fn get_start_tick_indexes(
    tick_current_index: i32,
    tick_spacing: u16,
    a_to_b: bool,
) -> ArrayVec<i32, MAX_TRAVERSABLE_TICK_ARRAYS_LEN> {
    let tick_spacing_u16 = tick_spacing;
    let tick_spacing_i32 = tick_spacing as i32;
    let ticks_in_array = TICK_ARRAY_SIZE * tick_spacing_i32;

    let start_tick_index_base = floor_division(tick_current_index, ticks_in_array) * ticks_in_array;
    let offset = if a_to_b {
        [0, -1, -2]
    } else {
        let shifted =
            tick_current_index + tick_spacing_i32 >= start_tick_index_base + ticks_in_array;
        if shifted {
            [1, 2, 3]
        } else {
            [0, 1, 2]
        }
    };

    let mut start_tick_indexes = ArrayVec::new();
    offset.iter().for_each(|&o| {
        let start_tick_index = start_tick_index_base + o * ticks_in_array;
        // TODO: we should remove Tick::check_is_valid_start_tick because it uses division, but we can assure that
        // start_tick_index is always one of multiples of tick_spacing * TICK_ARRAY_SIZE.
        // So there is no need to check it using division here.
        if Tick::check_is_valid_start_tick(start_tick_index, tick_spacing_u16) {
            start_tick_indexes.push(start_tick_index);
        }
    });

    start_tick_indexes
}

#[cfg(test)]
mod sparse_swap_tick_sequence_tests {
    use super::*;
    use crate::util::test_utils::account_info_mock::AccountInfoMock;
    use pinocchio_pubkey::pubkey;

    #[test]
    fn test_derive_tick_array_pda() {
        let whirlpool_key = pubkey!("HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ"); // well-known whirlpool key (SOL/USDC(ts=64))

        let ta_start_neg_11264 = derive_tick_array_pda(&whirlpool_key, -11264);
        assert_eq!(
            ta_start_neg_11264,
            pubkey!("81T5kNuPRkyVzhwbe2RpKR7wmQpGJ7RBkGPdTqyfa5vq")
        );

        let ta_start_neg_5632 = derive_tick_array_pda(&whirlpool_key, -5632);
        assert_eq!(
            ta_start_neg_5632,
            pubkey!("9K1HWrGKZKfjTnKfF621BmEQdai4FcUz9tsoF41jwz5B")
        );

        let ta_start_0 = derive_tick_array_pda(&whirlpool_key, 0);
        assert_eq!(
            ta_start_0,
            pubkey!("JCpxMSDRDPBMqjoX7LkhMwro2y6r85Q8E6p5zNdBZyWa")
        );

        let ta_start_5632 = derive_tick_array_pda(&whirlpool_key, 5632);
        assert_eq!(
            ta_start_5632,
            pubkey!("BW2Mr823NUQN7vnVpv5E6yCTnqEXQ3ZnqjZyiywXPcUp")
        );

        let ta_start_11264 = derive_tick_array_pda(&whirlpool_key, 11264);
        assert_eq!(
            ta_start_11264,
            pubkey!("2ezvsnoXdukw5dAAZ4EkW67bmUo8PHRPX8ZDqf76BKtV")
        );
    }

    mod test_get_start_tick_indexes {
        use super::*;

        // a to b
        // a to b (not shifted)
        // a to b (only 2 ta)
        // a to b (only 1 ta)
        // b to a (not shifted)
        // b to a (shifted)
        // b to a (only 2 ta)
        // b to a (only 1 ta)

        fn do_test(a_to_b: bool, tick_spacing: u16, tick_current_index: i32, expected: Vec<i32>) {
            let start_tick_indexes =
                get_start_tick_indexes(tick_current_index, tick_spacing, a_to_b);
            assert_eq!(start_tick_indexes.to_vec(), expected);
        }

        mod tick_spacing_1 {
            use super::*;

            #[test]
            fn a_to_b() {
                do_test(true, 1, 0, vec![0, -88, -176]);
            }

            #[test]
            fn a_to_b_not_shifted() {
                do_test(true, 1, -1, vec![-88, -176, -264]);
            }

            #[test]
            fn a_to_b_only_2_ta() {
                do_test(true, 1, -443608, vec![-443608, -443696]);
            }

            #[test]
            fn a_to_b_only_1_ta() {
                do_test(true, 1, -443635, vec![-443696]);
            }

            #[test]
            fn b_to_a_not_shifted() {
                do_test(false, 1, 86, vec![0, 88, 176]);
            }

            #[test]
            fn b_to_a_shifted() {
                do_test(false, 1, 87, vec![88, 176, 264]);
            }

            #[test]
            fn b_to_a_only_2_ta() {
                do_test(false, 1, 443600, vec![443520, 443608]);
            }

            #[test]
            fn b_to_a_only_1_ta() {
                do_test(false, 1, 443608, vec![443608]);
            }
        }

        mod tick_spacing_64 {
            use super::*;

            #[test]
            fn a_to_b() {
                do_test(true, 64, 0, vec![0, -5632, -11264]);
            }

            #[test]
            fn a_to_b_not_shifted() {
                do_test(true, 64, -64, vec![-5632, -11264, -16896]);
            }

            #[test]
            fn a_to_b_only_2_ta() {
                do_test(true, 64, -439296, vec![-439296, -444928]);
            }

            #[test]
            fn a_to_b_only_1_ta() {
                do_test(true, 64, -443635, vec![-444928]);
            }

            #[test]
            fn b_to_a_not_shifted() {
                do_test(false, 64, 5567, vec![0, 5632, 11264]);
            }

            #[test]
            fn b_to_a_shifted() {
                do_test(false, 64, 5568, vec![5632, 11264, 16896]);
            }

            #[test]
            fn b_to_a_only_2_ta() {
                do_test(false, 64, 439200, vec![433664, 439296]);
            }

            #[test]
            fn b_to_a_only_1_ta() {
                do_test(false, 64, 443608, vec![439296]);
            }
        }

        mod tick_spacing_32768 {
            use super::*;

            #[test]
            fn a_to_b() {
                do_test(true, 32768, 0, vec![0, -2883584]);
            }

            #[test]
            fn a_to_b_not_shifted() {
                do_test(true, 32768, -1, vec![-2883584]);
            }

            #[test]
            fn a_to_b_only_2_ta() {
                do_test(true, 32768, 443635, vec![0, -2883584]);
            }

            #[test]
            fn a_to_b_only_1_ta() {
                do_test(true, 32768, -443635, vec![-2883584]);
            }

            #[test]
            fn b_to_a_not_shifted() {
                do_test(false, 32768, -32769, vec![-2883584, 0]);
            }

            #[test]
            fn b_to_a_shifted() {
                do_test(false, 32768, -32768, vec![0]);
            }

            #[test]
            fn b_to_a_only_2_ta() {
                do_test(false, 32768, -443635, vec![-2883584, 0]);
            }

            #[test]
            fn b_to_a_only_1_ta() {
                do_test(false, 32768, 443608, vec![0]);
            }
        }
    }

    mod test_sparse_swap_tick_sequence_builder {
        use crate::{
            pinocchio::utils::tests::{
                generate_pubkey::generate_pubkey, test_account_info::TestAccountInfo,
            },
            state::TICK_ARRAY_SIZE_USIZE,
        };

        use super::*;

        #[test]
        fn check_zeroed_tick_array_data() {
            let whirlpool_address = generate_pubkey();
            let whirlpool_tick_spacing = 64;
            let whirlpool_tick_current_index = 5650;

            // uninitialized
            let ta0_address = derive_tick_array_pda(&whirlpool_address, 5632);
            let ta0 = TestAccountInfo::new(0)
                .key(&ta0_address)
                .owner(&SYSTEM_PROGRAM_ID)
                .writable();

            let builder = SparseSwapTickSequenceBuilder::new(
                &ta0.account_info,
                &ta0.account_info,
                &ta0.account_info,
                &None,
            );

            assert_eq!(builder.tick_array_account_infos.len(), 1);
            let swap_tick_sequence = builder
                .try_build(
                    &whirlpool_address,
                    whirlpool_tick_current_index,
                    whirlpool_tick_spacing,
                    false,
                )
                .unwrap();

            for i in 0..TICK_ARRAY_SIZE_USIZE {
                let tick = swap_tick_sequence
                    .get_tick(0, 5632 + (i as i32) * 64, 64)
                    .unwrap();

                let initialized = tick.initialized();
                assert!(!initialized);
                let liquidity_net = tick.liquidity_net();
                assert_eq!(liquidity_net, 0);
                let liquidity_gross = tick.liquidity_gross();
                assert_eq!(liquidity_gross, 0);
                let fee_growth_outside_a = tick.fee_growth_outside_a();
                assert_eq!(fee_growth_outside_a, 0);
                let fee_growth_outside_b = tick.fee_growth_outside_b();
                assert_eq!(fee_growth_outside_b, 0);
                let reward_growth_outside_r0 = tick.reward_growths_outside()[0];
                assert_eq!(reward_growth_outside_r0, 0);
                let reward_growth_outside_r1 = tick.reward_growths_outside()[1];
                assert_eq!(reward_growth_outside_r1, 0);
                let reward_growth_outside_r2 = tick.reward_growths_outside()[2];
                assert_eq!(reward_growth_outside_r2, 0);
            }
        }

        #[test]
        fn dedup_tick_array_account_infos() {
            let whirlpool_address = generate_pubkey();
            let whirlpool_tick_spacing = 64;
            let whirlpool_tick_current_index = 0;

            // initialized
            let ta0_address = derive_tick_array_pda(&whirlpool_address, 0);
            let ta0 = TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 0)
                .key(&ta0_address)
                .writable();

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool_address, 5632);
            let ta1 = TestAccountInfo::new(0)
                .key(&ta1_address)
                .owner(&SYSTEM_PROGRAM_ID)
                .writable();

            // initialized
            let ta2_address = derive_tick_array_pda(&whirlpool_address, 11264);
            let ta2 = TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 11264)
                .key(&ta2_address)
                .writable();

            let builder = SparseSwapTickSequenceBuilder::new(
                &ta0.account_info,
                &ta0.account_info,
                &ta1.account_info,
                &Some(vec![
                    &ta1.account_info,
                    &ta2.account_info,
                    &ta2.account_info,
                ]),
            );
            let swap_tick_sequence = builder
                .try_build(
                    &whirlpool_address,
                    whirlpool_tick_current_index,
                    whirlpool_tick_spacing,
                    false,
                )
                .unwrap();

            assert_eq!(swap_tick_sequence.arrays.len(), 3);
            assert_eq!(swap_tick_sequence.arrays[0].start_tick_index(), 0);
            assert_eq!(swap_tick_sequence.arrays[1].start_tick_index(), 5632);
            assert_eq!(swap_tick_sequence.arrays[2].start_tick_index(), 11264);
        }

        #[test]
        fn ignore_wrong_uninitialized_tick_array() {
            let whirlpool_address = generate_pubkey();
            let whirlpool_tick_spacing = 64;
            let whirlpool_tick_current_index = 0;

            let another_whirlpool_address = generate_pubkey();

            // initialized
            let ta0_address = derive_tick_array_pda(&whirlpool_address, 0);
            let ta0 = TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 0)
                .key(&ta0_address)
                .writable();

            // uninitialized and for another whirlpool
            let ta1_address = derive_tick_array_pda(&another_whirlpool_address, 5632);
            let ta1 = TestAccountInfo::new(0)
                .key(&ta1_address)
                .owner(&SYSTEM_PROGRAM_ID)
                .writable();

            let builder = SparseSwapTickSequenceBuilder::new(
                &ta0.account_info,
                &ta0.account_info,
                &ta1.account_info,
                &None,
            );
            let swap_tick_sequence = builder
                .try_build(
                    &whirlpool_address,
                    whirlpool_tick_current_index,
                    whirlpool_tick_spacing,
                    false,
                )
                .unwrap();

            // ta1 should be ignored
            assert_eq!(swap_tick_sequence.arrays.len(), 1);
            assert_eq!(swap_tick_sequence.arrays[0].start_tick_index(), 0);
        }

        #[test]
        fn fail_if_no_appropriate_tick_arrays() {
            let whirlpool_address = generate_pubkey();
            let whirlpool_tick_spacing = 64;
            let whirlpool_tick_current_index = 1;

            let ta0_address = derive_tick_array_pda(&whirlpool_address, 5632);
            let ta0 = TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 5632)
                .key(&ta0_address)
                .writable();

            let ta1_address = derive_tick_array_pda(&whirlpool_address, 11264);
            let ta1 = TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 11264)
                .key(&ta1_address)
                .writable();

            let builder = SparseSwapTickSequenceBuilder::new(
                &ta0.account_info,
                &ta1.account_info,
                &ta1.account_info,
                &None,
            );
            let result = builder.try_build(
                &whirlpool_address,
                whirlpool_tick_current_index,
                whirlpool_tick_spacing,
                false,
            );
            assert!(result.is_err());
            //TODO: fix
            /*
            assert!(result
                .err()
                .unwrap()
                .to_string()
                .contains("InvalidTickArraySequence"));
            */
        }

        #[test]
        fn adjust_tick_array_account_ordering() {
            let whirlpool_address = generate_pubkey();
            let whirlpool_tick_spacing = 64;
            let whirlpool_tick_current_index = -65; // no shift

            // initialized
            let ta0_address = derive_tick_array_pda(&whirlpool_address, 0);
            let ta0 = TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 0)
                .key(&ta0_address)
                .writable();

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool_address, 5632);
            let ta1 = TestAccountInfo::new(0)
                .key(&ta1_address)
                .owner(&SYSTEM_PROGRAM_ID)
                .writable();

            // initialized
            let ta2_address = derive_tick_array_pda(&whirlpool_address, 11264);
            let ta2 = TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 11264)
                .key(&ta2_address)
                .writable();

            // initialized
            let ta3_address = derive_tick_array_pda(&whirlpool_address, -5632);
            let ta3 = TestAccountInfo::new_fixed_tick_array(&whirlpool_address, -5632)
                .key(&ta3_address)
                .writable();

            let builder = SparseSwapTickSequenceBuilder::new(
                // reverse order
                &ta2.account_info,
                &ta1.account_info,
                &ta0.account_info,
                &Some(vec![&ta3.account_info]),
            );
            let swap_tick_sequence = builder
                .try_build(
                    &whirlpool_address,
                    whirlpool_tick_current_index,
                    whirlpool_tick_spacing,
                    false,
                )
                .unwrap();

            assert_eq!(swap_tick_sequence.arrays.len(), 3);
            assert_eq!(swap_tick_sequence.arrays[0].start_tick_index(), -5632);
            assert_eq!(swap_tick_sequence.arrays[1].start_tick_index(), 0);
            assert_eq!(swap_tick_sequence.arrays[2].start_tick_index(), 5632);
        }

        #[test]
        fn uninitialized_tick_array_not_provided() {
            let whirlpool_address = generate_pubkey();
            let whirlpool_tick_spacing = 64;
            let whirlpool_tick_current_index = -65; // no shift

            // initialized
            let ta0_address = derive_tick_array_pda(&whirlpool_address, 0);
            let ta0 = TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 0)
                .key(&ta0_address)
                .writable();

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool_address, 5632);
            let ta1 = TestAccountInfo::new(0)
                .key(&ta1_address)
                .owner(&SYSTEM_PROGRAM_ID)
                .writable();

            // initialized
            let ta2_address = derive_tick_array_pda(&whirlpool_address, 11264);
            let ta2 = TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 11264)
                .key(&ta2_address)
                .writable();

            // initialized
            let ta3_address = derive_tick_array_pda(&whirlpool_address, -5632);
            let ta3 = TestAccountInfo::new_fixed_tick_array(&whirlpool_address, -5632)
                .key(&ta3_address)
                .writable();

            let builder = SparseSwapTickSequenceBuilder::new(
                &ta3.account_info, // -5632
                &ta0.account_info, // 0
                // no ta1 provided
                &ta2.account_info, // 11264
                &None,
            );
            let swap_tick_sequence = builder
                .try_build(
                    &whirlpool_address,
                    whirlpool_tick_current_index,
                    whirlpool_tick_spacing,
                    false,
                )
                .unwrap();

            // -5632 should be used as the first tick array
            // 5632 should not be included because it is not provided
            assert_eq!(swap_tick_sequence.arrays.len(), 2);
            assert_eq!(swap_tick_sequence.arrays[0].start_tick_index(), -5632);
            assert_eq!(swap_tick_sequence.arrays[1].start_tick_index(), 0);
        }

        #[test]
        fn all_tick_array_uninitialized() {
            let whirlpool_address = generate_pubkey();
            let whirlpool_tick_spacing = 64;
            let whirlpool_tick_current_index = 6000;

            // uninitialized
            let ta0_address = derive_tick_array_pda(&whirlpool_address, 0);
            let ta0 = TestAccountInfo::new(0)
                .key(&ta0_address)
                .owner(&SYSTEM_PROGRAM_ID)
                .writable();

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool_address, 5632);
            let ta1 = TestAccountInfo::new(0)
                .key(&ta1_address)
                .owner(&SYSTEM_PROGRAM_ID)
                .writable();

            // uninitialized
            let ta2_address = derive_tick_array_pda(&whirlpool_address, 11264);
            let ta2 = TestAccountInfo::new(0)
                .key(&ta2_address)
                .owner(&SYSTEM_PROGRAM_ID)
                .writable();

            // uninitialized
            let ta3_address = derive_tick_array_pda(&whirlpool_address, -5632);
            let ta3 = TestAccountInfo::new(0)
                .key(&ta3_address)
                .owner(&SYSTEM_PROGRAM_ID)
                .writable();

            let builder = SparseSwapTickSequenceBuilder::new(
                &ta0.account_info, // 0
                &ta1.account_info, // 5632
                &ta2.account_info, // 11264
                &Some(vec![
                    &ta3.account_info, // -5632
                ]),
            );
            let swap_tick_sequence = builder
                .try_build(
                    &whirlpool_address,
                    whirlpool_tick_current_index,
                    whirlpool_tick_spacing,
                    true,
                )
                .unwrap();

            // 5632 should be used as the first tick array and its direction should be a to b.
            assert_eq!(swap_tick_sequence.arrays.len(), 3);
            assert_eq!(swap_tick_sequence.arrays[0].start_tick_index(), 5632);
            assert_eq!(swap_tick_sequence.arrays[1].start_tick_index(), 0);
            assert_eq!(swap_tick_sequence.arrays[2].start_tick_index(), -5632);
        }

        #[test]
        fn fail_if_uninitialized_account_is_not_empty() {
            let whirlpool_address = generate_pubkey();
            let whirlpool_tick_spacing = 64;
            let whirlpool_tick_current_index = 0;

            // initialized
            let ta0_address = derive_tick_array_pda(&whirlpool_address, 0);
            let ta0 = TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 0)
                .key(&ta0_address)
                .writable();

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool_address, 5632);
            let ta1 = TestAccountInfo::new(8) // not empty
                .key(&ta1_address)
                .owner(&SYSTEM_PROGRAM_ID)
                .writable();

            // initialized
            let ta2_address = derive_tick_array_pda(&whirlpool_address, 11264);
            let ta2 = TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 11264)
                .key(&ta2_address)
                .writable();

            let builder = SparseSwapTickSequenceBuilder::new(
                &ta0.account_info,
                &ta1.account_info,
                &ta2.account_info,
                &None,
            );
            let result = builder.try_build(
                &whirlpool_address,
                whirlpool_tick_current_index,
                whirlpool_tick_spacing,
                false,
            );
            assert!(result.is_err());
            //TODO: fix
            /*
            assert!(result
                .err()
                .unwrap()
                .to_string()
                .contains("AccountOwnedByWrongProgram"));
            */
        }
    }

    mod test_proxied_tick_array {
        use crate::{
            pinocchio::utils::tests::{
                generate_pubkey::generate_pubkey, test_account_info::TestAccountInfo,
            },
            state::TICK_ARRAY_SIZE_USIZE,
        };

        use super::*;

        fn to_proxied_tick_array_initialized<'a>(
            account_info: &'a AccountInfo,
            whirlpool_key: &Pubkey,
        ) -> ProxiedTickArray<'a> {
            let loaded_tick_array =
                crate::pinocchio::state::whirlpool::tick_array::loader::load_tick_array_mut(
                    account_info,
                    whirlpool_key,
                )
                .unwrap();
            ProxiedTickArray::new_initialized(loaded_tick_array)
        }

        #[test]
        fn initialized_start_tick_index() {
            let whirlpool_address = generate_pubkey();
            let tick_array_address = generate_pubkey();
            let start_28160 = TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 28160)
                .key(&tick_array_address)
                .writable();

            let proxied_28160 =
                to_proxied_tick_array_initialized(&start_28160.account_info, &whirlpool_address);
            assert_eq!(proxied_28160.start_tick_index(), 28160);
        }

        #[test]
        fn uninitialized_start_tick_index() {
            let proxied_56320 = ProxiedTickArray::new_uninitialized(56320);
            assert_eq!(proxied_56320.start_tick_index(), 56320);
        }

        #[test]
        fn initialized_get_and_update_tick() {
            let whirlpool_address = generate_pubkey();
            let tick_array_address = generate_pubkey();
            let start_28160 = TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 28160)
                .key(&tick_array_address)
                .writable();

            let mut proxied_28160 =
                to_proxied_tick_array_initialized(&start_28160.account_info, &whirlpool_address);

            let tick = proxied_28160.get_tick(28160 + 64, 64).unwrap();
            assert!(!tick.initialized());

            proxied_28160
                .update_tick(
                    28160 + 64,
                    64,
                    &TickUpdate {
                        initialized: true,
                        ..Default::default()
                    },
                )
                .unwrap();

            let tick = proxied_28160.get_tick(28160 + 64, 64).unwrap();
            assert!(tick.initialized());
        }

        #[test]
        fn uninitialized_get_tick() {
            let proxied_56320 = ProxiedTickArray::new_uninitialized(56320);
            for i in 0..TICK_ARRAY_SIZE_USIZE {
                let tick = proxied_56320.get_tick(56320 + (i as i32) * 64, 64).unwrap();
                assert!(!tick.initialized());
            }
        }

        #[test]
        #[should_panic]
        fn panic_uninitialized_update_tick() {
            let mut proxied_56320 = ProxiedTickArray::new_uninitialized(56320);

            // uninitialized tick must not be updated, so updating ProxiedTickArray::Uninitialized should panic
            proxied_56320
                .update_tick(
                    56320 + 64,
                    64,
                    &TickUpdate {
                        initialized: true,
                        ..Default::default()
                    },
                )
                .unwrap();
        }

        #[test]
        fn initialized_is_min_tick_array() {
            let whirlpool_address = generate_pubkey();
            let start_28160 =
                TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 28160).writable();
            let proxied_28160 =
                to_proxied_tick_array_initialized(&start_28160.account_info, &whirlpool_address);
            assert!(!proxied_28160.is_min_tick_array());

            let start_neg_444928 =
                TestAccountInfo::new_fixed_tick_array(&whirlpool_address, -444928).writable();
            let proxied_neg_444928 = to_proxied_tick_array_initialized(
                &start_neg_444928.account_info,
                &whirlpool_address,
            );
            assert!(proxied_neg_444928.is_min_tick_array());
        }

        #[test]
        fn uninitialized_is_min_tick_array() {
            let proxied_56320 = ProxiedTickArray::new_uninitialized(56320);
            assert!(!proxied_56320.is_min_tick_array());

            let proxied_neg_444928 = ProxiedTickArray::new_uninitialized(-444928);
            assert!(proxied_neg_444928.is_min_tick_array());
        }

        #[test]
        fn initialized_is_max_tick_array() {
            let whirlpool_address = generate_pubkey();
            let start_28160 =
                TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 28160).writable();
            let proxied_28160 =
                to_proxied_tick_array_initialized(&start_28160.account_info, &whirlpool_address);
            assert!(!proxied_28160.is_max_tick_array(64));

            let start_439296 =
                TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 439296).writable();
            let proxied_439296 =
                to_proxied_tick_array_initialized(&start_439296.account_info, &whirlpool_address);
            assert!(proxied_439296.is_max_tick_array(64));
        }

        #[test]
        fn uninitialized_is_max_tick_array() {
            let proxied_56320 = ProxiedTickArray::new_uninitialized(56320);
            assert!(!proxied_56320.is_max_tick_array(64));

            let proxied_439296 = ProxiedTickArray::new_uninitialized(439296);
            assert!(proxied_439296.is_max_tick_array(64));
        }

        #[test]
        fn initialized_tick_offset() {
            let whirlpool_address = generate_pubkey();
            let start_28160 =
                TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 28160).writable();
            let proxied_28160 =
                to_proxied_tick_array_initialized(&start_28160.account_info, &whirlpool_address);

            for i in 0..TICK_ARRAY_SIZE_USIZE {
                let offset = proxied_28160
                    .tick_offset(28160 + 64 * (i as i32), 64)
                    .unwrap();
                assert_eq!(offset, i as isize);
            }
        }

        #[test]
        fn uninitialized_tick_offset() {
            let proxied_56320 = ProxiedTickArray::new_uninitialized(56320);
            for i in 0..TICK_ARRAY_SIZE_USIZE {
                let offset = proxied_56320
                    .tick_offset(56320 + 64 * (i as i32), 64)
                    .unwrap();
                assert_eq!(offset, i as isize);
            }
        }

        #[test]
        fn initialized_get_next_init_tick_index() {
            let whirlpool_address = generate_pubkey();
            let start_28160 =
                TestAccountInfo::new_fixed_tick_array(&whirlpool_address, 28160).writable();
            let mut proxied_28160 =
                to_proxied_tick_array_initialized(&start_28160.account_info, &whirlpool_address);

            proxied_28160
                .update_tick(
                    28160 + 64 * 16,
                    64,
                    &TickUpdate {
                        initialized: true,
                        ..Default::default()
                    },
                )
                .unwrap();

            let next_initialized_tick_index = proxied_28160
                .get_next_init_tick_index(28160, 64, false)
                .unwrap()
                .unwrap();
            assert_eq!(next_initialized_tick_index, 28160 + 64 * 16);
        }

        #[test]
        fn uninitialized_get_next_init_tick_index() {
            let proxied_56320 = ProxiedTickArray::new_uninitialized(56320);
            let next_initialized_tick_index = proxied_56320
                .get_next_init_tick_index(56320, 64, false)
                .unwrap();
            assert!(next_initialized_tick_index.is_none());
        }
    }
}
