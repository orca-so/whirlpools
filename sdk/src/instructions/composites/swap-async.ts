import { resolveOrCreateATAs, TransactionBuilder, ZERO } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { SwapUtils, TickArrayUtil, Whirlpool, WhirlpoolContext } from "../..";
import { WhirlpoolAccountFetchOptions } from "../../network/public/account-fetcher";
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
 * @param opts - {@link WhirlpoolAccountFetchOptions} to use for account fetching.
 * @returns
 */
export async function swapAsync(
  ctx: WhirlpoolContext,
  params: SwapAsyncParams,
  opts: WhirlpoolAccountFetchOptions
): Promise<TransactionBuilder> {
  const { wallet, whirlpool, swapInput } = params;
  const { aToB, amount } = swapInput;
  const txBuilder = new TransactionBuilder(ctx.connection, ctx.wallet, ctx.txBuilderOpts);
  const tickArrayAddresses = [swapInput.tickArray0, swapInput.tickArray1, swapInput.tickArray2];

  let uninitializedArrays = await TickArrayUtil.getUninitializedArraysString(
    tickArrayAddresses,
    ctx.fetcher,
    opts
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
