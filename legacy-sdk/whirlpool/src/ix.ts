import type { Program } from "@coral-xyz/anchor";
import type { PDA, Instruction } from "@orca-so/common-sdk";
import type { Whirlpool } from "./artifacts/whirlpool";
import * as ix from "./instructions";

/**
 * Instruction builders for the Whirlpools program.
 *
 * @category Core
 */
export class WhirlpoolIx {
  /**
   * Initializes a WhirlpoolsConfig account that hosts info & authorities
   * required to govern a set of Whirlpools.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - InitConfigParams object
   * @returns - Instruction to perform the action.
   */
  public static initializeConfigIx(
    program: Program<Whirlpool>,
    params: ix.InitConfigParams,
  ) {
    return ix.initializeConfigIx(program, params);
  }

  /**
   * Sets the feature flag for a WhirlpoolsConfig.
   *
   * @category Instructions
   * @param program - program object containing services required to generate the instruction
   * @param params - SetConfigFeatureFlagParams object
   * @returns - Instruction to perform the action.
   */
  public static setConfigFeatureFlagIx(
    program: Program<Whirlpool>,
    params: ix.SetConfigFeatureFlagParams,
  ) {
    return ix.setConfigFeatureFlagIx(program, params);
  }

  /**
   * Initializes a fee tier account usable by Whirlpools in this WhirlpoolsConfig space.
   *
   *  Special Errors
   * `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - InitFeeTierParams object
   * @returns - Instruction to perform the action.
   */
  public static initializeFeeTierIx(
    program: Program<Whirlpool>,
    params: ix.InitFeeTierParams,
  ) {
    return ix.initializeFeeTierIx(program, params);
  }

  /**
   * Initializes a tick_array account to represent a tick-range in a Whirlpool.
   *
   * Special Errors
   * `InvalidTokenMintOrder` - The order of mints have to be ordered by
   * `SqrtPriceOutOfBounds` - provided initial_sqrt_price is not between 2^-64 to 2^64
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - InitPoolParams object
   * @returns - Instruction to perform the action.
   */
  public static initializePoolIx(
    program: Program<Whirlpool>,
    params: ix.InitPoolParams,
  ) {
    return ix.initializePoolIx(program, params);
  }

  /**
   * Initialize reward for a Whirlpool. A pool can only support up to a set number of rewards.
   * The initial emissionsPerSecond is set to 0.
   *
   * #### Special Errors
   * - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized index in this pool,
   *                          or exceeds NUM_REWARDS, or all reward slots for this pool has been initialized.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - InitializeRewardParams object
   * @returns - Instruction to perform the action.
   */
  public static initializeRewardIx(
    program: Program<Whirlpool>,
    params: ix.InitializeRewardParams,
  ) {
    return ix.initializeRewardIx(program, params);
  }

  /**
   * Initializes a TickArray account.
   *
   * #### Special Errors
   *  `InvalidStartTick` - if the provided start tick is out of bounds or is not a multiple of TICK_ARRAY_SIZE * tick spacing.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - InitTickArrayParams object
   * @returns - Instruction to perform the action.
   */
  public static initTickArrayIx(
    program: Program<Whirlpool>,
    params: ix.InitTickArrayParams,
  ) {
    return ix.initTickArrayIx(program, params);
  }

  /**
   * Open a position in a Whirlpool. A unique token will be minted to represent the position in the users wallet.
   * The position will start off with 0 liquidity.
   *
   * #### Special Errors
   * `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of the tick-spacing in this pool.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - OpenPositionParams object
   * @returns - Instruction to perform the action.
   */
  public static openPositionIx(
    program: Program<Whirlpool>,
    params: ix.OpenPositionParams,
  ) {
    return ix.openPositionIx(program, params);
  }

  /**
   * Open a position in a Whirlpool. A unique token will be minted to represent the position
   * in the users wallet. Additional Metaplex metadata is appended to identify the token.
   * The position will start off with 0 liquidity.
   *
   * #### Special Errors
   * `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of the tick-spacing in this pool.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - OpenPositionParams object and a derived PDA that hosts the position's metadata.
   * @returns - Instruction to perform the action.
   */
  public static openPositionWithMetadataIx(
    program: Program<Whirlpool>,
    params: ix.OpenPositionParams & { metadataPda: PDA },
  ) {
    return ix.openPositionWithMetadataIx(program, params);
  }

