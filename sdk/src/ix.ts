import { PDA } from "@orca-so/common-sdk";
import { Address, Program } from "@project-serum/anchor";
import { WhirlpoolContext } from ".";
import { Whirlpool } from "./artifacts/whirlpool";
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
  public static initializeConfigIx(program: Program<Whirlpool>, params: ix.InitConfigParams) {
    return ix.initializeConfigIx(program, params);
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
  public static initializeFeeTierIx(program: Program<Whirlpool>, params: ix.InitFeeTierParams) {
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
  public static initializePoolIx(program: Program<Whirlpool>, params: ix.InitPoolParams) {
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
  public static initializeRewardIx(program: Program<Whirlpool>, params: ix.InitializeRewardParams) {
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
  public static initTickArrayIx(program: Program<Whirlpool>, params: ix.InitTickArrayParams) {
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
  public static openPositionIx(program: Program<Whirlpool>, params: ix.OpenPositionParams) {
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
    params: ix.OpenPositionParams & { metadataPda: PDA }
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
    params: ix.IncreaseLiquidityParams
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
    params: ix.DecreaseLiquidityParams
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
  public static closePositionIx(program: Program<Whirlpool>, params: ix.ClosePositionParams) {
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
    params: ix.UpdateFeesAndRewardsParams
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
  public static collectFeesIx(program: Program<Whirlpool>, params: ix.CollectFeesParams) {
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
    params: ix.CollectProtocolFeesParams
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
  public static collectRewardIx(program: Program<Whirlpool>, params: ix.CollectRewardParams) {
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
    params: ix.SetCollectProtocolFeesAuthorityParams
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
    params: ix.SetDefaultFeeRateParams
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
    params: ix.SetDefaultProtocolFeeRateParams
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
  public static setFeeAuthorityIx(program: Program<Whirlpool>, params: ix.SetFeeAuthorityParams) {
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
  public static setFeeRateIx(program: Program<Whirlpool>, params: ix.SetFeeRateParams) {
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
    params: ix.SetProtocolFeeRateParams
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
    params: ix.SetRewardAuthorityBySuperAuthorityParams
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
    params: ix.SetRewardAuthorityParams
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
    params: ix.SetRewardEmissionsParams
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
    params: ix.SetRewardEmissionsSuperAuthorityParams
  ) {
    return ix.setRewardEmissionsSuperAuthorityIx(program, params);
  }

  /**
   *
   * A set of transactions to collect all fees and rewards from a list of positions.
   *
   * @param ctx - WhirlpoolContext object for the current environment.
   * @param params - CollectAllPositionAddressParams object.
   * @param refresh - if true, will always fetch for the latest values on chain to compute.
   * @returns
   */
  public static async collectAllForPositionsTxns(
    ctx: WhirlpoolContext,
    params: ix.CollectAllPositionAddressParams,
    refresh: boolean
  ) {
    return ix.collectAllForPositionAddressesTxns(ctx, params, refresh);
  }

  /**
   * Collect protocol fees from a list of pools
   *
   * @param ctx - WhirlpoolContext object for the current environment.
   * @param poolAddresses the addresses of the Whirlpool accounts to collect protocol fees from
   * @returns A transaction builder to resolve ATA for tokenA and tokenB if needed, and collect protocol fees for all pools
   */
  public static async collectProtocolFeesForPools(ctx: WhirlpoolContext, poolKeys: Address[]) {
    return ix.collectProtocolFees(ctx, poolKeys);
  }
}
