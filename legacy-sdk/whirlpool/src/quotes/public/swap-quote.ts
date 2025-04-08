import type { Address } from "@coral-xyz/anchor";
import type { Percentage } from "@orca-so/common-sdk";
import { AddressUtil } from "@orca-so/common-sdk";
import type BN from "bn.js";
import invariant from "tiny-invariant";
import type { SwapInput } from "../../instructions";
import type {
  WhirlpoolAccountFetchOptions,
  WhirlpoolAccountFetcherInterface,
} from "../../network/public/fetcher";
import { IGNORE_CACHE } from "../../network/public/fetcher";
import type { TickArray, WhirlpoolData } from "../../types/public";
import { TICK_ARRAY_SIZE } from "../../types/public";
import { PoolUtil, SwapDirection } from "../../utils/public";
import { SwapUtils } from "../../utils/public/swap-utils";
import type { Whirlpool } from "../../whirlpool-client";
import { simulateSwap } from "../swap/swap-quote-impl";
import type { DevFeeSwapQuote } from "./dev-fee-swap-quote";
import type { TokenExtensionContextForPool } from "../../utils/public/token-extension-util";
import { TokenExtensionUtil } from "../../utils/public/token-extension-util";
import { PublicKey } from "@solana/web3.js";

/**
 * An enum to specify when to use fallback tick array in a swap quote.
 * @category Quotes
 */
export enum UseFallbackTickArray {
  // Always try to include fallback tick array in the swap quote
  Always = "Always",
  // Never include fallback tick array in the swap quote
  Never = "Never",
  // Use fallback tick array only when tickCurrentIndex is the edge (last quoter) of the first tick array
  Situational = "Situational",
}

/**
 * @category Quotes
 *
 * @param tokenAmount - The amount of input or output token to swap from (depending on amountSpecifiedIsInput).
 * @param otherAmountThreshold - The maximum/minimum of input/output token to swap into (depending on amountSpecifiedIsInput).
 * @param sqrtPriceLimit - The maximum/minimum price the swap will swap to.
 * @param aToB - The direction of the swap. True if swapping from A to B. False if swapping from B to A.
 * @param amountSpecifiedIsInput - Specifies the token the parameter `amount`represents. If true, the amount represents
 *                                 the input token of the swap.
 * @param tickArrays - An sequential array of tick-array objects in the direction of the trade to swap on
 * @param tokenExtensionCtx - TokenExtensions info for the whirlpool
 * @param fallbackTickArray - Optional. A reserve in case prices move in the opposite direction
 */
export type SwapQuoteParam = {
  whirlpoolData: WhirlpoolData;
  tokenAmount: BN;
  otherAmountThreshold: BN;
  sqrtPriceLimit: BN;
  aToB: boolean;
  amountSpecifiedIsInput: boolean;
  tickArrays: TickArray[];
  tokenExtensionCtx: TokenExtensionContextForPool;
  fallbackTickArray?: PublicKey;
};

/**
 * A collection of estimated values from quoting a swap.
 * @category Quotes
 * @link {BaseSwapQuote}
 * @link {DevFeeSwapQuote}
 */
export type SwapQuote = NormalSwapQuote | DevFeeSwapQuote;

/**
 * A collection of estimated values from quoting a swap.
 * @category Quotes
 * @param estimatedAmountIn - Approximate number of input token swapped in the swap
 * @param estimatedAmountOut - Approximate number of output token swapped in the swap
 * @param estimatedEndTickIndex - Approximate tick-index the Whirlpool will land on after this swap
 * @param estimatedEndSqrtPrice - Approximate sqrtPrice the Whirlpool will land on after this swap
 * @param estimatedFeeAmount - Approximate feeAmount (all fees) charged on this swap
 */
export type SwapEstimates = {
  estimatedAmountIn: BN;
  estimatedAmountOut: BN;
  estimatedEndTickIndex: number;
  estimatedEndSqrtPrice: BN;
  estimatedFeeAmount: BN;
  transferFee: {
    deductingFromEstimatedAmountIn: BN;
    deductedFromEstimatedAmountOut: BN;
  };
};

/**
 * A collection of estimated values from quoting a swap. Object can be directly used in a swap transaction.
 * @category Quotes
 */
