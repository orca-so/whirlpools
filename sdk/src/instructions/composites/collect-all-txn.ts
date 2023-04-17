import { Address } from "@coral-xyz/anchor";
import { Instruction, resolveOrCreateATAs, TransactionBuilder, ZERO } from "@orca-so/common-sdk";
import { ResolvedTokenAddressInstruction } from "@orca-so/common-sdk/dist/helpers/token-instructions";
import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { PositionData, WhirlpoolContext } from "../..";
import { WhirlpoolIx } from "../../ix";
import { WhirlpoolData } from "../../types/public";
import { PDAUtil, PoolUtil, TickUtil } from "../../utils/public";
import {
  createWSOLAccountInstructions,
  getAssociatedTokenAddressSync,
} from "../../utils/spl-token-utils";
import { checkMergedTransactionSizeIsValid, convertListToMap } from "../../utils/txn-utils";
import { getTokenMintsFromWhirlpools } from "../../utils/whirlpool-ata-utils";
import { updateFeesAndRewardsIx } from "../update-fees-and-rewards-ix";

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
 * @param refresh - if true, will always fetch for the latest on-chain data.
 * @returns A set of transaction-builders to resolve ATA for affliated tokens, collect fee & rewards for all positions.
 */
export async function collectAllForPositionAddressesTxns(
  ctx: WhirlpoolContext,
  params: CollectAllPositionAddressParams,
  refresh = false
): Promise<TransactionBuilder[]> {
  const { positions, ...rest } = params;
  const posData = convertListToMap(
    await ctx.fetcher.listPositions(positions, refresh),
    positions.map((pos) => pos.toString())
  );
  const positionMap: Record<string, PositionData> = {};
  Object.entries(posData).forEach(([addr, pos]) => {
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
  const whirlpoolDatas = await ctx.fetcher.listPools(whirlpoolAddrs, false);
  const whirlpools = convertListToMap(whirlpoolDatas, whirlpoolAddrs);

  const allMints = getTokenMintsFromWhirlpools(whirlpoolDatas);
  const accountExemption = await ctx.fetcher.getAccountRentExempt();

  // resolvedAtas[mint] => Instruction & { address }
  // if already ATA exists, Instruction will be EMPTY_INSTRUCTION
  const resolvedAtas = convertListToMap(
    await resolveOrCreateATAs(
      ctx.connection,
      receiverKey,
      allMints.mintMap.map((tokenMint) => ({ tokenMint })),
      async () => accountExemption,
      payerKey,
      true // CreateIdempotent
    ),
    allMints.mintMap.map((mint) => mint.toBase58())
  );

  const latestBlockhash = await ctx.connection.getLatestBlockhash();
  const txBuilders: TransactionBuilder[] = [];

  let posIndex = 0;
  let pendingTxBuilder = null;
  let touchedMints = null;
  let reattempt = false;
  while (posIndex < positionList.length) {
    if (!pendingTxBuilder || !touchedMints) {
      pendingTxBuilder = new TransactionBuilder(ctx.connection, ctx.wallet, ctx.txBuilderOpts);
      touchedMints = new Set<string>();
      resolvedAtas[NATIVE_MINT.toBase58()] = createWSOLAccountInstructions(
        receiverKey,
        ZERO,
        accountExemption
      );
    }

    // Build collect instructions
    const [positionAddr, position] = positionList[posIndex];
    const collectIxForPosition = constructCollectIxForPosition(
      ctx,
      new PublicKey(positionAddr),
      position,
      whirlpools,
      positionOwnerKey,
      positionAuthorityKey,
      resolvedAtas,
      touchedMints
    );
    const positionTxBuilder = new TransactionBuilder(ctx.connection, ctx.wallet, ctx.txBuilderOpts);
    positionTxBuilder.addInstructions(collectIxForPosition);

    // Attempt to push the new instructions into the pending builder
    // Iterate to the next position if possible
    // Create a builder and reattempt if the current one is full.
    const mergeable = await checkMergedTransactionSizeIsValid(
      ctx,
      [pendingTxBuilder, positionTxBuilder],
      latestBlockhash
    );
    if (mergeable) {
      pendingTxBuilder.addInstruction(positionTxBuilder.compressIx(false));
      posIndex += 1;
      reattempt = false;
    } else {
      if (reattempt) {
        throw new Error(
          `Unable to fit collection ix for ${position.positionMint.toBase58()} in a Transaction.`
        );
      }

      txBuilders.push(pendingTxBuilder);
      pendingTxBuilder = null;
      touchedMints = null;
      reattempt = true;
    }
  }

  if (pendingTxBuilder) {
    txBuilders.push(pendingTxBuilder);
  }
  return txBuilders;
}

// TODO: Once individual collect ix for positions is implemented, maybe migrate over if it can take custom ATA?
const constructCollectIxForPosition = (
  ctx: WhirlpoolContext,
  positionKey: PublicKey,
  position: PositionData,
  whirlpools: Record<string, WhirlpoolData | null>,
  positionOwner: PublicKey,
  positionAuthority: PublicKey,
  resolvedAtas: Record<string, ResolvedTokenAddressInstruction>,
  touchedMints: Set<string>
) => {
  const ixForPosition: Instruction[] = [];
  const {
    whirlpool: whirlpoolKey,
    liquidity,
    tickLowerIndex,
    tickUpperIndex,
    positionMint,
    rewardInfos: positionRewardInfos,
  } = position;

  const whirlpool = whirlpools[whirlpoolKey.toBase58()];
  if (!whirlpool) {
    throw new Error(
      `Unable to process positionMint ${positionMint} - unable to derive whirlpool ${whirlpoolKey.toBase58()}`
    );
  }
  const { tickSpacing } = whirlpool;
  const mintA = whirlpool.tokenMintA.toBase58();
  const mintB = whirlpool.tokenMintB.toBase58();

  const positionTokenAccount = getAssociatedTokenAddressSync(
    positionMint.toBase58(),
    positionOwner.toBase58()
  );

  // Update fee and reward values if necessary
  if (!liquidity.eq(ZERO)) {
    ixForPosition.push(
      updateFeesAndRewardsIx(ctx.program, {
        position: positionKey,
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

  // Collect Fee
  if (!touchedMints.has(mintA)) {
    ixForPosition.push(resolvedAtas[mintA]);
    touchedMints.add(mintA);
  }
  if (!touchedMints.has(mintB)) {
    ixForPosition.push(resolvedAtas[mintB]);
    touchedMints.add(mintB);
  }
  ixForPosition.push(
    WhirlpoolIx.collectFeesIx(ctx.program, {
      whirlpool: whirlpoolKey,
      position: positionKey,
      positionAuthority,
      positionTokenAccount,
      tokenOwnerAccountA: resolvedAtas[mintA].address,
      tokenOwnerAccountB: resolvedAtas[mintB].address,
      tokenVaultA: whirlpool.tokenVaultA,
      tokenVaultB: whirlpool.tokenVaultB,
    })
  );

  // Collect Rewards
  // TODO: handle empty vault values?
  positionRewardInfos.forEach((_, index) => {
    const rewardInfo = whirlpool.rewardInfos[index];
    if (PoolUtil.isRewardInitialized(rewardInfo)) {
      const mintReward = rewardInfo.mint.toBase58();
      if (!touchedMints.has(mintReward)) {
        ixForPosition.push(resolvedAtas[mintReward]);
        touchedMints.add(mintReward);
      }
      ixForPosition.push(
        WhirlpoolIx.collectRewardIx(ctx.program, {
          whirlpool: whirlpoolKey,
          position: positionKey,
          positionAuthority,
          positionTokenAccount,
          rewardIndex: index,
          rewardOwnerAccount: resolvedAtas[mintReward].address,
          rewardVault: rewardInfo.vault,
        })
      );
    }
  });

  return ixForPosition;
};
