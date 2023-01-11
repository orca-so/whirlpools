import { AddressUtil, resolveOrCreateATAs, TransactionBuilder, ZERO } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { WhirlpoolContext } from "../..";
import { SwapClientParams, swapIx } from "../swap-ix";

/**
 * Parameters to build a swap transaction with additional sanity checks.
 *
 * @category Async Instruction Types
 * @param poolAddress - The public key for the Whirlpool to swap on
 * @param whirlpool - A {@link WhirlpoolData} on-chain data object for the pool
 * @param input - A quote on the desired tokenIn and tokenOut for this swap. Use {@link swapQuoteWithParams} or other swap quote functions to generate this object.
 * @param wallet - The wallet that tokens will be withdrawn and deposit into.
 * @param resolveATA - If true, function will automatically resolve and create token ATA to receive tokens.
 * @param inputTokenAssociatedAddress - available if resolveATA is false. Provide the ATA for input token
 * @param outputTokenAssociatedAddress - available if If resolveATA is false. Provide the ATA for output token
 */
export type SwapAsyncParams = SwapAsyncWithResolveATA | SwapAsyncWithATA;

/**
 * @category Async Instruction Types
 */
export type SwapAsyncWithResolveATA = { resolveATA: true } & Omit<
  SwapClientParams,
  "inputTokenAssociatedAddress" | "outputTokenAssociatedAddress" | "isClientParams"
>;

/**
 * @category Async Instruction Types
 */
export type SwapAsyncWithATA = { resolveATA: false } & Omit<SwapClientParams, "isClientParams">;

/**
 * Swap instruction builder method with resolveATA & additional checks.
 * @param ctx - WhirlpoolContext object for the current environment.
 * @param params - {@link SwapAsyncParams}
 * @param refresh - If true, the network calls will always fetch for the latest values.
 * @returns 
 */
export async function swapAsync(ctx: WhirlpoolContext, params: SwapAsyncParams, refresh: boolean) {
  const { wallet, whirlpoolData, swapInput } = params;
  const { aToB, amount } = swapInput;
  const txBuilder = new TransactionBuilder(ctx.connection, ctx.wallet);

  const tickArrayAddresses = [swapInput.tickArray0, swapInput.tickArray1, swapInput.tickArray2];
  const tickArrayData = await ctx.fetcher.listTickArrays(tickArrayAddresses, refresh);

  let tokenOwnerAccountA: PublicKey, tokenOwnerAccountB: PublicKey;
  if (params.resolveATA) {
    const [resolvedAtaA, resolvedAtaB] = await resolveOrCreateATAs(
      ctx.connection,
      wallet,
      [
        { tokenMint: whirlpoolData.tokenMintA, wrappedSolAmountIn: aToB ? amount : ZERO },
        { tokenMint: whirlpoolData.tokenMintB, wrappedSolAmountIn: !aToB ? amount : ZERO },
      ],
      () => ctx.fetcher.getAccountRentExempt()
    );
    const { address: ataAKey, ...tokenOwnerAccountAIx } = resolvedAtaA;
    const { address: ataBKey, ...tokenOwnerAccountBIx } = resolvedAtaB;

    txBuilder.addInstruction(tokenOwnerAccountAIx);
    txBuilder.addInstruction(tokenOwnerAccountBIx);
    tokenOwnerAccountA = ataAKey;
    tokenOwnerAccountB = ataBKey;
  } else {
    const [inputTokenAssociatedAddress, outputTokenAssociatedAddress] = AddressUtil.toPubKeys([
      params.inputTokenAssociatedAddress,
      params.outputTokenAssociatedAddress,
    ]);
    tokenOwnerAccountA = aToB ? inputTokenAssociatedAddress : outputTokenAssociatedAddress;
    tokenOwnerAccountB = aToB ? outputTokenAssociatedAddress : inputTokenAssociatedAddress;
  }

  return txBuilder.addInstruction(
    swapIx(ctx.program, {
      isClientParams: true,
      ...params,
      inputTokenAssociatedAddress: aToB ? tokenOwnerAccountA : tokenOwnerAccountB,
      outputTokenAssociatedAddress: aToB ? tokenOwnerAccountB : tokenOwnerAccountA,
      tickArrayData,
    })
  );
}
