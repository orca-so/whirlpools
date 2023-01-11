import { AddressUtil, Instruction } from "@orca-so/common-sdk";
import { Address, BN, Program } from "@project-serum/anchor";
import { TOKEN_PROGRAM_ID, u64 } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { Whirlpool } from "../artifacts/whirlpool";
import { TickArrayData, WhirlpoolData } from "../types/public";
import { PDAUtil, TickArrayUtil } from "../utils/public";

/**
 * Parameters and accounts to swap on a Whirlpool
 * Option to use {@link SwapRawParams} or {@link SwapClientParams}
 * @category Instruction Types
 */
export type SwapParams = SwapRawParams | SwapClientParams;

/**
 * Parameters that uses client data types to swap on a Whirlpools.
 *
 * @category Instruction Types
 * @param whirlpool - PublicKey for the whirlpool that the position will be opened for.
 * @param whirlpoolData - On-chain account for a Whirlpool {@link WhirlpoolData}
 * @param wallet - The wallet that tokens will be withdrawn and deposit into.
 * @param swapInput - {@link SwapInput} parameters to define the nature of the swap
 * @param inputTokenAssociatedAddress - The associated token account for the input token.
 * @param outputTokenAssociatedAddress - The associated token account for the output token.
 * @param tickArrayData - @optional If present, method will check whether all tick-arrays are initialized
 */
export type SwapClientParams = {
  isClientParams: true;
  whirlpool: PublicKey;
  whirlpoolData: WhirlpoolData;
  wallet: PublicKey;
  swapInput: SwapInput;
  inputTokenAssociatedAddress: Address;
  outputTokenAssociatedAddress: Address;
  tickArrayData?: (TickArrayData | null)[];
};

/**
 * Raw parameters and accounts to swap on a Whirlpool
 *
 * @category Instruction Types
 * @param swapInput - Parameters in {@link SwapInput}
 * @param whirlpool - PublicKey for the whirlpool that the position will be opened for.
 * @param tokenOwnerAccountA - PublicKey for the associated token account for tokenA in the collection wallet
 * @param tokenOwnerAccountB - PublicKey for the associated token account for tokenB in the collection wallet
 * @param tokenVaultA - PublicKey for the tokenA vault for this whirlpool.
 * @param tokenVaultB - PublicKey for the tokenB vault for this whirlpool.
 * @param oracle - PublicKey for the oracle account for this Whirlpool.
 * @param tokenAuthority - authority to withdraw tokens from the input token account
 */
export type SwapRawParams = SwapInput & {
  isClientParams?: false;
  whirlpool: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  oracle: PublicKey;
  tokenAuthority: PublicKey;
};

/**
 * Parameters that describe the nature of a swap on a Whirlpool.
 *
 * @category Instruction Types
 * @param aToB - The direction of the swap. True if swapping from A to B. False if swapping from B to A.
 * @param amountSpecifiedIsInput - Specifies the token the parameter `amount`represents. If true, the amount represents
 *                                 the input token of the swap.
 * @param amount - The amount of input or output token to swap from (depending on amountSpecifiedIsInput).
 * @param otherAmountThreshold - The maximum/minimum of input/output token to swap into (depending on amountSpecifiedIsInput).
 * @param sqrtPriceLimit - The maximum/minimum price the swap will swap to.
 * @param tickArray0 - PublicKey of the tick-array where the Whirlpool's currentTickIndex resides in
 * @param tickArray1 - The next tick-array in the swap direction. If the swap will not reach the next tick-aray, input the same array as tickArray0.
 * @param tickArray2 - The next tick-array in the swap direction after tickArray2. If the swap will not reach the next tick-aray, input the same array as tickArray1.
 */
export type SwapInput = {
  amount: u64;
  otherAmountThreshold: u64;
  sqrtPriceLimit: BN;
  amountSpecifiedIsInput: boolean;
  aToB: boolean;
  tickArray0: PublicKey;
  tickArray1: PublicKey;
  tickArray2: PublicKey;
};

/**
 * Parameters to swap on a Whirlpool with developer fees
 *
 * @category Instruction Types
 * @param swapInput - Parameters in {@link SwapInput}
 * @param devFeeAmount -  FeeAmount (developer fees) charged on this swap
 */
export type DevFeeSwapInput = SwapInput & {
  devFeeAmount: u64;
};

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
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - {@link SwapParams}
 * @returns - Instruction to perform the action.
 */
export function swapIx(program: Program<Whirlpool>, params: SwapParams): Instruction {
  let rawParams: SwapRawParams;
  let tickArrayData: (TickArrayData | null)[] | undefined;

  // Convert client parameters into raw parameters
  if (params.isClientParams) {
    const {
      swapInput,
      whirlpool,
      whirlpoolData,
      inputTokenAssociatedAddress,
      outputTokenAssociatedAddress,
      wallet,
    } = params;
    const aToB = swapInput.aToB;
    const [inputTokenATA, outputTokenATA] = AddressUtil.toPubKeys([
      inputTokenAssociatedAddress,
      outputTokenAssociatedAddress,
    ]);
    const oraclePda = PDAUtil.getOracle(program.programId, whirlpool);
    rawParams = {
      whirlpool,
      tokenOwnerAccountA: aToB ? inputTokenATA : outputTokenATA,
      tokenOwnerAccountB: aToB ? outputTokenATA : inputTokenATA,
      tokenVaultA: whirlpoolData.tokenVaultA,
      tokenVaultB: whirlpoolData.tokenVaultB,
      oracle: oraclePda.publicKey,
      tokenAuthority: wallet,
      ...swapInput,
    };
    tickArrayData = params.tickArrayData;
  } else {
    rawParams = params;
  }

  // Verify tick arrays are initialized if the user provided them.
  if (tickArrayData) {
    const tickArrayAddresses = [rawParams.tickArray0, rawParams.tickArray1, rawParams.tickArray2];
    const uninitializedIndices = TickArrayUtil.getUninitializedArrays(tickArrayData);
    if (uninitializedIndices.length > 0) {
      const uninitializedArrays = uninitializedIndices
        .map((index) => tickArrayAddresses[index].toBase58())
        .join(", ");
      throw new Error(`TickArray addresses - [${uninitializedArrays}] need to be initialized.`);
    }
  }

  // Construct the raw instruction
  const {
    amount,
    otherAmountThreshold,
    sqrtPriceLimit,
    amountSpecifiedIsInput,
    aToB,
    whirlpool,
    tokenAuthority,
    tokenOwnerAccountA,
    tokenVaultA,
    tokenOwnerAccountB,
    tokenVaultB,
    tickArray0,
    tickArray1,
    tickArray2,
    oracle,
  } = rawParams;

  const ix = program.instruction.swap(
    amount,
    otherAmountThreshold,
    sqrtPriceLimit,
    amountSpecifiedIsInput,
    aToB,
    {
      accounts: {
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenAuthority: tokenAuthority,
        whirlpool,
        tokenOwnerAccountA,
        tokenVaultA,
        tokenOwnerAccountB,
        tokenVaultB,
        tickArray0,
        tickArray1,
        tickArray2,
        oracle,
      },
    }
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
