use anchor_lang::prelude::*;
use std::{
    cell::{Ref, RefCell, RefMut},
    collections::VecDeque,
};

use crate::{
    errors::ErrorCode,
    state::{TickArray, Whirlpool, MAX_TICK_INDEX, MIN_TICK_INDEX, TICK_ARRAY_SIZE},
    util::SwapTickSequence,
};

enum TickArrayAccount<'info> {
    Initialized {
        tick_array_whirlpool: Pubkey,
        start_tick_index: i32,
        account_info: AccountInfo<'info>,
    },
    Uninitialized {
        pubkey: Pubkey,
        account_info: AccountInfo<'info>,
        zeroed: Option<Box<RefCell<TickArray>>>,
    },
}

pub struct SparseSwapTickSequenceBuilder<'info> {
    tick_array_accounts: Vec<TickArrayAccount<'info>>,
}

impl<'info> SparseSwapTickSequenceBuilder<'info> {
    pub fn try_from(
        whirlpool: &Account<'info, Whirlpool>,
        a_to_b: bool,
        static_tick_array_account_infos: Vec<AccountInfo<'info>>,
        additional_tick_array_account_infos: Option<Vec<AccountInfo<'info>>>,
    ) -> Result<Self> {
        let mut tick_array_account_infos = static_tick_array_account_infos;
        if let Some(additional_tick_array_account_infos) = additional_tick_array_account_infos {
            tick_array_account_infos.extend(additional_tick_array_account_infos);
        }

        // dedup by key
        tick_array_account_infos.sort_by_key(|a| a.key());
        tick_array_account_infos.dedup_by_key(|a| a.key());

        let mut initialized = vec![];
        let mut uninitialized = vec![];
        for account_info in tick_array_account_infos.into_iter() {
            let state = peek_tick_array(account_info)?;

            match &state {
                TickArrayAccount::Initialized {
                    tick_array_whirlpool,
                    start_tick_index,
                    ..
                } => {
                    // has_one constraint equivalent check
                    if *tick_array_whirlpool != whirlpool.key() {
                        return Err(ErrorCode::DifferentWhirlpoolTickArrayAccount.into());
                    }

                    // TickArray accounts in initialized have been verified as:
                    //   - Owned by this program
                    //   - Initialized as TickArray account
                    //   - Writable account
                    //   - TickArray account for this whirlpool
                    // So we can safely use these accounts.
                    initialized.push((*start_tick_index, state));
                }
                TickArrayAccount::Uninitialized {
                    pubkey: account_address,
                    ..
                } => {
                    // TickArray accounts in uninitialized have been verified as:
                    //   - Owned by System program
                    //   - Data size is zero
                    //   - Writable account
                    // But we are not sure if these accounts are valid TickArray PDA for this whirlpool,
                    // so we need to check it later.
                    uninitialized.push((*account_address, state));
                }
            }
        }

        let start_tick_indexes = get_start_tick_indexes(whirlpool, a_to_b);

        let mut tick_array_accounts: Vec<TickArrayAccount> = vec![];
        for start_tick_index in start_tick_indexes.iter() {
            // find from initialized tick arrays
            if let Some(pos) = initialized.iter().position(|t| t.0 == *start_tick_index) {
                let state = initialized.remove(pos).1;
                tick_array_accounts.push(state);
                continue;
            }

            // find from uninitialized tick arrays
            let tick_array_pda = derive_tick_array_pda(&whirlpool, *start_tick_index);
            if let Some(pos) = uninitialized.iter().position(|t| t.0 == tick_array_pda) {
                let state = uninitialized.remove(pos).1;
                if let TickArrayAccount::Uninitialized {
                    pubkey,
                    account_info,
                    ..
                } = state
                {
                    // create zeroed TickArray data
                    let zeroed = Box::new(RefCell::new(TickArray::default()));
                    zeroed
                        .borrow_mut()
                        .initialize(whirlpool, *start_tick_index)?;

                    tick_array_accounts.push(TickArrayAccount::Uninitialized {
                        pubkey,
                        account_info,
                        zeroed: Some(zeroed),
                    });
                } else {
                    unreachable!("state in uninitialized must be Uninitialized");
                }
                continue;
            }

            // no more valid tickarrays for this swap
            break;
        }

        if tick_array_accounts.is_empty() {
            return Err(crate::errors::ErrorCode::InvalidTickArraySequence.into());
        }

        Ok(Self {
            tick_array_accounts,
        })
    }

