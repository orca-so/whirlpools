import { PDA } from "@orca-so/common-sdk";
import { WhirlpoolContext } from "./context";
import * as ix from "./instructions";

/**
 * Instruction set for the Whirlpools program.
 *
 * @category Core
 */
export class WhirlpoolIx {
  /**
   * Initializes a WhirlpoolsConfig account that hosts info & authorities
   * required to govern a set of Whirlpools.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - InitConfigParams object
   * @returns - Instruction to perform the action.
   */
  public static initializeConfigIx(context: WhirlpoolContext, params: ix.InitConfigParams) {
    return ix.initializeConfigIx(context, params);
  }

  /**
   * Initializes a fee tier account usable by Whirlpools in this WhirlpoolsConfig space.
   *
   *  Special Errors
   * `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - InitFeeTierParams object
   * @returns - Instruction to perform the action.
   */
  public static initializeFeeTierIx(context: WhirlpoolContext, params: ix.InitFeeTierParams) {
    return ix.initializeFeeTierIx(context, params);
  }

  /**
   * Initializes a tick_array account to represent a tick-range in a Whirlpool.
   *
   * Special Errors
   * `InvalidTokenMintOrder` - The order of mints have to be ordered by
   * `SqrtPriceOutOfBounds` - provided initial_sqrt_price is not between 2^-64 to 2^64
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - InitPoolParams object
   * @returns - Instruction to perform the action.
   */
  public static initializePoolIx(context: WhirlpoolContext, params: ix.InitPoolParams) {
    return ix.initializePoolIx(context, params);
  }

  /**
   * Initialize reward for a Whirlpool. A pool can only support up to a set number of rewards.
   * The initial emissionsPerSecond is set to 0.
   *
   * #### Special Errors
   * - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized index in this pool,
   *                          or exceeds NUM_REWARDS, or all reward slots for this pool has been initialized.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - InitializeRewardParams object
   * @returns - Instruction to perform the action.
   */
  public static initializeRewardIx(context: WhirlpoolContext, params: ix.InitializeRewardParams) {
    return ix.initializeRewardIx(context, params);
  }

  /**
   * Initializes a TickArray account.
   *
   * #### Special Errors
   *  `InvalidStartTick` - if the provided start tick is out of bounds or is not a multiple of TICK_ARRAY_SIZE * tick spacing.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - InitTickArrayParams object
   * @returns - Instruction to perform the action.
   */
  public static initTickArrayIx(context: WhirlpoolContext, params: ix.InitTickArrayParams) {
    return ix.initTickArrayIx(context, params);
  }

  /**
   * Open a position in a Whirlpool. A unique token will be minted to represent the position in the users wallet.
   * The position will start off with 0 liquidity.
   *
   * #### Special Errors
   * `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of the tick-spacing in this pool.
   *

   * @param context - Context object containing services required to generate the instruction
   * @param params - OpenPositionParams object
   * @returns - Instruction to perform the action.
   */
  public static openPositionIx(context: WhirlpoolContext, params: ix.OpenPositionParams) {
    return ix.openPositionIx(context, params);
  }

  /**
   * Open a position in a Whirlpool. A unique token will be minted to represent the position
   * in the users wallet. Additional Metaplex metadata is appended to identify the token.
   * The position will start off with 0 liquidity.
   *
   * #### Special Errors
   * `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of the tick-spacing in this pool.
   *

   * @param context - Context object containing services required to generate the instruction
   * @param params - OpenPositionParams object and a derived PDA that hosts the position's metadata.
   * @returns - Instruction to perform the action.
   */
  public static openPositionWithMetadataIx(
    context: WhirlpoolContext,
    params: ix.OpenPositionParams & { metadataPda: PDA }
  ) {
    return ix.openPositionWithMetadataIx(context, params);
  }

  /**
   * Add liquidity to a position in the Whirlpool. This call also updates the position's accrued fees and rewards.
   *
   * #### Special Errors
   * `LiquidityZero` - Provided liquidity amount is zero.
   * `LiquidityTooHigh` - Provided liquidity exceeds u128::max.
   * `TokenMaxExceeded` - The required token to perform this operation exceeds the user defined amount.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - IncreaseLiquidityParams object
   * @returns - Instruction to perform the action.
   */
  public static increaseLiquidityIx(context: WhirlpoolContext, params: ix.IncreaseLiquidityParams) {
    return ix.increaseLiquidityIx(context, params);
  }

