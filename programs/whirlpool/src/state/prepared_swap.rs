use anchor_lang::prelude::*;

use crate::{errors::ErrorCode, manager::swap_manager::PostSwapUpdate, state::{AdaptiveFeeVariables, NUM_REWARDS, TICK_ARRAY_SIZE_USIZE, Whirlpool}};

// Maximum nonce value allowed for PreparedSwap.
//
// Although the nonce is represented as a u8, allowing all 256 possible
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
pub const MAX_PREPARED_SWAP_NONCE: u8 = 15; // allows 0..=15, 16 accounts

// Current PreparedSwap account layout version.
//
// Increment this value whenever the PreparedSwap layout or account size
// changes.
pub const PREPARED_SWAP_LAYOUT_VERSION: u16 = 1;

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Debug)]
pub struct PendingWhirlpoolUpdate {
    pub amount_a: u64,
    pub amount_b: u64,
    pub lp_fee: u64,
    pub next_liquidity: u128,
    pub next_tick_index: i32,
    pub next_sqrt_price: u128,
    pub next_fee_growth_global: u128,
    pub next_reward_growth_global: [u128; NUM_REWARDS],
    pub next_protocol_fee: u64, // delta value (not next absolute value)
}

impl PendingWhirlpoolUpdate {
    pub const LEN: usize = 8 + 8 + 8 + 16 + 4 + 16 + 16 + (16 * NUM_REWARDS) + 8; // 132
}

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Debug)]
pub struct PendingOracleUpdate {
    pub next_adaptive_fee_variables_is_some: bool,
    pub next_adaptive_fee_variables: AdaptiveFeeVariables,
}

impl PendingOracleUpdate {
    pub const LEN: usize = 1 + 44; // 45
}

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Debug)]
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
    pub whirlpool_state_version: u32,

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
    pub pending_whirlpool_update: PendingWhirlpoolUpdate,
    pub pending_oracle_update: PendingOracleUpdate,
    pub pending_tick_updates_len: u16,
    // TODO: remove magic number (3)
    pub pending_tick_updates: [PendingTickUpdate; TICK_ARRAY_SIZE_USIZE * 3],
}

impl PreparedSwapPendingUpdates {
    // TODO: remove magic number (3)
    pub const LEN: usize = PendingWhirlpoolUpdate::LEN + PendingOracleUpdate::LEN + 2 + PendingTickUpdate::LEN * TICK_ARRAY_SIZE_USIZE * 3; // 9947
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

    pub fn initialize(&mut self, nonce: u8) -> Result<()> {
        if nonce > MAX_PREPARED_SWAP_NONCE {
            return Err(ErrorCode::PreparedSwapNonceMaxExceeded.into());
        }

        self.version = PREPARED_SWAP_LAYOUT_VERSION;
        self.state = PreparedSwapState::Unprepared as u8;
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
        whirlpool: &Account<Whirlpool>,
        amount: u64,
        sqrt_price_limit: u128,
        amount_specified_is_input: bool,
        a_to_b: bool,
        clock: &Clock,
    ) {
        self.precondition = PreparedSwapPrecondition {
            slot: clock.slot,
            authority,
            whirlpool: whirlpool.key(),
            // TODO: set
            whirlpool_state_version: 0,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
        };
    }

    pub fn add_pending_tick_update(
        &mut self,
        tick_update: PendingTickUpdate,
    ) {
        // TODO: overflow check
        self.pending_updates.pending_tick_updates[self.pending_updates.pending_tick_updates_len as usize] = tick_update;
        self.pending_updates.pending_tick_updates_len += 1;
    }

