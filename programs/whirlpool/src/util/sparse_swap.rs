use anchor_lang::{prelude::*, system_program};
use std::collections::VecDeque;

use crate::{
    math::floor_division,
    state::{
        FixedTickArray, Tick, TickArrayType, TickUpdate, Whirlpool, ZeroedTickArray,
        TICK_ARRAY_SIZE,
    },
    util::SwapTickSequence,
};

use crate::state::{load_tick_array_mut, LoadedTickArrayMut};

pub(crate) enum ProxiedTickArray<'a> {
    Initialized(LoadedTickArrayMut<'a>),
    Uninitialized(ZeroedTickArray),
}

impl<'a> ProxiedTickArray<'a> {
    pub fn new_initialized(refmut: LoadedTickArrayMut<'a>) -> Self {
        ProxiedTickArray::Initialized(refmut)
    }

    pub fn new_uninitialized(start_tick_index: i32) -> Self {
        ProxiedTickArray::Uninitialized(ZeroedTickArray::new(start_tick_index))
    }

    pub fn start_tick_index(&self) -> i32 {
        self.as_ref().start_tick_index()
    }

    pub fn get_next_init_tick_index(
        &self,
        tick_index: i32,
        tick_spacing: u16,
        a_to_b: bool,
    ) -> Result<Option<i32>> {
        self.as_ref()
            .get_next_init_tick_index(tick_index, tick_spacing, a_to_b)
    }

    pub fn get_tick(&self, tick_index: i32, tick_spacing: u16) -> Result<Tick> {
        self.as_ref().get_tick(tick_index, tick_spacing)
    }

    pub fn update_tick(
        &mut self,
        tick_index: i32,
        tick_spacing: u16,
        update: &TickUpdate,
    ) -> Result<()> {
        self.as_mut().update_tick(tick_index, tick_spacing, update)
    }

    pub fn is_min_tick_array(&self) -> bool {
        self.as_ref().is_min_tick_array()
    }

    pub fn is_max_tick_array(&self, tick_spacing: u16) -> bool {
        self.as_ref().is_max_tick_array(tick_spacing)
    }

    pub fn tick_offset(&self, tick_index: i32, tick_spacing: u16) -> Result<isize> {
        self.as_ref().tick_offset(tick_index, tick_spacing)
    }
}

impl<'a> AsRef<dyn TickArrayType + 'a> for ProxiedTickArray<'a> {
    fn as_ref(&self) -> &(dyn TickArrayType + 'a) {
        match self {
            ProxiedTickArray::Initialized(ref array) => &**array,
            ProxiedTickArray::Uninitialized(ref array) => array,
        }
    }
}

impl<'a> AsMut<dyn TickArrayType + 'a> for ProxiedTickArray<'a> {
    fn as_mut(&mut self) -> &mut (dyn TickArrayType + 'a) {
        match self {
            ProxiedTickArray::Initialized(ref mut array) => &mut **array,
            ProxiedTickArray::Uninitialized(ref mut array) => array,
        }
    }
}

pub struct SparseSwapTickSequenceBuilder<'info> {
    // AccountInfo ownership must be kept while using RefMut.
    // This is why try_from and build are separated and SparseSwapTickSequenceBuilder struct is used.
    tick_array_accounts: Vec<AccountInfo<'info>>,
}

impl<'info> SparseSwapTickSequenceBuilder<'info> {
    /// Create a new SparseSwapTickSequenceBuilder from the given tick array accounts.
    ///
    /// static_tick_array_account_infos and supplemental_tick_array_account_infos will be merged,
    /// and deduplicated by key. TickArray accounts can be provided in any order.
    ///
    /// Even if over three tick arrays are provided, only three tick arrays are used in the single swap.
    /// The extra TickArray acts as a fallback in case the current price moves.
    pub fn new(
        static_tick_array_account_infos: Vec<AccountInfo<'info>>,
        supplemental_tick_array_account_infos: Option<Vec<AccountInfo<'info>>>,
    ) -> Self {
        let mut tick_array_account_infos: Vec<AccountInfo<'info>> = static_tick_array_account_infos;
        if let Some(supplemental_tick_array_account_infos) = supplemental_tick_array_account_infos {
            tick_array_account_infos.extend(supplemental_tick_array_account_infos);
        }

        // dedup by key
        tick_array_account_infos.sort_by_key(|a| a.key());
        tick_array_account_infos.dedup_by_key(|a| a.key());

        Self {
            tick_array_accounts: tick_array_account_infos,
        }
    }