  /**
   * Remove liquidity to a position in the Whirlpool. This call also updates the position's accrued fees and rewards.
   *
   * #### Special Errors
   * - `LiquidityZero` - Provided liquidity amount is zero.
   * - `LiquidityTooHigh` - Provided liquidity exceeds u128::max.
   * - `TokenMinSubceeded` - The required token to perform this operation subceeds the user defined amount.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - DecreaseLiquidityParams object
   * @returns - Instruction to perform the action.
   */
  public static decreaseLiquidityIx(context: WhirlpoolContext, params: ix.DecreaseLiquidityParams) {
    return ix.decreaseLiquidityIx(context, params);
  }

  /**
   * Close a position in a Whirlpool. Burns the position token in the owner's wallet.
   *

   * @param context - Context object containing services required to generate the instruction
   * @param params - ClosePositionParams object
   * @returns - Instruction to perform the action.
   */
  public static closePositionIx(context: WhirlpoolContext, params: ix.ClosePositionParams) {
    return ix.closePositionIx(context, params);
  }

  /**
   * Perform a swap in this Whirlpool
   *
   * #### Special Errors
   * - `ZeroTradableAmount` - User provided parameter `amount` is 0.
   * - `InvalidSqrtPriceLimitDirection` - User provided parameter `sqrt_price_limit` does not match the direction of the trade.
   * - `SqrtPriceOutOfBounds` - User provided parameter `sqrt_price_limit` is over Whirlppool's max/min bounds for sqrt-price.
   * - `InvalidTickArraySequence` - User provided tick-arrays are not in sequential order required to proceed in this trade direction.
   * - `TickArraySequenceInvalidIndex` - The swap loop attempted to access an invalid array index during the query of the next initialized tick.
   * - `TickArrayIndexOutofBounds` - The swap loop attempted to access an invalid array index during tick crossing.
   * - `LiquidityOverflow` - Liquidity value overflowed 128bits during tick crossing.
   * - `InvalidTickSpacing` - The swap pool was initialized with tick-spacing of 0.
   *
   * ### Parameters
   * @param context - Context object containing services required to generate the instruction
   * @param params - SwapParams object
   * @returns - Instruction to perform the action.
   */
  public static swapIx(context: WhirlpoolContext, params: ix.SwapParams) {
    return ix.swapIx(context, params);
  }

  /**
   * Update the accrued fees and rewards for a position.
   *
   * #### Special Errors
   * `TickNotFound` - Provided tick array account does not contain the tick for this position.
   * `LiquidityZero` - Position has zero liquidity and therefore already has the most updated fees and reward values.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - UpdateFeesAndRewardsParams object
   * @returns - Instruction to perform the action.
   */
  public static updateFeesAndRewardsIx(
    context: WhirlpoolContext,
    params: ix.UpdateFeesAndRewardsParams
  ) {
    return ix.updateFeesAndRewardsIx(context, params);
  }

  /**
   * Collect fees accrued for this position.
   * Call updateFeesAndRewards before this to update the position to the newest accrued values.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - CollectFeesParams object
   * @returns - Instruction to perform the action.
   */
  public static collectFeesIx(context: WhirlpoolContext, params: ix.CollectFeesParams) {
    return ix.collectFeesIx(context, params);
  }

  /**
   * Collect protocol fees accrued in this Whirlpool.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - CollectProtocolFeesParams object
   * @returns - Instruction to perform the action.
   */
  public static collectProtocolFeesIx(
    context: WhirlpoolContext,
    params: ix.CollectProtocolFeesParams
  ) {
    return ix.collectProtocolFeesIx(context, params);
  }

  /**
   * Collect rewards accrued for this reward index in a position.
   * Call updateFeesAndRewards before this to update the position to the newest accrued values.
   *

   * @param context - Context object containing services required to generate the instruction
   * @param params - CollectRewardParams object
   * @returns - Instruction to perform the action.
   */
  public static collectRewardIx(context: WhirlpoolContext, params: ix.CollectRewardParams) {
    return ix.collectRewardIx(context, params);
  }

  /**
   * Sets the fee authority to collect protocol fees for a WhirlpoolsConfig.
   * Only the current collect protocol fee authority has permission to invoke this instruction.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - SetCollectProtocolFeesAuthorityParams object
   * @returns - Instruction to perform the action.
   */
  public static setCollectProtocolFeesAuthorityIx(
    context: WhirlpoolContext,
    params: ix.SetCollectProtocolFeesAuthorityParams
  ) {
    return ix.setCollectProtocolFeesAuthorityIx(context, params);
  }

  /**
   * Updates a fee tier account with a new default fee rate. The new rate will not retroactively update
   * initialized pools.
   *
   * #### Special Errors
   * - `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - SetDefaultFeeRateParams object
   * @returns - Instruction to perform the action.
   */
  public static setDefaultFeeRateIx(context: WhirlpoolContext, params: ix.SetDefaultFeeRateParams) {
    return ix.setDefaultFeeRateIx(context, params);
  }