    pub fn set_pending_swap_update(
        &mut self,
        swap_update: &PostSwapUpdate,
    ) {
        // pending_oracle_update
        if let Some(adaptive_fee_info) = &swap_update.next_adaptive_fee_info {
            self.pending_updates.pending_oracle_update.next_adaptive_fee_variables_is_some = true;
            self.pending_updates.pending_oracle_update.next_adaptive_fee_variables = adaptive_fee_info.variables;
        } else {
            self.pending_updates.pending_oracle_update.next_adaptive_fee_variables_is_some = false;
        }

        // pending_whirlpool_update
        self.pending_updates.pending_whirlpool_update = PendingWhirlpoolUpdate {
            amount_a: swap_update.amount_a,
            amount_b: swap_update.amount_b,
            lp_fee: swap_update.lp_fee,
            next_liquidity: swap_update.next_liquidity,
            next_tick_index: swap_update.next_tick_index,
            next_sqrt_price: swap_update.next_sqrt_price,
            next_fee_growth_global: swap_update.next_fee_growth_global,
            next_reward_growth_global: [
                swap_update.next_reward_infos[0].growth_global_x64,
                swap_update.next_reward_infos[1].growth_global_x64,
                swap_update.next_reward_infos[2].growth_global_x64,
            ],
            next_protocol_fee: swap_update.next_protocol_fee,
        };
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
        whirlpool: &Account<Whirlpool>,
        amount: u64,
        sqrt_price_limit: u128,
        amount_specified_is_input: bool,
        a_to_b: bool,
        clock: &Clock,
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
            slot: clock.slot,
            authority,
            whirlpool: whirlpool.key(),
            // TODO: set
            whirlpool_state_version: 0,
            amount,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
        }) {
            return Err(ErrorCode::PreparedSwapPreconditionMismatch.into());
        }

        Ok(())
    }

    /* 
    pub fn initialize(&mut self, whirlpools_config: Pubkey, token_mint: Pubkey) -> Result<()> {
        self.whirlpools_config = whirlpools_config;
        self.token_mint = token_mint;
        self.attribute_require_non_transferable_position = false;
        Ok(())
    }

    pub fn update_attribute(&mut self, attribute: TokenBadgeAttribute) -> Result<()> {
        match attribute {
            TokenBadgeAttribute::RequireNonTransferablePosition(value) => {
                self.attribute_require_non_transferable_position = value;
            }
        }
        Ok(())
    }
    */
}

/* 
#[cfg(test)]
mod token_badge_initialize_tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_default() {
        let token_badge = TokenBadge {
            ..Default::default()
        };
        assert_eq!(token_badge.whirlpools_config, Pubkey::default());
        assert_eq!(token_badge.token_mint, Pubkey::default());
    }

    #[test]
    fn test_initialize() {
        let mut token_badge = TokenBadge {
            ..Default::default()
        };
        let whirlpools_config =
            Pubkey::from_str("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ").unwrap();
        let token_mint = Pubkey::from_str("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE").unwrap();

        let result = token_badge.initialize(whirlpools_config, token_mint);
        assert!(result.is_ok());

        assert_eq!(whirlpools_config, token_badge.whirlpools_config);
        assert_eq!(token_mint, token_badge.token_mint);
        assert!(!token_badge.attribute_require_non_transferable_position);
    }
}

#[cfg(test)]
mod discriminator_tests {
    use anchor_lang::Discriminator;

    use super::*;

    #[test]
    fn test_discriminator() {
        let discriminator: [u8; 8] = TokenBadge::DISCRIMINATOR.try_into().unwrap();
        // The discriminator is determined by the struct name and not depending on the program id.
        // $ echo -n account:TokenBadge | sha256sum | cut -c 1-16
        // 74dbcce5f974ff96
        assert_eq!(
            discriminator,
            [0x74, 0xdb, 0xcc, 0xe5, 0xf9, 0x74, 0xff, 0x96]
        );
    }
}

#[cfg(test)]
mod data_layout_tests {
    use super::*;

    #[test]
    fn test_token_badge_data_layout() {
        let token_badge_whirlpools_config = Pubkey::new_unique();
        let token_badge_token_mint = Pubkey::new_unique();
        let token_badge_attribute_require_non_transferable_position = true;
        let token_badge_reserved = [0u8; 127];

        // manually build the expected data layout
        let mut token_badge_data = [0u8; TokenBadge::LEN];
        let mut offset = 0;
        token_badge_data[offset..offset + 8].copy_from_slice(TokenBadge::DISCRIMINATOR);
        offset += 8;
        token_badge_data[offset..offset + 32]
            .copy_from_slice(&token_badge_whirlpools_config.to_bytes());
        offset += 32;
        token_badge_data[offset..offset + 32].copy_from_slice(&token_badge_token_mint.to_bytes());
        offset += 32;
        token_badge_data[offset..offset + 1].copy_from_slice(
            &token_badge_attribute_require_non_transferable_position
                .try_to_vec()
                .unwrap(),
        );
        offset += 1;
        token_badge_data[offset..offset + token_badge_reserved.len()]
            .copy_from_slice(&token_badge_reserved);
        offset += token_badge_reserved.len();
        assert_eq!(offset, TokenBadge::LEN);

        // deserialize
        let deserialized = TokenBadge::try_deserialize(&mut token_badge_data.as_ref()).unwrap();

        assert_eq!(
            token_badge_whirlpools_config,
            deserialized.whirlpools_config
        );
        assert_eq!(token_badge_token_mint, deserialized.token_mint);

        // serialize
        let mut serialized = Vec::new();
        deserialized.try_serialize(&mut serialized).unwrap();
        serialized.extend_from_slice(&token_badge_reserved);

        assert_eq!(serialized.as_slice(), token_badge_data.as_ref());
    }
}
*/
