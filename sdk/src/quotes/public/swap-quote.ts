import { Address, BN } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import { u64 } from "@solana/spl-token";
import invariant from "tiny-invariant";
import { PoolUtil } from "../../utils/public/pool-utils";
import { SwapInput } from "../../instructions";
import { WhirlpoolData, TickArrayData, MIN_SQRT_PRICE, MAX_SQRT_PRICE } from "../../types/public";
import { AddressUtil, Percentage, ZERO } from "@orca-so/common-sdk";
import { TickArrayUtil } from "../../utils/public";
import { Whirlpool } from "../../whirlpool-client";
import { AccountFetcher } from "../../network/public";
import { swapQuoteWithParamsImpl } from "../swap/swap-quote-impl";

/**
 * @category Quotes
 */
export type SwapQuoteParam = {
  whirlpoolData: WhirlpoolData;
  tokenAmount: u64;
  otherAmountThreshold: u64;
  sqrtPriceLimit: u64;
  aToB: boolean;
  amountSpecifiedIsInput: boolean;
  slippageTolerance: Percentage;
  tickArrays: TickArray[];
};

export type TickArray = {
  address: PublicKey;
  data: TickArrayData | null;
};

/**
 * @category Quotes
 */
export type SwapQuote = {
  estimatedAmountIn: u64;
  estimatedAmountOut: u64;
  estimatedEndTickIndex: number;
  estimatedEndSqrtPrice: u64;
  estimatedFeeAmount: u64;
} & SwapInput;

/**
 * @category Quotes
 */
export async function swapQuoteByInputToken(
  whirlpool: Whirlpool,
  swapTokenMint: Address,
  tokenAmount: u64,
  amountSpecifiedIsInput: boolean,
  slippageTolerance: Percentage,
  fetcher: AccountFetcher,
  programId: Address,
  refresh: boolean
): Promise<SwapQuote> {
  const whirlpoolData = whirlpool.getData();
  const swapMintKey = AddressUtil.toPubKey(swapTokenMint);
  const swapTokenType = PoolUtil.getTokenType(whirlpoolData, swapMintKey);
  invariant(!!swapTokenType, "swapTokenMint does not match any tokens on this pool");

  const aToB =
    swapMintKey.equals(whirlpoolData.tokenMintA) === amountSpecifiedIsInput ? true : false;

  const tickArrays = await PoolUtil.getTickArraysForSwap(
    whirlpoolData.tickCurrentIndex,
    whirlpoolData.tickSpacing,
    aToB,
    AddressUtil.toPubKey(programId),
    whirlpool.getAddress(),
    fetcher,
    refresh
  );

  // Check if all the tick arrays have been initialized.
  const uninitializedIndices = TickArrayUtil.getUninitializedArrays(
    tickArrays.map((array) => array.data)
  );
  if (uninitializedIndices.length > 0) {
    const uninitializedArrays = uninitializedIndices
      .map((index) => tickArrays[index].address.toBase58())
      .join(", ");
    throw new Error(`TickArray addresses - [${uninitializedArrays}] need to be initialized.`);
  }

  return swapQuoteWithParamsImpl({
    whirlpoolData,
    tokenAmount,
    aToB,
    amountSpecifiedIsInput,
    sqrtPriceLimit: getDefaultSqrtPriceLimit(aToB),
    otherAmountThreshold: ZERO,
    slippageTolerance,
    tickArrays,
  });
}

export function getDefaultSqrtPriceLimit(aToB: boolean) {
  return aToB ? new u64(MIN_SQRT_PRICE) : new u64(MAX_SQRT_PRICE);
}
