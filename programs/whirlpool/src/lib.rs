//! A concentrated liquidity AMM contract powered by Orca.
use anchor_lang::prelude::*;

declare_id!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

#[doc(hidden)]
pub mod constants;
#[doc(hidden)]
pub mod errors;
#[doc(hidden)]
pub mod instructions;
#[doc(hidden)]
pub mod manager;
#[doc(hidden)]
pub mod math;
pub mod state;
#[doc(hidden)]
pub mod tests;
#[doc(hidden)]
pub mod util;

use crate::state::{OpenPositionBumps, OpenPositionWithMetadataBumps, WhirlpoolBumps};
use instructions::*;

#[program]
pub mod whirlpool {
    use super::*;

    /// Initializes a WhirlpoolsConfig account that hosts info & authorities
    /// required to govern a set of Whirlpools.
    ///
    /// # Parameters
    /// - `fee_authority` - Authority authorized to initialize fee-tiers and set customs fees.
    /// - `collect_protocol_fees_authority` - Authority authorized to collect protocol fees.
    /// - `reward_emissions_super_authority` - Authority authorized to set reward authorities in pools.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        fee_authority: Pubkey,
        collect_protocol_fees_authority: Pubkey,
        reward_emissions_super_authority: Pubkey,
        default_protocol_fee_rate: u16,
    ) -> ProgramResult {
        return instructions::initialize_config::handler(
            ctx,
            fee_authority,
            collect_protocol_fees_authority,
            reward_emissions_super_authority,
            default_protocol_fee_rate,
        );
    }

    /// Initializes a Whirlpool account.
    /// Fee rate is set to the default values on the config and supplied fee_tier.
    ///
    /// # Parameters
    /// - `bumps` - The bump value when deriving the PDA of the Whirlpool address.
    /// - `tick_spacing` - The desired tick spacing for this pool.
    /// - `initial_sqrt_price` - The desired initial sqrt-price for this pool
    ///
    /// # Special Errors
    /// `InvalidTokenMintOrder` - The order of mints have to be ordered by
    /// `SqrtPriceOutOfBounds` - provided initial_sqrt_price is not between 2^-64 to 2^64
    ///
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        bumps: WhirlpoolBumps,
        tick_spacing: u16,
        initial_sqrt_price: u128,
    ) -> ProgramResult {
        return instructions::initialize_pool::handler(
            ctx,
            bumps,
            tick_spacing,
            initial_sqrt_price,
        );
    }

    /// Initializes a tick_array account to represent a tick-range in a Whirlpool.
    ///
    /// # Parameters
    /// - `start_tick_index` - The starting tick index for this tick-array.
    ///                        Has to be a multiple of TickArray size & the tick spacing of this pool.
    ///
    /// # Special Errors
    /// - `InvalidStartTick` - if the provided start tick is out of bounds or is not a multiple of
    ///                        TICK_ARRAY_SIZE * tick spacing.
    pub fn initialize_tick_array(
        ctx: Context<InitializeTickArray>,
        start_tick_index: i32,
    ) -> ProgramResult {
        return instructions::initialize_tick_array::handler(ctx, start_tick_index);
    }

    /// Initializes a fee_tier account usable by Whirlpools in a WhirlpoolConfig space.
    ///
    /// # Authority
    /// - "fee_authority" - Set authority in the WhirlpoolConfig
    ///
    /// # Parameters
    /// - `tick_spacing` - The tick-spacing that this fee-tier suggests the default_fee_rate for.
    /// - `default_fee_rate` - The default fee rate that a pool will use if the pool uses this
    ///                        fee tier during initialization.
    ///
    /// # Special Errors
    /// - `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE.
    pub fn initialize_fee_tier(
        ctx: Context<InitializeFeeTier>,
        tick_spacing: u16,
        default_fee_rate: u16,
    ) -> ProgramResult {
        return instructions::initialize_fee_tier::handler(ctx, tick_spacing, default_fee_rate);
    }

    /// Initialize reward for a Whirlpool. A pool can only support up to a set number of rewards.
    ///
    /// # Authority
    /// - "reward_authority" - assigned authority by the reward_super_authority for the specified
    ///                        reward-index in this Whirlpool
    ///
    /// # Parameters
    /// - `reward_index` - The reward index that we'd like to initialize. (0 <= index <= NUM_REWARDS)
    ///
    /// # Special Errors
    /// - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized
    ///                          index in this pool, or exceeds NUM_REWARDS, or
    ///                          all reward slots for this pool has been initialized.
    pub fn initialize_reward(ctx: Context<InitializeReward>, reward_index: u8) -> ProgramResult {
        return instructions::initialize_reward::handler(ctx, reward_index);
    }

    /// Set the reward emissions for a reward in a Whirlpool.
    ///
    /// # Authority
    /// - "reward_authority" - assigned authority by the reward_super_authority for the specified
    ///                        reward-index in this Whirlpool
    ///
    /// # Parameters
    /// - `reward_index` - The reward index (0 <= index <= NUM_REWARDS) that we'd like to modify.
    /// - `emissions_per_second_x64` - The amount of rewards emitted in this pool.
    ///
    /// # Special Errors
    /// - `RewardVaultAmountInsufficient` - The amount of rewards in the reward vault cannot emit
    ///                                     more than a day of desired emissions.
    /// - `InvalidTimestamp` - Provided timestamp is not in order with the previous timestamp.
    /// - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized
    ///                          index in this pool, or exceeds NUM_REWARDS, or
    ///                          all reward slots for this pool has been initialized.
    pub fn set_reward_emissions(
        ctx: Context<SetRewardEmissions>,
        reward_index: u8,
        emissions_per_second_x64: u128,
    ) -> ProgramResult {
        return instructions::set_reward_emissions::handler(
            ctx,
            reward_index,
            emissions_per_second_x64,
        );
    }

    /// Open a position in a Whirlpool. A unique token will be minted to represent the position
    /// in the users wallet. The position will start off with 0 liquidity.
    ///
    /// # Parameters
    /// - `tick_lower_index` - The tick specifying the lower end of the position range.
    /// - `tick_upper_index` - The tick specifying the upper end of the position range.
    ///
    /// # Special Errors
    /// - `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of
    ///                        the tick-spacing in this pool.
    pub fn open_position(
        ctx: Context<OpenPosition>,
        bumps: OpenPositionBumps,
        tick_lower_index: i32,
        tick_upper_index: i32,
    ) -> ProgramResult {
        return instructions::open_position::handler(
            ctx,
            bumps,
            tick_lower_index,
            tick_upper_index,
        );
    }

    /// Open a position in a Whirlpool. A unique token will be minted to represent the position
    /// in the users wallet. Additional Metaplex metadata is appended to identify the token.
    /// The position will start off with 0 liquidity.
    ///
    /// # Parameters
    /// - `tick_lower_index` - The tick specifying the lower end of the position range.
    /// - `tick_upper_index` - The tick specifying the upper end of the position range.
    ///
    /// # Special Errors
    /// - `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of
    ///                        the tick-spacing in this pool.
    pub fn open_position_with_metadata(
        ctx: Context<OpenPositionWithMetadata>,
        bumps: OpenPositionWithMetadataBumps,
        tick_lower_index: i32,
        tick_upper_index: i32,
    ) -> ProgramResult {
        return instructions::open_position_with_metadata::handler(
            ctx,
            bumps,
            tick_lower_index,
            tick_upper_index,
        );
    }

    /// Add liquidity to a position in the Whirlpool.
    ///
    /// # Authority
    /// - `position_authority` - authority that owns the token corresponding to this desired position.
    ///
    /// # Parameters
    /// - `liquidity_amount` - The total amount of Liquidity the user is willing to deposit.
    /// - `token_max_a` - The maximum amount of tokenA the user is willing to deposit.
    /// - `token_max_b` - The maximum amount of tokenB the user is willing to deposit.
    ///
    /// # Special Errors
    /// - `LiquidityZero` - Provided liquidity amount is zero.
    /// - `LiquidityTooHigh` - Provided liquidity exceeds u128::max.
    /// - `TokenMaxExceeded` - The required token to perform this operation exceeds the user defined amount.
    pub fn increase_liquidity(
        ctx: Context<ModifyLiquidity>,
        liquidity_amount: u128,
        token_max_a: u64,
        token_max_b: u64,
    ) -> ProgramResult {
        return instructions::increase_liquidity::handler(
            ctx,
            liquidity_amount,
            token_max_a,
            token_max_b,
        );
    }

    /// Withdraw liquidity from a position in the Whirlpool.
    ///
    /// # Authority
    /// - `position_authority` - authority that owns the token corresponding to this desired position.
    ///
    /// # Parameters
    /// - `liquidity_amount` - The total amount of Liquidity the user desires to withdraw.
    /// - `token_min_a` - The minimum amount of tokenA the user is willing to withdraw.
    /// - `token_min_b` - The minimum amount of tokenB the user is willing to withdraw.
    ///
    /// # Special Errors
    /// - `LiquidityZero` - Provided liquidity amount is zero.
    /// - `LiquidityTooHigh` - Provided liquidity exceeds u128::max.
    /// - `TokenMinSubceeded` - The required token to perform this operation subceeds the user defined amount.
    pub fn decrease_liquidity(
        ctx: Context<ModifyLiquidity>,
        liquidity_amount: u128,
        token_min_a: u64,
        token_min_b: u64,
    ) -> ProgramResult {
        return instructions::decrease_liquidity::handler(
            ctx,
            liquidity_amount,
            token_min_a,
            token_min_b,
        );
    }

    /// Update the accrued fees and rewards for a position.
    ///
    /// # Special Errors
    /// - `TickNotFound` - Provided tick array account does not contain the tick for this position.
    /// - `LiquidityZero` - Position has zero liquidity and therefore already has the most updated fees and reward values.
    pub fn update_fees_and_rewards(ctx: Context<UpdateFeesAndRewards>) -> ProgramResult {
        return instructions::update_fees_and_rewards::handler(ctx);
    }

    /// Collect fees accrued for this position.
    ///
    /// # Authority
    /// - `position_authority` - authority that owns the token corresponding to this desired position.
    pub fn collect_fees(ctx: Context<CollectFees>) -> ProgramResult {
        return instructions::collect_fees::handler(ctx);
    }

    /// Collect rewards accrued for this position.
    ///
    /// # Authority
    /// - `position_authority` - authority that owns the token corresponding to this desired position.
    pub fn collect_reward(ctx: Context<CollectReward>, reward_index: u8) -> ProgramResult {
        return instructions::collect_reward::handler(ctx, reward_index);
    }

    /// Collect the protocol fees accrued in this Whirlpool
    ///
    /// # Authority
    /// - `collect_protocol_fees_authority` - assigned authority in the WhirlpoolConfig that can collect protocol fees
    pub fn collect_protocol_fees(ctx: Context<CollectProtocolFees>) -> ProgramResult {
        return instructions::collect_protocol_fees::handler(ctx);
    }

    /// Perform a swap in this Whirlpool
    ///
    /// # Parameters
    /// - `amount`
    /// - `other_amount_threshold`
    /// - `sqrt_price_limit`
    /// - `exact_input`
    /// - `a_to_b`
    pub fn swap(
        ctx: Context<Swap>,
        amount: u64,
        other_amount_threshold: u64,
        sqrt_price_limit: u128,
        exact_input: bool,
        a_to_b: bool,
    ) -> ProgramResult {
        return instructions::swap::handler(
            ctx,
            amount,
            other_amount_threshold,
            sqrt_price_limit,
            exact_input,
            a_to_b,
        );
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> ProgramResult {
        return instructions::close_position::handler(ctx);
    }

    /// Set the default_fee_rate for a FeeTier
    /// Only the current fee authority has permission to invoke this instruction.
    ///
    /// # Authority
    /// - "fee_authority" - Set authority in the WhirlpoolConfig
    ///
    /// # Parameters
    /// - `default_fee_rate` - The default fee rate that a pool will use if the pool uses this
    ///                        fee tier during initialization.
    ///
    /// # Special Errors
    /// - `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE.
    pub fn set_default_fee_rate(
        ctx: Context<SetDefaultFeeRate>,
        default_fee_rate: u16,
    ) -> ProgramResult {
        return instructions::set_default_fee_rate::handler(ctx, default_fee_rate);
    }

    /// Sets the default protocol fee rate for a WhirlpoolConfig
    /// Protocol fee rate is represented as a basis point.
    /// Only the current fee authority has permission to invoke this instruction.
    ///
    /// # Authority
    /// - "fee_authority" - Set authority that can modify pool fees in the WhirlpoolConfig
    ///
    /// # Parameters
    /// - `default_protocol_fee_rate` - Rate that is referenced during the initialization of a Whirlpool using this config.
    ///
    /// # Special Errors
    /// - `ProtocolFeeRateMaxExceeded` - If the provided default_protocol_fee_rate exceeds MAX_PROTOCOL_FEE_RATE.
    pub fn set_default_protocol_fee_rate(
        ctx: Context<SetDefaultProtocolFeeRate>,
        default_protocol_fee_rate: u16,
    ) -> ProgramResult {
        return instructions::set_default_protocol_fee_rate::handler(
            ctx,
            default_protocol_fee_rate,
        );
    }

    /// Sets the fee rate for a Whirlpool.
    /// Fee rate is represented as hundredths of a basis point.
    /// Only the current fee authority has permission to invoke this instruction.
    ///
    /// # Authority
    /// - "fee_authority" - Set authority that can modify pool fees in the WhirlpoolConfig
    ///
    /// # Parameters
    /// - `fee_rate` - The rate that the pool will use to calculate fees going onwards.
    ///
    /// # Special Errors
    /// - `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE.
    pub fn set_fee_rate(ctx: Context<SetFeeRate>, fee_rate: u16) -> ProgramResult {
        return instructions::set_fee_rate::handler(ctx, fee_rate);
    }

    /// Sets the protocol fee rate for a Whirlpool.
    /// Protocol fee rate is represented as a basis point.
    /// Only the current fee authority has permission to invoke this instruction.
    ///
    /// # Authority
    /// - "fee_authority" - Set authority that can modify pool fees in the WhirlpoolConfig
    ///
    /// # Parameters
    /// - `protocol_fee_rate` - The rate that the pool will use to calculate protocol fees going onwards.
    ///
    /// # Special Errors
    /// - `ProtocolFeeRateMaxExceeded` - If the provided default_protocol_fee_rate exceeds MAX_PROTOCOL_FEE_RATE.
    pub fn set_protocol_fee_rate(
        ctx: Context<SetProtocolFeeRate>,
        protocol_fee_rate: u16,
    ) -> ProgramResult {
        return instructions::set_protocol_fee_rate::handler(ctx, protocol_fee_rate);
    }

    /// Sets the fee authority for a WhirlpoolConfig.
    /// The fee authority can set the fee & protocol fee rate for individual pools or
    /// set the default fee rate for newly minted pools.
    /// Only the current collect fee authority has permission to invoke this instruction.
    ///
    /// # Authority
    /// - "fee_authority" - Set authority that can modify pool fees in the WhirlpoolConfig
    pub fn set_fee_authority(ctx: Context<SetFeeAuthority>) -> ProgramResult {
        return instructions::set_fee_authority::handler(ctx);
    }

    /// Sets the fee authority to collect protocol fees for a WhirlpoolConfig.
    /// Only the current collect protocol fee authority has permission to invoke this instruction.
    ///
    /// # Authority
    /// - "fee_authority" - Set authority that can collect protocol fees in the WhirlpoolConfig
    pub fn set_collect_protocol_fees_authority(
        ctx: Context<SetCollectProtocolFeesAuthority>,
    ) -> ProgramResult {
        return instructions::set_collect_protocol_fees_authority::handler(ctx);
    }

    /// Set the whirlpool reward authority at the provided `reward_index`.
    /// Only the current reward authority for this reward index has permission to invoke this instruction.
    ///
    /// # Authority
    /// - "reward_authority" - Set authority that can control reward emission for this particular reward.
    pub fn set_reward_authority(
        ctx: Context<SetRewardAuthority>,
        reward_index: u8,
    ) -> ProgramResult {
        return instructions::set_reward_authority::handler(ctx, reward_index);
    }

    /// Set the whirlpool reward authority at the provided `reward_index`.
    /// Only the current reward super authority has permission to invoke this instruction.
    ///
    /// # Authority
    /// - "reward_authority" - Set authority that can control reward emission for this particular reward.
    pub fn set_reward_authority_by_super_authority(
        ctx: Context<SetRewardAuthorityBySuperAuthority>,
        reward_index: u8,
    ) -> ProgramResult {
        return instructions::set_reward_authority_by_super_authority::handler(ctx, reward_index);
    }

    /// Set the whirlpool reward super authority for a WhirlpoolConfig
    /// Only the current reward super authority has permission to invoke this instruction.
    /// This instruction will not change the authority on any `WhirlpoolRewardInfo` whirlpool rewards.
    ///
    /// # Authority
    /// - "reward_emissions_super_authority" - Set authority that can control reward authorities for all pools in this config space.
    pub fn set_reward_emissions_super_authority(
        ctx: Context<SetRewardEmissionsSuperAuthority>,
    ) -> ProgramResult {
        return instructions::set_reward_emissions_super_authority::handler(ctx);
    }
}
