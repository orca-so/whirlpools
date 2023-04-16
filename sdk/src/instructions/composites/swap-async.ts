import { resolveOrCreateATAs, TransactionBuilder, ZERO } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { SwapUtils, TickArrayUtil, Whirlpool, WhirlpoolContext } from "../..";
import { contextToBuilderOptions } from "../../utils/txn-utils";
import { SwapInput, swapIx } from "../swap-ix";

export type SwapAsyncParams = {
  swapInput: SwapInput;
  whirlpool: Whirlpool;
  wallet: PublicKey;
};

/**
 * Swap instruction builder method with resolveATA & additional checks.
 * @param ctx - WhirlpoolContext object for the current environment.
 * @param params - {@link SwapAsyncParams}
 * @param refresh - If true, the network calls will always fetch for the latest values.
 * @returns
 */
export async function swapAsync(
  ctx: WhirlpoolContext,
  params: SwapAsyncParams,
  refresh: boolean
): Promise<TransactionBuilder> {
  const { wallet, whirlpool, swapInput } = params;
  const { aToB, amount } = swapInput;
  const txBuilder = new TransactionBuilder(ctx.connection, ctx.wallet, contextToBuilderOptions(ctx.opts));
  const tickArrayAddresses = [swapInput.tickArray0, swapInput.tickArray1, swapInput.tickArray2];

  let uninitializedArrays = await TickArrayUtil.getUninitializedArraysString(
    tickArrayAddresses,
    ctx.fetcher,
    refresh
  );
  if (uninitializedArrays) {
    throw new Error(`TickArray addresses - [${uninitializedArrays}] need to be initialized.`);
  }

  const data = whirlpool.getData();
  const [resolvedAtaA, resolvedAtaB] = await resolveOrCreateATAs(
    ctx.connection,
    wallet,
    [
      { tokenMint: data.tokenMintA, wrappedSolAmountIn: aToB ? amount : ZERO },
      { tokenMint: data.tokenMintB, wrappedSolAmountIn: !aToB ? amount : ZERO },
    ],
    () => ctx.fetcher.getAccountRentExempt()
  );
  const { address: ataAKey, ...tokenOwnerAccountAIx } = resolvedAtaA;
  const { address: ataBKey, ...tokenOwnerAccountBIx } = resolvedAtaB;
  txBuilder.addInstructions([tokenOwnerAccountAIx, tokenOwnerAccountBIx]);
  const inputTokenAccount = aToB ? ataAKey : ataBKey;
  const outputTokenAccount = aToB ? ataBKey : ataAKey;

  return txBuilder.addInstruction(
    swapIx(
      ctx.program,
      SwapUtils.getSwapParamsFromQuote(
        swapInput,
        ctx,
        whirlpool,
        inputTokenAccount,
        outputTokenAccount,
        wallet
      )
    )
  );
}
