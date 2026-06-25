use anchor_lang::prelude::*;

use crate::{errors::ErrorCode, manager::swap_manager::PostSwapUpdate, state::{AdaptiveFeeVariables, NUM_REWARDS, TICK_ARRAY_SIZE_USIZE}};

// Maximum nonce value allowed for PreparedSwap.
//
// Although the nonce is represented as a u16, allowing all 65536 possible
// PreparedSwap accounts would provide little practical value while
// significantly increasing rent costs.
//
// PreparedSwap is intended to be a short-lived working area for a
// prepare/commit workflow. Reusing the same PreparedSwap account across
// multiple transactions within a block may introduce write-lock contention,
// but this is not expected to be a significant limitation in practice.
//
// We therefore start with a conservative limit and can raise it in the
// future if real-world demand justifies it.
pub const MAX_PREPARED_SWAP_NONCE: u16 = 15; // allows 0..=15, 16 accounts

// Current PreparedSwap account layout version.
//
// Increment this value whenever the PreparedSwap layout or account size
// changes.
pub const PREPARED_SWAP_LAYOUT_VERSION: u16 = 1;

// Maximum number of pending tick updates that can be produced by a swap.
//
// A swap can traverse at most three TickArrays. In the worst case, every
// initialized tick crossed by the swap requires an update, and all ticks in
// all three TickArrays are crossed. Therefore, the upper bound is the total
// number of ticks contained in three TickArrays.
pub const MAX_PENDING_TICK_UPDATES_LEN: usize = TICK_ARRAY_SIZE_USIZE * 3;

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Debug, PartialEq, Eq)]
pub struct PendingPostSwapUpdate {
    pub amount_a: u64,
    pub amount_b: u64,
    pub lp_fee: u64,
    pub next_liquidity: u128,
    pub next_tick_index: i32,
    pub next_sqrt_price: u128,
    pub next_fee_growth_global: u128,
    pub next_reward_growth_global: [u128; NUM_REWARDS],
    pub next_protocol_fee: u64, // delta value (not next absolute value)

    // Flattened fixed-size Option<T> for zero-copy serialization.
    pub next_adaptive_fee_variables_is_some: bool,
    pub next_adaptive_fee_variables: AdaptiveFeeVariables,
}

impl PendingPostSwapUpdate {
    pub const LEN: usize = 8 + 8 + 8 + 16 + 4 + 16 + 16 + (16 * NUM_REWARDS) + 8 + 1 + 44; // 177
}

#[zero_copy]
#[repr(C, packed)]
#[derive(Debug, PartialEq, Eq)]
pub struct PendingTickUpdate {
    // We recompute the reward growth outside values.
    // Unlike fee growth outside, they do not depend on intermediate state changes during swap execution,
    // which makes the recomputation straightforward.
    //
    // In principle, growth outside for the output token could also be recomputed,
    // since the global growth for the output token does not change.
    // However, for the sake of simplicity, we record both token A and token B values directly.
    //
    // The trade-off is increased account space usage in QuoteCache.
    // Simply storing the reward growth outside values causes the account to exceed the 10 KB limit,
    // making QuoteCache initialization more complex.
    // Since it is a PDA, initialization would require two instructions (initialize + extend) instead of just one.
    pub array_index: u8,
    pub tick_index: i32,
    pub next_fee_growth_outside_a: u128,
    pub next_fee_growth_outside_b: u128,
}

impl PendingTickUpdate {
    pub const LEN: usize = 1 + 4 + 16 + 16; // 37
}

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Debug, PartialEq, Eq)]
pub struct PreparedSwapPrecondition {
    pub slot: u64,

    pub authority: Pubkey,

    pub whirlpool: Pubkey,
    pub whirlpool_state_sequence: u32,

    pub amount: u64,
    pub sqrt_price_limit: u128,
    pub amount_specified_is_input: bool,
    pub a_to_b: bool,
}

impl PreparedSwapPrecondition {
    pub const LEN: usize = 8 + 32 + 32 + 4 + 8 + 16 + 1 + 1; // 102
}

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Debug)]
pub struct PreparedSwapPendingUpdates {
    pub pending_post_swap_update: PendingPostSwapUpdate,
    pub pending_tick_updates_len: u16,
    pub pending_tick_updates: [PendingTickUpdate; MAX_PENDING_TICK_UPDATES_LEN],
}

impl PreparedSwapPendingUpdates {
    pub const LEN: usize = PendingPostSwapUpdate::LEN + 2 + PendingTickUpdate::LEN * MAX_PENDING_TICK_UPDATES_LEN; // 9947
}

#[repr(u8)]
pub enum PreparedSwapState {
    Unprepared,
    Prepared,
    Committed,
}
pub type PreparedSwapStateU8 = u8;

const PREPARED_SWAP_RESERVED_BYTES: usize = 180; // total 10KB

#[account(zero_copy(unsafe))]
#[repr(C, packed)]
#[derive(Debug)]

pub struct PreparedSwap {
    // PreparedSwap account layout version
    // Guard against stale PreparedSwap accounts being used after a program upgrade that modifies the PreparedSwap layout or size.
    // Although instructions are not expected to execute in the same slot after a program upgrade,
    // this version check is included as a safeguard against future changes.
    pub version: u16,

    // Note: enum is not compatible with zero_copy
    pub state: PreparedSwapStateU8,

    pub precondition: PreparedSwapPrecondition,
    pub pending_updates: PreparedSwapPendingUpdates,

    pub reserved: [u8; PREPARED_SWAP_RESERVED_BYTES],
}