    /// # Parameters
    /// - `whirlpool` - Whirlpool account
    /// - `a_to_b` - Direction of the swap
    ///
    /// # Errors
    /// - `DifferentWhirlpoolTickArrayAccount` - If the provided TickArray account is not for the whirlpool
    /// - `InvalidTickArraySequence` - If no valid TickArray account for the swap is found
    /// - `AccountNotMutable` - If the provided TickArray account is not mutable
    /// - `AccountOwnedByWrongProgram` - If the provided initialized TickArray account is not owned by this program
    /// - `AccountDiscriminatorNotFound` - If the provided TickArray account does not have a discriminator
    /// - `AccountDiscriminatorMismatch` - If the provided TickArray account has a mismatched discriminator
    pub fn try_build<'a>(
        &'a self,
        whirlpool: &Account<Whirlpool>,
        a_to_b: bool,
    ) -> Result<SwapTickSequence<'a>> {
        let mut loaded_tick_arrays: Vec<LoadedTickArrayMut> = Vec::with_capacity(3);
        for account_info in &self.tick_array_accounts {
            let tick_array = maybe_load_tick_array(account_info, whirlpool)?;
            if let Some(tick_array) = tick_array {
                loaded_tick_arrays.push(tick_array);
            }
        }

        let start_tick_indexes = get_start_tick_indexes(whirlpool, a_to_b);
        let mut required_tick_arrays: VecDeque<ProxiedTickArray> = VecDeque::with_capacity(3);
        for start_tick_index in start_tick_indexes.iter() {
            let pos = loaded_tick_arrays
                .iter()
                .position(|tick_array| tick_array.start_tick_index() == *start_tick_index);
            if let Some(pos) = pos {
                let tick_array = loaded_tick_arrays.remove(pos);
                required_tick_arrays.push_back(ProxiedTickArray::new_initialized(tick_array));
                continue;
            }

            let tick_array_pda = derive_tick_array_pda(whirlpool, *start_tick_index);
            let has_account_info = self
                .tick_array_accounts
                .iter()
                .any(|account_info| account_info.key() == tick_array_pda);
            if has_account_info {
                required_tick_arrays
                    .push_back(ProxiedTickArray::new_uninitialized(*start_tick_index));
                continue;
            }
            break;
        }

        if required_tick_arrays.is_empty() {
            return Err(crate::errors::ErrorCode::InvalidTickArraySequence.into());
        }

        Ok(SwapTickSequence::new_with_proxy(
            required_tick_arrays.pop_front().unwrap(),
            required_tick_arrays.pop_front(),
            required_tick_arrays.pop_front(),
        ))
    }
}

fn maybe_load_tick_array<'a>(
    account_info: &'a AccountInfo<'_>,
    whirlpool: &Account<Whirlpool>,
) -> Result<Option<LoadedTickArrayMut<'a>>> {
    if *account_info.owner == system_program::ID && account_info.data_is_empty() {
        return Ok(None);
    }

    let tick_array = load_tick_array_mut(account_info, &whirlpool.key())?;
    Ok(Some(tick_array))
}

fn derive_tick_array_pda(whirlpool: &Account<Whirlpool>, start_tick_index: i32) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"tick_array",
            whirlpool.key().as_ref(),
            start_tick_index.to_string().as_bytes(),
        ],
        &FixedTickArray::owner(),
    )
    .0
}