  /**
   * Updates a WhirlpoolsConfig with a new default protocol fee rate. The new rate will not retroactively update
   * initialized pools.
   *
   * #### Special Errors
   * - `ProtocolFeeRateMaxExceeded` - If the provided default_protocol_fee_rate exceeds MAX_PROTOCOL_FEE_RATE.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - SetDefaultFeeRateParams object
   * @returns - Instruction to perform the action.
   */
  public static setDefaultProtocolFeeRateIx(
    context: WhirlpoolContext,
    params: ix.SetDefaultProtocolFeeRateParams
  ) {
    return ix.setDefaultProtocolFeeRateIx(context, params);
  }

  /**
   * Sets the fee authority for a WhirlpoolsConfig.
   * The fee authority can set the fee & protocol fee rate for individual pools or set the default fee rate for newly minted pools.
   * Only the current fee authority has permission to invoke this instruction.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - SetFeeAuthorityParams object
   * @returns - Instruction to perform the action.
   */
  public static setFeeAuthorityIx(context: WhirlpoolContext, params: ix.SetFeeAuthorityParams) {
    return ix.setFeeAuthorityIx(context, params);
  }

  /**
   * Sets the fee rate for a Whirlpool.
   * Only the current fee authority has permission to invoke this instruction.
   *
   * #### Special Errors
   * - `FeeRateMaxExceeded` - If the provided fee_rate exceeds MAX_FEE_RATE.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - SetFeeRateParams object
   * @returns - Instruction to perform the action.
   */
  public static setFeeRateIx(context: WhirlpoolContext, params: ix.SetFeeRateParams) {
    return ix.setFeeRateIx(context, params);
  }

  /**
   * Sets the protocol fee rate for a Whirlpool.
   * Only the current fee authority has permission to invoke this instruction.
   *
   * #### Special Errors
   * - `ProtocolFeeRateMaxExceeded` - If the provided default_protocol_fee_rate exceeds MAX_PROTOCOL_FEE_RATE.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - SetFeeRateParams object
   * @returns - Instruction to perform the action.
   */
  public static setProtocolFeeRateIx(
    context: WhirlpoolContext,
    params: ix.SetProtocolFeeRateParams
  ) {
    return ix.setProtocolFeeRateIx(context, params);
  }

  /**
   * Set the whirlpool reward authority at the provided `reward_index`.
   * Only the current reward super authority has permission to invoke this instruction.
   *
   * #### Special Errors
   * - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized index in this pool,
   *                          or exceeds NUM_REWARDS.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - SetRewardAuthorityParams object
   * @returns - Instruction to perform the action.
   */
  public static setRewardAuthorityBySuperAuthorityIx(
    context: WhirlpoolContext,
    params: ix.SetRewardAuthorityBySuperAuthorityParams
  ) {
    return ix.setRewardAuthorityBySuperAuthorityIx(context, params);
  }

  /**
   * Set the whirlpool reward authority at the provided `reward_index`.
   * Only the current reward authority for this reward index has permission to invoke this instruction.
   *
   * #### Special Errors
   * - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized index in this pool,
   *                          or exceeds NUM_REWARDS.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - SetRewardAuthorityParams object
   * @returns - Instruction to perform the action.
   */
  public static setRewardAuthorityIx(
    context: WhirlpoolContext,
    params: ix.SetRewardAuthorityParams
  ) {
    return ix.setRewardAuthorityIx(context, params);
  }

  /**
   * Set the reward emissions for a reward in a Whirlpool.
   *
   * #### Special Errors
   * - `RewardVaultAmountInsufficient` - The amount of rewards in the reward vault cannot emit more than a day of desired emissions.
   * - `InvalidTimestamp` - Provided timestamp is not in order with the previous timestamp.
   * - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized index in this pool,
   *                          or exceeds NUM_REWARDS.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - SetRewardEmissionsParams object
   * @returns - Instruction to perform the action.
   */
  public static setRewardEmissionsIx(
    context: WhirlpoolContext,
    params: ix.SetRewardEmissionsParams
  ) {
    return ix.setRewardEmissionsIx(context, params);
  }

  /**
   * Set the whirlpool reward super authority for a WhirlpoolsConfig
   * Only the current reward super authority has permission to invoke this instruction.
   * This instruction will not change the authority on any `WhirlpoolRewardInfo` whirlpool rewards.
   *
   * @param context - Context object containing services required to generate the instruction
   * @param params - SetRewardEmissionsSuperAuthorityParams object
   * @returns - Instruction to perform the action.
   */
  public static setRewardEmissionsSuperAuthorityIx(
    context: WhirlpoolContext,
    params: ix.SetRewardEmissionsSuperAuthorityParams
  ) {
    return ix.setRewardEmissionsSuperAuthorityIx(context, params);
  }
}