export type NormalSwapQuote = SwapInput & SwapEstimates;

/**
 * Get an estimated swap quote using input token amount.
 *
 * @category Quotes
 * @param whirlpool - Whirlpool to perform the swap on
 * @param inputTokenMint - PublicKey for the input token mint to swap with
 * @param tokenAmount - The amount of input token to swap from
 * @param slippageTolerance - The amount of slippage to account for in this quote
 * @param programId - PublicKey for the Whirlpool ProgramId
 * @param cache - WhirlpoolAccountCacheInterface instance object to fetch solana accounts
 * @param opts an {@link WhirlpoolAccountFetchOptions} object to define fetch and cache options when accessing on-chain accounts
 * @param useFallbackTickArray - An enum to specify when to use fallback tick array in a swap quote.
 * @returns a SwapQuote object with slippage adjusted SwapInput parameters & estimates on token amounts, fee & end whirlpool states.
 */
export async function swapQuoteByInputToken(
  whirlpool: Whirlpool,
  inputTokenMint: Address,
  tokenAmount: BN,
  slippageTolerance: Percentage,
  programId: Address,
  fetcher: WhirlpoolAccountFetcherInterface,
  opts?: WhirlpoolAccountFetchOptions,
  useFallbackTickArray: UseFallbackTickArray = UseFallbackTickArray.Never,
): Promise<SwapQuote> {
  const params = await swapQuoteByToken(
    whirlpool,
    inputTokenMint,
    tokenAmount,
    true,
    useFallbackTickArray,
    programId,
    fetcher,
    opts,
  );
  return swapQuoteWithParams(params, slippageTolerance);
}

/**
 * Get an estimated swap quote using an output token amount.
 *
 * Use this quote to get an estimated amount of input token needed to receive
 * the defined output token amount.
 *
 * @category Quotes
 * @param whirlpool - Whirlpool to perform the swap on
 * @param outputTokenMint - PublicKey for the output token mint to swap into
 * @param tokenAmount - The maximum amount of output token to receive in this swap.
 * @param slippageTolerance - The amount of slippage to account for in this quote
 * @param programId - PublicKey for the Whirlpool ProgramId
 * @param cache - WhirlpoolAccountCacheInterface instance to fetch solana accounts
 * @param opts an {@link WhirlpoolAccountFetchOptions} object to define fetch and cache options when accessing on-chain accounts
 * @param useFallbackTickArray - An enum to specify when to use fallback tick array in a swap quote.
 * @returns a SwapQuote object with slippage adjusted SwapInput parameters & estimates on token amounts, fee & end whirlpool states.
 */
export async function swapQuoteByOutputToken(
  whirlpool: Whirlpool,
  outputTokenMint: Address,
  tokenAmount: BN,
  slippageTolerance: Percentage,
  programId: Address,
  fetcher: WhirlpoolAccountFetcherInterface,
  opts?: WhirlpoolAccountFetchOptions,
  useFallbackTickArray: UseFallbackTickArray = UseFallbackTickArray.Never,
): Promise<SwapQuote> {
  const params = await swapQuoteByToken(
    whirlpool,
    outputTokenMint,
    tokenAmount,
    false,
    useFallbackTickArray,
    programId,
    fetcher,
    opts,
  );
  return swapQuoteWithParams(params, slippageTolerance);
}

/**
 * Perform a sync swap quote based on the basic swap instruction parameters.
 *
 * @category Quotes
 * @param params - SwapQuote parameters
 * @param slippageTolerance - The amount of slippage to account for when generating the final quote.
 * @returns a SwapQuote object with slippage adjusted SwapInput parameters & estimates on token amounts, fee & end whirlpool states.
 */
export function swapQuoteWithParams(
  params: SwapQuoteParam,
  slippageTolerance: Percentage,
): SwapQuote {
  const quote = simulateSwap({
    ...params,
    tickArrays: SwapUtils.interpolateUninitializedTickArrays(
      PublicKey.default,
      params.tickArrays,
    ),
  });

  if (params.fallbackTickArray) {
    if (quote.tickArray2.equals(quote.tickArray1)) {
      // both V1 and V2 can use this fallback
      quote.tickArray2 = params.fallbackTickArray;
    } else {
      // no obvious room for fallback, but V2 can use this field
      quote.supplementalTickArrays = [params.fallbackTickArray];
    }
  }

  const slippageAdjustedQuote: SwapQuote = {
    ...quote,
    ...SwapUtils.calculateSwapAmountsFromQuote(
      quote.amount,
      quote.estimatedAmountIn,
      quote.estimatedAmountOut,
      slippageTolerance,
      quote.amountSpecifiedIsInput,
    ),
  };

  return slippageAdjustedQuote;
}