fn get_start_tick_indexes(whirlpool: &Account<Whirlpool>, a_to_b: bool) -> Vec<i32> {
    let tick_current_index = whirlpool.tick_current_index;
    let tick_spacing_u16 = whirlpool.tick_spacing;
    let tick_spacing_i32 = whirlpool.tick_spacing as i32;
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

    let start_tick_indexes = offset
        .iter()
        .filter_map(|&o| {
            let start_tick_index = start_tick_index_base + o * ticks_in_array;
            if Tick::check_is_valid_start_tick(start_tick_index, tick_spacing_u16) {
                Some(start_tick_index)
            } else {
                None
            }
        })
        .collect::<Vec<i32>>();

    start_tick_indexes
}

#[cfg(test)]
mod sparse_swap_tick_sequence_tests {
    use super::*;
    use crate::util::test_utils::account_info_mock::AccountInfoMock;
    use anchor_lang::prelude::pubkey;

    #[test]
    fn test_derive_tick_array_pda() {
        let mut account_info_mock = AccountInfoMock::new_whirlpool(
            pubkey!("HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ"), // well-known whirlpool key (SOL/USDC(ts=64))
            64,
            0,
            Some(pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc")),
        );
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool_account = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let ta_start_neg_11264 = derive_tick_array_pda(&whirlpool_account, -11264);
        assert_eq!(
            ta_start_neg_11264,
            pubkey!("81T5kNuPRkyVzhwbe2RpKR7wmQpGJ7RBkGPdTqyfa5vq")
        );

        let ta_start_neg_5632 = derive_tick_array_pda(&whirlpool_account, -5632);
        assert_eq!(
            ta_start_neg_5632,
            pubkey!("9K1HWrGKZKfjTnKfF621BmEQdai4FcUz9tsoF41jwz5B")
        );

        let ta_start_0 = derive_tick_array_pda(&whirlpool_account, 0);
        assert_eq!(
            ta_start_0,
            pubkey!("JCpxMSDRDPBMqjoX7LkhMwro2y6r85Q8E6p5zNdBZyWa")
        );

        let ta_start_5632 = derive_tick_array_pda(&whirlpool_account, 5632);
        assert_eq!(
            ta_start_5632,
            pubkey!("BW2Mr823NUQN7vnVpv5E6yCTnqEXQ3ZnqjZyiywXPcUp")
        );

        let ta_start_11264 = derive_tick_array_pda(&whirlpool_account, 11264);
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
            let mut account_info_mock = AccountInfoMock::new_whirlpool(
                Pubkey::new_unique(),
                tick_spacing,
                tick_current_index,
                None,
            );
            let account_info = account_info_mock.to_account_info(true);
            let whirlpool_account = Account::<Whirlpool>::try_from(&account_info).unwrap();
            let start_tick_indexes = get_start_tick_indexes(&whirlpool_account, a_to_b);
            assert_eq!(start_tick_indexes, expected);
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
        use crate::state::TICK_ARRAY_SIZE_USIZE;

        use super::*;

        #[test]
        fn check_zeroed_tick_array_data() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock =
                AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            // uninitialized
            let ta0_address = derive_tick_array_pda(&whirlpool, 5632);
            let mut ta0_mock = AccountInfoMock::new(ta0_address, vec![], System::id());
            let ta0 = ta0_mock.to_account_info(true);

            let builder = SparseSwapTickSequenceBuilder::new(
                vec![ta0.clone(), ta0.clone(), ta0.clone()],
                None,
            );

            assert_eq!(builder.tick_array_accounts.len(), 1);
            let swap_tick_sequence = builder.try_build(&whirlpool, false).unwrap();

            for i in 0..TICK_ARRAY_SIZE_USIZE {
                let tick = swap_tick_sequence
                    .get_tick(0, 5632 + (i as i32) * 64, 64)
                    .unwrap();

                let initialized = tick.initialized;
                assert!(!initialized);
                let liquidity_net = tick.liquidity_net;
                assert_eq!(liquidity_net, 0);
                let liquidity_gross = tick.liquidity_gross;
                assert_eq!(liquidity_gross, 0);
                let fee_growth_outside_a = tick.fee_growth_outside_a;
                assert_eq!(fee_growth_outside_a, 0);
                let fee_growth_outside_b = tick.fee_growth_outside_b;
                assert_eq!(fee_growth_outside_b, 0);
                let reward_growth_outside_r0 = tick.reward_growths_outside[0];
                assert_eq!(reward_growth_outside_r0, 0);
                let reward_growth_outside_r1 = tick.reward_growths_outside[1];
                assert_eq!(reward_growth_outside_r1, 0);
                let reward_growth_outside_r2 = tick.reward_growths_outside[2];
                assert_eq!(reward_growth_outside_r2, 0);
            }
        }

        #[test]
        fn dedup_tick_array_account_infos() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock =
                AccountInfoMock::new_whirlpool(whirlpool_address, 64, 0, None);
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            // initialized
            let ta0_address = derive_tick_array_pda(&whirlpool, 0);
            let mut ta0_mock =
                AccountInfoMock::new_tick_array(ta0_address, whirlpool_address, 0, None);
            let ta0 = ta0_mock.to_account_info(true);

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool, 5632);
            let mut ta1_mock = AccountInfoMock::new(ta1_address, vec![], System::id());
            let ta1 = ta1_mock.to_account_info(true);