    pub fn build<'a>(&'a self) -> Result<SwapTickSequence<'a>> {
        let mut tick_array_refmuts = VecDeque::with_capacity(3);
        for tick_array_account in self.tick_array_accounts.iter() {
            match tick_array_account {
                TickArrayAccount::Initialized { account_info, .. } => {
                    use std::ops::DerefMut;

                    let data = account_info.try_borrow_mut_data()?;
                    let tick_array_refmut = RefMut::map(data, |data| {
                        bytemuck::from_bytes_mut(
                            &mut data.deref_mut()[8..std::mem::size_of::<TickArray>() + 8],
                        )
                    });
                    tick_array_refmuts.push_back(tick_array_refmut);
                }
                TickArrayAccount::Uninitialized { zeroed, .. } => {
                    let tick_array_refmut = zeroed.as_ref().unwrap().borrow_mut();
                    tick_array_refmuts.push_back(tick_array_refmut);
                }
            }
        }

        Ok(SwapTickSequence::<'a>::new(
            tick_array_refmuts.pop_front().unwrap(),
            tick_array_refmuts.pop_front(),
            tick_array_refmuts.pop_front(),
        ))
    }
}

fn peek_tick_array<'info>(account_info: AccountInfo<'info>) -> Result<TickArrayAccount<'info>> {
    use anchor_lang::Discriminator;

    // following process is ported from anchor-lang's AccountLoader::try_from and AccountLoader::load_mut

    if !account_info.is_writable {
        return Err(anchor_lang::error::ErrorCode::AccountNotMutable.into());
    }

    // uninitialized writable account (owned by system program and its data size is zero)
    if account_info.owner == &System::id() && account_info.data_is_empty() {
        return Ok(TickArrayAccount::Uninitialized {
            pubkey: *account_info.key,
            account_info,
            zeroed: None,
        });
    }

    // owner program check
    if account_info.owner != &TickArray::owner() {
        return Err(
            Error::from(anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram)
                .with_pubkeys((*account_info.owner, TickArray::owner())),
        );
    }

    let data = account_info.try_borrow_data()?;
    if data.len() < TickArray::discriminator().len() {
        return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound.into());
    }

    let disc_bytes = arrayref::array_ref![data, 0, 8];
    if disc_bytes != &TickArray::discriminator() {
        return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch.into());
    }

    let tick_array: Ref<TickArray> = Ref::map(data, |data| {
        bytemuck::from_bytes(&data[8..std::mem::size_of::<TickArray>() + 8])
    });

    let start_tick_index = tick_array.start_tick_index;
    let whirlpool = tick_array.whirlpool;
    drop(tick_array);

    Ok(TickArrayAccount::Initialized {
        tick_array_whirlpool: whirlpool,
        start_tick_index,
        account_info,
    })
}

fn get_start_tick_indexes(whirlpool: &Account<Whirlpool>, a_to_b: bool) -> Vec<i32> {
    let tick_current_index = whirlpool.tick_current_index;
    let tick_spacing = whirlpool.tick_spacing as i32;
    let ticks_in_array = TICK_ARRAY_SIZE * tick_spacing;

    let start_tick_index_base = floor_division(tick_current_index, ticks_in_array) * ticks_in_array;
    let offset = if a_to_b {
        [0, -1, -2]
    } else {
        let shifted = tick_current_index + tick_spacing >= start_tick_index_base + ticks_in_array;
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
            if is_valid_start_tick_index(start_tick_index, ticks_in_array) {
                Some(start_tick_index)
            } else {
                None
            }
        })
        .collect::<Vec<i32>>();

    start_tick_indexes
}

fn is_valid_start_tick_index(start_tick_index: i32, ticks_in_array: i32) -> bool {
    // caller must assure that start_tick_index is multiple of ticks_in_array
    start_tick_index + ticks_in_array > MIN_TICK_INDEX && start_tick_index < MAX_TICK_INDEX
}

fn floor_division(dividend: i32, divisor: i32) -> i32 {
    assert!(divisor != 0, "Divisor cannot be zero.");
    if dividend % divisor == 0 || dividend.signum() == divisor.signum() {
        dividend / divisor
    } else {
        dividend / divisor - 1
    }
}

fn derive_tick_array_pda(whirlpool: &Account<Whirlpool>, start_tick_index: i32) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"tick_array",
            whirlpool.key().as_ref(),
            start_tick_index.to_string().as_bytes(),
        ],
        &TickArray::owner(),
    )
    .0
}

#[cfg(test)]
mod sparse_swap_tick_sequence_tests {
    use anchor_lang::Discriminator;

    use super::*;
    use anchor_lang::solana_program::pubkey;

    struct AccountInfoMock {
        pub key: Pubkey,
        pub lamports: u64,
        pub data: Vec<u8>,
        pub owner: Pubkey,
        pub rent_epoch: u64,
        pub executable: bool,
    }

    impl AccountInfoMock {
        pub fn new(key: Pubkey, data: Vec<u8>, owner: Pubkey) -> Self {
            Self {
                key,
                lamports: 0,
                data,
                owner,
                rent_epoch: 0,
                executable: false,
            }
        }

        pub fn new_whirlpool(
            key: Pubkey,
            tick_spacing: u16,
            tick_current_index: i32,
            owner: Option<Pubkey>,
        ) -> Self {
            let whirlpool = Whirlpool {
                tick_spacing,
                tick_current_index,
                ..Whirlpool::default()
            };

            let mut data = vec![0u8; Whirlpool::LEN];
            whirlpool.try_serialize(&mut data.as_mut_slice()).unwrap();
            Self::new(key, data, owner.unwrap_or(Whirlpool::owner()))
        }