  /**
   * Add liquidity to a position in the Whirlpool. This call also updates the position's accrued fees and rewards.
   *
   * #### Special Errors
   * `LiquidityZero` - Provided liquidity amount is zero.
   * `LiquidityTooHigh` - Provided liquidity exceeds u128::max.
   * `TokenMaxExceeded` - The required token to perform this operation exceeds the user defined amount.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - IncreaseLiquidityParams object
   * @returns - Instruction to perform the action.
   */
  public static increaseLiquidityIx(
    program: Program<Whirlpool>,
    params: ix.IncreaseLiquidityParams,
  ) {
    return ix.increaseLiquidityIx(program, params);
  }

  /**
   * Remove liquidity to a position in the Whirlpool. This call also updates the position's accrued fees and rewards.
   *
   * #### Special Errors
   * - `LiquidityZero` - Provided liquidity amount is zero.
   * - `LiquidityTooHigh` - Provided liquidity exceeds u128::max.
   * - `TokenMinSubceeded` - The required token to perform this operation subceeds the user defined amount.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - DecreaseLiquidityParams object
   * @returns - Instruction to perform the action.
   */
  public static decreaseLiquidityIx(
    program: Program<Whirlpool>,
    params: ix.DecreaseLiquidityParams,
  ) {
    return ix.decreaseLiquidityIx(program, params);
  }