            // initialized
            let ta2_address = derive_tick_array_pda(&whirlpool, 11264);
            let mut ta2_mock =
                AccountInfoMock::new_tick_array(ta2_address, whirlpool_address, 11264, None);
            let ta2 = ta2_mock.to_account_info(true);

            let builder = SparseSwapTickSequenceBuilder::new(
                vec![ta0.clone(), ta0.clone(), ta1.clone()],
                Some(vec![ta1.clone(), ta2.clone(), ta2.clone()]),
            );
            let swap_tick_sequence = builder.try_build(&whirlpool, false).unwrap();

            assert_eq!(swap_tick_sequence.arrays.len(), 3);
            assert_eq!(swap_tick_sequence.arrays[0].start_tick_index(), 0);
            assert_eq!(swap_tick_sequence.arrays[1].start_tick_index(), 5632);
            assert_eq!(swap_tick_sequence.arrays[2].start_tick_index(), 11264);
        }

        #[test]
        fn ignore_wrong_uninitialized_tick_array() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock =
                AccountInfoMock::new_whirlpool(whirlpool_address, 64, 0, None);
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            let another_whirlpool_address = Pubkey::new_unique();
            let mut another_account_info_mock =
                AccountInfoMock::new_whirlpool(another_whirlpool_address, 64, 0, None);
            let another_account_info = another_account_info_mock.to_account_info(true);
            let another_whirlpool = Account::<Whirlpool>::try_from(&another_account_info).unwrap();

            let ta0_address = derive_tick_array_pda(&whirlpool, 0);
            let mut ta0_mock =
                AccountInfoMock::new_tick_array(ta0_address, whirlpool_address, 0, None);
            let ta0 = ta0_mock.to_account_info(true);

            // uninitialized and for another whirlpool
            let ta1_address = derive_tick_array_pda(&another_whirlpool, 5632);
            let mut ta1_mock = AccountInfoMock::new(ta1_address, vec![], System::id());
            let ta1 = ta1_mock.to_account_info(true);

            let builder = SparseSwapTickSequenceBuilder::new(
                vec![ta0.clone(), ta0.clone(), ta1.clone()],
                None,
            );
            let swap_tick_sequence = builder.try_build(&whirlpool, false).unwrap();

            // ta1 should be ignored
            assert_eq!(swap_tick_sequence.arrays.len(), 1);
            assert_eq!(swap_tick_sequence.arrays[0].start_tick_index(), 0);
        }

        #[test]
        fn fail_if_no_appropriate_tick_arrays() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock =
                AccountInfoMock::new_whirlpool(whirlpool_address, 64, 1, None);
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            let ta0_address = derive_tick_array_pda(&whirlpool, 5632);
            let mut ta0_mock =
                AccountInfoMock::new_tick_array(ta0_address, whirlpool_address, 5632, None);
            let ta0 = ta0_mock.to_account_info(true);

            let ta1_address = derive_tick_array_pda(&whirlpool, 11264);
            let mut ta1_mock =
                AccountInfoMock::new_tick_array(ta1_address, whirlpool_address, 11264, None);
            let ta1 = ta1_mock.to_account_info(true);

            let builder = SparseSwapTickSequenceBuilder::new(vec![ta0.clone(), ta1.clone()], None);
            let result = builder.try_build(&whirlpool, false);
            assert!(result.is_err());
            assert!(result
                .err()
                .unwrap()
                .to_string()
                .contains("InvalidTickArraySequence"));
        }

        #[test]
        fn adjust_tick_array_account_ordering() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock = AccountInfoMock::new_whirlpool(
                whirlpool_address,
                64,
                -65, // no shift
                None,
            );
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            // initialized
            let ta0_address = derive_tick_array_pda(&whirlpool, 0);
            let mut ta0_mock =
                AccountInfoMock::new_tick_array(ta0_address, whirlpool_address, 0, None);
            let ta0 = ta0_mock.to_account_info(true);

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool, 5632);
            let mut ta1_mock = AccountInfoMock::new(ta1_address, vec![], System::id());
            let ta1 = ta1_mock.to_account_info(true);

            // initialized
            let ta2_address = derive_tick_array_pda(&whirlpool, 11264);
            let mut ta2_mock =
                AccountInfoMock::new_tick_array(ta2_address, whirlpool_address, 11264, None);
            let ta2 = ta2_mock.to_account_info(true);

            // initialized
            let ta3_address = derive_tick_array_pda(&whirlpool, -5632);
            let mut ta3_mock =
                AccountInfoMock::new_tick_array(ta3_address, whirlpool_address, -5632, None);
            let ta3 = ta3_mock.to_account_info(true);

            let builder = SparseSwapTickSequenceBuilder::new(
                vec![
                    // reverse order
                    ta2.clone(), // 11264
                    ta1.clone(), // 5632
                    ta0.clone(), // 0
                ],
                Some(vec![
                    ta3.clone(), // -5632
                ]),
            );
            let swap_tick_sequence = builder.try_build(&whirlpool, false).unwrap();

            assert_eq!(swap_tick_sequence.arrays.len(), 3);
            assert_eq!(swap_tick_sequence.arrays[0].start_tick_index(), -5632);
            assert_eq!(swap_tick_sequence.arrays[1].start_tick_index(), 0);
            assert_eq!(swap_tick_sequence.arrays[2].start_tick_index(), 5632);
        }

        #[test]
        fn uninitialized_tick_array_not_provided() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock = AccountInfoMock::new_whirlpool(
                whirlpool_address,
                64,
                -65, // no shift
                None,
            );
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            // initialized
            let ta0_address = derive_tick_array_pda(&whirlpool, 0);
            let mut ta0_mock =
                AccountInfoMock::new_tick_array(ta0_address, whirlpool_address, 0, None);
            let ta0 = ta0_mock.to_account_info(true);

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool, 5632);
            let mut ta1_mock = AccountInfoMock::new(ta1_address, vec![], System::id());
            let _ta1 = ta1_mock.to_account_info(true);

            // initialized
            let ta2_address = derive_tick_array_pda(&whirlpool, 11264);
            let mut ta2_mock =
                AccountInfoMock::new_tick_array(ta2_address, whirlpool_address, 11264, None);
            let ta2 = ta2_mock.to_account_info(true);

            // initialized
            let ta3_address = derive_tick_array_pda(&whirlpool, -5632);
            let mut ta3_mock =
                AccountInfoMock::new_tick_array(ta3_address, whirlpool_address, -5632, None);
            let ta3 = ta3_mock.to_account_info(true);

            let builder = SparseSwapTickSequenceBuilder::new(
                vec![
                    ta3.clone(), // -5632
                    ta0.clone(), // 0
                    // no ta1 provided
                    ta2.clone(), // 11264
                ],
                None,
            );
            let swap_tick_sequence = builder.try_build(&whirlpool, false).unwrap();

            // -5632 should be used as the first tick array
            // 5632 should not be included because it is not provided
            assert_eq!(swap_tick_sequence.arrays.len(), 2);
            assert_eq!(swap_tick_sequence.arrays[0].start_tick_index(), -5632);
            assert_eq!(swap_tick_sequence.arrays[1].start_tick_index(), 0);
        }

        #[test]
        fn all_tick_array_uninitialized() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock =
                AccountInfoMock::new_whirlpool(whirlpool_address, 64, 6000, None);
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            // uninitialized
            let ta0_address = derive_tick_array_pda(&whirlpool, 0);
            let mut ta0_mock = AccountInfoMock::new(ta0_address, vec![], System::id());
            let ta0 = ta0_mock.to_account_info(true);

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool, 5632);
            let mut ta1_mock = AccountInfoMock::new(ta1_address, vec![], System::id());
            let ta1 = ta1_mock.to_account_info(true);

            // uninitialized
            let ta2_address = derive_tick_array_pda(&whirlpool, 11264);
            let mut ta2_mock = AccountInfoMock::new(ta2_address, vec![], System::id());
            let ta2 = ta2_mock.to_account_info(true);

            // uninitialized
            let ta3_address = derive_tick_array_pda(&whirlpool, -5632);
            let mut ta3_mock = AccountInfoMock::new(ta3_address, vec![], System::id());
            let ta3 = ta3_mock.to_account_info(true);

            let builder = SparseSwapTickSequenceBuilder::new(
                vec![
                    ta0.clone(), // 0
                    ta1.clone(), // 5632
                    ta2.clone(), // 11264
                ],
                Some(vec![
                    ta3.clone(), // -5632
                ]),
            );
            let swap_tick_sequence = builder.try_build(&whirlpool, true).unwrap();

            // 5632 should be used as the first tick array and its direction should be a to b.
            assert_eq!(swap_tick_sequence.arrays.len(), 3);
            assert_eq!(swap_tick_sequence.arrays[0].start_tick_index(), 5632);
            assert_eq!(swap_tick_sequence.arrays[1].start_tick_index(), 0);
            assert_eq!(swap_tick_sequence.arrays[2].start_tick_index(), -5632);
        }

        #[test]
        fn fail_if_uninitialized_account_is_not_empty() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock =
                AccountInfoMock::new_whirlpool(whirlpool_address, 64, 0, None);
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            // initialized
            let ta0_address = derive_tick_array_pda(&whirlpool, 0);
            let mut ta0_mock =
                AccountInfoMock::new_tick_array(ta0_address, whirlpool_address, 0, None);

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool, 5632);
            let mut ta1_mock = AccountInfoMock::new(
                ta1_address,
                vec![0u8; 8], // not empty
                System::id(),
            );

            // initialized
            let ta2_address = derive_tick_array_pda(&whirlpool, 11264);
            let mut ta2_mock =
                AccountInfoMock::new_tick_array(ta2_address, whirlpool_address, 11264, None);

            let ta0 = ta0_mock.to_account_info(true);
            let ta1 = ta1_mock.to_account_info(true);
            let ta2 = ta2_mock.to_account_info(true);
            let builder = SparseSwapTickSequenceBuilder::new(
                vec![ta0.clone(), ta1.clone(), ta2.clone()],
                None,
            );
            let result = builder.try_build(&whirlpool, false);
            assert!(result.is_err());
            assert!(result
                .err()
                .unwrap()
                .to_string()
                .contains("AccountOwnedByWrongProgram"));
        }
    }

    mod test_proxied_tick_array {
        use std::cell::RefMut;

        use crate::state::TICK_ARRAY_SIZE_USIZE;

        use super::*;

        fn to_proxied_tick_array_initialized<'a>(
            account_info: &'a AccountInfo<'a>,
        ) -> ProxiedTickArray<'a> {
            use std::ops::DerefMut;

            let data = account_info.try_borrow_mut_data().unwrap();
            let tick_array_refmut: RefMut<FixedTickArray> = RefMut::map(data, |data| {
                bytemuck::from_bytes_mut(
                    &mut data.deref_mut()[8..std::mem::size_of::<FixedTickArray>() + 8],
                )
            });
            ProxiedTickArray::new_initialized(tick_array_refmut)
        }

        #[test]
        fn initialized_start_tick_index() {
            let mut start_28160 = AccountInfoMock::new_tick_array(
                Pubkey::new_unique(),
                Pubkey::new_unique(),
                28160,
                None,
            );
            let start_28160 = start_28160.to_account_info(true);
            let proxied_28160 = to_proxied_tick_array_initialized(&start_28160);
            assert_eq!(proxied_28160.start_tick_index(), 28160);
        }

        #[test]
        fn uninitialized_start_tick_index() {
            let proxied_56320 = ProxiedTickArray::new_uninitialized(56320);
            assert_eq!(proxied_56320.start_tick_index(), 56320);
        }

        #[test]
        fn initialized_get_and_update_tick() {
            let mut start_28160 = AccountInfoMock::new_tick_array(
                Pubkey::new_unique(),
                Pubkey::new_unique(),
                28160,
                None,
            );
            let start_28160 = start_28160.to_account_info(true);
            let mut proxied_28160 = to_proxied_tick_array_initialized(&start_28160);

            let tick = proxied_28160.get_tick(28160 + 64, 64).unwrap();
            assert!(!tick.initialized);

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
            assert!(tick.initialized);
        }

        #[test]
        fn uninitialized_get_tick() {
            let proxied_56320 = ProxiedTickArray::new_uninitialized(56320);
            for i in 0..TICK_ARRAY_SIZE_USIZE {
                let tick = proxied_56320.get_tick(56320 + (i as i32) * 64, 64).unwrap();
                assert!(!tick.initialized);
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
            let mut start_28160 = AccountInfoMock::new_tick_array(
                Pubkey::new_unique(),
                Pubkey::new_unique(),
                28160,
                None,
            );
            let start_28160 = start_28160.to_account_info(true);
            let proxied_28160 = to_proxied_tick_array_initialized(&start_28160);
            assert!(!proxied_28160.is_min_tick_array());

            let mut start_neg_444928 = AccountInfoMock::new_tick_array(
                Pubkey::new_unique(),
                Pubkey::new_unique(),
                -444928,
                None,
            );
            let start_neg_444928 = start_neg_444928.to_account_info(true);
            let proxied_neg_444928 = to_proxied_tick_array_initialized(&start_neg_444928);
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
            let mut start_28160 = AccountInfoMock::new_tick_array(
                Pubkey::new_unique(),
                Pubkey::new_unique(),
                28160,
                None,
            );
            let start_28160 = start_28160.to_account_info(true);
            let proxied_28160 = to_proxied_tick_array_initialized(&start_28160);
            assert!(!proxied_28160.is_max_tick_array(64));

            let mut start_439296 = AccountInfoMock::new_tick_array(
                Pubkey::new_unique(),
                Pubkey::new_unique(),
                439296,
                None,
            );
            let start_439296 = start_439296.to_account_info(true);
            let proxied_439296 = to_proxied_tick_array_initialized(&start_439296);
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
            let mut start_28160 = AccountInfoMock::new_tick_array(
                Pubkey::new_unique(),
                Pubkey::new_unique(),
                28160,
                None,
            );
            let start_28160 = start_28160.to_account_info(true);
            let proxied_28160 = to_proxied_tick_array_initialized(&start_28160);
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
            let mut start_28160 = AccountInfoMock::new_tick_array(
                Pubkey::new_unique(),
                Pubkey::new_unique(),
                28160,
                None,
            );
            let start_28160 = start_28160.to_account_info(true);
            let mut proxied_28160 = to_proxied_tick_array_initialized(&start_28160);

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
