import type { Address } from "@coral-xyz/anchor";
import { AddressUtil } from "@orca-so/common-sdk";
import type BN from "bn.js";
import invariant from "tiny-invariant";
import type {
  WhirlpoolAccountFetcherInterface,
  WhirlpoolAccountFetchOptions,
} from "../network/public/fetcher";
import type { SwapQuoteParam } from "../quotes/public";
import { PoolUtil, SwapDirection, SwapUtils } from "../utils/public";
import { NO_TOKEN_EXTENSION_CONTEXT } from "../utils/public/token-extension-util";

export interface SwapQuoteRequest {
  whirlpool: Address;
  tradeTokenMint: Address;
  tokenAmount: BN;
  amountSpecifiedIsInput: boolean;
}

export async function batchBuildSwapQuoteParams(
  quoteRequests: SwapQuoteRequest[],
  programId: Address,
  fetcher: WhirlpoolAccountFetcherInterface,
  opts?: WhirlpoolAccountFetchOptions,
): Promise<SwapQuoteParam[]> {
  const whirlpools = await fetcher.getPools(
    quoteRequests.map((req) => req.whirlpool),
    opts,
  );
  const program = AddressUtil.toPubKey(programId);

  const tickArrayRequests = quoteRequests.map((quoteReq) => {
    const { whirlpool, tokenAmount, tradeTokenMint, amountSpecifiedIsInput } =
      quoteReq;
    const whirlpoolData = whirlpools.get(AddressUtil.toString(whirlpool))!;
    const swapMintKey = AddressUtil.toPubKey(tradeTokenMint);
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
    fetcher,
    tickArrayRequests,
    opts,
  );

  return tickArrayRequests.map((req, index) => {
    const { whirlpoolData, tokenAmount, aToB, amountSpecifiedIsInput } = req;
    return {
      whirlpoolData,
      tokenAmount,
      aToB,
      amountSpecifiedIsInput,
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
        amountSpecifiedIsInput,
      ),
      tickArrays: tickArrays[index],
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // WhirlpoolRouter does not support token extensions
    };
  });
}
