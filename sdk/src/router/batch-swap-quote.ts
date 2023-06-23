import { Address } from "@coral-xyz/anchor";
import { AddressUtil } from "@orca-so/common-sdk";
import BN from "bn.js";
import invariant from "tiny-invariant";
import { WhirlpoolAccountFetcherInterface, WhirlpoolAccountFetchOptions } from "../network/public/account-fetcher";
import { SwapQuoteParam } from "../quotes/public";
import { PoolUtil, SwapDirection, SwapUtils } from "../utils/public";

export interface SwapQuoteRequest {
  whirlpool: Address;
  tradeTokenMint: Address;
  tokenAmount: BN;
  amountSpecifiedIsInput: boolean;
}

export async function batchBuildSwapQuoteParams(
  quoteRequests: SwapQuoteRequest[],
  programId: Address,
  cache: WhirlpoolAccountFetcherInterface,
  opts?: WhirlpoolAccountFetchOptions
): Promise<SwapQuoteParam[]> {
  const whirlpools = await cache.getPools(
    quoteRequests.map((req) => req.whirlpool),
    opts
  );
  const program = AddressUtil.toPubKey(programId);

  const tickArrayRequests = quoteRequests.map((quoteReq, index) => {
    const { whirlpool, tokenAmount, tradeTokenMint, amountSpecifiedIsInput } = quoteReq;
    const whirlpoolData = whirlpools.get(AddressUtil.toString(whirlpool))!;
    const swapMintKey = AddressUtil.toPubKey(tradeTokenMint);
    const swapTokenType = PoolUtil.getTokenType(whirlpoolData, swapMintKey);
    invariant(!!swapTokenType, "swapTokenMint does not match any tokens on this pool");
    const aToB =
      SwapUtils.getSwapDirection(whirlpoolData, swapMintKey, amountSpecifiedIsInput) ===
      SwapDirection.AtoB;
    return {
      whirlpoolData,
      tokenAmount,
      aToB,
      tickCurrentIndex: whirlpoolData.tickCurrentIndex,
      tickSpacing: whirlpoolData.tickSpacing,
      whirlpoolAddress: AddressUtil.toPubKey(whirlpool),
      amountSpecifiedIsInput,
    };
  });

  const tickArrays = await SwapUtils.getBatchTickArrays(
    program,
    cache,
    tickArrayRequests,
    opts
  );

  return tickArrayRequests.map((req, index) => {
    const { whirlpoolData, tokenAmount, aToB, amountSpecifiedIsInput } = req;
    return {
      whirlpoolData,
      tokenAmount,
      aToB,
      amountSpecifiedIsInput,
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(amountSpecifiedIsInput),
      tickArrays: tickArrays[index],
    };
  });
}