impl PreparedSwap {
    pub const LEN: usize = 8 + 2 + 1 + PreparedSwapPrecondition::LEN + PreparedSwapPendingUpdates::LEN + PREPARED_SWAP_RESERVED_BYTES;

    pub fn initialize(&mut self, nonce: u16) -> Result<()> {
        if nonce > MAX_PREPARED_SWAP_NONCE {
            return Err(ErrorCode::PreparedSwapNonceMaxExceeded.into());
        }

        self.reset();
        Ok(())
    }

    pub fn reset(
        &mut self,
    ) {
        self.version = PREPARED_SWAP_LAYOUT_VERSION;
        self.state = PreparedSwapState::Unprepared as u8;
        self.pending_updates.pending_tick_updates_len = 0;
    }

    pub fn set_precondition(
        &mut self,
        authority: Pubkey,
        whirlpool: Pubkey,
        whirlpool_state_sequence: u32,
        amount: u64,
        sqrt_price_limit: u128,
        amount_specified_is_input: bool,
        a_to_b: bool,
        slot: u64,
    ) {
        self.precondition = PreparedSwapPrecondition {
            slot,
            authority,
            whirlpool,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
        };
    }

    pub fn add_pending_tick_update(
        &mut self,
        update: PendingTickUpdate,
    ) {
        if self.pending_updates.pending_tick_updates_len as usize == MAX_PENDING_TICK_UPDATES_LEN {
            unreachable!(
              "pending tick update capacity exceeded; all ticks crossed by a swap should fit within MAX_PENDING_TICK_UPDATES_LEN"
            );
        }
        self.pending_updates.pending_tick_updates[self.pending_updates.pending_tick_updates_len as usize] = update;
        self.pending_updates.pending_tick_updates_len += 1;
    }

    pub fn set_pending_post_swap_update(
        &mut self,
        update: &PostSwapUpdate,
    ) {
        self.pending_updates.pending_post_swap_update.amount_a = update.amount_a;
        self.pending_updates.pending_post_swap_update.amount_b = update.amount_b;
        self.pending_updates.pending_post_swap_update.lp_fee = update.lp_fee;
        self.pending_updates.pending_post_swap_update.next_liquidity = update.next_liquidity;
        self.pending_updates.pending_post_swap_update.next_tick_index = update.next_tick_index;
        self.pending_updates.pending_post_swap_update.next_sqrt_price = update.next_sqrt_price;
        self.pending_updates.pending_post_swap_update.next_fee_growth_global = update.next_fee_growth_global;
        self.pending_updates.pending_post_swap_update.next_reward_growth_global[0] =update.next_reward_infos[0].growth_global_x64;
        self.pending_updates.pending_post_swap_update.next_reward_growth_global[1] =update.next_reward_infos[1].growth_global_x64;
        self.pending_updates.pending_post_swap_update.next_reward_growth_global[2] =update.next_reward_infos[2].growth_global_x64;
        self.pending_updates.pending_post_swap_update.next_protocol_fee = update.next_protocol_fee;
        if let Some(adaptive_fee_info) = &update.next_adaptive_fee_info {
            self.pending_updates.pending_post_swap_update.next_adaptive_fee_variables_is_some = true;
            self.pending_updates.pending_post_swap_update.next_adaptive_fee_variables = adaptive_fee_info.variables;
        } else {
            self.pending_updates.pending_post_swap_update.next_adaptive_fee_variables_is_some = false;
        }        
    }

    pub fn set_state(
        &mut self,
        state: PreparedSwapState,
    ) {
        self.state = state as u8;
    }

    pub fn validate_for_commit(
        &self,
        authority: Pubkey,
        whirlpool: Pubkey,
        whirlpool_state_sequence: u32,
        amount: u64,
        sqrt_price_limit: u128,
        amount_specified_is_input: bool,
        a_to_b: bool,
        slot: u64,
    ) -> Result<()> {
        // PreparedSwap is a zero-copy account.
        // A version mismatch means the account data may be interpreted using the wrong
        // layout, so the version must be checked before performing any other validation.
        if self.version != PREPARED_SWAP_LAYOUT_VERSION {
            return Err(ErrorCode::PreparedSwapVersionMismatch.into());
        }

        if self.state != PreparedSwapState::Prepared as u8 {
            return Err(ErrorCode::PreparedSwapNotPrepared.into());
        }

        if self.precondition != (PreparedSwapPrecondition {
            slot,
            authority,
            whirlpool,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
        }) {
            return Err(ErrorCode::PreparedSwapPreconditionMismatch.into());
        }

        Ok(())
    }
}

#[cfg(test)]
mod prepared_swap_functions_tests {
    use super::*;
    use crate::state::{AdaptiveFeeInfo, WhirlpoolRewardInfo};

    #[test]
    fn test_initialize() {
        let mut prepared_swap_data = [0xffu8; PreparedSwap::LEN - 8];
        let prepared_swap: &mut PreparedSwap = bytemuck::from_bytes_mut(&mut prepared_swap_data);

        assert!(prepared_swap.version != PREPARED_SWAP_LAYOUT_VERSION);
        assert!(prepared_swap.state != PreparedSwapState::Unprepared as u8);
        assert!(prepared_swap.pending_updates.pending_tick_updates_len != 0);

        let valid_nonce = MAX_PREPARED_SWAP_NONCE;
        prepared_swap.initialize(valid_nonce).unwrap();

        assert!(prepared_swap.version == PREPARED_SWAP_LAYOUT_VERSION);
        assert!(prepared_swap.state == PreparedSwapState::Unprepared as u8);
        assert!(prepared_swap.pending_updates.pending_tick_updates_len == 0);
    }

