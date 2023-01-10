import {
  AddressUtil,
  deriveATA,
  resolveOrCreateATAs,
  TransactionBuilder,
  ZERO,
} from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";
import { WhirlpoolContext, WhirlpoolData } from "../..";
import { PDAUtil, TickArrayUtil } from "../../utils/public";
import { SwapInput, swapIx } from "../swap-ix";

/**
 * Parameters to build a swap transaction.
 *
 * @param poolAddress - The public key for the Whirlpool to swap on
 * @param whirlpool - A {@link WhirlpoolData} on-chain data object for the pool
 * @param input - A quote on the desired tokenIn and tokenOut for this swap. Use {@link swapQuoteWithParams} or other swap quote functions to generate this object.
 * @param wallet - The wallet that tokens will be withdrawn and deposit into.
 * @param resolveAssociatedTokenAccounts - If true, function will automatically resolve and create token ATA to receive tokens.
 * @param tokenAAssociatedAddress - If resolveAssociatedTokenAccounts is false, provide the ATA for tokenA
 * @param tokenBAssociatedAddress - If resolveAssociatedTokenAccounts is false, provide the ATA for tokenB
 */
export type SwapBuilderParams = SwapBuilderParamsWithATA | SwapBuilderParamsWithResolveATA;

type SwapBuilderParamsWithResolveATA = {
  resolveAssociatedTokenAccounts: true;
} & SwapBuilderParamsBase;

type SwapBuilderParamsWithATA = {
  resolveAssociatedTokenAccounts: false;
  tokenAAssociatedAddress: Address;
  tokenBAssociatedAddress: Address;
} & SwapBuilderParamsBase;

type SwapBuilderParamsBase = {
  poolAddress: Address;
  whirlpool: WhirlpoolData;
  input: SwapInput;
  wallet: PublicKey;
};

export async function swap(
  ctx: WhirlpoolContext,
  params: SwapBuilderParams
): Promise<TransactionBuilder> {
  const { poolAddress, whirlpool, input, wallet } = params;
  const addressKey = AddressUtil.toPubKey(poolAddress);
  invariant(input.amount.gt(ZERO), "swap amount must be more than zero.");

  // Check if all the tick arrays have been initialized.
  const tickArrayAddresses = [input.tickArray0, input.tickArray1, input.tickArray2];
  const tickArrays = await ctx.fetcher.listTickArrays(tickArrayAddresses, true);
  const uninitializedIndices = TickArrayUtil.getUninitializedArrays(tickArrays);
  if (uninitializedIndices.length > 0) {
    const uninitializedArrays = uninitializedIndices
      .map((index) => tickArrayAddresses[index].toBase58())
      .join(", ");
    throw new Error(`TickArray addresses - [${uninitializedArrays}] need to be initialized.`);
  }

  const { amount, aToB } = input;
  const txBuilder = new TransactionBuilder(ctx.provider.connection, ctx.provider.wallet);

  let tokenOwnerAccountA: PublicKey, tokenOwnerAccountB: PublicKey;
  if (params.resolveAssociatedTokenAccounts) {
    const [resolvedAtaA, resolvedAtaB] = await resolveOrCreateATAs(
      ctx.connection,
      wallet,
      [
        { tokenMint: whirlpool.tokenMintA, wrappedSolAmountIn: aToB ? amount : ZERO },
        { tokenMint: whirlpool.tokenMintB, wrappedSolAmountIn: !aToB ? amount : ZERO },
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
    tokenOwnerAccountA = await deriveATA(wallet, whirlpool.tokenMintA);
    tokenOwnerAccountB = await deriveATA(wallet, whirlpool.tokenMintB);
  }

  const oraclePda = PDAUtil.getOracle(ctx.program.programId, addressKey);

  txBuilder.addInstruction(
    swapIx(ctx.program, {
      ...input,
      whirlpool: addressKey,
      tokenAuthority: wallet,
      tokenOwnerAccountA,
      tokenVaultA: whirlpool.tokenVaultA,
      tokenOwnerAccountB,
      tokenVaultB: whirlpool.tokenVaultB,
      oracle: oraclePda.publicKey,
    })
  );

  return txBuilder;
}
