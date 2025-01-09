import type { AddressLookupTableAccount, PublicKey } from "@solana/web3.js";
import { PDAUtil, PoolUtil, PREFER_CACHE, toTx, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import type { WhirlpoolContext, WhirlpoolData } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import type { MintWithTokenProgram } from "@orca-so/common-sdk";
import { sendTransaction } from "../../../utils/transaction_sender";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { mergeTransactionBuilders } from "../../../utils/merge_transaction";
import type { PositionBundleOpenState, PositionBundleStateItem } from "./csv";
import type { PositionBundleStateDifference } from "./state_difference";
import type { QuotesToSync } from "./quote";

export async function sendTransactions(ctx: WhirlpoolContext, alts: AddressLookupTableAccount[], transactions: TransactionBuilder[], defaultPriorityFeeInLamports: number) {
  for (const tx of transactions) {
    const landed = await sendTransaction(tx, defaultPriorityFeeInLamports, alts);
    if (!landed) {
      throw new Error("transaction failed");
    }
  }
}

export async function buildTransactions(
  ctx: WhirlpoolContext,
  alts: AddressLookupTableAccount[],
  positionBundlePubkey: PublicKey,
  whirlpoolPubkey: PublicKey,
  difference: PositionBundleStateDifference,
  positionBundleTargetState: PositionBundleStateItem[],
  quotes: QuotesToSync,
): Promise<{
  withdrawTransactions: TransactionBuilder[];
  depositTransactions: TransactionBuilder[];
}> {
  const { quotesForDecrease, quotesForClose, quotesForOpen, quotesForIncrease } = quotes;

  const whirlpool = await ctx.fetcher.getPool(whirlpoolPubkey, PREFER_CACHE) as WhirlpoolData;
  const mintA = await ctx.fetcher.getMintInfo(whirlpool.tokenMintA, PREFER_CACHE) as MintWithTokenProgram;
  const mintB = await ctx.fetcher.getMintInfo(whirlpool.tokenMintB, PREFER_CACHE) as MintWithTokenProgram;

  const ataA = getAssociatedTokenAddressSync(whirlpool.tokenMintA, ctx.wallet.publicKey, true, mintA.tokenProgram);
  const ataB = getAssociatedTokenAddressSync(whirlpool.tokenMintB, ctx.wallet.publicKey, true, mintB.tokenProgram);
  const ataPositionBundle = getAssociatedTokenAddressSync(difference.positionBundle.positionBundleMint, ctx.wallet.publicKey, true, TOKEN_PROGRAM_ID);

  const baseParams = {
    positionAuthority: ctx.wallet.publicKey,
    positionTokenAccount: ataPositionBundle,
    tokenMintA: whirlpool.tokenMintA,
    tokenMintB: whirlpool.tokenMintB,
    tokenOwnerAccountA: ataA,
    tokenOwnerAccountB: ataB,
    tokenProgramA: mintA.tokenProgram,
    tokenProgramB: mintB.tokenProgram,
    tokenVaultA: whirlpool.tokenVaultA,
    tokenVaultB: whirlpool.tokenVaultB,
    whirlpool: whirlpoolPubkey,
  };

  const rewardParams = await Promise.all(whirlpool.rewardInfos.filter((rewardInfo) => PoolUtil.isRewardInitialized(rewardInfo)).map(async (rewardInfo) => {
    const mint = await ctx.fetcher.getMintInfo(rewardInfo.mint) as MintWithTokenProgram;
    const ata = getAssociatedTokenAddressSync(rewardInfo.mint, ctx.wallet.publicKey, true, mint.tokenProgram);
    return {
      mint,
      rewardInfo,
      ata,
    };
  }));

  const getBundledPositionPDA = (bundleIndex: number) => {
    return PDAUtil.getBundledPosition(ctx.program.programId, difference.positionBundle.positionBundleMint, bundleIndex);
  }
  const getBundledPositionPubkey = (bundleIndex: number) => {
    return getBundledPositionPDA(bundleIndex).publicKey;
  };
  const getTickArrayPubkey = (tickIndex: number) => {
    return PDAUtil.getTickArrayFromTickIndex(tickIndex, whirlpool.tickSpacing, whirlpoolPubkey, ctx.program.programId).publicKey;
  };

  const withdrawTransactions: TransactionBuilder[] = [];
  for (const { bundleIndex, decrease } of quotesForDecrease) {
    withdrawTransactions.push(toTx(ctx, WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
      ...baseParams,
      ...decrease,
      position: getBundledPositionPubkey(bundleIndex),
      tickArrayLower: getTickArrayPubkey(difference.bundledPositions[bundleIndex]!.tickLowerIndex),
      tickArrayUpper: getTickArrayPubkey(difference.bundledPositions[bundleIndex]!.tickUpperIndex),
    })));
  }
  for (const { bundleIndex, decrease } of quotesForClose) {
    const tx = new TransactionBuilder(ctx.connection, ctx.wallet);
    if (decrease) {
      tx.addInstruction(WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
        ...baseParams,
        ...decrease,
        position: getBundledPositionPubkey(bundleIndex),
        tickArrayLower: getTickArrayPubkey(difference.bundledPositions[bundleIndex]!.tickLowerIndex),
        tickArrayUpper: getTickArrayPubkey(difference.bundledPositions[bundleIndex]!.tickUpperIndex),
      }));
    }
    tx.addInstruction(WhirlpoolIx.collectFeesV2Ix(ctx.program, {
      ...baseParams,
      position: getBundledPositionPubkey(bundleIndex),
    }));

    rewardParams.forEach(({ mint, rewardInfo, ata }, rewardIndex) => {
      tx.addInstruction(WhirlpoolIx.collectRewardV2Ix(ctx.program, {
        ...baseParams,
        position: getBundledPositionPubkey(bundleIndex),
        rewardIndex,
        rewardMint: mint.address,
        rewardOwnerAccount: ata,
        rewardTokenProgram: mint.tokenProgram,
        rewardVault: rewardInfo.vault,
      }));
    });

    tx.addInstruction(WhirlpoolIx.closeBundledPositionIx(ctx.program, {
      bundleIndex,
      bundledPosition: getBundledPositionPubkey(bundleIndex),
      positionBundle: positionBundlePubkey,
      positionBundleAuthority: ctx.wallet.publicKey,
      positionBundleTokenAccount: ataPositionBundle,
      receiver: ctx.wallet.publicKey,
    }));

    withdrawTransactions.push(tx);
  }

  const depositTransactions: TransactionBuilder[] = [];
  for (const { bundleIndex, increase } of quotesForOpen) {
    const tx = new TransactionBuilder(ctx.connection, ctx.wallet);
    const targetState = positionBundleTargetState[bundleIndex] as PositionBundleOpenState;

    tx.addInstruction(WhirlpoolIx.openBundledPositionIx(ctx.program, {
      positionBundle: positionBundlePubkey,
      bundleIndex,
      bundledPositionPda: getBundledPositionPDA(bundleIndex),
      positionBundleAuthority: ctx.wallet.publicKey,
      funder: ctx.wallet.publicKey,
      positionBundleTokenAccount: ataPositionBundle,
      tickLowerIndex: targetState.lowerTickIndex,
      tickUpperIndex: targetState.upperTickIndex,
      whirlpool: whirlpoolPubkey,
    }));

    if (increase) {
      tx.addInstruction(WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
        ...baseParams,
        ...increase,
        position: getBundledPositionPubkey(bundleIndex),
        tickArrayLower: getTickArrayPubkey(targetState.lowerTickIndex),
        tickArrayUpper: getTickArrayPubkey(targetState.upperTickIndex),
      }));
    }

    depositTransactions.push(tx);
  }
  for (const { bundleIndex, increase } of quotesForIncrease) {
    const targetState = positionBundleTargetState[bundleIndex] as PositionBundleOpenState;
    depositTransactions.push(toTx(ctx, WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
      ...baseParams,
      ...increase,
      position: getBundledPositionPubkey(bundleIndex),
      tickArrayLower: getTickArrayPubkey(targetState.lowerTickIndex),
      tickArrayUpper: getTickArrayPubkey(targetState.upperTickIndex),
    })));
  }

  const mergedWithdrawTransactions = mergeTransactionBuilders(ctx, withdrawTransactions, alts);
  const mergedDepositTransactions = mergeTransactionBuilders(ctx, depositTransactions, alts);

  return {
    withdrawTransactions: mergedWithdrawTransactions,
    depositTransactions: mergedDepositTransactions
  };
}