    #[test]
    fn test_initialize_fail_invalid_nonce() {
        let mut prepared_swap_data = [0u8; PreparedSwap::LEN - 8];
        let prepared_swap: &mut PreparedSwap = bytemuck::from_bytes_mut(&mut prepared_swap_data);

        let invalid_nonce = MAX_PREPARED_SWAP_NONCE.checked_add(1).unwrap();
        let result = prepared_swap.initialize(invalid_nonce);
        assert_eq!(result.unwrap_err(), ErrorCode::PreparedSwapNonceMaxExceeded.into());
    }

    #[test]
    fn test_reset() {
        let mut prepared_swap_data = [0xffu8; PreparedSwap::LEN - 8];
        let prepared_swap: &mut PreparedSwap = bytemuck::from_bytes_mut(&mut prepared_swap_data);

        assert!(prepared_swap.version != PREPARED_SWAP_LAYOUT_VERSION);
        assert!(prepared_swap.state != PreparedSwapState::Unprepared as u8);
        assert!(prepared_swap.pending_updates.pending_tick_updates_len != 0);

        prepared_swap.reset();

        assert!(prepared_swap.version == PREPARED_SWAP_LAYOUT_VERSION);
        assert!(prepared_swap.state == PreparedSwapState::Unprepared as u8);
        assert!(prepared_swap.pending_updates.pending_tick_updates_len == 0);
    }

    #[test]
    fn test_set_recondition() {
        let mut prepared_swap_data = [0x00u8; PreparedSwap::LEN - 8];
        let prepared_swap: &mut PreparedSwap = bytemuck::from_bytes_mut(&mut prepared_swap_data);
        prepared_swap.reset();

        let whirlpool_address = Pubkey::new_unique();
        let whirlpool_state_sequence = 0x88776655u32;

        let authority = Pubkey::new_unique();
        let amount = 0x1122334455667788u64;
        let sqrt_price_limit = 0xffeeddccbbaa99887766554433221100u128;
        let amount_specified_is_input = true;
        let a_to_b = false;
        let slot = 0x9988776666778899u64;

        prepared_swap.set_precondition(
            authority,
            whirlpool_address,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            slot,
        );

        assert!(prepared_swap.precondition == PreparedSwapPrecondition {
            slot,
            authority,
            whirlpool: whirlpool_address,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
        });
    }

    #[test]
    fn test_add_pending_tick_update() {
        let mut prepared_swap_data = [0x00u8; PreparedSwap::LEN - 8];
        let prepared_swap: &mut PreparedSwap = bytemuck::from_bytes_mut(&mut prepared_swap_data);
        prepared_swap.reset();

        assert!(prepared_swap.pending_updates.pending_tick_updates_len == 0);

        for i in 0..MAX_PENDING_TICK_UPDATES_LEN {
            let pending_update = PendingTickUpdate {
                array_index: (i & 0xFF) as u8,
                tick_index: (i as i32) * (if i % 2 == 0 { 1 } else { -1 }),
                next_fee_growth_outside_a: 0x00112233445566778899aabbccddeeffu128,
                next_fee_growth_outside_b: 0xffeeddccbbaa99887766554433221100u128,
            };

            assert!(prepared_swap.pending_updates.pending_tick_updates_len as usize == i);
            assert!(prepared_swap.pending_updates.pending_tick_updates[i] != pending_update);

            prepared_swap.add_pending_tick_update(pending_update);

            assert!(prepared_swap.pending_updates.pending_tick_updates_len as usize == i + 1);
            assert!(prepared_swap.pending_updates.pending_tick_updates[i] == pending_update);
        }
    }

    #[test]
    #[should_panic]
    fn test_add_pending_tick_update_fail_overflow() {
        let mut prepared_swap_data = [0x00u8; PreparedSwap::LEN - 8];
        let prepared_swap: &mut PreparedSwap = bytemuck::from_bytes_mut(&mut prepared_swap_data);
        prepared_swap.reset();

        let pending_update = PendingTickUpdate {
            array_index: 0u8,
            tick_index: 0i32,
            next_fee_growth_outside_a: 0u128,
            next_fee_growth_outside_b: 0u128,
        };

        for _ in 0..=MAX_PENDING_TICK_UPDATES_LEN {
            prepared_swap.add_pending_tick_update(pending_update);
        }
    }