        pub fn new_tick_array(
            key: Pubkey,
            whirlpool: Pubkey,
            start_tick_index: i32,
            owner: Option<Pubkey>,
        ) -> Self {
            let tick_array = TickArray {
                whirlpool,
                start_tick_index,
                ..TickArray::default()
            };

            let mut data = vec![0u8; TickArray::LEN];
            data[0..8].copy_from_slice(&TickArray::discriminator());
            data[8..12].copy_from_slice(&start_tick_index.to_le_bytes());
            data[9956..9988].copy_from_slice(&whirlpool.to_bytes());
            Self::new(key, data, owner.unwrap_or(TickArray::owner()))
        }

        pub fn to_account_info<'a>(&'a mut self, is_writable: bool) -> AccountInfo<'a> {
            AccountInfo {
                key: &self.key,
                is_signer: false,
                is_writable,
                lamports: std::rc::Rc::new(RefCell::new(&mut self.lamports)),
                data: std::rc::Rc::new(RefCell::new(&mut self.data)),
                owner: &self.owner,
                rent_epoch: self.rent_epoch,
                executable: self.executable,
            }
        }
    }

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

        let ta_start_neg_11264 = derive_tick_array_pda(
            &whirlpool_account,
            -11264,
        );
        assert_eq!(ta_start_neg_11264, pubkey!("81T5kNuPRkyVzhwbe2RpKR7wmQpGJ7RBkGPdTqyfa5vq"));

        let ta_start_neg_5632 = derive_tick_array_pda(
            &whirlpool_account,
            -5632,
        );
        assert_eq!(ta_start_neg_5632, pubkey!("9K1HWrGKZKfjTnKfF621BmEQdai4FcUz9tsoF41jwz5B"));

        let ta_start_0 = derive_tick_array_pda(
            &whirlpool_account,
            0,
        );
        assert_eq!(ta_start_0, pubkey!("JCpxMSDRDPBMqjoX7LkhMwro2y6r85Q8E6p5zNdBZyWa"));

        let ta_start_5632 = derive_tick_array_pda(
            &whirlpool_account,
            5632,
        );
        assert_eq!(ta_start_5632, pubkey!("BW2Mr823NUQN7vnVpv5E6yCTnqEXQ3ZnqjZyiywXPcUp"));

        let ta_start_11264 = derive_tick_array_pda(
            &whirlpool_account,
            11264,
        );
        assert_eq!(ta_start_11264, pubkey!("2ezvsnoXdukw5dAAZ4EkW67bmUo8PHRPX8ZDqf76BKtV"));
    }

    #[test]
    fn test_floor_division() {
        assert_eq!(floor_division(0, 64), 0);
        assert_eq!(floor_division(1, 64), 0);
        assert_eq!(floor_division(63, 64), 0);
        assert_eq!(floor_division(64, 64), 1);
        assert_eq!(floor_division(65, 64), 1);
        assert_eq!(floor_division(127, 64), 1);
        assert_eq!(floor_division(128, 64), 2);
        assert_eq!(floor_division(129, 64), 2);
        assert_eq!(floor_division(-1, 64), -1);
        assert_eq!(floor_division(-63, 64), -1);
        assert_eq!(floor_division(-64, 64), -1);
        assert_eq!(floor_division(-65, 64), -2);
        assert_eq!(floor_division(-127, 64), -2);
        assert_eq!(floor_division(-128, 64), -2);
        assert_eq!(floor_division(-129, 64), -3);
    }

    mod test_is_valid_start_tick_index {
        use super::*;

        // valid tick range: -443636 ~ +443636

        fn get_ticks_in_array(tick_spacing: i32) -> i32 {
            TICK_ARRAY_SIZE * tick_spacing
        }

        #[test]
        fn tick_spacing_1() {
            let ticks_in_array = get_ticks_in_array(1);
            assert_eq!(is_valid_start_tick_index(-443784, ticks_in_array), false);
            assert_eq!(is_valid_start_tick_index(-443696, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(-443608, ticks_in_array), true); 
            assert_eq!(is_valid_start_tick_index(-88, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(0, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(88, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(443608, ticks_in_array), true); 
            assert_eq!(is_valid_start_tick_index(443696, ticks_in_array), false); 
        }

        #[test]
        fn tick_spacing_64() {
            let ticks_in_array = get_ticks_in_array(64);
            assert_eq!(is_valid_start_tick_index(-450560, ticks_in_array), false);
            assert_eq!(is_valid_start_tick_index(-444928, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(-439296, ticks_in_array), true); 
            assert_eq!(is_valid_start_tick_index(-5632, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(0, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(5632, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(439296, ticks_in_array), true); 
            assert_eq!(is_valid_start_tick_index(444928, ticks_in_array), false); 
        }

        #[test]
        fn tick_spacing_4096() {
            let ticks_in_array = get_ticks_in_array(4096);
            assert_eq!(is_valid_start_tick_index(-1081344, ticks_in_array), false);
            assert_eq!(is_valid_start_tick_index(-720896, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(-360448, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(0, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(360448, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(720896, ticks_in_array), false);
        }

        #[test]
        fn tick_spacing_8192() {
            let ticks_in_array = get_ticks_in_array(8192);
            assert_eq!(is_valid_start_tick_index(-1441792, ticks_in_array), false);
            assert_eq!(is_valid_start_tick_index(-720896, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(0, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(720896, ticks_in_array), false);
        }

        #[test]
        fn tick_spacing_32768() {
            let ticks_in_array = get_ticks_in_array(32768);
            assert_eq!(is_valid_start_tick_index(-5767168, ticks_in_array), false);
            assert_eq!(is_valid_start_tick_index(-2883584, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(0, ticks_in_array), true);
            assert_eq!(is_valid_start_tick_index(2883584, ticks_in_array), false);
        }
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

        fn do_test(
            a_to_b: bool,
            tick_spacing: u16,
            tick_current_index: i32,
            expected: Vec<i32>,
        ) {
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

    mod test_peek_tick_array {
        use super::*;

        #[test]
        fn fail_not_writable() {
            let mut account_info_mock = AccountInfoMock::new_tick_array(
                Pubkey::new_unique(),
                Pubkey::new_unique(),
                0,
                None
            );
            let account_info = account_info_mock.to_account_info(false); // not writable

            let result = peek_tick_array(account_info);
            assert!(result.is_err());
            assert!(result.err().unwrap().to_string().contains("AccountNotMutable"));
        }

        #[test]
        fn uninitialized_tick_array() {
            let account_address = Pubkey::new_unique();
            let mut account_info_mock = AccountInfoMock::new(
                account_address.clone(),
                vec![],
                System::id(),
            );
            let account_info = account_info_mock.to_account_info(true);

            let result = peek_tick_array(account_info);
            assert!(result.is_ok());
            match result.unwrap() {
                TickArrayAccount::Uninitialized { pubkey, account_info, zeroed } => {
                    assert_eq!(pubkey, account_address);
                    assert_eq!(account_info.key(), account_address);
                    assert!(zeroed.is_none());
                }
                _ => panic!("unexpected state"),
            }
        }

        #[test]
        fn fail_system_program_but_not_zero_size() {
            let mut account_info_mock = AccountInfoMock::new(
                Pubkey::new_unique(),
                vec![0u8; 1],
                System::id()
            );
            let account_info = account_info_mock.to_account_info(true);

            let result = peek_tick_array(account_info);
            assert!(result.is_err());
            // non empty account should be owned by this program
            assert!(result.err().unwrap().to_string().contains("AccountOwnedByWrongProgram"));
        }

        #[test]
        fn fail_account_discriminator_not_found() {
            let mut account_info_mock = AccountInfoMock::new(
                Pubkey::new_unique(),
                vec![],
                TickArray::owner()
            );
            let account_info = account_info_mock.to_account_info(true);

            let result = peek_tick_array(account_info);
            assert!(result.is_err());
            assert!(result.err().unwrap().to_string().contains("AccountDiscriminatorNotFound"));
        }

        #[test]
        fn fail_discriminator_mismatch() {
            let mut account_info_mock = AccountInfoMock::new_whirlpool(
                Pubkey::new_unique(),
                64,
                0,
                None,
            );
            let account_info = account_info_mock.to_account_info(true);

            let result = peek_tick_array(account_info);
            assert!(result.is_err());
            assert!(result.err().unwrap().to_string().contains("AccountDiscriminatorMismatch"));
        }

        #[test]
        fn initialized_tick_array() {
            let tick_array_address = Pubkey::new_unique();
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock = AccountInfoMock::new_tick_array(
                tick_array_address.clone(),
                whirlpool_address,
                439296,
                None
            );
            let account_info = account_info_mock.to_account_info(true);

            let result = peek_tick_array(account_info);
            assert!(result.is_ok());
            match result.unwrap() {
                TickArrayAccount::Initialized { start_tick_index, tick_array_whirlpool, account_info } => {
                    assert_eq!(start_tick_index, 439296);
                    assert_eq!(tick_array_whirlpool, whirlpool_address);
                    assert_eq!(account_info.key(), tick_array_address);
                }
                _ => panic!("unexpected state"),
            }
        }
    }

    mod test_sparse_swap_tick_sequence_builder {
        use crate::state::TICK_ARRAY_SIZE_USIZE;

        use super::*;

        #[test]
        fn check_zeroed_tick_array_data() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock = AccountInfoMock::new_whirlpool(
                whirlpool_address.clone(),
                64,
                5650,
                None,
            );
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            // uninitialized
            let ta0_address = derive_tick_array_pda(&whirlpool, 5632);
            let mut ta0_mock = AccountInfoMock::new(
                ta0_address.clone(),
                vec![],
                System::id(),
            );
            let ta0 = ta0_mock.to_account_info(true);

            let builder = SparseSwapTickSequenceBuilder::try_from(
                &whirlpool,
                false,
                vec![
                    ta0.clone(),
                    ta0.clone(),
                    ta0.clone(),
                ],
                None,
            ).unwrap();

            assert_eq!(builder.tick_array_accounts.len(), 1);
            match &builder.tick_array_accounts[0] {
                TickArrayAccount::Initialized { .. } => {
                    panic!("unexpected state");
                }
                TickArrayAccount::Uninitialized { zeroed, .. } => {
                    assert!(zeroed.is_some());
                    let ta = zeroed.as_ref().unwrap().borrow();

                    // .start_tick_index
                    let start_tick_index = ta.start_tick_index;
                    assert_eq!(start_tick_index, 5632);

                    // .whirlpool
                    assert_eq!(ta.whirlpool, whirlpool_address);

                    // .ticks
                    assert_eq!(ta.ticks.len(), TICK_ARRAY_SIZE_USIZE);
                    for i in 0..TICK_ARRAY_SIZE_USIZE {
                        let tick = ta.ticks[i];
                    
                        let initialized = tick.initialized;
                        assert_eq!(initialized, false);
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
            }

            // after build
            let swap_tick_sequence = builder.build().unwrap();
            for i in 0..TICK_ARRAY_SIZE_USIZE {
                let tick = swap_tick_sequence.get_tick(0, 5632 + (i as i32) * 64, 64).unwrap();
            
                let initialized = tick.initialized;
                assert_eq!(initialized, false);
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
            let mut account_info_mock = AccountInfoMock::new_whirlpool(
                whirlpool_address.clone(),
                64,
                0,
                None,
            );
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            // initialized
            let ta0_address = derive_tick_array_pda(&whirlpool, 0);
            let mut ta0_mock = AccountInfoMock::new_tick_array(
                ta0_address.clone(),
                whirlpool_address,
                0,
                None
            );
            let ta0 = ta0_mock.to_account_info(true);

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool, 5632);
            let mut ta1_mock = AccountInfoMock::new(
                ta1_address.clone(),
                vec![],
                System::id(),
            );
            let ta1 = ta1_mock.to_account_info(true);

            // initialized
            let ta2_address = derive_tick_array_pda(&whirlpool, 11264);
            let mut ta2_mock = AccountInfoMock::new_tick_array(
                ta2_address.clone(),
                whirlpool_address,
                11264,
                None
            );
            let ta2 = ta2_mock.to_account_info(true);

            let builder = SparseSwapTickSequenceBuilder::try_from(
                &whirlpool,
                false,
                vec![
                    ta0.clone(),
                    ta0.clone(), // dup
                    ta1.clone(),
                ],
                Some(vec![
                    ta1.clone(), // dup
                    ta2.clone(),
                    ta2.clone(), // dup
                ]),
            ).unwrap();

            assert_eq!(builder.tick_array_accounts.len(), 3);
            vec![0, 5632, 11264].iter().enumerate().for_each(|(i, &expected)| {
                match &builder.tick_array_accounts[i] {
                    TickArrayAccount::Initialized { start_tick_index: actual, .. } => {
                        assert_eq!(*actual, expected);
                    }
                    TickArrayAccount::Uninitialized { zeroed, .. } => {
                        assert!(zeroed.is_some());
                        let ta = zeroed.as_ref().unwrap().borrow();
                        let start_tick_index = ta.start_tick_index;
                        assert_eq!(start_tick_index, expected);
                    }
                }
            });
        }

        #[test]
        fn fail_wrong_whirlpool_tick_array() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock = AccountInfoMock::new_whirlpool(
                whirlpool_address.clone(),
                64,
                0,
                None,
            );
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            let another_whirlpool_address = Pubkey::new_unique();
            let mut another_account_info_mock = AccountInfoMock::new_whirlpool(
                another_whirlpool_address.clone(),
                64,
                0,
                None,
            );
            let another_account_info = another_account_info_mock.to_account_info(true);
            let another_whirlpool = Account::<Whirlpool>::try_from(&another_account_info).unwrap();

            let ta0_address = derive_tick_array_pda(&whirlpool, 0);
            let mut ta0_mock = AccountInfoMock::new_tick_array(
                ta0_address.clone(),
                whirlpool_address,
                0,
                None
            );
            let ta0 = ta0_mock.to_account_info(true);

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool, 5632);
            let mut ta1_mock = AccountInfoMock::new(
                ta1_address.clone(),
                vec![],
                System::id(),
            );
            let ta1 = ta1_mock.to_account_info(true);

            // initialized but for another whirlpool
            let ta2_address = derive_tick_array_pda(&another_whirlpool, 11264);
            let mut ta2_mock = AccountInfoMock::new_tick_array(
                ta2_address.clone(),
                another_whirlpool_address,
                11264,
                None
            );
            let ta2 = ta2_mock.to_account_info(true);

            let result = SparseSwapTickSequenceBuilder::try_from(
                &whirlpool,
                false,
                vec![ta0, ta1, ta2],
                None,
            );
            assert!(result.is_err());
            assert!(result.err().unwrap().to_string().contains("DifferentWhirlpoolTickArrayAccount"));
        }

        #[test]
        fn ignore_wrong_uninitialized_tick_array() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock = AccountInfoMock::new_whirlpool(
                whirlpool_address.clone(),
                64,
                0,
                None,
            );
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            let another_whirlpool_address = Pubkey::new_unique();
            let mut another_account_info_mock = AccountInfoMock::new_whirlpool(
                another_whirlpool_address.clone(),
                64,
                0,
                None,
            );
            let another_account_info = another_account_info_mock.to_account_info(true);
            let another_whirlpool = Account::<Whirlpool>::try_from(&another_account_info).unwrap();

            let ta0_address = derive_tick_array_pda(&whirlpool, 0);
            let mut ta0_mock = AccountInfoMock::new_tick_array(
                ta0_address.clone(),
                whirlpool_address,
                0,
                None
            );
            let ta0 = ta0_mock.to_account_info(true);

            // uninitialized and for another whirlpool
            let ta1_address = derive_tick_array_pda(&another_whirlpool, 5632);
            let mut ta1_mock = AccountInfoMock::new(
                ta1_address.clone(),
                vec![],
                System::id(),
            );
            let ta1 = ta1_mock.to_account_info(true);

            let builder = SparseSwapTickSequenceBuilder::try_from(
                &whirlpool,
                false,
                vec![ta0, ta1.clone(), ta1.clone()],
                None,
            ).unwrap();

            // ta1 should be ignored
            assert_eq!(builder.tick_array_accounts.len(), 1);
            match &builder.tick_array_accounts[0] {
                TickArrayAccount::Initialized { start_tick_index: actual, .. } => {
                    assert_eq!(*actual, 0);
                }
                _ => panic!("unexpected state"),
            }
        }

        #[test]
        fn fail_if_no_appropriate_tick_arrays() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock = AccountInfoMock::new_whirlpool(
                whirlpool_address.clone(),
                64,
                1,
                None,
            );
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            let ta0_address = derive_tick_array_pda(&whirlpool, 5632);
            let mut ta0_mock = AccountInfoMock::new_tick_array(
                ta0_address.clone(),
                whirlpool_address,
                5632,
                None
            );
            let ta0 = ta0_mock.to_account_info(true);

            let ta1_address = derive_tick_array_pda(&whirlpool, 11264);
            let mut ta1_mock = AccountInfoMock::new_tick_array(
                ta1_address.clone(),
                whirlpool_address,
                11264,
                None
            );
            let ta1 = ta1_mock.to_account_info(true);
            
            let result = SparseSwapTickSequenceBuilder::try_from(
                &whirlpool,
                false,
                vec![ta0, ta1], // provided, but no TA stating at 0
                None,
            );
            assert!(result.is_err());
            assert!(result.err().unwrap().to_string().contains("InvalidTickArraySequence"));
        }

        #[test]
        fn adjust_tick_array_account_ordering() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock = AccountInfoMock::new_whirlpool(
                whirlpool_address.clone(),
                64,
                -65, // no shift
                None,
            );
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            // initialized
            let ta0_address = derive_tick_array_pda(&whirlpool, 0);
            let mut ta0_mock = AccountInfoMock::new_tick_array(
                ta0_address.clone(),
                whirlpool_address,
                0,
                None
            );
            let ta0 = ta0_mock.to_account_info(true);

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool, 5632);
            let mut ta1_mock = AccountInfoMock::new(
                ta1_address.clone(),
                vec![],
                System::id(),
            );
            let ta1 = ta1_mock.to_account_info(true);

            // initialized
            let ta2_address = derive_tick_array_pda(&whirlpool, 11264);
            let mut ta2_mock = AccountInfoMock::new_tick_array(
                ta2_address.clone(),
                whirlpool_address,
                11264,
                None
            );
            let ta2 = ta2_mock.to_account_info(true);

            // initialized
            let ta3_address = derive_tick_array_pda(&whirlpool, -5632);
            let mut ta3_mock = AccountInfoMock::new_tick_array(
                ta3_address.clone(),
                whirlpool_address,
                -5632,
                None
            );
            let ta3 = ta3_mock.to_account_info(true);

            let builder = SparseSwapTickSequenceBuilder::try_from(
                &whirlpool,
                false,
                vec![
                    // reverse order
                    ta2.clone(), // 11264
                    ta1.clone(), // 5632
                    ta0.clone(), // 0
                ],
                Some(vec![
                    ta3.clone(), // -5632
                ]),
            ).unwrap();

            // -5632 should be used as the first tick array
            assert_eq!(builder.tick_array_accounts.len(), 3);
            vec![-5632, 0, 5632].iter().enumerate().for_each(|(i, &expected)| {
                match &builder.tick_array_accounts[i] {
                    TickArrayAccount::Initialized { start_tick_index: actual, .. } => {
                        assert_eq!(*actual, expected);
                    }
                    TickArrayAccount::Uninitialized { zeroed, .. } => {
                        assert!(zeroed.is_some());
                        let ta = zeroed.as_ref().unwrap().borrow();
                        let start_tick_index = ta.start_tick_index;
                        assert_eq!(start_tick_index, expected);
                    }
                }
            });
        }

        #[test]
        fn uninitialized_tick_array_not_provided() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock = AccountInfoMock::new_whirlpool(
                whirlpool_address.clone(),
                64,
                -65, // no shift
                None,
            );
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            // initialized
            let ta0_address = derive_tick_array_pda(&whirlpool, 0);
            let mut ta0_mock = AccountInfoMock::new_tick_array(
                ta0_address.clone(),
                whirlpool_address,
                0,
                None
            );
            let ta0 = ta0_mock.to_account_info(true);

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool, 5632);
            let mut ta1_mock = AccountInfoMock::new(
                ta1_address.clone(),
                vec![],
                System::id(),
            );
            let ta1 = ta1_mock.to_account_info(true);

            // initialized
            let ta2_address = derive_tick_array_pda(&whirlpool, 11264);
            let mut ta2_mock = AccountInfoMock::new_tick_array(
                ta2_address.clone(),
                whirlpool_address,
                11264,
                None
            );
            let ta2 = ta2_mock.to_account_info(true);

            // initialized
            let ta3_address = derive_tick_array_pda(&whirlpool, -5632);
            let mut ta3_mock = AccountInfoMock::new_tick_array(
                ta3_address.clone(),
                whirlpool_address,
                -5632,
                None
            );
            let ta3 = ta3_mock.to_account_info(true);

            let builder = SparseSwapTickSequenceBuilder::try_from(
                &whirlpool,
                false,
                vec![
                    ta3.clone(), // -5632
                    ta0.clone(), // 0
                    // no ta1 provided
                    ta2.clone(), // 11264
                ],
                None,
            ).unwrap();

            // -5632 should be used as the first tick array
            // 5632 should not be included because it is not provided
            assert_eq!(builder.tick_array_accounts.len(), 2);
            vec![-5632, 0].iter().enumerate().for_each(|(i, &expected)| {
                match &builder.tick_array_accounts[i] {
                    TickArrayAccount::Initialized { start_tick_index: actual, .. } => {
                        assert_eq!(*actual, expected);
                    }
                    TickArrayAccount::Uninitialized { zeroed, .. } => {
                        assert!(zeroed.is_some());
                        let ta = zeroed.as_ref().unwrap().borrow();
                        let start_tick_index = ta.start_tick_index;
                        assert_eq!(start_tick_index, expected);
                    }
                }
            });
        }

        #[test]
        fn all_tick_array_uninitialized() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock = AccountInfoMock::new_whirlpool(
                whirlpool_address.clone(),
                64,
                6000,
                None,
            );
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            // uninitialized
            let ta0_address = derive_tick_array_pda(&whirlpool, 0);
            let mut ta0_mock = AccountInfoMock::new(
                ta0_address.clone(),
                vec![],
                System::id(),
            );
            let ta0 = ta0_mock.to_account_info(true);

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool, 5632);
            let mut ta1_mock = AccountInfoMock::new(
                ta1_address.clone(),
                vec![],
                System::id(),
            );
            let ta1 = ta1_mock.to_account_info(true);

            // uninitialized
            let ta2_address = derive_tick_array_pda(&whirlpool, 11264);
            let mut ta2_mock = AccountInfoMock::new(
                ta2_address.clone(),
                vec![],
                System::id(),
            );
            let ta2 = ta2_mock.to_account_info(true);

            // uninitialized
            let ta3_address = derive_tick_array_pda(&whirlpool, -5632);
            let mut ta3_mock = AccountInfoMock::new(
                ta3_address.clone(),
                vec![],
                System::id(),
            );
            let ta3 = ta3_mock.to_account_info(true);

            let builder = SparseSwapTickSequenceBuilder::try_from(
                &whirlpool,
                true,
                vec![
                    ta0.clone(), // 0
                    ta1.clone(), // 5632
                    ta2.clone(), // 11264
                ],
                Some(vec![
                    ta3.clone(), // -5632
                ]),
            ).unwrap();

            // 5632 should be used as the first tick array and its direction should be a to b.
            assert_eq!(builder.tick_array_accounts.len(), 3);
            vec![5632, 0, -5632].iter().enumerate().for_each(|(i, &expected)| {
                match &builder.tick_array_accounts[i] {
                    TickArrayAccount::Initialized { .. } => {
                        panic!("unexpected state");
                    }
                    TickArrayAccount::Uninitialized { zeroed, .. } => {
                        assert!(zeroed.is_some());
                        let ta = zeroed.as_ref().unwrap().borrow();
                        let start_tick_index = ta.start_tick_index;
                        assert_eq!(start_tick_index, expected);
                    }
                }
            });

        }

        #[test]
        fn fail_if_account_is_not_writable() {
            fn run_test(i: usize) {
                let whirlpool_address = Pubkey::new_unique();
                let mut account_info_mock = AccountInfoMock::new_whirlpool(
                    whirlpool_address.clone(),
                    64,
                    0,
                    None,
                );
                let account_info = account_info_mock.to_account_info(false);
                let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

                // initialized
                let ta0_address = derive_tick_array_pda(&whirlpool, 0);
                let mut ta0_mock = AccountInfoMock::new_tick_array(
                    ta0_address.clone(),
                    whirlpool_address,
                    0,
                    None
                );

                // uninitialized
                let ta1_address = derive_tick_array_pda(&whirlpool, 5632);
                let mut ta1_mock = AccountInfoMock::new(
                    ta1_address.clone(),
                    vec![],
                    System::id(),
                );

                // initialized
                let ta2_address = derive_tick_array_pda(&whirlpool, 11264);
                let mut ta2_mock = AccountInfoMock::new_tick_array(
                    ta2_address.clone(),
                    whirlpool_address,
                    11264,
                    None
                );

                let ta0 = ta0_mock.to_account_info(i != 0);
                let ta1 = ta1_mock.to_account_info(i != 1);
                let ta2 = ta2_mock.to_account_info(i != 2);
                let result = SparseSwapTickSequenceBuilder::try_from(
                    &whirlpool,
                    false,
                    vec![ta0, ta1, ta2],
                    None,
                );
                assert!(result.is_err());
                assert!(result.err().unwrap().to_string().contains("AccountNotMutable"));    
            }

            run_test(0);
            run_test(1);
            run_test(2);
        }

        #[test]
        fn fail_if_uninitialized_account_is_not_empty() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock = AccountInfoMock::new_whirlpool(
                whirlpool_address.clone(),
                64,
                0,
                None,
            );
            let account_info = account_info_mock.to_account_info(false);
            let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

            // initialized
            let ta0_address = derive_tick_array_pda(&whirlpool, 0);
            let mut ta0_mock = AccountInfoMock::new_tick_array(
                ta0_address.clone(),
                whirlpool_address,
                0,
                None
            );

            // uninitialized
            let ta1_address = derive_tick_array_pda(&whirlpool, 5632);
            let mut ta1_mock = AccountInfoMock::new(
                ta1_address.clone(),
                vec![0u8; 8], // not empty
                System::id(),
            );

            // initialized
            let ta2_address = derive_tick_array_pda(&whirlpool, 11264);
            let mut ta2_mock = AccountInfoMock::new_tick_array(
                ta2_address.clone(),
                whirlpool_address,
                11264,
                None
            );

            let ta0 = ta0_mock.to_account_info(true);
            let ta1 = ta1_mock.to_account_info(true);
            let ta2 = ta2_mock.to_account_info(true);
            let result = SparseSwapTickSequenceBuilder::try_from(
                &whirlpool,
                false,
                vec![ta0, ta1, ta2],
                None,
            );
            assert!(result.is_err());
            assert!(result.err().unwrap().to_string().contains("AccountOwnedByWrongProgram"));    
        }

        #[test]
        fn fail_if_wrong_tick_array_account() {
            let whirlpool_address = Pubkey::new_unique();
            let mut account_info_mock = AccountInfoMock::new_whirlpool(
                whirlpool_address.clone(),
                64,
                0,
                None,
            );
            let whirlpool_account_info = account_info_mock.to_account_info(true);
            let whirlpool = Account::<Whirlpool>::try_from(&whirlpool_account_info).unwrap();

            // initialized
            let ta0_address = derive_tick_array_pda(&whirlpool, 0);
            let mut ta0_mock = AccountInfoMock::new_tick_array(
                ta0_address.clone(),
                whirlpool_address,
                0,
                None
            );

            // initialized
            let ta2_address = derive_tick_array_pda(&whirlpool, 11264);
            let mut ta2_mock = AccountInfoMock::new_tick_array(
                ta2_address.clone(),
                whirlpool_address,
                11264,
                None
            );

            let ta0 = ta0_mock.to_account_info(true);
            let ta1 = whirlpool_account_info.clone();
            let ta2 = ta2_mock.to_account_info(true);
            let result = SparseSwapTickSequenceBuilder::try_from(
                &whirlpool,
                false,
                vec![
                    ta0,
                    ta1,
                    ta2
                ],
                None,
            );
            assert!(result.is_err());
            assert!(result.err().unwrap().to_string().contains("AccountDiscriminatorMismatch"));
        }
    }
}
