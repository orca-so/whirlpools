use anchor_lang::prelude::*;

declare_id!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

mod entrypoint;

#[doc(hidden)]
pub mod pinocchio;

#[doc(hidden)]
pub mod auth;
#[doc(hidden)]
pub mod constants;
#[doc(hidden)]
pub mod errors;
#[doc(hidden)]
pub mod events;
#[doc(hidden)]
pub mod instructions;
#[doc(hidden)]
pub mod manager;
#[doc(hidden)]
pub mod math;
#[doc(hidden)]
pub mod security;
pub mod state;
#[doc(hidden)]
pub mod tests;
#[doc(hidden)]
pub mod util;

use crate::state::{
    ConfigFeatureFlag, LockType, OpenPositionBumps, OpenPositionWithMetadataBumps,
    TokenBadgeAttribute, WhirlpoolBumps,
};
use crate::util::RemainingAccountsInfo;
use instructions::*;

#[program]
pub mod whirlpool {
    use super::*;

    /// Initializes a WhirlpoolsConfig account that hosts info & authorities
    /// required to govern a set of Whirlpools.
    ///
    /// ### Authority
    /// - "authority" - Set authority that is one of ADMINS.
    ///
    /// ### Parameters
    /// - `fee_authority` - Authority authorized to initialize fee-tiers and set customs fees.
    /// - `collect_protocol_fees_authority` - Authority authorized to collect protocol fees.
    /// - `reward_emissions_super_authority` - Authority authorized to set reward authorities in pools.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        fee_authority: Pubkey,
        collect_protocol_fees_authority: Pubkey,
        reward_emissions_super_authority: Pubkey,
        default_protocol_fee_rate: u16,
    ) -> Result<()> {
        instructions::initialize_config::handler(
            ctx,
            fee_authority,
            collect_protocol_fees_authority,
            reward_emissions_super_authority,
            default_protocol_fee_rate,
        )
    }

    /// Initializes a Whirlpool account.
    /// Fee rate is set to the default values on the config and supplied fee_tier.
    ///
    /// ### Parameters
    /// - `bumps` - The bump value when deriving the PDA of the Whirlpool address.
    /// - `tick_spacing` - The desired tick spacing for this pool.
    /// - `initial_sqrt_price` - The desired initial sqrt-price for this pool
    ///
    /// #### Special Errors
    /// `InvalidTokenMintOrder` - The order of mints have to be ordered by
    /// `SqrtPriceOutOfBounds` - provided initial_sqrt_price is not between 2^-64 to 2^64
    ///
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        bumps: WhirlpoolBumps,
        tick_spacing: u16,
        initial_sqrt_price: u128,
    ) -> Result<()> {
        instructions::initialize_pool::handler(ctx, bumps, tick_spacing, initial_sqrt_price)
    }

    /// Initializes a fixed-length tick_array account to represent a tick-range in a Whirlpool.
    ///
    /// ### Parameters
    /// - `start_tick_index` - The starting tick index for this tick-array.
    ///                        Has to be a multiple of TickArray size & the tick spacing of this pool.
    ///
    /// #### Special Errors
    /// - `InvalidStartTick` - if the provided start tick is out of bounds or is not a multiple of
    ///                        TICK_ARRAY_SIZE * tick spacing.
    pub fn initialize_tick_array(
        ctx: Context<InitializeTickArray>,
        start_tick_index: i32,
    ) -> Result<()> {
        instructions::initialize_tick_array::handler(ctx, start_tick_index)
    }

    /// Initialize a variable-length tick array for a Whirlpool.
    ///
    /// ### Parameters
    /// - `start_tick_index` - The starting tick index for this tick-array.
    ///                        Has to be a multiple of TickArray size & the tick spacing of this pool.
    /// - `idempotent` - If true, the instruction will not fail if the tick array already exists.
    ///                  Note: The idempotent option exits successfully if a FixedTickArray is present as well as a DynamicTickArray.
    ///
    /// #### Special Errors
    /// - `InvalidStartTick` - if the provided start tick is out of bounds or is not a multiple of
    ///                        TICK_ARRAY_SIZE * tick spacing.
    pub fn initialize_dynamic_tick_array(
        ctx: Context<InitializeDynamicTickArray>,
        start_tick_index: i32,
        idempotent: bool,
    ) -> Result<()> {
        instructions::initialize_dynamic_tick_array::handler(ctx, start_tick_index, idempotent)
    }

    /// Initializes a fee_tier account usable by Whirlpools in a WhirlpoolConfig space.
    ///
    /// ### Authority
    /// - "fee_authority" - Set authority in the WhirlpoolConfig
    ///
    /// ### Parameters
    /// - `tick_spacing` - The tick-spacing that this fee-tier suggests the default_fee_rate for.
    /// - `default_fee_rate` - The default fee rate that a pool will use if the pool uses this
    ///                        fee tier during initialization.
    ///
    /// #### Special Errors
    /// - `InvalidTickSpacing` - If the provided tick_spacing is 0.
    /// - `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE.
    pub fn initialize_fee_tier(
        ctx: Context<InitializeFeeTier>,
        tick_spacing: u16,
        default_fee_rate: u16,
    ) -> Result<()> {
        instructions::initialize_fee_tier::handler(ctx, tick_spacing, default_fee_rate)
    }

    /// Initialize reward for a Whirlpool. A pool can only support up to a set number of rewards.
    ///
    /// ### Authority
    /// - "reward_authority" - assigned authority by the reward_super_authority for the specified
    ///                        reward-index in this Whirlpool
    ///
    /// ### Parameters
    /// - `reward_index` - The reward index that we'd like to initialize. (0 <= index <= NUM_REWARDS)
    ///
    /// #### Special Errors
    /// - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized
    ///                          index in this pool, or exceeds NUM_REWARDS, or
    ///                          all reward slots for this pool has been initialized.
    pub fn initialize_reward(ctx: Context<InitializeReward>, reward_index: u8) -> Result<()> {
        instructions::initialize_reward::handler(ctx, reward_index)
    }

    /// Set the reward emissions for a reward in a Whirlpool.
    ///
    /// ### Authority
    /// - "reward_authority" - assigned authority by the reward_super_authority for the specified
    ///                        reward-index in this Whirlpool
    ///
    /// ### Parameters
    /// - `reward_index` - The reward index (0 <= index <= NUM_REWARDS) that we'd like to modify.
    /// - `emissions_per_second_x64` - The amount of rewards emitted in this pool.
    ///
    /// #### Special Errors
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
    ) -> Result<()> {
        instructions::set_reward_emissions::handler(ctx, reward_index, emissions_per_second_x64)
    }

    /// Open a position in a Whirlpool. A unique token will be minted to represent the position
    /// in the users wallet. The position will start off with 0 liquidity.
    ///
    /// ### Parameters
    /// - `tick_lower_index` - The tick specifying the lower end of the position range.
    /// - `tick_upper_index` - The tick specifying the upper end of the position range.
    ///
    /// #### Special Errors
    /// - `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of
    ///                        the tick-spacing in this pool.
    pub fn open_position(
        ctx: Context<OpenPosition>,
        bumps: OpenPositionBumps,
        tick_lower_index: i32,
        tick_upper_index: i32,
    ) -> Result<()> {
        instructions::open_position::handler(ctx, bumps, tick_lower_index, tick_upper_index)
    }

    /// Open a position in a Whirlpool. A unique token will be minted to represent the position
    /// in the users wallet. Additional Metaplex metadata is appended to identify the token.
    /// The position will start off with 0 liquidity.
    ///
    /// ### Parameters
    /// - `tick_lower_index` - The tick specifying the lower end of the position range.
    /// - `tick_upper_index` - The tick specifying the upper end of the position range.
    ///
    /// #### Special Errors
    /// - `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of
    ///                        the tick-spacing in this pool.
    pub fn open_position_with_metadata(
        ctx: Context<OpenPositionWithMetadata>,
        bumps: OpenPositionWithMetadataBumps,
        tick_lower_index: i32,
        tick_upper_index: i32,
    ) -> Result<()> {
        instructions::open_position_with_metadata::handler(
            ctx,
            bumps,
            tick_lower_index,
            tick_upper_index,
        )
    }

    /// Add liquidity to a position in the Whirlpool. This call also updates the position's accrued fees and rewards.
    ///
    /// ### Authority
    /// - `position_authority` - authority that owns the token corresponding to this desired position.
    ///
    /// ### Parameters
    /// - `liquidity_amount` - The total amount of Liquidity the user is willing to deposit.
    /// - `token_max_a` - The maximum amount of tokenA the user is willing to deposit.
    /// - `token_max_b` - The maximum amount of tokenB the user is willing to deposit.
    ///
    /// #### Special Errors
    /// - `LiquidityZero` - Provided liquidity amount is zero.
    /// - `LiquidityTooHigh` - Provided liquidity exceeds u128::max.
    /// - `TokenMaxExceeded` - The required token to perform this operation exceeds the user defined amount.
    #[allow(unused_variables)]
    pub fn increase_liquidity(
        ctx: Context<ModifyLiquidity>,
        liquidity_amount: u128,
        token_max_a: u64,
        token_max_b: u64,
    ) -> Result<()> {
        unreachable!(); // Pinocchio
    }

    /// Withdraw liquidity from a position in the Whirlpool. This call also updates the position's accrued fees and rewards.
    ///
    /// ### Authority
    /// - `position_authority` - authority that owns the token corresponding to this desired position.
    ///
    /// ### Parameters
    /// - `liquidity_amount` - The total amount of Liquidity the user desires to withdraw.
    /// - `token_min_a` - The minimum amount of tokenA the user is willing to withdraw.
    /// - `token_min_b` - The minimum amount of tokenB the user is willing to withdraw.
    ///
    /// #### Special Errors
    /// - `LiquidityZero` - Provided liquidity amount is zero.
    /// - `LiquidityTooHigh` - Provided liquidity exceeds u128::max.
    /// - `TokenMinSubceeded` - The required token to perform this operation subceeds the user defined amount.
    #[allow(unused_variables)]
    pub fn decrease_liquidity(
        ctx: Context<ModifyLiquidity>,
        liquidity_amount: u128,
        token_min_a: u64,
        token_min_b: u64,
    ) -> Result<()> {
        unreachable!(); // Pinocchio
    }

    /// Update the accrued fees and rewards for a position.
    ///
    /// #### Special Errors
    /// - `TickNotFound` - Provided tick array account does not contain the tick for this position.
    /// - `LiquidityZero` - Position has zero liquidity and therefore already has the most updated fees and reward values.
    pub fn update_fees_and_rewards(ctx: Context<UpdateFeesAndRewards>) -> Result<()> {
        instructions::update_fees_and_rewards::handler(ctx)
    }

    /// Collect fees accrued for this position.
    ///
    /// ### Authority
    /// - `position_authority` - authority that owns the token corresponding to this desired position.
    pub fn collect_fees(ctx: Context<CollectFees>) -> Result<()> {
        instructions::collect_fees::handler(ctx)
    }

    /// Collect rewards accrued for this position.
    ///
    /// ### Authority
    /// - `position_authority` - authority that owns the token corresponding to this desired position.
    pub fn collect_reward(ctx: Context<CollectReward>, reward_index: u8) -> Result<()> {
        instructions::collect_reward::handler(ctx, reward_index)
    }

    /// Collect the protocol fees accrued in this Whirlpool
    ///
    /// ### Authority
    /// - `collect_protocol_fees_authority` - assigned authority in the WhirlpoolConfig that can collect protocol fees
    pub fn collect_protocol_fees(ctx: Context<CollectProtocolFees>) -> Result<()> {
        instructions::collect_protocol_fees::handler(ctx)
    }

    /// Perform a swap in this Whirlpool
    ///
    /// ### Authority
    /// - "token_authority" - The authority to withdraw tokens from the input token account.
    ///
    /// ### Parameters
    /// - `amount` - The amount of input or output token to swap from (depending on amount_specified_is_input).
    /// - `other_amount_threshold` - The maximum/minimum of input/output token to swap into (depending on amount_specified_is_input).
    /// - `sqrt_price_limit` - The maximum/minimum price the swap will swap to.
    /// - `amount_specified_is_input` - Specifies the token the parameter `amount`represents. If true, the amount represents the input token of the swap.
    /// - `a_to_b` - The direction of the swap. True if swapping from A to B. False if swapping from B to A.
    ///
    /// #### Special Errors
    /// - `ZeroTradableAmount` - User provided parameter `amount` is 0.
    /// - `InvalidSqrtPriceLimitDirection` - User provided parameter `sqrt_price_limit` does not match the direction of the trade.
    /// - `SqrtPriceOutOfBounds` - User provided parameter `sqrt_price_limit` is over Whirlppool's max/min bounds for sqrt-price.
    /// - `InvalidTickArraySequence` - User provided tick-arrays are not in sequential order required to proceed in this trade direction.
    /// - `TickArraySequenceInvalidIndex` - The swap loop attempted to access an invalid array index during the query of the next initialized tick.
    /// - `TickArrayIndexOutofBounds` - The swap loop attempted to access an invalid array index during tick crossing.
    /// - `LiquidityOverflow` - Liquidity value overflowed 128bits during tick crossing.
    /// - `InvalidTickSpacing` - The swap pool was initialized with tick-spacing of 0.
    pub fn swap(
        ctx: Context<Swap>,
        amount: u64,
        other_amount_threshold: u64,
        sqrt_price_limit: u128,
        amount_specified_is_input: bool,
        a_to_b: bool,
    ) -> Result<()> {
        instructions::swap::handler(
            ctx,
            amount,
            other_amount_threshold,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
        )
    }

    /// Close a position in a Whirlpool. Burns the position token in the owner's wallet.
    ///
    /// ### Authority
    /// - "position_authority" - The authority that owns the position token.
    ///
    /// #### Special Errors
    /// - `ClosePositionNotEmpty` - The provided position account is not empty.
    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        instructions::close_position::handler(ctx)
    }

    /// Set the default_fee_rate for a FeeTier
    /// Only the current fee authority has permission to invoke this instruction.
    ///
    /// ### Authority
    /// - "fee_authority" - Set authority in the WhirlpoolConfig
    ///
    /// ### Parameters
    /// - `default_fee_rate` - The default fee rate that a pool will use if the pool uses this
    ///                        fee tier during initialization.
    ///
    /// #### Special Errors
    /// - `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE.
    pub fn set_default_fee_rate(
        ctx: Context<SetDefaultFeeRate>,
        default_fee_rate: u16,
    ) -> Result<()> {
        instructions::set_default_fee_rate::handler(ctx, default_fee_rate)
    }

    /// Sets the default protocol fee rate for a WhirlpoolConfig
    /// Protocol fee rate is represented as a basis point.
    /// Only the current fee authority has permission to invoke this instruction.
    ///
    /// ### Authority
    /// - "fee_authority" - Set authority that can modify pool fees in the WhirlpoolConfig
    ///
    /// ### Parameters
    /// - `default_protocol_fee_rate` - Rate that is referenced during the initialization of a Whirlpool using this config.
    ///
    /// #### Special Errors
    /// - `ProtocolFeeRateMaxExceeded` - If the provided default_protocol_fee_rate exceeds MAX_PROTOCOL_FEE_RATE.
    pub fn set_default_protocol_fee_rate(
        ctx: Context<SetDefaultProtocolFeeRate>,
        default_protocol_fee_rate: u16,
    ) -> Result<()> {
        instructions::set_default_protocol_fee_rate::handler(ctx, default_protocol_fee_rate)
    }

    /// Sets the fee rate for a Whirlpool.
    /// Fee rate is represented as hundredths of a basis point.
    /// Only the current fee authority has permission to invoke this instruction.
    ///
    /// ### Authority
    /// - "fee_authority" - Set authority that can modify pool fees in the WhirlpoolConfig
    ///
    /// ### Parameters
    /// - `fee_rate` - The rate that the pool will use to calculate fees going onwards.
    ///
    /// #### Special Errors
    /// - `FeeRateMaxExceeded` - If the provided fee_rate exceeds MAX_FEE_RATE.
    pub fn set_fee_rate(ctx: Context<SetFeeRate>, fee_rate: u16) -> Result<()> {
        instructions::set_fee_rate::handler(ctx, fee_rate)
    }

    /// Sets the protocol fee rate for a Whirlpool.
    /// Protocol fee rate is represented as a basis point.
    /// Only the current fee authority has permission to invoke this instruction.
    ///
    /// ### Authority
    /// - "fee_authority" - Set authority that can modify pool fees in the WhirlpoolConfig
    ///
    /// ### Parameters
    /// - `protocol_fee_rate` - The rate that the pool will use to calculate protocol fees going onwards.
    ///
    /// #### Special Errors
    /// - `ProtocolFeeRateMaxExceeded` - If the provided default_protocol_fee_rate exceeds MAX_PROTOCOL_FEE_RATE.
    pub fn set_protocol_fee_rate(
        ctx: Context<SetProtocolFeeRate>,
        protocol_fee_rate: u16,
    ) -> Result<()> {
        instructions::set_protocol_fee_rate::handler(ctx, protocol_fee_rate)
    }

    /// Sets the fee authority for a WhirlpoolConfig.
    /// The fee authority can set the fee & protocol fee rate for individual pools or
    /// set the default fee rate for newly minted pools.
    /// Only the current fee authority has permission to invoke this instruction.
    ///
    /// ### Authority
    /// - "fee_authority" - Set authority that can modify pool fees in the WhirlpoolConfig
    pub fn set_fee_authority(ctx: Context<SetFeeAuthority>) -> Result<()> {
        instructions::set_fee_authority::handler(ctx)
    }

    /// Sets the fee authority to collect protocol fees for a WhirlpoolConfig.
    /// Only the current collect protocol fee authority has permission to invoke this instruction.
    ///
    /// ### Authority
    /// - "fee_authority" - Set authority that can collect protocol fees in the WhirlpoolConfig
    pub fn set_collect_protocol_fees_authority(
        ctx: Context<SetCollectProtocolFeesAuthority>,
    ) -> Result<()> {
        instructions::set_collect_protocol_fees_authority::handler(ctx)
    }

    /// Set the whirlpool reward authority at the provided `reward_index`.
    /// Only the current reward authority for this reward index has permission to invoke this instruction.
    ///
    /// ### Authority
    /// - "reward_authority" - Set authority that can control reward emission for this particular reward.
    ///
    /// #### Special Errors
    /// - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized
    ///                          index in this pool, or exceeds NUM_REWARDS, or
    ///                          all reward slots for this pool has been initialized.
    pub fn set_reward_authority(ctx: Context<SetRewardAuthority>, reward_index: u8) -> Result<()> {
        instructions::set_reward_authority::handler(ctx, reward_index)
    }

    /// Set the whirlpool reward authority at the provided `reward_index`.
    /// Only the current reward super authority has permission to invoke this instruction.
    ///
    /// ### Authority
    /// - "reward_authority" - Set authority that can control reward emission for this particular reward.
    ///
    /// #### Special Errors
    /// - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized
    ///                          index in this pool, or exceeds NUM_REWARDS, or
    ///                          all reward slots for this pool has been initialized.
    pub fn set_reward_authority_by_super_authority(
        ctx: Context<SetRewardAuthorityBySuperAuthority>,
        reward_index: u8,
    ) -> Result<()> {
        instructions::set_reward_authority_by_super_authority::handler(ctx, reward_index)
    }

    /// Set the whirlpool reward super authority for a WhirlpoolConfig
    /// Only the current reward super authority has permission to invoke this instruction.
    /// This instruction will not change the authority on any `WhirlpoolRewardInfo` whirlpool rewards.
    ///
    /// ### Authority
    /// - "reward_emissions_super_authority" - Set authority that can control reward authorities for all pools in this config space.
    pub fn set_reward_emissions_super_authority(
        ctx: Context<SetRewardEmissionsSuperAuthority>,
    ) -> Result<()> {
        instructions::set_reward_emissions_super_authority::handler(ctx)
    }

    /// Perform a two-hop swap in this Whirlpool
    ///
    /// ### Authority
    /// - "token_authority" - The authority to withdraw tokens from the input token account.
    ///
    /// ### Parameters
    /// - `amount` - The amount of input or output token to swap from (depending on amount_specified_is_input).
    /// - `other_amount_threshold` - The maximum/minimum of input/output token to swap into (depending on amount_specified_is_input).
    /// - `amount_specified_is_input` - Specifies the token the parameter `amount`represents. If true, the amount represents the input token of the swap.
    /// - `a_to_b_one` - The direction of the swap of hop one. True if swapping from A to B. False if swapping from B to A.
    /// - `a_to_b_two` - The direction of the swap of hop two. True if swapping from A to B. False if swapping from B to A.
    /// - `sqrt_price_limit_one` - The maximum/minimum price the swap will swap to in the first hop.
    /// - `sqrt_price_limit_two` - The maximum/minimum price the swap will swap to in the second hop.
    ///
    /// #### Special Errors
    /// - `ZeroTradableAmount` - User provided parameter `amount` is 0.
    /// - `InvalidSqrtPriceLimitDirection` - User provided parameter `sqrt_price_limit` does not match the direction of the trade.
    /// - `SqrtPriceOutOfBounds` - User provided parameter `sqrt_price_limit` is over Whirlppool's max/min bounds for sqrt-price.
    /// - `InvalidTickArraySequence` - User provided tick-arrays are not in sequential order required to proceed in this trade direction.
    /// - `TickArraySequenceInvalidIndex` - The swap loop attempted to access an invalid array index during the query of the next initialized tick.
    /// - `TickArrayIndexOutofBounds` - The swap loop attempted to access an invalid array index during tick crossing.
    /// - `LiquidityOverflow` - Liquidity value overflowed 128bits during tick crossing.
    /// - `InvalidTickSpacing` - The swap pool was initialized with tick-spacing of 0.
    /// - `InvalidIntermediaryMint` - Error if the intermediary mint between hop one and two do not equal.
    /// - `DuplicateTwoHopPool` - Error if whirlpool one & two are the same pool.
    #[allow(clippy::too_many_arguments)]
    pub fn two_hop_swap(
        ctx: Context<TwoHopSwap>,
        amount: u64,
        other_amount_threshold: u64,
        amount_specified_is_input: bool,
        a_to_b_one: bool,
        a_to_b_two: bool,
        sqrt_price_limit_one: u128,
        sqrt_price_limit_two: u128,
    ) -> Result<()> {
        instructions::two_hop_swap::handler(
            ctx,
            amount,
            other_amount_threshold,
            amount_specified_is_input,
            a_to_b_one,
            a_to_b_two,
            sqrt_price_limit_one,
            sqrt_price_limit_two,
        )
    }

    /// Initializes a PositionBundle account that bundles several positions.
    /// A unique token will be minted to represent the position bundle in the users wallet.
    pub fn initialize_position_bundle(ctx: Context<InitializePositionBundle>) -> Result<()> {
        instructions::initialize_position_bundle::handler(ctx)
    }

    /// Initializes a PositionBundle account that bundles several positions.
    /// A unique token will be minted to represent the position bundle in the users wallet.
    /// Additional Metaplex metadata is appended to identify the token.
    pub fn initialize_position_bundle_with_metadata(
        ctx: Context<InitializePositionBundleWithMetadata>,
    ) -> Result<()> {
        instructions::initialize_position_bundle_with_metadata::handler(ctx)
    }

    /// Delete a PositionBundle account. Burns the position bundle token in the owner's wallet.
    ///
    /// ### Authority
    /// - `position_bundle_owner` - The owner that owns the position bundle token.
    ///
    /// ### Special Errors
    /// - `PositionBundleNotDeletable` - The provided position bundle has open positions.
    pub fn delete_position_bundle(ctx: Context<DeletePositionBundle>) -> Result<()> {
        instructions::delete_position_bundle::handler(ctx)
    }

    /// Open a bundled position in a Whirlpool. No new tokens are issued
    /// because the owner of the position bundle becomes the owner of the position.
    /// The position will start off with 0 liquidity.
    ///
    /// ### Authority
    /// - `position_bundle_authority` - authority that owns the token corresponding to this desired position bundle.
    ///
    /// ### Parameters
    /// - `bundle_index` - The bundle index that we'd like to open.
    /// - `tick_lower_index` - The tick specifying the lower end of the position range.
    /// - `tick_upper_index` - The tick specifying the upper end of the position range.
    ///
    /// #### Special Errors
    /// - `InvalidBundleIndex` - If the provided bundle index is out of bounds.
    /// - `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of
    ///                        the tick-spacing in this pool.
    pub fn open_bundled_position(
        ctx: Context<OpenBundledPosition>,
        bundle_index: u16,
        tick_lower_index: i32,
        tick_upper_index: i32,
    ) -> Result<()> {
        instructions::open_bundled_position::handler(
            ctx,
            bundle_index,
            tick_lower_index,
            tick_upper_index,
        )
    }

    /// Close a bundled position in a Whirlpool.
    ///
    /// ### Authority
    /// - `position_bundle_authority` - authority that owns the token corresponding to this desired position bundle.
    ///
    /// ### Parameters
    /// - `bundle_index` - The bundle index that we'd like to close.
    ///
    /// #### Special Errors
    /// - `InvalidBundleIndex` - If the provided bundle index is out of bounds.
    /// - `ClosePositionNotEmpty` - The provided position account is not empty.
    pub fn close_bundled_position(
        ctx: Context<CloseBundledPosition>,
        bundle_index: u16,
    ) -> Result<()> {
        instructions::close_bundled_position::handler(ctx, bundle_index)
    }

    /// Open a position in a Whirlpool. A unique token will be minted to represent the position
    /// in the users wallet. Additional TokenMetadata extension is initialized to identify the token.
    /// Mint and TokenAccount are based on Token-2022.
    /// The position will start off with 0 liquidity.
    ///
    /// ### Parameters
    /// - `tick_lower_index` - The tick specifying the lower end of the position range.
    /// - `tick_upper_index` - The tick specifying the upper end of the position range.
    /// - `with_token_metadata_extension` - If true, the token metadata extension will be initialized.
    ///
    /// #### Special Errors
    /// - `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of
    ///                        the tick-spacing in this pool.
    pub fn open_position_with_token_extensions(
        ctx: Context<OpenPositionWithTokenExtensions>,
        tick_lower_index: i32,
        tick_upper_index: i32,
        with_token_metadata_extension: bool,
    ) -> Result<()> {
        instructions::open_position_with_token_extensions::handler(
            ctx,
            tick_lower_index,
            tick_upper_index,
            with_token_metadata_extension,
        )
    }

    /// Close a position in a Whirlpool. Burns the position token in the owner's wallet.
    /// Mint and TokenAccount are based on Token-2022. And Mint accout will be also closed.
    ///
    /// ### Authority
    /// - "position_authority" - The authority that owns the position token.
    ///
    /// #### Special Errors
    /// - `ClosePositionNotEmpty` - The provided position account is not empty.
    pub fn close_position_with_token_extensions(
        ctx: Context<ClosePositionWithTokenExtensions>,
    ) -> Result<()> {
        instructions::close_position_with_token_extensions::handler(ctx)
    }

    /// Lock the position to prevent any liquidity changes.
    ///
    /// ### Authority
    /// - `position_authority` - The authority that owns the position token.
    ///
    /// #### Special Errors
    /// - `PositionAlreadyLocked` - The provided position is already locked.
    /// - `PositionNotLockable` - The provided position is not lockable (e.g. An empty position).
    pub fn lock_position(ctx: Context<LockPosition>, lock_type: LockType) -> Result<()> {
        instructions::lock_position::handler(ctx, lock_type)
    }

    /// Reset the position range to a new range.
    ///
    /// ### Authority
    /// - `position_authority` - The authority that owns the position token.
    ///
    /// ### Parameters
    /// - `new_tick_lower_index` - The new tick specifying the lower end of the position range.
    /// - `new_tick_upper_index` - The new tick specifying the upper end of the position range.
    ///
    /// #### Special Errors
    /// - `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of
    ///                        the tick-spacing in this pool.
    /// - `ClosePositionNotEmpty` - The provided position account is not empty.
    /// - `SameTickRangeNotAllowed` - The provided tick range is the same as the current tick range.
    pub fn reset_position_range(
        ctx: Context<ResetPositionRange>,
        new_tick_lower_index: i32,
        new_tick_upper_index: i32,
    ) -> Result<()> {
        instructions::reset_position_range::handler(ctx, new_tick_lower_index, new_tick_upper_index)
    }

    /// Transfer a locked position to a different token account.
    ///
    /// ### Authority
    /// - `position_authority` - The authority that owns the position token.
    pub fn transfer_locked_position(ctx: Context<TransferLockedPosition>) -> Result<()> {
        instructions::transfer_locked_position::handler(ctx)
    }

    /// Initializes an adaptive_fee_tier account usable by Whirlpools in a WhirlpoolConfig space.
    ///
    /// ### Authority
    /// - "fee_authority" - Set authority in the WhirlpoolConfig
    ///
    /// ### Parameters
    /// - `fee_tier_index` - The index of the fee-tier that this adaptive fee tier will be initialized.
    /// - `tick_spacing` - The tick-spacing that this fee-tier suggests the default_fee_rate for.
    /// - `initialize_pool_authority` - The authority that can initialize pools with this adaptive fee-tier.
    /// - `delegated_fee_authority` - The authority that can set the base fee rate for pools using this adaptive fee-tier.
    /// - `default_fee_rate` - The default fee rate that a pool will use if the pool uses this
    ///                        fee tier during initialization.
    /// - `filter_period` - Period determine high frequency trading time window. (seconds)
    /// - `decay_period` - Period determine when the adaptive fee start decrease. (seconds)
    /// - `reduction_factor` - Adaptive fee rate decrement rate.
    /// - `adaptive_fee_control_factor` - Adaptive fee control factor.
    /// - `max_volatility_accumulator` - Max volatility accumulator.
    /// - `tick_group_size` - Tick group size to define tick group index.
    /// - `major_swap_threshold_ticks` - Major swap threshold ticks to define major swap.
    ///
    /// #### Special Errors
    /// - `InvalidTickSpacing` - If the provided tick_spacing is 0.
    /// - `InvalidFeeTierIndex` - If the provided fee_tier_index is same to tick_spacing.
    /// - `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE.
    /// - `InvalidAdaptiveFeeConstants` - If the provided adaptive fee constants are invalid.
    #[allow(clippy::too_many_arguments)]
    pub fn initialize_adaptive_fee_tier(
        ctx: Context<InitializeAdaptiveFeeTier>,
        fee_tier_index: u16,
        tick_spacing: u16,
        initialize_pool_authority: Pubkey,
        delegated_fee_authority: Pubkey,
        default_base_fee_rate: u16,
        filter_period: u16,
        decay_period: u16,
        reduction_factor: u16,
        adaptive_fee_control_factor: u32,
        max_volatility_accumulator: u32,
        tick_group_size: u16,
        major_swap_threshold_ticks: u16,
    ) -> Result<()> {
        instructions::initialize_adaptive_fee_tier::handler(
            ctx,
            fee_tier_index,
            tick_spacing,
            initialize_pool_authority,
            delegated_fee_authority,
            default_base_fee_rate,
            filter_period,
            decay_period,
            reduction_factor,
            adaptive_fee_control_factor,
            max_volatility_accumulator,
            tick_group_size,
            major_swap_threshold_ticks,
        )
    }

    /// Set the default_base_fee_rate for an AdaptiveFeeTier
    /// Only the current fee authority in WhirlpoolsConfig has permission to invoke this instruction.
    ///
    /// ### Authority
    /// - "fee_authority" - Set authority in the WhirlpoolConfig
    ///
    /// ### Parameters
    /// - `default_base_fee_rate` - The default base fee rate that a pool will use if the pool uses this
    ///                             adaptive fee-tier during initialization.
    ///
    /// #### Special Errors
    /// - `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE.
    pub fn set_default_base_fee_rate(
        ctx: Context<SetDefaultBaseFeeRate>,
        default_base_fee_rate: u16,
    ) -> Result<()> {
        instructions::set_default_base_fee_rate::handler(ctx, default_base_fee_rate)
    }

    /// Sets the delegated fee authority for an AdaptiveFeeTier.
    /// The delegated fee authority can set the fee rate for individual pools initialized with the adaptive fee-tier.
    /// Only the current fee authority in WhirlpoolsConfig has permission to invoke this instruction.
    ///
    /// ### Authority
    /// - "fee_authority" - Set authority in the WhirlpoolConfig
    pub fn set_delegated_fee_authority(ctx: Context<SetDelegatedFeeAuthority>) -> Result<()> {
        instructions::set_delegated_fee_authority::handler(ctx)
    }

    /// Sets the initialize pool authority for an AdaptiveFeeTier.
    /// Only the initialize pool authority can initialize pools with the adaptive fee-tier.
    /// Only the current fee authority in WhirlpoolsConfig has permission to invoke this instruction.
    ///
    /// ### Authority
    /// - "fee_authority" - Set authority in the WhirlpoolConfig
    pub fn set_initialize_pool_authority(ctx: Context<SetInitializePoolAuthority>) -> Result<()> {
        instructions::set_initialize_pool_authority::handler(ctx)
    }

    /// Sets the adaptive fee constants for an AdaptiveFeeTier.
    /// Only the current fee authority in WhirlpoolsConfig has permission to invoke this instruction.
    ///
    /// ### Authority
    /// - "fee_authority" - Set authority in the WhirlpoolConfig
    ///
    /// ### Parameters
    /// - `filter_period` - Period determine high frequency trading time window. (seconds)
    /// - `decay_period` - Period determine when the adaptive fee start decrease. (seconds)
    /// - `reduction_factor` - Adaptive fee rate decrement rate.
    /// - `adaptive_fee_control_factor` - Adaptive fee control factor.
    /// - `max_volatility_accumulator` - Max volatility accumulator.
    /// - `tick_group_size` - Tick group size to define tick group index.
    /// - `major_swap_threshold_ticks` - Major swap threshold ticks to define major swap.
    #[allow(clippy::too_many_arguments)]
    pub fn set_preset_adaptive_fee_constants(
        ctx: Context<SetPresetAdaptiveFeeConstants>,
        filter_period: u16,
        decay_period: u16,
        reduction_factor: u16,
        adaptive_fee_control_factor: u32,
        max_volatility_accumulator: u32,
        tick_group_size: u16,
        major_swap_threshold_ticks: u16,
    ) -> Result<()> {
        instructions::set_preset_adaptive_fee_constants::handler(
            ctx,
            filter_period,
            decay_period,
            reduction_factor,
            adaptive_fee_control_factor,
            max_volatility_accumulator,
            tick_group_size,
            major_swap_threshold_ticks,
        )
    }

    /// Initializes a Whirlpool account and Oracle account with adaptive fee.
    ///
    /// ### Parameters
    /// - `initial_sqrt_price` - The desired initial sqrt-price for this pool
    /// - `trade_enable_timestamp` - The timestamp when trading is enabled for this pool (within 72 hours)
    ///
    /// #### Special Errors
    /// `InvalidTokenMintOrder` - The order of mints have to be ordered by
    /// `SqrtPriceOutOfBounds` - provided initial_sqrt_price is not between 2^-64 to 2^64
    /// `InvalidTradeEnableTimestamp` - provided trade_enable_timestamp is not within 72 hours or the adaptive fee-tier is permission-less
    /// `UnsupportedTokenMint` - The provided token mint is not supported by the program (e.g. it has risky token extensions)
    ///
    pub fn initialize_pool_with_adaptive_fee(
        ctx: Context<InitializePoolWithAdaptiveFee>,
        initial_sqrt_price: u128,
        trade_enable_timestamp: Option<u64>,
    ) -> Result<()> {
        instructions::initialize_pool_with_adaptive_fee::handler(
            ctx,
            initial_sqrt_price,
            trade_enable_timestamp,
        )
    }

    /// Sets the fee rate for a Whirlpool by the delegated fee authority in AdaptiveFeeTier.
    /// Fee rate is represented as hundredths of a basis point.
    ///
    /// ### Authority
    /// - "delegated_fee_authority" - Set authority that can modify pool fees in the AdaptiveFeeTier
    ///
    /// ### Parameters
    /// - `fee_rate` - The rate that the pool will use to calculate fees going onwards.
    ///
    /// #### Special Errors
    /// - `FeeRateMaxExceeded` - If the provided fee_rate exceeds MAX_FEE_RATE.
    pub fn set_fee_rate_by_delegated_fee_authority(
        ctx: Context<SetFeeRateByDelegatedFeeAuthority>,
        fee_rate: u16,
    ) -> Result<()> {
        instructions::set_fee_rate_by_delegated_fee_authority::handler(ctx, fee_rate)
    }

    /// Sets specific adaptive fee constants for a pool. Only the provided constants will be updated,
    /// others remain unchanged. Caller should avoid invoking this instruction when a pool's adaptive
    /// fee is high to prevent LP revenue loss
    ///
    /// ### Authority
    /// - `fee_authority` - Set authority in the WhirlpoolsConfig
    ///
    /// ### Parameters
    /// All parameters are optional. Only provided values will be updated.
    /// - `filter_period` - Period determine high frequency trading time window. (seconds)
    /// - `decay_period` - Period determine when the adaptive fee start decrease. (seconds)
    /// - `reduction_factor` - Adaptive fee rate decrement rate.
    /// - `adaptive_fee_control_factor` - Adaptive fee control factor.
    /// - `max_volatility_accumulator` - Max volatility accumulator.
    /// - `tick_group_size` - Tick group size to define tick group index.
    /// - `major_swap_threshold_ticks` - Major swap threshold ticks to define major swap.
    ///
    /// #### Special Errors
    /// - `InvalidAdaptiveFeeConstants` - If the resulting constants are invalid for the pool's tick_spacing.
    /// - `AdaptiveFeeConstantsUnchanged` - If the provided adaptive fee constants are unchanged from the existing constants.
    #[allow(clippy::too_many_arguments)]
    pub fn set_adaptive_fee_constants(
        ctx: Context<SetAdaptiveFeeConstants>,
        filter_period: Option<u16>,
        decay_period: Option<u16>,
        reduction_factor: Option<u16>,
        adaptive_fee_control_factor: Option<u32>,
        max_volatility_accumulator: Option<u32>,
        tick_group_size: Option<u16>,
        major_swap_threshold_ticks: Option<u16>,
    ) -> Result<()> {
        instructions::adaptive_fee::set_adaptive_fee_constants::handler(
            ctx,
            filter_period,
            decay_period,
            reduction_factor,
            adaptive_fee_control_factor,
            max_volatility_accumulator,
            tick_group_size,
            major_swap_threshold_ticks,
        )
    }

    /// Sets the feature flag for a WhirlpoolConfig.
    ///
    /// ### Authority
    /// - "authority" - Set authority that is one of ADMINS.
    ///
    /// ### Parameters
    /// - `feature_flag` - The feature flag that the WhirlpoolConfig will use.
    pub fn set_config_feature_flag(
        ctx: Context<SetConfigFeatureFlag>,
        feature_flag: ConfigFeatureFlag,
    ) -> Result<()> {
        instructions::set_config_feature_flag::handler(ctx, feature_flag)
    }

    /// Migration instruction to repurpose the reward authority space in the Whirlpool.
    /// TODO: This instruction should be removed once all pools have been migrated.
    pub fn migrate_repurpose_reward_authority_space(
        ctx: Context<MigrateRepurposeRewardAuthoritySpace>,
    ) -> Result<()> {
        instructions::migrate_repurpose_reward_authority_space::handler(ctx)
    }

    /// RepositionLiquidityV2 liquidity creates an atomic operation that:
    /// - Withdraws liquidity from the current position range
    /// - Resets the position to a new tick range
    /// - Adds liquidity to the new position range
    /// - Restores fees and rewards
    ///
    /// This instruction works with both Token and Token-2022.
    ///
    /// ### Authority
    /// - `position_authority` - authority that owns the token corresponding to this desired position.
    ///
    /// ### Parameters
    /// - `new_tick_lower_index` - The new tick index for the lower end of the position range.
    /// - `new_tick_upper_index` - The new tick index for the upper end of the position range.
    /// - `new_liquidity_amount` - The total amount of Liquidity the user is willing to deposit.
    /// - `token_min_a` - The minimum amount of tokenA the user is willing to withdraw.
    /// - `token_min_b` - The minimum amount of tokenB the user is willing to withdraw.
    /// - `token_max_a` - The maximum amount of tokenA the user is willing to deposit.
    /// - `token_max_b` - The maximum amount of tokenB the user is willing to deposit.
    ///
    /// #### Special Errors
    /// - `LiquidityZero` - Provided liquidity amount is zero.
    /// - `LiquidityTooHigh` - Provided liquidity exceeds u128::max.
    /// - `TokenMaxExceeded` - The required token to perform this operation exceeds the user defined amount.
    /// - `TokenMinSubceeded` - The required token to perform this operation subceeds the user defined amount.
    /// - `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of
    ///                        the tick-spacing in this pool.
    /// - `SameTickRangeNotAllowed` - The provided tick range is the same as the current tick range.
    pub fn reposition_liquidity_v2<'info>(
        ctx: Context<'_, '_, '_, 'info, RepositionLiquidityV2<'info>>,
        new_tick_lower_index: i32,
        new_tick_upper_index: i32,
        new_liquidity_amount: u128,
        token_min_a: u64,
        token_min_b: u64,
        token_max_a: u64,
        token_max_b: u64,
        remaining_accounts_info: Option<RemainingAccountsInfo>,
    ) -> Result<()> {
        // pinocchio implementation should be used
        unreachable!()
    }

    ////////////////////////////////////////////////////////////////////////////////
    // V2 instructions (TokenExtensions)
    ////////////////////////////////////////////////////////////////////////////////

    /// Collect fees accrued for this position.
    /// This instruction works with both Token and Token-2022.
    ///
    /// ### Authority
    /// - `position_authority` - authority that owns the token corresponding to this desired position.
    pub fn collect_fees_v2<'info>(
        ctx: Context<'_, '_, '_, 'info, CollectFeesV2<'info>>,
        remaining_accounts_info: Option<RemainingAccountsInfo>,
    ) -> Result<()> {
        instructions::v2::collect_fees::handler(ctx, remaining_accounts_info)
    }

    /// Collect the protocol fees accrued in this Whirlpool
    /// This instruction works with both Token and Token-2022.
    ///
    /// ### Authority
    /// - `collect_protocol_fees_authority` - assigned authority in the WhirlpoolConfig that can collect protocol fees
    pub fn collect_protocol_fees_v2<'info>(
        ctx: Context<'_, '_, '_, 'info, CollectProtocolFeesV2<'info>>,
        remaining_accounts_info: Option<RemainingAccountsInfo>,
    ) -> Result<()> {
        instructions::v2::collect_protocol_fees::handler(ctx, remaining_accounts_info)
    }

    /// Collect rewards accrued for this position.
    /// This instruction works with both Token and Token-2022.
    ///
    /// ### Authority
    /// - `position_authority` - authority that owns the token corresponding to this desired position.
    pub fn collect_reward_v2<'info>(
        ctx: Context<'_, '_, '_, 'info, CollectRewardV2<'info>>,
        reward_index: u8,
        remaining_accounts_info: Option<RemainingAccountsInfo>,
    ) -> Result<()> {
        instructions::v2::collect_reward::handler(ctx, reward_index, remaining_accounts_info)
    }

    /// Withdraw liquidity from a position in the Whirlpool. This call also updates the position's accrued fees and rewards.
    /// This instruction works with both Token and Token-2022.
    ///
    /// ### Authority
    /// - `position_authority` - authority that owns the token corresponding to this desired position.
    ///
    /// ### Parameters
    /// - `liquidity_amount` - The total amount of Liquidity the user desires to withdraw.
    /// - `token_min_a` - The minimum amount of tokenA the user is willing to withdraw.
    /// - `token_min_b` - The minimum amount of tokenB the user is willing to withdraw.
    ///
    /// #### Special Errors
    /// - `LiquidityZero` - Provided liquidity amount is zero.
    /// - `LiquidityTooHigh` - Provided liquidity exceeds u128::max.
    /// - `TokenMinSubceeded` - The required token to perform this operation subceeds the user defined amount.
    #[allow(unused_variables)]
    pub fn decrease_liquidity_v2<'info>(
        ctx: Context<'_, '_, '_, 'info, ModifyLiquidityV2<'info>>,
        liquidity_amount: u128,
        token_min_a: u64,
        token_min_b: u64,
        remaining_accounts_info: Option<RemainingAccountsInfo>,
    ) -> Result<()> {
        unreachable!(); // Pinocchio
    }

    /// Add liquidity to a position in the Whirlpool. This call also updates the position's accrued fees and rewards.
    /// This instruction works with both Token and Token-2022.
    ///
    /// ### Authority
    /// - `position_authority` - authority that owns the token corresponding to this desired position.
    ///
    /// ### Parameters
    /// - `liquidity_amount` - The total amount of Liquidity the user is willing to deposit.
    /// - `token_max_a` - The maximum amount of tokenA the user is willing to deposit.
    /// - `token_max_b` - The maximum amount of tokenB the user is willing to deposit.
    ///
    /// #### Special Errors
    /// - `LiquidityZero` - Provided liquidity amount is zero.
    /// - `LiquidityTooHigh` - Provided liquidity exceeds u128::max.
    /// - `TokenMaxExceeded` - The required token to perform this operation exceeds the user defined amount.
    #[allow(unused_variables)]
    pub fn increase_liquidity_v2<'info>(
        ctx: Context<'_, '_, '_, 'info, ModifyLiquidityV2<'info>>,
        liquidity_amount: u128,
        token_max_a: u64,
        token_max_b: u64,
        remaining_accounts_info: Option<RemainingAccountsInfo>,
    ) -> Result<()> {
        unreachable!(); // Pinocchio
    }

    /// Initializes a Whirlpool account.
    /// This instruction works with both Token and Token-2022.
    /// Fee rate is set to the default values on the config and supplied fee_tier.
    ///
    /// ### Parameters
    /// - `bumps` - The bump value when deriving the PDA of the Whirlpool address.
    /// - `tick_spacing` - The desired tick spacing for this pool.
    /// - `initial_sqrt_price` - The desired initial sqrt-price for this pool
    ///
    /// #### Special Errors
    /// `InvalidTokenMintOrder` - The order of mints have to be ordered by
    /// `SqrtPriceOutOfBounds` - provided initial_sqrt_price is not between 2^-64 to 2^64
    ///
    pub fn initialize_pool_v2(
        ctx: Context<InitializePoolV2>,
        tick_spacing: u16,
        initial_sqrt_price: u128,
    ) -> Result<()> {
        instructions::v2::initialize_pool::handler(ctx, tick_spacing, initial_sqrt_price)
    }

    /// Initialize reward for a Whirlpool. A pool can only support up to a set number of rewards.
    /// This instruction works with both Token and Token-2022.
    ///
    /// ### Authority
    /// - "reward_authority" - assigned authority by the reward_super_authority for the specified
    ///                        reward-index in this Whirlpool
    ///
    /// ### Parameters
    /// - `reward_index` - The reward index that we'd like to initialize. (0 <= index <= NUM_REWARDS)
    ///
    /// #### Special Errors
    /// - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized
    ///                          index in this pool, or exceeds NUM_REWARDS, or
    ///                          all reward slots for this pool has been initialized.
    pub fn initialize_reward_v2(ctx: Context<InitializeRewardV2>, reward_index: u8) -> Result<()> {
        instructions::v2::initialize_reward::handler(ctx, reward_index)
    }

    /// Set the reward emissions for a reward in a Whirlpool.
    /// This instruction works with both Token and Token-2022.
    ///
    /// ### Authority
    /// - "reward_authority" - assigned authority by the reward_super_authority for the specified
    ///                        reward-index in this Whirlpool
    ///
    /// ### Parameters
    /// - `reward_index` - The reward index (0 <= index <= NUM_REWARDS) that we'd like to modify.
    /// - `emissions_per_second_x64` - The amount of rewards emitted in this pool.
    ///
    /// #### Special Errors
    /// - `RewardVaultAmountInsufficient` - The amount of rewards in the reward vault cannot emit
    ///                                     more than a day of desired emissions.
    /// - `InvalidTimestamp` - Provided timestamp is not in order with the previous timestamp.
    /// - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized
    ///                          index in this pool, or exceeds NUM_REWARDS, or
    ///                          all reward slots for this pool has been initialized.
    pub fn set_reward_emissions_v2(
        ctx: Context<SetRewardEmissionsV2>,
        reward_index: u8,
        emissions_per_second_x64: u128,
    ) -> Result<()> {
        instructions::v2::set_reward_emissions::handler(ctx, reward_index, emissions_per_second_x64)
    }

    /// Perform a swap in this Whirlpool
    /// This instruction works with both Token and Token-2022.
    ///
    /// ### Authority
    /// - "token_authority" - The authority to withdraw tokens from the input token account.
    ///
    /// ### Parameters
    /// - `amount` - The amount of input or output token to swap from (depending on amount_specified_is_input).
    /// - `other_amount_threshold` - The maximum/minimum of input/output token to swap into (depending on amount_specified_is_input).
    /// - `sqrt_price_limit` - The maximum/minimum price the swap will swap to.
    /// - `amount_specified_is_input` - Specifies the token the parameter `amount`represents. If true, the amount represents the input token of the swap.
    /// - `a_to_b` - The direction of the swap. True if swapping from A to B. False if swapping from B to A.
    ///
    /// #### Special Errors
    /// - `ZeroTradableAmount` - User provided parameter `amount` is 0.
    /// - `InvalidSqrtPriceLimitDirection` - User provided parameter `sqrt_price_limit` does not match the direction of the trade.
    /// - `SqrtPriceOutOfBounds` - User provided parameter `sqrt_price_limit` is over Whirlppool's max/min bounds for sqrt-price.
    /// - `InvalidTickArraySequence` - User provided tick-arrays are not in sequential order required to proceed in this trade direction.
    /// - `TickArraySequenceInvalidIndex` - The swap loop attempted to access an invalid array index during the query of the next initialized tick.
    /// - `TickArrayIndexOutofBounds` - The swap loop attempted to access an invalid array index during tick crossing.
    /// - `LiquidityOverflow` - Liquidity value overflowed 128bits during tick crossing.
    /// - `InvalidTickSpacing` - The swap pool was initialized with tick-spacing of 0.
    pub fn swap_v2<'info>(
        ctx: Context<'_, '_, '_, 'info, SwapV2<'info>>,
        amount: u64,
        other_amount_threshold: u64,
        sqrt_price_limit: u128,
        amount_specified_is_input: bool,
        a_to_b: bool,
        remaining_accounts_info: Option<RemainingAccountsInfo>,
    ) -> Result<()> {
        instructions::v2::swap::handler(
            ctx,
            amount,
            other_amount_threshold,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            remaining_accounts_info,
        )
    }

    /// Perform a two-hop swap in this Whirlpool
    /// This instruction works with both Token and Token-2022.
    ///
    /// ### Authority
    /// - "token_authority" - The authority to withdraw tokens from the input token account.
    ///
    /// ### Parameters
    /// - `amount` - The amount of input or output token to swap from (depending on amount_specified_is_input).
    /// - `other_amount_threshold` - The maximum/minimum of input/output token to swap into (depending on amount_specified_is_input).
    /// - `amount_specified_is_input` - Specifies the token the parameter `amount`represents. If true, the amount represents the input token of the swap.
    /// - `a_to_b_one` - The direction of the swap of hop one. True if swapping from A to B. False if swapping from B to A.
    /// - `a_to_b_two` - The direction of the swap of hop two. True if swapping from A to B. False if swapping from B to A.
    /// - `sqrt_price_limit_one` - The maximum/minimum price the swap will swap to in the first hop.
    /// - `sqrt_price_limit_two` - The maximum/minimum price the swap will swap to in the second hop.
    ///
    /// #### Special Errors
    /// - `ZeroTradableAmount` - User provided parameter `amount` is 0.
    /// - `InvalidSqrtPriceLimitDirection` - User provided parameter `sqrt_price_limit` does not match the direction of the trade.
    /// - `SqrtPriceOutOfBounds` - User provided parameter `sqrt_price_limit` is over Whirlppool's max/min bounds for sqrt-price.
    /// - `InvalidTickArraySequence` - User provided tick-arrays are not in sequential order required to proceed in this trade direction.
    /// - `TickArraySequenceInvalidIndex` - The swap loop attempted to access an invalid array index during the query of the next initialized tick.
    /// - `TickArrayIndexOutofBounds` - The swap loop attempted to access an invalid array index during tick crossing.
    /// - `LiquidityOverflow` - Liquidity value overflowed 128bits during tick crossing.
    /// - `InvalidTickSpacing` - The swap pool was initialized with tick-spacing of 0.
    /// - `InvalidIntermediaryMint` - Error if the intermediary mint between hop one and two do not equal.
    /// - `DuplicateTwoHopPool` - Error if whirlpool one & two are the same pool.
    #[allow(clippy::too_many_arguments)]
    pub fn two_hop_swap_v2<'info>(
        ctx: Context<'_, '_, '_, 'info, TwoHopSwapV2<'info>>,
        amount: u64,
        other_amount_threshold: u64,
        amount_specified_is_input: bool,
        a_to_b_one: bool,
        a_to_b_two: bool,
        sqrt_price_limit_one: u128,
        sqrt_price_limit_two: u128,
        remaining_accounts_info: Option<RemainingAccountsInfo>,
    ) -> Result<()> {
        instructions::v2::two_hop_swap::handler(
            ctx,
            amount,
            other_amount_threshold,
            amount_specified_is_input,
            a_to_b_one,
            a_to_b_two,
            sqrt_price_limit_one,
            sqrt_price_limit_two,
            remaining_accounts_info,
        )
    }

    /// Initializes a WhirlpoolConfigExtension account that hosts info & authorities.
    ///
    /// ### Authority
    /// - "fee_authority" - Set authority in the WhirlpoolConfig
    pub fn initialize_config_extension(ctx: Context<InitializeConfigExtension>) -> Result<()> {
        instructions::v2::initialize_config_extension::handler(ctx)
    }

    /// Sets the config extension authority for a WhirlpoolsConfigExtension.
    /// Only the current config extension authority has permission to invoke this instruction.
    ///
    /// ### Authority
    /// - "config_extension_authority" - Set authority in the WhirlpoolConfigExtension
    pub fn set_config_extension_authority(ctx: Context<SetConfigExtensionAuthority>) -> Result<()> {
        instructions::v2::set_config_extension_authority::handler(ctx)
    }

    /// Sets the token badge authority for a WhirlpoolsConfigExtension.
    /// Only the config extension authority has permission to invoke this instruction.
    ///
    /// ### Authority
    /// - "config_extension_authority" - Set authority in the WhirlpoolConfigExtension
    pub fn set_token_badge_authority(ctx: Context<SetTokenBadgeAuthority>) -> Result<()> {
        instructions::v2::set_token_badge_authority::handler(ctx)
    }

    /// Initialize a TokenBadge account.
    ///
    /// ### Authority
    /// - "token_badge_authority" - Set authority in the WhirlpoolConfigExtension
    ///
    /// ### Special Errors
    /// - `FeatureIsNotEnabled` - If the feature flag for token badges is not enabled.
    pub fn initialize_token_badge(ctx: Context<InitializeTokenBadge>) -> Result<()> {
        instructions::v2::initialize_token_badge::handler(ctx)
    }

    /// Delete a TokenBadge account.
    ///
    /// ### Authority
    /// - "token_badge_authority" - Set authority in the WhirlpoolConfigExtension
    ///
    /// ### Special Errors
    /// - `FeatureIsNotEnabled` - If the feature flag for token badges is not enabled.
    pub fn delete_token_badge(ctx: Context<DeleteTokenBadge>) -> Result<()> {
        instructions::v2::delete_token_badge::handler(ctx)
    }

    /// Set an attribute on a TokenBadge account.
    ///
    /// ### Authority
    /// - "token_badge_authority" - Set authority in the WhirlpoolConfigExtension
    ///
    /// ### Parameters
    /// - `attribute` - The attribute to set on the TokenBadge account.
    ///
    /// #### Special Errors
    /// - `FeatureIsNotEnabled` - If the feature flag for token badges is not enabled.
    pub fn set_token_badge_attribute(
        ctx: Context<SetTokenBadgeAttribute>,
        attribute: TokenBadgeAttribute,
    ) -> Result<()> {
        instructions::v2::set_token_badge_attribute::handler(ctx, attribute)
    }

    // Only for inclusion in the IDL
    pub fn idl_include(ctx: Context<IdlInclude>) -> Result<()> {
        // So compiler doesn't strip out the ctx
        let _ = ctx.program_id;
        Err(ProgramError::InvalidInstructionData.into())
    }
}