async function swapQuoteByToken(
  whirlpool: Whirlpool,
  inputTokenMint: Address,
  tokenAmount: BN,
  amountSpecifiedIsInput: boolean,
  useFallbackTickArray: UseFallbackTickArray,
  programId: Address,
  fetcher: WhirlpoolAccountFetcherInterface,
  opts?: WhirlpoolAccountFetchOptions,
): Promise<SwapQuoteParam> {
  // If we use whirlpool.getData() here, quote will not be the latest even if opts is IGNORE_CACHE
  const whirlpoolData = await fetcher.getPool(whirlpool.getAddress(), opts);
  invariant(!!whirlpoolData, "Whirlpool data not found");

  const swapMintKey = AddressUtil.toPubKey(inputTokenMint);
  const swapTokenType = PoolUtil.getTokenType(whirlpoolData, swapMintKey);
  invariant(
    !!swapTokenType,
    "swapTokenMint does not match any tokens on this pool",
  );

  const aToB =
    SwapUtils.getSwapDirection(
      whirlpoolData,
      swapMintKey,
      amountSpecifiedIsInput,
    ) === SwapDirection.AtoB;

  const tickArrays = await SwapUtils.getTickArrays(
    whirlpoolData.tickCurrentIndex,
    whirlpoolData.tickSpacing,
    aToB,
    AddressUtil.toPubKey(programId),
    whirlpool.getAddress(),
    fetcher,
    opts,
  );

  const fallbackTickArray = getFallbackTickArray(
    useFallbackTickArray,
    tickArrays,
    aToB,
    whirlpool,
    programId,
  );

  const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(
    fetcher,
    whirlpoolData,
    IGNORE_CACHE,
  );

  return {
    whirlpoolData,
    tokenAmount,
    aToB,
    amountSpecifiedIsInput,
    sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
    otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
      amountSpecifiedIsInput,
    ),
    tickArrays,
    tokenExtensionCtx,
    fallbackTickArray,
  };
}

function getFallbackTickArray(
  useFallbackTickArray: UseFallbackTickArray,
  tickArrays: TickArray[],
  aToB: boolean,
  whirlpool: Whirlpool,
  programId: Address,
): PublicKey | undefined {
  if (useFallbackTickArray === UseFallbackTickArray.Never) {
    return undefined;
  }

  const fallbackTickArray = SwapUtils.getFallbackTickArrayPublicKey(
    tickArrays,
    whirlpool.getData().tickSpacing,
    aToB,
    AddressUtil.toPubKey(programId),
    whirlpool.getAddress(),
  );

  if (
    useFallbackTickArray === UseFallbackTickArray.Always ||
    !fallbackTickArray
  ) {
    return fallbackTickArray;
  }

  invariant(
    useFallbackTickArray === UseFallbackTickArray.Situational,
    `Unexpected UseFallbackTickArray value: ${useFallbackTickArray}`,
  );

  const ticksInArray = whirlpool.getData().tickSpacing * TICK_ARRAY_SIZE;
  const tickCurrentIndex = whirlpool.getData().tickCurrentIndex;
  if (aToB) {
    // A to B (direction is right to left): [    ta2     ][    ta1     ][    ta0  ===]
    // if tickCurrentIndex is within the rightmost quarter of ta0, use fallbackTickArray
    const threshold = tickArrays[0].startTickIndex + (ticksInArray / 4) * 3;
    return tickCurrentIndex >= threshold ? fallbackTickArray : undefined;
  } else {
    // B to A (direction is left to right): [=== ta0     ][    ta1     ][    ta2     ]
    // if tickCurrentIndex is within the leftmost quarter of ta0, use fallbackTickArray
    const threshold = tickArrays[0].startTickIndex + ticksInArray / 4;
    return tickCurrentIndex <= threshold ? fallbackTickArray : undefined;
  }
}