    #[test]
    fn test_set_pending_post_swap_update_adaptive_fee_info_is_some() {
        let mut prepared_swap_data = [0x00u8; PreparedSwap::LEN - 8];
        let prepared_swap: &mut PreparedSwap = bytemuck::from_bytes_mut(&mut prepared_swap_data);
        prepared_swap.reset();

        let post_swap_update = PostSwapUpdate {
            amount_a: 0x1122334455667788u64,
            amount_b: 0x99aabbccddeeff00u64,
            lp_fee: 0xffeeddccbbaa9988u64,
            next_liquidity: 0x77665544332211000011223344556677u128,
            next_tick_index: 0x1122ffeei32,
            next_sqrt_price: 0xccddeeff0011223333221100ffeeddccu128,
            next_fee_growth_global: 0xbbaabbaa001100112233223355665566u128,
            next_reward_infos: [
                WhirlpoolRewardInfo {
                    growth_global_x64: 0x55667788ffeeddcc00112233aabbccddu128,
                    ..Default::default()
                },
                WhirlpoolRewardInfo {
                    growth_global_x64: 0x55667788ffeedd00cc112233aabbccddu128,
                    ..Default::default()
                },
                WhirlpoolRewardInfo {
                    growth_global_x64: 0x55667788ffee00ddcc112233aabbccddu128,
                    ..Default::default()
                },
            ],
            next_protocol_fee: 0x1122334499887766u64,
            next_adaptive_fee_info: Some(AdaptiveFeeInfo {
                variables: AdaptiveFeeVariables {
                    last_reference_update_timestamp: 0x9988776655443322u64,
                    last_major_swap_timestamp: 0x778899aabbccddeeu64,
                    volatility_reference: 0xff001122u32,
                    tick_group_index_reference: 0x2211ffeei32,
                    volatility_accumulator: 0x55665544u32,
                    ..Default::default()
                },
                ..Default::default()
            })
        };

        let expect_post_swap_update = PendingPostSwapUpdate {
            amount_a: post_swap_update.amount_a,
            amount_b: post_swap_update.amount_b,
            lp_fee: post_swap_update.lp_fee,
            next_liquidity: post_swap_update.next_liquidity,
            next_tick_index: post_swap_update.next_tick_index,
            next_sqrt_price: post_swap_update.next_sqrt_price,
            next_fee_growth_global: post_swap_update.next_fee_growth_global,
            next_reward_growth_global: [
                post_swap_update.next_reward_infos[0].growth_global_x64,
                post_swap_update.next_reward_infos[1].growth_global_x64,
                post_swap_update.next_reward_infos[2].growth_global_x64,
            ],
            next_protocol_fee: post_swap_update.next_protocol_fee,
            next_adaptive_fee_variables_is_some: true,
            next_adaptive_fee_variables: post_swap_update.next_adaptive_fee_info.as_ref().unwrap().variables,
        };

        assert!(prepared_swap.pending_updates.pending_post_swap_update != expect_post_swap_update);

        prepared_swap.set_pending_post_swap_update(&post_swap_update);

        assert!(prepared_swap.pending_updates.pending_post_swap_update == expect_post_swap_update);
    }

    #[test]
    fn test_set_pending_post_swap_update_adaptive_fee_info_is_none() {
        let mut prepared_swap_data = [0x01u8; PreparedSwap::LEN - 8];
        let prepared_swap: &mut PreparedSwap = bytemuck::from_bytes_mut(&mut prepared_swap_data);
        prepared_swap.reset();

        let post_swap_update = PostSwapUpdate {
            amount_a: 0x1122334455667788u64,
            amount_b: 0x99aabbccddeeff00u64,
            lp_fee: 0xffeeddccbbaa9988u64,
            next_liquidity: 0x77665544332211000011223344556677u128,
            next_tick_index: 0x1122ffeei32,
            next_sqrt_price: 0xccddeeff0011223333221100ffeeddccu128,
            next_fee_growth_global: 0xbbaabbaa001100112233223355665566u128,
            next_reward_infos: [
                WhirlpoolRewardInfo {
                    growth_global_x64: 0x55667788ffeeddcc00112233aabbccddu128,
                    ..Default::default()
                },
                WhirlpoolRewardInfo {
                    growth_global_x64: 0x55667788ffeedd00cc112233aabbccddu128,
                    ..Default::default()
                },
                WhirlpoolRewardInfo {
                    growth_global_x64: 0x55667788ffee00ddcc112233aabbccddu128,
                    ..Default::default()
                },
            ],
            next_protocol_fee: 0x1122334499887766u64,
            next_adaptive_fee_info: None,
        };

        let expect_whirlpool_update = PendingPostSwapUpdate {
            amount_a: post_swap_update.amount_a,
            amount_b: post_swap_update.amount_b,
            lp_fee: post_swap_update.lp_fee,
            next_liquidity: post_swap_update.next_liquidity,
            next_tick_index: post_swap_update.next_tick_index,
            next_sqrt_price: post_swap_update.next_sqrt_price,
            next_fee_growth_global: post_swap_update.next_fee_growth_global,
            next_reward_growth_global: [
                post_swap_update.next_reward_infos[0].growth_global_x64,
                post_swap_update.next_reward_infos[1].growth_global_x64,
                post_swap_update.next_reward_infos[2].growth_global_x64,
            ],
            next_protocol_fee: post_swap_update.next_protocol_fee,
            next_adaptive_fee_variables_is_some: false,
            // Note: prepared_swap_data is initialized with [0x01u8; *]
            next_adaptive_fee_variables: AdaptiveFeeVariables {
                last_reference_update_timestamp: 0x0101010101010101u64,
                last_major_swap_timestamp: 0x0101010101010101u64,
                volatility_reference: 0x01010101u32,
                tick_group_index_reference: 0x01010101i32,
                volatility_accumulator: 0x01010101u32,
                reserved: [0x01u8; 16]
            },
        };

        assert!(prepared_swap.pending_updates.pending_post_swap_update != expect_whirlpool_update);

        prepared_swap.set_pending_post_swap_update(&post_swap_update);

        assert!(prepared_swap.pending_updates.pending_post_swap_update == expect_whirlpool_update);
    }

    #[test]
    fn test_set_state() {
        let mut prepared_swap_data = [0x00u8; PreparedSwap::LEN - 8];
        let prepared_swap: &mut PreparedSwap = bytemuck::from_bytes_mut(&mut prepared_swap_data);

        prepared_swap.reset();
        assert!(prepared_swap.state == PreparedSwapState::Unprepared as u8);

        prepared_swap.set_state(PreparedSwapState::Prepared);
        assert!(prepared_swap.state == PreparedSwapState::Prepared as u8);

        prepared_swap.set_state(PreparedSwapState::Committed);
        assert!(prepared_swap.state == PreparedSwapState::Committed as u8);

        prepared_swap.set_state(PreparedSwapState::Unprepared);
        assert!(prepared_swap.state == PreparedSwapState::Unprepared as u8);
    }