  /**
   * Close a position in a Whirlpool. Burns the position token in the owner's wallet.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - ClosePositionParams object
   * @returns - Instruction to perform the action.
   */
  public static closePositionIx(
    program: Program<Whirlpool>,
    params: ix.ClosePositionParams,
  ) {
    return ix.closePositionIx(program, params);
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
   * - `AmountCalcOverflow` - The required token amount exceeds the u64 range.
   * - `AmountRemainingOverflow` - Result does not match the specified amount.
   * - `DifferentWhirlpoolTickArrayAccount` - The provided tick array account does not belong to the whirlpool.
   * - `PartialFillError` - Partially filled when sqrtPriceLimit = 0 and amountSpecifiedIsInput = false.
   *
   * ### Parameters
   * @param program - program object containing services required to generate the instruction
   * @param params - {@link SwapParams}
   * @returns - Instruction to perform the action.
   */
  public static swapIx(program: Program<Whirlpool>, params: ix.SwapParams) {
    return ix.swapIx(program, params);
  }

  /**
   * Perform a two-hop-swap in this Whirlpool
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
   * - `DuplicateTwoHopPool` - Swaps on the same pool are not allowed.
   * - `InvalidIntermediaryMint` - The first and second leg of the hops do not share a common token.
   * - `AmountCalcOverflow` - The required token amount exceeds the u64 range.
   * - `AmountRemainingOverflow` - Result does not match the specified amount.
   * - `DifferentWhirlpoolTickArrayAccount` - The provided tick array account does not belong to the whirlpool.
   * - `PartialFillError` - Partially filled when sqrtPriceLimit = 0 and amountSpecifiedIsInput = false.
   * - `IntermediateTokenAmountMismatch` - The amount of tokens received from the first hop does not match the amount sent to the second hop.
   *
   * ### Parameters
   * @param program - program object containing services required to generate the instruction
   * @param params - TwoHopSwapParams object
   * @returns - Instruction to perform the action.
   */
  public static twoHopSwapIx(
    program: Program<Whirlpool>,
    params: ix.TwoHopSwapParams,
  ) {
    return ix.twoHopSwapIx(program, params);
  }

  /**
   * Update the accrued fees and rewards for a position.
   *
   * #### Special Errors
   * `TickNotFound` - Provided tick array account does not contain the tick for this position.
   * `LiquidityZero` - Position has zero liquidity and therefore already has the most updated fees and reward values.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - UpdateFeesAndRewardsParams object
   * @returns - Instruction to perform the action.
   */
  public static updateFeesAndRewardsIx(
    program: Program<Whirlpool>,
    params: ix.UpdateFeesAndRewardsParams,
  ) {
    return ix.updateFeesAndRewardsIx(program, params);
  }

  /**
   * Collect fees accrued for this position.
   * Call updateFeesAndRewards before this to update the position to the newest accrued values.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - CollectFeesParams object
   * @returns - Instruction to perform the action.
   */
  public static collectFeesIx(
    program: Program<Whirlpool>,
    params: ix.CollectFeesParams,
  ) {
    return ix.collectFeesIx(program, params);
  }

  /**
   * Collect protocol fees accrued in this Whirlpool.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - CollectProtocolFeesParams object
   * @returns - Instruction to perform the action.
   */
  public static collectProtocolFeesIx(
    program: Program<Whirlpool>,
    params: ix.CollectProtocolFeesParams,
  ) {
    return ix.collectProtocolFeesIx(program, params);
  }

  /**
   * Collect rewards accrued for this reward index in a position.
   * Call updateFeesAndRewards before this to update the position to the newest accrued values.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - CollectRewardParams object
   * @returns - Instruction to perform the action.
   */
  public static collectRewardIx(
    program: Program<Whirlpool>,
    params: ix.CollectRewardParams,
  ) {
    return ix.collectRewardIx(program, params);
  }

  /**
   * Sets the fee authority to collect protocol fees for a WhirlpoolsConfig.
   * Only the current collect protocol fee authority has permission to invoke this instruction.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - SetCollectProtocolFeesAuthorityParams object
   * @returns - Instruction to perform the action.
   */
  public static setCollectProtocolFeesAuthorityIx(
    program: Program<Whirlpool>,
    params: ix.SetCollectProtocolFeesAuthorityParams,
  ) {
    return ix.setCollectProtocolFeesAuthorityIx(program, params);
  }

  /**
   * Updates a fee tier account with a new default fee rate. The new rate will not retroactively update
   * initialized pools.
   *
   * #### Special Errors
   * - `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - SetDefaultFeeRateParams object
   * @returns - Instruction to perform the action.
   */
  public static setDefaultFeeRateIx(
    program: Program<Whirlpool>,
    params: ix.SetDefaultFeeRateParams,
  ) {
    return ix.setDefaultFeeRateIx(program, params);
  }

  /**
   * Updates a WhirlpoolsConfig with a new default protocol fee rate. The new rate will not retroactively update
   * initialized pools.
   *
   * #### Special Errors
   * - `ProtocolFeeRateMaxExceeded` - If the provided default_protocol_fee_rate exceeds MAX_PROTOCOL_FEE_RATE.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - SetDefaultFeeRateParams object
   * @returns - Instruction to perform the action.
   */
  public static setDefaultProtocolFeeRateIx(
    program: Program<Whirlpool>,
    params: ix.SetDefaultProtocolFeeRateParams,
  ) {
    return ix.setDefaultProtocolFeeRateIx(program, params);
  }

  /**
   * Sets the fee authority for a WhirlpoolsConfig.
   * The fee authority can set the fee & protocol fee rate for individual pools or set the default fee rate for newly minted pools.
   * Only the current fee authority has permission to invoke this instruction.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - SetFeeAuthorityParams object
   * @returns - Instruction to perform the action.
   */
  public static setFeeAuthorityIx(
    program: Program<Whirlpool>,
    params: ix.SetFeeAuthorityParams,
  ) {
    return ix.setFeeAuthorityIx(program, params);
  }

  /**
   * Sets the fee rate for a Whirlpool.
   * Only the current fee authority has permission to invoke this instruction.
   *
   * #### Special Errors
   * - `FeeRateMaxExceeded` - If the provided fee_rate exceeds MAX_FEE_RATE.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - SetFeeRateParams object
   * @returns - Instruction to perform the action.
   */
  public static setFeeRateIx(
    program: Program<Whirlpool>,
    params: ix.SetFeeRateParams,
  ) {
    return ix.setFeeRateIx(program, params);
  }

  /**
   * Sets the protocol fee rate for a Whirlpool.
   * Only the current fee authority has permission to invoke this instruction.
   *
   * #### Special Errors
   * - `ProtocolFeeRateMaxExceeded` - If the provided default_protocol_fee_rate exceeds MAX_PROTOCOL_FEE_RATE.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - SetFeeRateParams object
   * @returns - Instruction to perform the action.
   */
  public static setProtocolFeeRateIx(
    program: Program<Whirlpool>,
    params: ix.SetProtocolFeeRateParams,
  ) {
    return ix.setProtocolFeeRateIx(program, params);
  }

  /**
   * Set the whirlpool reward authority at the provided `reward_index`.
   * Only the current reward super authority has permission to invoke this instruction.
   *
   * #### Special Errors
   * - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized index in this pool,
   *                          or exceeds NUM_REWARDS.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - SetRewardAuthorityParams object
   * @returns - Instruction to perform the action.
   */
  public static setRewardAuthorityBySuperAuthorityIx(
    program: Program<Whirlpool>,
    params: ix.SetRewardAuthorityBySuperAuthorityParams,
  ) {
    return ix.setRewardAuthorityBySuperAuthorityIx(program, params);
  }

  /**
   * Set the whirlpool reward authority at the provided `reward_index`.
   * Only the current reward authority for this reward index has permission to invoke this instruction.
   *
   * #### Special Errors
   * - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized index in this pool,
   *                          or exceeds NUM_REWARDS.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - SetRewardAuthorityParams object
   * @returns - Instruction to perform the action.
   */
  public static setRewardAuthorityIx(
    program: Program<Whirlpool>,
    params: ix.SetRewardAuthorityParams,
  ) {
    return ix.setRewardAuthorityIx(program, params);
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
   * @param program - program object containing services required to generate the instruction
   * @param params - SetRewardEmissionsParams object
   * @returns - Instruction to perform the action.
   */
  public static setRewardEmissionsIx(
    program: Program<Whirlpool>,
    params: ix.SetRewardEmissionsParams,
  ) {
    return ix.setRewardEmissionsIx(program, params);
  }

  /**
   * Set the whirlpool reward super authority for a WhirlpoolsConfig
   * Only the current reward super authority has permission to invoke this instruction.
   * This instruction will not change the authority on any `WhirlpoolRewardInfo` whirlpool rewards.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - SetRewardEmissionsSuperAuthorityParams object
   * @returns - Instruction to perform the action.
   */
  public static setRewardEmissionsSuperAuthorityIx(
    program: Program<Whirlpool>,
    params: ix.SetRewardEmissionsSuperAuthorityParams,
  ) {
    return ix.setRewardEmissionsSuperAuthorityIx(program, params);
  }

  /**
   * Initializes a PositionBundle account.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - InitializePositionBundleParams object
   * @returns - Instruction to perform the action.
   */
  public static initializePositionBundleIx(
    program: Program<Whirlpool>,
    params: ix.InitializePositionBundleParams,
  ) {
    return ix.initializePositionBundleIx(program, params);
  }

  /**
   * Initializes a PositionBundle account.
   * Additional Metaplex metadata is appended to identify the token.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - InitializePositionBundleParams object
   * @returns - Instruction to perform the action.
   */
  public static initializePositionBundleWithMetadataIx(
    program: Program<Whirlpool>,
    params: ix.InitializePositionBundleParams & {
      positionBundleMetadataPda: PDA;
    },
  ) {
    return ix.initializePositionBundleWithMetadataIx(program, params);
  }

  /**
   * Deletes a PositionBundle account.
   *
   * #### Special Errors
   * `PositionBundleNotDeletable` - The provided position bundle has open positions.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - DeletePositionBundleParams object
   * @returns - Instruction to perform the action.
   */
  public static deletePositionBundleIx(
    program: Program<Whirlpool>,
    params: ix.DeletePositionBundleParams,
  ) {
    return ix.deletePositionBundleIx(program, params);
  }

  /**
   * Open a bundled position in a Whirlpool.
   * No new tokens are issued because the owner of the position bundle becomes the owner of the position.
   * The position will start off with 0 liquidity.
   *
   * #### Special Errors
   * `InvalidBundleIndex` - If the provided bundle index is out of bounds.
   * `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of the tick-spacing in this pool.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - OpenBundledPositionParams object
   * @returns - Instruction to perform the action.
   */
  public static openBundledPositionIx(
    program: Program<Whirlpool>,
    params: ix.OpenBundledPositionParams,
  ) {
    return ix.openBundledPositionIx(program, params);
  }

  /**
   * Close a bundled position in a Whirlpool.
   *
   * #### Special Errors
   * `InvalidBundleIndex` - If the provided bundle index is out of bounds.
   * `ClosePositionNotEmpty` - The provided position account is not empty.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - CloseBundledPositionParams object
   * @returns - Instruction to perform the action.
   */
  public static closeBundledPositionIx(
    program: Program<Whirlpool>,
    params: ix.CloseBundledPositionParams,
  ) {
    return ix.closeBundledPositionIx(program, params);
  }

  /**
   * Open a position in a Whirlpool. A unique token will be minted to represent the position
   * in the users wallet. Additional TokenMetadata extension is initialized to identify the token if requested.
   * Mint and Token account are based on Token-2022.
   * The position will start off with 0 liquidity.
   *
   * #### Special Errors
   * `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of the tick-spacing in this pool.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - OpenPositionWithTokenExtensionsParams object and a derived PDA that hosts the position's metadata.
   * @returns - Instruction to perform the action.
   */
  public static openPositionWithTokenExtensionsIx(
    program: Program<Whirlpool>,
    params: ix.OpenPositionWithTokenExtensionsParams,
  ) {
    return ix.openPositionWithTokenExtensionsIx(program, params);
  }

  /**
   * Close a position in a Whirlpool. Burns the position token in the owner's wallet.
   * Mint and TokenAccount are based on Token-2022. And Mint accout will be also closed.
   *
   * @category Instructions
   * @param program - program object containing services required to generate the instruction
   * @param params - ClosePositionWithTokenExtensionsParams object
   * @returns - Instruction to perform the action.
   */
  public static closePositionWithTokenExtensionsIx(
    program: Program<Whirlpool>,
    params: ix.ClosePositionWithTokenExtensionsParams,
  ) {
    return ix.closePositionWithTokenExtensionsIx(program, params);
  }

  /**
   * Initializes an adaptive fee tier account usable by Whirlpools in this WhirlpoolsConfig space.
   *
   * @category Instructions
   * @param context - Context object containing services required to generate the instruction
   * @param params - InitializeAdaptiveFeeTierParams object
   * @returns - Instruction to perform the action.
   */
  public static initializeAdaptiveFeeTierIx(
    program: Program<Whirlpool>,
    params: ix.InitializeAdaptiveFeeTierParams,
  ) {
    return ix.initializeAdaptiveFeeTierIx(program, params);
  }

  /**
   * Initializes a Whirlpool account with adaptive fee.
   *
   * @category Instructions
   * @param context - Context object containing services required to generate the instruction
   * @param params - InitPoolWithAdaptiveFeeTierParams object
   * @returns - Instruction to perform the action.
   */
  public static initializePoolWithAdaptiveFeeIx(
    program: Program<Whirlpool>,
    params: ix.InitPoolWithAdaptiveFeeParams,
  ) {
    return ix.initializePoolWithAdaptiveFeeIx(program, params);
  }

  /**
   * Updates an adaptive fee tier account with a new default base fee rate. The new rate will not retroactively update
   * initialized pools.
   *
   * @category Instructions
   * @param context - Context object containing services required to generate the instruction
   * @param params - SetDefaultBaseFeeRateParams object
   * @returns - Instruction to perform the action.
   */
  public static setDefaultBaseFeeRateIx(
    program: Program<Whirlpool>,
    params: ix.SetDefaultBaseFeeRateParams,
  ) {
    return ix.setDefaultBaseFeeRateIx(program, params);
  }

  /**
   * Sets the delegated fee authority for an AdaptiveFeeTier.
   * Only the fee authority has permission to invoke this instruction.
   *
   * @category Instructions
   * @param context - Context object containing services required to generate the instruction
   * @param params - SetDelegatedFeeAuthorityParams object
   * @returns - Instruction to perform the action.
   */
  public static setDelegatedFeeAuthorityIx(
    program: Program<Whirlpool>,
    params: ix.SetDelegatedFeeAuthorityParams,
  ) {
    return ix.setDelegatedFeeAuthorityIx(program, params);
  }

  /**
   * Sets the fee rate for a Whirlpool by the delegated fee authority.
   * Only the current delegated fee authority has permission to invoke this instruction.
   *
   * @category Instructions
   * @param context - Context object containing services required to generate the instruction
   * @param params - SetFeeRateByDelegatedFeeAuthorityParams object
   * @returns - Instruction to perform the action.
   */
  public static setFeeRateByDelegatedFeeAuthorityIx(
    program: Program<Whirlpool>,
    params: ix.SetFeeRateByDelegatedFeeAuthorityParams,
  ) {
    return ix.setFeeRateByDelegatedFeeAuthorityIx(program, params);
  }

  /**
   * Sets the initialize pool authority for an AdaptiveFeeTier.
   * Only the fee authority has permission to invoke this instruction.
   *
   * @category Instructions
   * @param context - Context object containing services required to generate the instruction
   * @param params - SetInitializePoolAuthorityParams object
   * @returns - Instruction to perform the action.
   */
  public static setInitializePoolAuthorityIx(
    program: Program<Whirlpool>,
    params: ix.SetInitializePoolAuthorityParams,
  ) {
    return ix.setInitializePoolAuthorityIx(program, params);
  }

  /**
   * Updates an adaptive fee tier account with new preset adaptive fee constants.
   *
   * @category Instructions
   * @param context - Context object containing services required to generate the instruction
   * @param params - SetPresetAdaptiveFeeConstantsParams object
   * @returns - Instruction to perform the action.
   */
  public static setPresetAdaptiveFeeConstantsIx(
    program: Program<Whirlpool>,
    params: ix.SetPresetAdaptiveFeeConstantsParams,
  ) {
    return ix.setPresetAdaptiveFeeConstantsIx(program, params);
  }

  /**
   * Sets specific adaptive fee constants for a pool.
   * Only the provided constants will be updated, others remain unchanged.
   *
   * @category Instructions
   * @param program - Program object containing the Whirlpool IDL
   * @param params - SetAdaptiveFeeConstantsParams object
   * @returns - Instruction to perform the action.
   */
  public static setAdaptiveFeeConstantsIx(
    program: Program<Whirlpool>,
    params: ix.SetAdaptiveFeeConstantsParams,
  ) {
    return ix.setAdaptiveFeeConstantsIx(program, params);
  }

  /**
   * Reset a position's range. Requires liquidity to be zero.
   *
   * #### Special Errors
   * `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of the tick-spacing in this pool.
   * `ClosePositionNotEmpty` - The provided position account is not empty.
   * `SameTickRangeNotAllowed` - The provided tick range is the same as the current tick range.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - ResetPositionRangeParams object
   * @returns - Instruction to perform the action.
   */
  public static resetPositionRangeIx(
    program: Program<Whirlpool>,
    params: ix.ResetPositionRangeParams,
  ) {
    return ix.resetPositionRangeIx(program, params);
  }

  /**
   * Lock the position to prevent any liquidity changes.
   *
   * #### Special Errors
   * `PositionAlreadyLocked` - The provided position is already locked.
   * `PositionNotLockable` - The provided position is not lockable (e.g. An empty position).
   *
   * @category Instructions
   * @param program - program object containing services required to generate the instruction
   * @param params - LockPositionParams object.
   * @returns - Instruction to perform the action.
   */
  public static lockPositionIx(
    program: Program<Whirlpool>,
    params: ix.LockPositionParams,
  ) {
    return ix.lockPositionIx(program, params);
  }

  /**
   * Transfer a position in a Whirlpool.
   *
   * @param program - program object containing services required to generate the instruction
   * @param params - TransferPositionParams object
   * @returns - Instruction to perform the action.
   */
  public static transferLockedPositionIx(
    program: Program<Whirlpool>,
    params: ix.TransferLockedPositionParams,
  ) {
    return ix.transferLockedPositionIx(program, params);
  }

  // V2 instructions
  // TODO: comments
  public static collectFeesV2Ix(
    program: Program<Whirlpool>,
    params: ix.CollectFeesV2Params,
  ) {
    return ix.collectFeesV2Ix(program, params);
  }

  public static collectProtocolFeesV2Ix(
    program: Program<Whirlpool>,
    params: ix.CollectProtocolFeesV2Params,
  ) {
    return ix.collectProtocolFeesV2Ix(program, params);
  }

  public static collectRewardV2Ix(
    program: Program<Whirlpool>,
    params: ix.CollectRewardV2Params,
  ) {
    return ix.collectRewardV2Ix(program, params);
  }

  public static decreaseLiquidityV2Ix(
    program: Program<Whirlpool>,
    params: ix.DecreaseLiquidityV2Params,
  ) {
    return ix.decreaseLiquidityV2Ix(program, params);
  }

  public static increaseLiquidityV2Ix(
    program: Program<Whirlpool>,
    params: ix.IncreaseLiquidityV2Params,
  ) {
    return ix.increaseLiquidityV2Ix(program, params);
  }

  public static initializePoolV2Ix(
    program: Program<Whirlpool>,
    params: ix.InitPoolV2Params,
  ) {
    return ix.initializePoolV2Ix(program, params);
  }

  public static initializeRewardV2Ix(
    program: Program<Whirlpool>,
    params: ix.InitializeRewardV2Params | ix.InitializeRewardV2WithPubkeyParams,
  ): Instruction {
    if ("rewardVaultKeypair" in params) {
      return ix.initializeRewardV2Ix(program, params);
    }
    return ix.initializeRewardV2Ix(program, params);
  }

  public static initDynamicTickArrayIx(
    program: Program<Whirlpool>,
    params: ix.InitDynamicTickArrayParams,
  ) {
    return ix.initDynamicTickArrayIx(program, params);
  }

  public static setRewardEmissionsV2Ix(
    program: Program<Whirlpool>,
    params: ix.SetRewardEmissionsV2Params,
  ) {
    return ix.setRewardEmissionsV2Ix(program, params);
  }

  public static swapV2Ix(program: Program<Whirlpool>, params: ix.SwapV2Params) {
    return ix.swapV2Ix(program, params);
  }

  public static twoHopSwapV2Ix(
    program: Program<Whirlpool>,
    params: ix.TwoHopSwapV2Params,
  ) {
    return ix.twoHopSwapV2Ix(program, params);
  }

  public static repositionLiquidityV2Ix(
    program: Program<Whirlpool>,
    params: ix.RepositionLiquidityV2Params,
  ) {
    return ix.repositionLiquidityV2Ix(program, params);
  }

  // V2 instructions (TokenBadge related)
  // TODO: comments
  public static initializeConfigExtensionIx(
    program: Program<Whirlpool>,
    params: ix.InitConfigExtensionParams,
  ) {
    return ix.initializeConfigExtensionIx(program, params);
  }

  public static setConfigExtensionAuthorityIx(
    program: Program<Whirlpool>,
    params: ix.SetConfigExtensionAuthorityParams,
  ) {
    return ix.setConfigExtensionAuthorityIx(program, params);
  }

  public static setTokenBadgeAuthorityIx(
    program: Program<Whirlpool>,
    params: ix.SetTokenBadgeAuthorityParams,
  ) {
    return ix.setTokenBadgeAuthorityIx(program, params);
  }

  public static initializeTokenBadgeIx(
    program: Program<Whirlpool>,
    params: ix.InitializeTokenBadgeParams,
  ) {
    return ix.initializeTokenBadgeIx(program, params);
  }

  public static deleteTokenBadgeIx(
    program: Program<Whirlpool>,
    params: ix.DeleteTokenBadgeParams,
  ) {
    return ix.deleteTokenBadgeIx(program, params);
  }

  public static setTokenBadgeAttributeIx(
    program: Program<Whirlpool>,
    params: ix.SetTokenBadgeAttributeParams,
  ) {
    return ix.setTokenBadgeAttributeIx(program, params);
  }
}
