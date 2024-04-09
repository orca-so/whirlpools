import { Address } from "@coral-xyz/anchor";
import {
  Instruction,
  ResolvedTokenAddressInstruction,
  TokenUtil,
  TransactionBuilder,
  ZERO,
  resolveOrCreateATAs,
} from "@orca-so/common-sdk";
import { NATIVE_MINT, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { PositionData, WhirlpoolContext } from "../..";
import { WhirlpoolIx } from "../../ix";
import { PREFER_CACHE, WhirlpoolAccountFetchOptions } from "../../network/public/fetcher";
import { WhirlpoolData } from "../../types/public";
import { PDAUtil, PoolUtil, TickUtil } from "../../utils/public";
import { checkMergedTransactionSizeIsValid, convertListToMap } from "../../utils/txn-utils";
import { getTokenMintsFromWhirlpools } from "../../utils/whirlpool-ata-utils";
import { updateFeesAndRewardsIx } from "../update-fees-and-rewards-ix";
import { TokenExtensionUtil } from "../../utils/public/token-extension-util";

/**
 * Parameters to collect all fees and rewards from a list of positions.
 *
 * @category Instruction Types
 * @param positionAddrs - An array of Whirlpool position addresses.
 * @param receiver - The destination wallet that collected fees & reward will be sent to. Defaults to ctx.wallet key.
 * @param positionOwner - The wallet key that contains the position token. Defaults to ctx.wallet key.
 * @param positionAuthority - The authority key that can authorize operation on the position. Defaults to ctx.wallet key.
 * @param payer - The key that will pay for the initialization of ATA token accounts. Defaults to ctx.wallet key.
 */
export type CollectAllPositionAddressParams = {
  positions: Address[];
} & CollectAllParams;

/**
 * Parameters to collect all fees and rewards from a list of positions.
 *
 * @category Instruction Types
 * @param positions - An array of Whirlpool positions.
 * @param receiver - The destination wallet that collected fees & reward will be sent to. Defaults to ctx.wallet key.
 * @param positionOwner - The wallet key that contains the position token. Defaults to ctx.wallet key.
 * @param positionAuthority - The authority key that can authorize operation on the position. Defaults to ctx.wallet key.
 * @param payer - The key that will pay for the initialization of ATA token accounts. Defaults to ctx.wallet key.
 */
export type CollectAllPositionParams = {
  positions: Record<string, PositionData>;
} & CollectAllParams;

/**
 * Common parameters between {@link CollectAllPositionParams} & {@link CollectAllPositionAddressParams}
 *
 * @category Instruction Types
 * @param receiver - The destination wallet that collected fees & reward will be sent to. Defaults to ctx.wallet key.
 * @param positionOwner - The wallet key that contains the position token. Defaults to ctx.wallet key.
 * @param positionAuthority - The authority key that can authorize operation on the position. Defaults to ctx.wallet key.
 * @param payer - The key that will pay for the initialization of ATA token accounts. Defaults to ctx.wallet key.
 */
export type CollectAllParams = {
  receiver?: PublicKey;
  positionOwner?: PublicKey;
  positionAuthority?: PublicKey;
  payer?: PublicKey;
};

/**
 * Build a set of transactions to collect fees and rewards for a set of Whirlpool Positions.
 *
 * @category Instructions
 * @experimental
 * @param ctx - WhirlpoolContext object for the current environment.
 * @param params - CollectAllPositionAddressParams object
 * @param opts an {@link WhirlpoolAccountFetchOptions} object to define fetch and cache options when accessing on-chain accounts
 * @returns A set of transaction-builders to resolve ATA for affliated tokens, collect fee & rewards for all positions.
 */
export async function collectAllForPositionAddressesTxns(
  ctx: WhirlpoolContext,
  params: CollectAllPositionAddressParams,
  opts: WhirlpoolAccountFetchOptions = PREFER_CACHE
): Promise<TransactionBuilder[]> {
  const { positions, ...rest } = params;
  const fetchedPositions = await ctx.fetcher.getPositions(positions, opts);

  const positionMap: Record<string, PositionData> = {};
  fetchedPositions.forEach((pos, addr) => {
    if (pos) {
      positionMap[addr] = pos;
    }
  });

  return collectAllForPositionsTxns(ctx, { positions: positionMap, ...rest });
}

/**
 * Build a set of transactions to collect fees and rewards for a set of Whirlpool Positions.
 *
 * @experimental
 * @param ctx - WhirlpoolContext object for the current environment.
 * @param params - CollectAllPositionParams object
 * @returns A set of transaction-builders to resolve ATA for affliated tokens, collect fee & rewards for all positions.
 */
export async function collectAllForPositionsTxns(
  ctx: WhirlpoolContext,
  params: CollectAllPositionParams
): Promise<TransactionBuilder[]> {
  const { positions, receiver, positionAuthority, positionOwner, payer } = params;
  const receiverKey = receiver ?? ctx.wallet.publicKey;
  const positionAuthorityKey = positionAuthority ?? ctx.wallet.publicKey;
  const positionOwnerKey = positionOwner ?? ctx.wallet.publicKey;
  const payerKey = payer ?? ctx.wallet.publicKey;
  const positionList = Object.entries(positions);

  if (positionList.length === 0) {
    return [];
  }

  const whirlpoolAddrs = positionList.map(([, pos]) => pos.whirlpool.toBase58());
  const whirlpools = await ctx.fetcher.getPools(whirlpoolAddrs, PREFER_CACHE);

  const allMints = getTokenMintsFromWhirlpools(Array.from(whirlpools.values()));
  const accountExemption = await ctx.fetcher.getAccountRentExempt();

  // make cache
  await ctx.fetcher.getMintInfos(allMints.mintMap);

  // resolvedAtas[mint] => Instruction & { address }
  // if already ATA exists, Instruction will be EMPTY_INSTRUCTION
  const resolvedAtas = convertListToMap(
    await resolveOrCreateATAs(
      ctx.connection,
      receiverKey,
      allMints.mintMap.map((tokenMint) => ({ tokenMint })),
      async () => accountExemption,
      payerKey,
      true, // CreateIdempotent
      ctx.accountResolverOpts.allowPDAOwnerAddress,
      ctx.accountResolverOpts.createWrappedSolAccountMethod
    ),
    allMints.mintMap.map((mint) => mint.toBase58())
  );

  const latestBlockhash = await ctx.connection.getLatestBlockhash();
  const txBuilders: TransactionBuilder[] = [];

  // build tasks
  // For TokenProgram-TokenProgram pair pool, collectFees and 3 collectReward instructions can be packed into one transaction.
  // But if pool has TokenExtension, especially TransferHook, we can no longer pack all instructions into one transaction.
  // So transactions need to be broken up at a finer granularity.
  const collectionTasks: CollectionTask[] = [];
  positionList.forEach(([positionAddr, position]) => {
    const whirlpool = whirlpools.get(position.whirlpool.toBase58());
    if (!whirlpool) {
      throw new Error(
        `Unable to process positionMint ${position.positionMint.toBase58()} - unable to derive whirlpool ${position.whirlpool.toBase58()}`
      );
    }

    // add fee collection task
    collectionTasks.push({
      collectionType: "fee",
      positionAddr,
      position,
      whirlpool,
    });

    // add reward collection task
    whirlpool.rewardInfos.forEach((rewardInfo, index) => {
      if (PoolUtil.isRewardInitialized(rewardInfo)) {
        collectionTasks.push({
          collectionType: "reward",
          rewardIndex: index,
          positionAddr,
          position,
          whirlpool,
        });
      }
    })
  });

  let cursor = 0;
  let pendingTxBuilder = null;
  let touchedMints = null;
  let lastUpdatedPosition = null;
  let reattempt = false;
  while (cursor < collectionTasks.length) {
    if (!pendingTxBuilder || !touchedMints) {
      pendingTxBuilder = new TransactionBuilder(ctx.connection, ctx.wallet, ctx.txBuilderOpts);
      touchedMints = new Set<string>();
      resolvedAtas[NATIVE_MINT.toBase58()] = TokenUtil.createWrappedNativeAccountInstruction(
        receiverKey,
        ZERO,
        accountExemption,
        undefined, // use default
        undefined, // use default
        ctx.accountResolverOpts.createWrappedSolAccountMethod
      );
    }

    // Build collect instructions
    const task = collectionTasks[cursor];
    const alreadyUpdated = lastUpdatedPosition === task.positionAddr;
    const collectIxForPosition = await constructCollectIxForPosition(
      ctx,
      task,
      alreadyUpdated,
      positionOwnerKey,
      positionAuthorityKey,
      resolvedAtas,
      touchedMints
    );
    const positionTxBuilder = new TransactionBuilder(ctx.connection, ctx.wallet, ctx.txBuilderOpts);
    positionTxBuilder.addInstructions(collectIxForPosition);

    // Attempt to push the new instructions into the pending builder
    // Iterate to the next task if possible
    // Create a builder and reattempt if the current one is full.
    const mergeable = await checkMergedTransactionSizeIsValid(
      ctx,
      [pendingTxBuilder, positionTxBuilder],
      latestBlockhash
    );
    if (mergeable) {
      pendingTxBuilder.addInstruction(positionTxBuilder.compressIx(false));
      cursor += 1;
      lastUpdatedPosition = task.positionAddr;
      reattempt = false;
    } else {
      if (reattempt) {
        throw new Error(
          `Unable to fit collection ix for ${task.position.positionMint.toBase58()} in a Transaction.`
        );
      }

      txBuilders.push(pendingTxBuilder);
      pendingTxBuilder = null;
      touchedMints = null;
      lastUpdatedPosition = null;
      reattempt = true;
    }
  }

  if (pendingTxBuilder) {
    txBuilders.push(pendingTxBuilder);
  }
  return txBuilders;
}

type CollectionTask = FeeCollectionTask | RewardCollectionTask;
type FeeCollectionTask = {
  collectionType: "fee";
} & CollectionTaskBase;
type RewardCollectionTask = {
  collectionType: "reward";
  rewardIndex: number;
} & CollectionTaskBase;
type CollectionTaskBase = {
  positionAddr: string;
  position: PositionData;
  whirlpool: WhirlpoolData;
};

// TODO: Once individual collect ix for positions is implemented, maybe migrate over if it can take custom ATA?
const constructCollectIxForPosition = async (
  ctx: WhirlpoolContext,
  task: CollectionTask,
  alreadyUpdated: boolean,
  positionOwner: PublicKey,
  positionAuthority: PublicKey,
  resolvedAtas: Record<string, ResolvedTokenAddressInstruction>,
  touchedMints: Set<string>,
) => {
  const ixForPosition: Instruction[] = [];
  const {
    whirlpool: whirlpoolKey,
    liquidity,
    tickLowerIndex,
    tickUpperIndex,
    positionMint,
    rewardInfos: positionRewardInfos,
  } = task.position;

  const whirlpool = task.whirlpool;
  const { tickSpacing } = whirlpool;
  const mintA = whirlpool.tokenMintA.toBase58();
  const mintB = whirlpool.tokenMintB.toBase58();

  const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(
    ctx.fetcher,
    whirlpool,
    PREFER_CACHE,
  );

  const positionTokenAccount = getAssociatedTokenAddressSync(
    positionMint,
    positionOwner,
    ctx.accountResolverOpts.allowPDAOwnerAddress
  );

  // Update fee and reward values if necessary
  if (!liquidity.eq(ZERO) && !alreadyUpdated) {
    ixForPosition.push(
      updateFeesAndRewardsIx(ctx.program, {
        position: new PublicKey(task.positionAddr),
        whirlpool: whirlpoolKey,
        tickArrayLower: PDAUtil.getTickArray(
          ctx.program.programId,
          whirlpoolKey,
          TickUtil.getStartTickIndex(tickLowerIndex, tickSpacing)
        ).publicKey,
        tickArrayUpper: PDAUtil.getTickArray(
          ctx.program.programId,
          whirlpoolKey,
          TickUtil.getStartTickIndex(tickUpperIndex, tickSpacing)
        ).publicKey,
      })
    );
  }

  if (task.collectionType === "fee") {
    // Collect Fee

    if (!touchedMints.has(mintA)) {
      ixForPosition.push(resolvedAtas[mintA]);
      touchedMints.add(mintA);
    }
    if (!touchedMints.has(mintB)) {
      ixForPosition.push(resolvedAtas[mintB]);
      touchedMints.add(mintB);
    }
    const collectFeesBaseParams = {
      whirlpool: whirlpoolKey,
      position: new PublicKey(task.positionAddr),
      positionAuthority,
      positionTokenAccount,
      tokenOwnerAccountA: resolvedAtas[mintA].address,
      tokenOwnerAccountB: resolvedAtas[mintB].address,
      tokenVaultA: whirlpool.tokenVaultA,
      tokenVaultB: whirlpool.tokenVaultB,
    };
    ixForPosition.push(
      !TokenExtensionUtil.isV2IxRequiredPool(tokenExtensionCtx)
        ? WhirlpoolIx.collectFeesIx(ctx.program, collectFeesBaseParams)
        : WhirlpoolIx.collectFeesV2Ix(ctx.program, {
          ...collectFeesBaseParams,
          tokenMintA: tokenExtensionCtx.tokenMintWithProgramA.address,
          tokenMintB: tokenExtensionCtx.tokenMintWithProgramB.address,
          tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
          tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
          tokenTransferHookAccountsA: await TokenExtensionUtil.getExtraAccountMetasForTransferHook(
            ctx.connection,
            tokenExtensionCtx.tokenMintWithProgramA,
            collectFeesBaseParams.tokenVaultA,
            collectFeesBaseParams.tokenOwnerAccountA,
            collectFeesBaseParams.whirlpool, // vault to owner, so pool is authority
          ),
          tokenTransferHookAccountsB: await TokenExtensionUtil.getExtraAccountMetasForTransferHook(
            ctx.connection,
            tokenExtensionCtx.tokenMintWithProgramB,
            collectFeesBaseParams.tokenVaultB,
            collectFeesBaseParams.tokenOwnerAccountB,
            collectFeesBaseParams.whirlpool, // vault to owner, so pool is authority
          ),
        })
    );
  } else {
    // Collect Rewards

    // TODO: handle empty vault values?
    const index = task.rewardIndex;
    const rewardInfo = whirlpool.rewardInfos[index];

    const mintReward = rewardInfo.mint.toBase58();
    if (!touchedMints.has(mintReward)) {
      ixForPosition.push(resolvedAtas[mintReward]);
      touchedMints.add(mintReward);
    }
    const collectRewardBaseParams = {
      whirlpool: whirlpoolKey,
      position: new PublicKey(task.positionAddr),
      positionAuthority,
      positionTokenAccount,
      rewardIndex: index,
      rewardOwnerAccount: resolvedAtas[mintReward].address,
      rewardVault: rewardInfo.vault,
    };
    ixForPosition.push(
      !TokenExtensionUtil.isV2IxRequiredReward(tokenExtensionCtx, index)
        ? WhirlpoolIx.collectRewardIx(ctx.program, collectRewardBaseParams)
        : WhirlpoolIx.collectRewardV2Ix(ctx.program, {
          ...collectRewardBaseParams,
          rewardMint: tokenExtensionCtx.rewardTokenMintsWithProgram[index]!.address,
          rewardTokenProgram: tokenExtensionCtx.rewardTokenMintsWithProgram[index]!.tokenProgram,
          rewardTransferHookAccounts: await TokenExtensionUtil.getExtraAccountMetasForTransferHook(
            ctx.connection,
            tokenExtensionCtx.rewardTokenMintsWithProgram[index]!,
            collectRewardBaseParams.rewardVault,
            collectRewardBaseParams.rewardOwnerAccount,
            collectRewardBaseParams.whirlpool, // vault to owner, so pool is authority
          ),
        })
    );
  }

  return ixForPosition;
};