    #[test]
    fn test_validate_for_commit() {
        let mut prepared_swap_data = [0x00u8; PreparedSwap::LEN - 8];
        let prepared_swap: &mut PreparedSwap = bytemuck::from_bytes_mut(&mut prepared_swap_data);
        prepared_swap.reset();

        let whirlpool_address = Pubkey::new_unique();
        let whirlpool_state_sequence = 0x88776655u32;

        let authority = Pubkey::new_unique();
        let amount = 0x1122334455667788u64;
        let sqrt_price_limit = 0xffeeddccbbaa99887766554433221100u128;
        let amount_specified_is_input = true;
        let a_to_b = false;
        let slot = 0x9988776666778899u64;

        prepared_swap.set_precondition(
            authority,
            whirlpool_address,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            slot,
        );
        prepared_swap.set_state(PreparedSwapState::Prepared);

        let result = prepared_swap.validate_for_commit(
            authority,
            whirlpool_address,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            slot,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_for_commit_fail_version_mismatch() {
        let mut prepared_swap_data = [0x00u8; PreparedSwap::LEN - 8];
        let prepared_swap: &mut PreparedSwap = bytemuck::from_bytes_mut(&mut prepared_swap_data);
        prepared_swap.reset();

        let whirlpool_address = Pubkey::new_unique();
        let whirlpool_state_sequence = 0x88776655u32;

        let authority = Pubkey::new_unique();
        let amount = 0x1122334455667788u64;
        let sqrt_price_limit = 0xffeeddccbbaa99887766554433221100u128;
        let amount_specified_is_input = true;
        let a_to_b = false;
        let slot = 0x9988776666778899u64;

        prepared_swap.set_precondition(
            authority,
            whirlpool_address,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            slot,
        );
        prepared_swap.set_state(PreparedSwapState::Prepared);

        // set invalid version
        prepared_swap.version = PREPARED_SWAP_LAYOUT_VERSION.checked_add(1).unwrap();

        let result = prepared_swap.validate_for_commit(
            authority,
            whirlpool_address,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            slot,
        );
        assert_eq!(result.unwrap_err(), ErrorCode::PreparedSwapVersionMismatch.into());
    }

    #[test]
    fn test_validate_for_commit_fail_state_not_prepared() {
        let mut prepared_swap_data = [0x00u8; PreparedSwap::LEN - 8];
        let prepared_swap: &mut PreparedSwap = bytemuck::from_bytes_mut(&mut prepared_swap_data);
        prepared_swap.reset();

        let whirlpool_address = Pubkey::new_unique();
        let whirlpool_state_sequence = 0x88776655u32;

        let authority = Pubkey::new_unique();
        let amount = 0x1122334455667788u64;
        let sqrt_price_limit = 0xffeeddccbbaa99887766554433221100u128;
        let amount_specified_is_input = true;
        let a_to_b = false;
        let slot = 0x9988776666778899u64;

        prepared_swap.set_precondition(
            authority,
            whirlpool_address,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            slot,
        );
        prepared_swap.set_state(PreparedSwapState::Prepared);

        // set non prepared state
        prepared_swap.state = PreparedSwapState::Committed as u8;

        let result = prepared_swap.validate_for_commit(
            authority,
            whirlpool_address,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            slot,
        );
        assert_eq!(result.unwrap_err(), ErrorCode::PreparedSwapNotPrepared.into());
    }

    #[test]
    fn test_validate_for_commit_fail_precondition_mismatch() {
        let mut prepared_swap_data = [0x00u8; PreparedSwap::LEN - 8];
        let prepared_swap: &mut PreparedSwap = bytemuck::from_bytes_mut(&mut prepared_swap_data);
        prepared_swap.reset();

        let whirlpool_address = Pubkey::new_unique();
        let whirlpool_state_sequence = 0x88776655u32;

        let authority = Pubkey::new_unique();
        let amount = 0x1122334455667788u64;
        let sqrt_price_limit = 0xffeeddccbbaa99887766554433221100u128;
        let amount_specified_is_input = true;
        let a_to_b = false;
        let slot = 0x9988776666778899u64;

        prepared_swap.set_precondition(
            authority,
            whirlpool_address,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            slot,
        );
        prepared_swap.set_state(PreparedSwapState::Prepared);

        // just to confirm the validity
        let result = prepared_swap.validate_for_commit(
            authority,
            whirlpool_address,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            slot,
        );
        assert!(result.is_ok());

        // authority mismatch
        let result = prepared_swap.validate_for_commit(
            Pubkey::new_unique(), // mismatch
            whirlpool_address,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            slot,
        );
        assert_eq!(result.unwrap_err(), ErrorCode::PreparedSwapPreconditionMismatch.into());

        // whirlpool pubkey mismatch
        let result = prepared_swap.validate_for_commit(
            authority,
            Pubkey::new_unique(), // mismatch
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            slot,
        );
        assert_eq!(result.unwrap_err(), ErrorCode::PreparedSwapPreconditionMismatch.into());

        // whirlpool state sequence mismatch
        let result = prepared_swap.validate_for_commit(
            authority,
            whirlpool_address,
            0x11223344u32,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            slot,
        );
        assert_eq!(result.unwrap_err(), ErrorCode::PreparedSwapPreconditionMismatch.into());

        // amount mismatch
        let result = prepared_swap.validate_for_commit(
            authority,
            whirlpool_address,
            whirlpool_state_sequence,
            amount.checked_add(1).unwrap(), // mismatch
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            slot,
        );
        assert_eq!(result.unwrap_err(), ErrorCode::PreparedSwapPreconditionMismatch.into());

        // sqrt_price_limit mismatch
        let result = prepared_swap.validate_for_commit(
            authority,
            whirlpool_address,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit.checked_add(1).unwrap(), // mismatch
            amount_specified_is_input,
            a_to_b,
            slot,
        );
        assert_eq!(result.unwrap_err(), ErrorCode::PreparedSwapPreconditionMismatch.into());

        // amount_specified_is_input mismatch
        let result = prepared_swap.validate_for_commit(
            authority,
            whirlpool_address,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            !amount_specified_is_input, // mismatch
            a_to_b,
            slot,
        );
        assert_eq!(result.unwrap_err(), ErrorCode::PreparedSwapPreconditionMismatch.into());

        // a_to_b mismatch
        let result = prepared_swap.validate_for_commit(
            authority,
            whirlpool_address,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            !a_to_b, // mismatch
            slot,
        );
        assert_eq!(result.unwrap_err(), ErrorCode::PreparedSwapPreconditionMismatch.into());

        // slot mismatch
        let result = prepared_swap.validate_for_commit(
            authority,
            whirlpool_address,
            whirlpool_state_sequence,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            slot.checked_add(1).unwrap(), // mismatch
        );
        assert_eq!(result.unwrap_err(), ErrorCode::PreparedSwapPreconditionMismatch.into());
    }
}

#[cfg(test)]
mod discriminator_tests {
    use anchor_lang::Discriminator;

    use super::*;

    #[test]
    fn test_discriminator() {
        let discriminator: [u8; 8] = PreparedSwap::DISCRIMINATOR.try_into().unwrap();
        // The discriminator is determined by the struct name and not depending on the program id.
        // $ echo -n account:PreparedSwap | sha256sum | cut -c 1-16
        // 414b56b1c43c25ef
        assert_eq!(
            discriminator,
            [0x41, 0x4b, 0x56, 0xb1, 0xc4, 0x3c, 0x25, 0xef]
        );
    }
}

#[cfg(test)]
mod data_layout_tests {
    use super::*;

    #[test]
    fn test_len_constant() {
        assert_eq!(PreparedSwap::LEN, 1024 * 10); // 10KB
    }

    #[test]
    fn test_prepared_swap_data_layout() {
        let prepared_swap_reserved = [0u8; PREPARED_SWAP_RESERVED_BYTES];
        
        let prepared_swap_version = 0x1122u16;
        let prepared_swap_state = PreparedSwapState::Committed as u8;

        let precondition_slot = 0x33445566778899aau64;
        let precondition_authority = Pubkey::new_unique();
        let precondition_whirlpool = Pubkey::new_unique();
        let precondition_whirlpool_state_sequence = 0x44556677u32;
        let precondition_amount = 0x8899aabbccddeeffu64;
        let precondition_sqrt_price_limit = 0x112233445566778899aabbccddeeff00u128;
        let precondition_amount_specified_is_input = true;
        let precondition_a_to_b = false;

        let pending_post_swap_update_amount_a = 0xffeeddccbbaa9988u64;
        let pending_post_swap_update_amount_b = 0x7766554433221100u64;
        let pending_post_swap_update_lp_fee = 0x1122334455667788u64;
        let pending_post_swap_update_next_liquidity = 0x99aabbccddeeff001122334455667788u128;
        let pending_post_swap_update_next_tick_index = 0x00112233i32;
        let pending_post_swap_update_next_sqrt_price = 0xff00ffeeddccbbaaaabbccdd11223344u128;
        let pending_post_swap_update_next_fee_growth_global = 0x11223344443322119988776666778899u128;
        let pending_post_swap_update_next_reward_growth_global = [
            0x112233445566778899aabbccddeeff00u128,
            0x112233445566778899aabbccddee00ffu128,
            0x112233445566778899aabbccdd00eeffu128,
        ];
        let pending_post_swap_update_next_protocol_fee = 0xccddeeff55667788u64;

        let pending_post_swap_update_next_af_var_is_some = true;
        let pending_post_swap_update_next_af_var_last_reference_update_timestamp = 0x1122334455667788u64;
        let pending_post_swap_update_next_af_var_last_major_swap_timestamp = 0x2233445566778899u64;
        let pending_post_swap_update_next_af_var_volatility_reference = 0x99aabbccu32;
        let pending_post_swap_update_next_af_var_tick_group_index_reference = 0x00ddeeffi32;
        let pending_post_swap_update_next_af_var_volatility_accumulator = 0x11223344u32;
        let pending_post_swap_update_next_af_var_reserved = [0u8; 16];

        let pending_tick_updates_len = 0xffeeu16;
        let pending_tick_update_array_index = 0xccu8;
        let pending_tick_update_tick_index = 0x55667788i32;
        let pending_tick_update_next_fee_growth_outside_a = 0x66778899aabbccdd9988776655443322u128;
        let pending_tick_update_next_fee_growth_outside_b = 0xddccbbaa998877661122334455667788u128;
        let mut pending_tick_update = [0u8; PendingTickUpdate::LEN];
        pending_tick_update[0] = pending_tick_update_array_index;
        pending_tick_update[1..5].copy_from_slice(&pending_tick_update_tick_index.to_le_bytes());
        pending_tick_update[5..21].copy_from_slice(&pending_tick_update_next_fee_growth_outside_a.to_le_bytes());
        pending_tick_update[21..37].copy_from_slice(&pending_tick_update_next_fee_growth_outside_b.to_le_bytes());

        let mut precondition_data = [0u8; PreparedSwapPrecondition::LEN];
        let mut offset = 0;
        precondition_data[offset..offset + 8].copy_from_slice(&precondition_slot.to_le_bytes());
        offset += 8;
        precondition_data[offset..offset + 32].copy_from_slice(precondition_authority.as_ref());
        offset += 32;
        precondition_data[offset..offset + 32].copy_from_slice(precondition_whirlpool.as_ref());
        offset += 32;
        precondition_data[offset..offset + 4].copy_from_slice(&precondition_whirlpool_state_sequence.to_le_bytes());
        offset += 4;
        precondition_data[offset..offset + 8].copy_from_slice(&precondition_amount.to_le_bytes());
        offset += 8;
        precondition_data[offset..offset + 16].copy_from_slice(&precondition_sqrt_price_limit.to_le_bytes());
        offset += 16;
        precondition_data[offset] = precondition_amount_specified_is_input as u8;
        offset += 1;
        precondition_data[offset] = precondition_a_to_b as u8;
        offset += 1;
        assert_eq!(offset, PreparedSwapPrecondition::LEN);

        let mut pending_updates_data = [0u8; PreparedSwapPendingUpdates::LEN];
        let mut offset = 0;
        pending_updates_data[offset..offset + 8].copy_from_slice(&pending_post_swap_update_amount_a.to_le_bytes());
        offset += 8;
        pending_updates_data[offset..offset + 8].copy_from_slice(&pending_post_swap_update_amount_b.to_le_bytes());
        offset += 8;
        pending_updates_data[offset..offset + 8].copy_from_slice(&pending_post_swap_update_lp_fee.to_le_bytes());
        offset += 8;
        pending_updates_data[offset..offset + 16].copy_from_slice(&pending_post_swap_update_next_liquidity.to_le_bytes());
        offset += 16;
        pending_updates_data[offset..offset + 4].copy_from_slice(&pending_post_swap_update_next_tick_index.to_le_bytes());
        offset += 4;
        pending_updates_data[offset..offset + 16].copy_from_slice(&pending_post_swap_update_next_sqrt_price.to_le_bytes());
        offset += 16;
        pending_updates_data[offset..offset + 16].copy_from_slice(&pending_post_swap_update_next_fee_growth_global.to_le_bytes());
        offset += 16;
        pending_post_swap_update_next_reward_growth_global.iter().for_each(|v| {
            pending_updates_data[offset..offset + 16].copy_from_slice(&v.to_le_bytes());
            offset += 16;
        });
        pending_updates_data[offset..offset + 8].copy_from_slice(&pending_post_swap_update_next_protocol_fee.to_le_bytes());
        offset += 8;
        pending_updates_data[offset] = pending_post_swap_update_next_af_var_is_some as u8;
        offset += 1;
        pending_updates_data[offset..offset + 8]
            .copy_from_slice(&pending_post_swap_update_next_af_var_last_reference_update_timestamp.to_le_bytes());
        offset += 8;
        pending_updates_data[offset..offset + 8]
            .copy_from_slice(&pending_post_swap_update_next_af_var_last_major_swap_timestamp.to_le_bytes());
        offset += 8;
        pending_updates_data[offset..offset + 4].copy_from_slice(&pending_post_swap_update_next_af_var_volatility_reference.to_le_bytes());
        offset += 4;
        pending_updates_data[offset..offset + 4]
            .copy_from_slice(&pending_post_swap_update_next_af_var_tick_group_index_reference.to_le_bytes());
        offset += 4;
        pending_updates_data[offset..offset + 4]
            .copy_from_slice(&pending_post_swap_update_next_af_var_volatility_accumulator.to_le_bytes());
        offset += 4;
        offset += pending_post_swap_update_next_af_var_reserved.len();
        assert_eq!(offset, PendingPostSwapUpdate::LEN);
        // tick
        pending_updates_data[offset..offset + 2].copy_from_slice(&pending_tick_updates_len.to_le_bytes());
        offset += 2;
        for _ in 0..MAX_PENDING_TICK_UPDATES_LEN {
            pending_updates_data[offset..offset + PendingTickUpdate::LEN].copy_from_slice(&pending_tick_update);
            offset += PendingTickUpdate::LEN;
        }
        assert_eq!(offset, PreparedSwapPendingUpdates::LEN);

        // manually build the expected PreparedSwap data layout
        // note: no discriminator
        let mut prepared_swap_data = [0u8; PreparedSwap::LEN - 8];
        let mut offset = 0;
        prepared_swap_data[offset..offset + 2].copy_from_slice(&prepared_swap_version.to_le_bytes());
        offset += 2;
        prepared_swap_data[offset] = prepared_swap_state as u8;
        offset += 1;
        prepared_swap_data[offset..offset + PreparedSwapPrecondition::LEN].copy_from_slice(&precondition_data);
        offset += PreparedSwapPrecondition::LEN;
        prepared_swap_data[offset..offset + PreparedSwapPendingUpdates::LEN].copy_from_slice(&pending_updates_data);
        offset += PreparedSwapPendingUpdates::LEN;
        offset += prepared_swap_reserved.len();
        assert_eq!(offset, prepared_swap_data.len());
        assert_eq!(prepared_swap_data.len(), core::mem::size_of::<PreparedSwap>());

        // cast from bytes to PreparedSwap (re-interpret)
        let prepared_swap: &PreparedSwap = bytemuck::from_bytes(&prepared_swap_data);

        // check that the data layout matches the expected layout
        let read_version = prepared_swap.version;
        assert_eq!(read_version, prepared_swap_version);
        let read_state = prepared_swap.state;
        assert_eq!(read_state, prepared_swap_state);
        // precondition
        let read_slot = prepared_swap.precondition.slot;
        assert_eq!(read_slot, precondition_slot);
        let read_authority = prepared_swap.precondition.authority;
        assert_eq!(read_authority, precondition_authority);
        let read_whirlpool = prepared_swap.precondition.whirlpool;
        assert_eq!(read_whirlpool, precondition_whirlpool);
        let read_whirlpool_state_sequence = prepared_swap.precondition.whirlpool_state_sequence;
        assert_eq!(read_whirlpool_state_sequence, precondition_whirlpool_state_sequence);
        let read_amount = prepared_swap.precondition.amount;
        assert_eq!(read_amount, precondition_amount);
        let read_sqrt_price_limit = prepared_swap.precondition.sqrt_price_limit;
        assert_eq!(read_sqrt_price_limit, precondition_sqrt_price_limit);
        let read_amount_specified_is_input = prepared_swap.precondition.amount_specified_is_input;
        assert_eq!(read_amount_specified_is_input, precondition_amount_specified_is_input);
        let read_a_to_b = prepared_swap.precondition.a_to_b;
        assert_eq!(read_a_to_b, precondition_a_to_b);
        // pendingg updates
        let read_amount_a = prepared_swap.pending_updates.pending_post_swap_update.amount_a;
        assert_eq!(read_amount_a, pending_post_swap_update_amount_a);
        let read_amount_b = prepared_swap.pending_updates.pending_post_swap_update.amount_b;
        assert_eq!(read_amount_b, pending_post_swap_update_amount_b);
        let read_lp_fee = prepared_swap.pending_updates.pending_post_swap_update.lp_fee;
        assert_eq!(read_lp_fee, pending_post_swap_update_lp_fee);
        let read_next_liquidity = prepared_swap.pending_updates.pending_post_swap_update.next_liquidity;
        assert_eq!(read_next_liquidity, pending_post_swap_update_next_liquidity);
        let read_next_tick_index = prepared_swap.pending_updates.pending_post_swap_update.next_tick_index;
        assert_eq!(read_next_tick_index, pending_post_swap_update_next_tick_index);
        let read_next_sqrt_price = prepared_swap.pending_updates.pending_post_swap_update.next_sqrt_price;
        assert_eq!(read_next_sqrt_price, pending_post_swap_update_next_sqrt_price);
        let read_next_fee_growth_global = prepared_swap.pending_updates.pending_post_swap_update.next_fee_growth_global;
        assert_eq!(read_next_fee_growth_global, pending_post_swap_update_next_fee_growth_global);
        let read_next_reward_growth_global = prepared_swap.pending_updates.pending_post_swap_update.next_reward_growth_global;
        assert_eq!(read_next_reward_growth_global, pending_post_swap_update_next_reward_growth_global);
        let read_next_protocol_fee = prepared_swap.pending_updates.pending_post_swap_update.next_protocol_fee;
        assert_eq!(read_next_protocol_fee, pending_post_swap_update_next_protocol_fee);

        let read_is_some = prepared_swap.pending_updates.pending_post_swap_update.next_adaptive_fee_variables_is_some;
        assert_eq!(read_is_some, pending_post_swap_update_next_af_var_is_some);
        let read_last_reference_update_timestamp = prepared_swap.pending_updates.pending_post_swap_update.next_adaptive_fee_variables.last_reference_update_timestamp;
        assert_eq!(read_last_reference_update_timestamp, pending_post_swap_update_next_af_var_last_reference_update_timestamp);
        let read_last_major_swap_timestamp = prepared_swap.pending_updates.pending_post_swap_update.next_adaptive_fee_variables.last_major_swap_timestamp;
        assert_eq!(read_last_major_swap_timestamp, pending_post_swap_update_next_af_var_last_major_swap_timestamp);
        let read_volatility_reference = prepared_swap.pending_updates.pending_post_swap_update.next_adaptive_fee_variables.volatility_reference;
        assert_eq!(read_volatility_reference, pending_post_swap_update_next_af_var_volatility_reference);
        let read_tick_group_index_reference = prepared_swap.pending_updates.pending_post_swap_update.next_adaptive_fee_variables.tick_group_index_reference;
        assert_eq!(read_tick_group_index_reference, pending_post_swap_update_next_af_var_tick_group_index_reference);
        let read_volatility_accumulator = prepared_swap.pending_updates.pending_post_swap_update.next_adaptive_fee_variables.volatility_accumulator;
        assert_eq!(read_volatility_accumulator, pending_post_swap_update_next_af_var_volatility_accumulator);
        let read_reserved = prepared_swap.pending_updates.pending_post_swap_update.next_adaptive_fee_variables.reserved;
        assert_eq!(read_reserved, pending_post_swap_update_next_af_var_reserved);

        // tick
        let read_tick_updates_len = prepared_swap.pending_updates.pending_tick_updates_len;
        assert_eq!(read_tick_updates_len, pending_tick_updates_len);
        for i in 0..MAX_PENDING_TICK_UPDATES_LEN {
            let read_array_index = prepared_swap.pending_updates.pending_tick_updates[i].array_index;
            assert_eq!(read_array_index, pending_tick_update_array_index);
            let read_tick_index = prepared_swap.pending_updates.pending_tick_updates[i].tick_index;
            assert_eq!(read_tick_index, pending_tick_update_tick_index);
            let read_next_fee_growth_outside_a = prepared_swap.pending_updates.pending_tick_updates[i].next_fee_growth_outside_a;
            assert_eq!(read_next_fee_growth_outside_a, pending_tick_update_next_fee_growth_outside_a);
            let read_next_fee_growth_outside_b = prepared_swap.pending_updates.pending_tick_updates[i].next_fee_growth_outside_b;
            assert_eq!(read_next_fee_growth_outside_b, pending_tick_update_next_fee_growth_outside_b);
        }
    }
}
