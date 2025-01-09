import { AddressLookupTableAccount, ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import { collectFeesQuote, CollectFeesQuote, collectRewardsQuote, CollectRewardsQuote, DecreaseLiquidityQuote, decreaseLiquidityQuoteByLiquidityWithParams, IGNORE_CACHE, IncreaseLiquidityQuote, IncreaseLiquidityQuoteByLiquidityParam, increaseLiquidityQuoteByLiquidityWithParams, MAX_TICK_INDEX, MIN_TICK_INDEX, NO_TOKEN_EXTENSION_CONTEXT, PDAUtil, PoolUtil, POSITION_BUNDLE_SIZE, PositionBundleData, PositionBundleUtil, PositionData, PREFER_CACHE, TickArrayData, TickArrayUtil, TickUtil, TokenExtensionUtil, toTx, WhirlpoolContext, WhirlpoolData, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { DecimalUtil, MEASUREMENT_BLOCKHASH, MintWithTokenProgram, Percentage, TransactionBuilder } from "@orca-so/common-sdk";
import { sendTransaction } from "../../utils/transaction_sender";
import { ctx } from "../../utils/provider";
import { promptConfirm, promptText } from "../../utils/prompt";
import { readFileSync } from "fs";
import BN from "bn.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { adjustForSlippage } from "@orca-so/whirlpools-sdk/dist/utils/position-util";
import Decimal from "decimal.js";

async function main() {
  console.info("sync PositionBundle state...");

  // prompt
  console.warn("using test values");
  const positionBundlePubkeyStr = "qHbk42b2ub8K6Rw6p7t1aUoJpwGZ6xpzDC75CQ4QgPD";
  //const positionBundlePubkeyStr = await promptText("positionBundlePubkey");
  const positionBundlePubkey = new PublicKey(positionBundlePubkeyStr);
  const whirlpoolPubkeyStr = "95XaJMqCLiWtUwF9DtSvDpDbPYhEHoVyCeeNwmUD7cwr";
  //const whirlpoolPubkeyStr = await promptText("whirlpoolPubkey");
  const whirlpoolPubkey = new PublicKey(whirlpoolPubkeyStr);
  const positionBundleTargetStateCsvPath = "position_bundle_target_state_close.csv";
  //const positionBundleTargetStateCsvPath = await promptText("positionBundleTargetStateCsvPath");

  const commaSeparatedAltPubkeyStrs = "7Vyx1y8vG9e9Q1MedmXpopRC6ZhVaZzGcvYh5Z3Cs75i , AnXmyHSfuAaWkCxaUuTW39SN5H5ztH8bBxm647uESgTd, FjTZwDecYM3G66VKFuAaLgw3rY1QitziKdM5Ng4EpoKd";
  //const commaSeparatedAltPubkeyStrs = await promptText("commaSeparatedAltPubkeys");
  const altPubkeyStrs = commaSeparatedAltPubkeyStrs.split(",").map((str) => str.trim()).filter((str) => str.length > 0);
  const altPubkeys = altPubkeyStrs.map((str) => new PublicKey(str));

  console.info("check positionBundle...");
  const positionBundle = await ctx.fetcher.getPositionBundle(positionBundlePubkey, IGNORE_CACHE);
  if (!positionBundle) {
    throw new Error("positionBundle not found");
  }
  console.info("check whirlpool...");
  const whirlpool = await ctx.fetcher.getPool(whirlpoolPubkey, IGNORE_CACHE);
  if (!whirlpool) {
    throw new Error("whirlpool not found");
  }
  const alts: AddressLookupTableAccount[] = [];
  if (altPubkeys.length > 0) {
    console.info("check ALTs...");
    for (const altPubkey of altPubkeys) {
      const res = await ctx.connection.getAddressLookupTable(altPubkey);
      if (!res || !res.value) {
        throw new Error(`altAddress not found: ${altPubkey.toBase58()}`);
      } else {
        console.info(`    loaded ALT ${altPubkey.toBase58()}, ${res.value.state.addresses.length} entries`);
      }
      alts.push(res.value);
    }  
  }

  // read position bundle target state
  console.info("read position bundle target state...");
  const positionBundleTargetState = readPositionBundleStateCsv(positionBundleTargetStateCsvPath, whirlpool.tickSpacing);

  // ensure that all required TickArrays are initialized
  console.info("check if required TickArrays are initialized...");
  await checkTickArrayInitialization(ctx, whirlpoolPubkey, positionBundleTargetState);

  // ensure that all required ATA are initialized
  console.info("check if required ATAs are initialized...");
  await checkATAInitialization(ctx, whirlpool);

  const { toDecimalAmountA, toDecimalAmountB, toDecimalAmountReward } = await getToDecimalAmountFunctions(ctx, whirlpool);

  let firstIteration = true;
  while (true) {
    console.info("check position bundle state difference...");
    const difference = await checkPositionBundleStateDifference(
      ctx,
      positionBundlePubkey,
      whirlpoolPubkey,
      positionBundleTargetState,
    );

    if (difference.noDifference.length === POSITION_BUNDLE_SIZE) {
      console.info("synced");
      break;
    }

    if (!firstIteration) {
      console.warn("There are still differences between the current state and the target state (some transaction may have failed)");
    }

    // TODO: prompt
    const slippage = Percentage.fromFraction(1, 100); // 1%
    const quotes = await generateQuotesToSync(ctx, whirlpoolPubkey, positionBundleTargetState, difference, slippage);
    const balanceDifference = calculateBalanceDifference(quotes);

    const { tokenABalance, tokenBBalance } = await getWalletATABalance(ctx, whirlpool);

    console.info("building transactions...");
    const transactions = await buildTransactions(ctx, alts, positionBundlePubkey, whirlpoolPubkey, difference, positionBundleTargetState, quotes);

    console.info([
      "\n📝 ACTION SUMMARY\n",
      "\n",
      `Pool: ${whirlpoolPubkey.toBase58()}\n`,
      `PositionBundle: ${positionBundlePubkey.toBase58()}\n`,
      "\n",
      "Position state changes:\n",
      "\n",
      `    close position:     ${difference.shouldBeClosed.length.toString().padStart(3, " ")} position(s)\n`,
      `    open  position:     ${difference.shouldBeOpened.length.toString().padStart(3, " ")} position(s)\n`,
      `    withdraw liquidity: ${difference.shouldBeDecreased.length.toString().padStart(3, " ")} position(s)\n`,
      `    deposit  liquidity: ${difference.shouldBeIncreased.length.toString().padStart(3, " ")} position(s)\n`,
      "\n",
      "Balance changes:\n",
      "\n",
      `    slippage: ${slippage.toDecimal().mul(100).toString()} %\n`,
      "\n",
      `    tokenA withdrawn (est): ${toDecimalAmountA(balanceDifference.tokenAWithdrawnEst)}\n`,
      `    tokenB withdrawn (est): ${toDecimalAmountB(balanceDifference.tokenBWithdrawnEst)}\n`,
      `    tokenA withdrawn (min): ${toDecimalAmountA(balanceDifference.tokenAWithdrawnMin)}\n`,
      `    tokenB withdrawn (min): ${toDecimalAmountB(balanceDifference.tokenBWithdrawnMin)}\n`,
      `    tokenA collected:       ${toDecimalAmountA(balanceDifference.tokenACollected)}\n`,
      `    tokenB collected:       ${toDecimalAmountB(balanceDifference.tokenBCollected)}\n`,
      `    rewards collected:      ${balanceDifference.rewardsCollected.map((reward, i) => reward ? toDecimalAmountReward(reward, i).toString() : "no reward").join(", ")}\n`,
      `    tokenA deposited (est): ${toDecimalAmountA(balanceDifference.tokenADepositedEst)}\n`,
      `    tokenB deposited (est): ${toDecimalAmountB(balanceDifference.tokenBDepositedEst)}\n`,
      `    tokenA deposited (max): ${toDecimalAmountA(balanceDifference.tokenADepositedMax)}\n`,
      `    tokenB deposited (max): ${toDecimalAmountB(balanceDifference.tokenBDepositedMax)}\n`,
      "\n",
      `    tokenA balance delta (est): ${toDecimalAmountA(balanceDifference.tokenABalanceDeltaEst)}\n`,
      `    tokenB balance delta (est): ${toDecimalAmountB(balanceDifference.tokenBBalanceDeltaEst)}\n`,
      "\n",
      "    * negative balance delta means deposited more than withdrawn\n",
      "\n",
      "Wallet balances:\n",
      "\n",
      `    tokenA: ${toDecimalAmountA(tokenABalance)}\n`,
      `    tokenB: ${toDecimalAmountB(tokenBBalance)}\n`,
      "\n",
      "Transactions:\n",
      "\n",
      `    withdraw: ${transactions.withdrawTransactions.length} transaction(s)\n`,
      `    deposit:  ${transactions.depositTransactions.length} transaction(s)\n`,
    ].join(""));

    if (balanceDifference.tokenABalanceDeltaEst.isNeg() && balanceDifference.tokenABalanceDeltaEst.abs().gt(tokenABalance)) {
      console.warn("WARNING: tokenA balance delta exceeds the wallet balance, some deposits may fail\n");
    }
    if (balanceDifference.tokenBBalanceDeltaEst.isNeg() && balanceDifference.tokenBBalanceDeltaEst.abs().gt(tokenBBalance)) {
      console.warn("WARNING: tokenB balance delta exceeds the wallet balance, some deposits may fail\n");
    }

    // prompt for confirmation
    const confirmed = await promptConfirm("proceed?");
    if (!confirmed) {
      console.info("canceled");
      break;
    }

    // TODO: prompt for priority fee
    const defaultPriorityFeeInLamports = 10_000; // 0.00001 SOL
    await sendTransactions(ctx, alts, transactions.withdrawTransactions, defaultPriorityFeeInLamports);
    await sendTransactions(ctx, alts, transactions.depositTransactions, defaultPriorityFeeInLamports);

    firstIteration = false;
  }
}

main();

////////////////////////////////////////////////////////////////////////////////

async function sendTransactions(ctx: WhirlpoolContext, alts: AddressLookupTableAccount[], transactions: TransactionBuilder[], defaultPriorityFeeInLamports: number) {
  for (const tx of transactions) {
    const landed = await sendTransaction(tx, defaultPriorityFeeInLamports, alts);
    if (!landed) {
      throw new Error("transaction failed");
    }
  }
}

async function buildTransactions(
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

function mergeTransactionBuilders(ctx: WhirlpoolContext, txs: TransactionBuilder[], alts: AddressLookupTableAccount[]): TransactionBuilder[] {
  const merged: TransactionBuilder[] = [];
  let tx: TransactionBuilder | undefined = undefined;
  let cursor = 0;
  while (cursor < txs.length) {
    if (!tx) {
      tx = new TransactionBuilder(ctx.connection, ctx.wallet);
      // reserve space for ComputeBudgetProgram
      tx.addInstruction({
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({units: 0}), // dummy ix
          ComputeBudgetProgram.setComputeUnitPrice({microLamports: 0}), // dummy ix
        ],
        cleanupInstructions: [],
        signers: [],
      })
    }

    const mergeable = checkMergedTransactionSizeIsValid(ctx, [tx, txs[cursor]], alts);
    if (mergeable) {
      tx.addInstruction(txs[cursor].compressIx(true));
      cursor++;
    } else {
      merged.push(tx);
      tx = undefined;
    }
  }

  if (tx) {
    merged.push(tx);
  }

  // remove dummy ComputeBudgetProgram ixs
  return merged.map((tx) => {
    const newTx = new TransactionBuilder(ctx.connection, ctx.wallet);
    const ix = tx.compressIx(true);
    ix.instructions = ix.instructions.slice(2); // remove dummy ComputeBudgetProgram ixs
    newTx.addInstruction(ix);
    return newTx;
  });
}

function checkMergedTransactionSizeIsValid(
  ctx: WhirlpoolContext,
  builders: TransactionBuilder[],
  alts: AddressLookupTableAccount[],
): boolean {
  const merged = new TransactionBuilder(
    ctx.connection,
    ctx.wallet,
    ctx.txBuilderOpts,
  );
  builders.forEach((builder) =>
    merged.addInstruction(builder.compressIx(true)),
  );
  try {
    merged.txnSize({
      latestBlockhash: MEASUREMENT_BLOCKHASH,
      maxSupportedTransactionVersion: 0,
      lookupTableAccounts: alts,
    });
    return true;
  } catch {
    return false;
  }
}


////////////////////////////////////////////////////////////////////////////////

async function checkTickArrayInitialization(ctx: WhirlpoolContext, whirlpoolPubkey: PublicKey, positionBundleTargetState: PositionBundleStateItem[]) {
  const whirlpool = await ctx.fetcher.getPool(whirlpoolPubkey) as WhirlpoolData; // tickSpacing is immutable
  const tickSpacing = whirlpool.tickSpacing;

  const tickArrayStartIndexes = new Set<number>();
  for (const targetState of positionBundleTargetState) {
    if (targetState.state === "open") {
      tickArrayStartIndexes.add(TickUtil.getStartTickIndex(targetState.lowerTickIndex, tickSpacing));
      tickArrayStartIndexes.add(TickUtil.getStartTickIndex(targetState.upperTickIndex, tickSpacing));
    }
  }

  const tickArrayAddresses = Array.from(tickArrayStartIndexes).map((startIndex) =>
    PDAUtil.getTickArray(ctx.program.programId, whirlpoolPubkey, startIndex).publicKey
  );

  const uninitialized = await TickArrayUtil.getUninitializedArraysString(tickArrayAddresses, ctx.fetcher, IGNORE_CACHE);
  if (uninitialized) {
    throw new Error(`uninitialized TickArrays: ${uninitialized}`);
  }
}

async function checkATAInitialization(ctx: WhirlpoolContext, whirlpool: WhirlpoolData) {
  const mintStrings = new Set<string>();
  mintStrings.add(whirlpool.tokenMintA.toBase58());
  mintStrings.add(whirlpool.tokenMintB.toBase58());
  whirlpool.rewardInfos.forEach((rewardInfo) => {
    if (PoolUtil.isRewardInitialized(rewardInfo)) {
      mintStrings.add(rewardInfo.mint.toBase58());
    }
  });

  const mintAddresses = Array.from(mintStrings).map((mintStr) => new PublicKey(mintStr));
  const mints = await ctx.fetcher.getMintInfos(mintAddresses, IGNORE_CACHE);

  const ataAddresses = mintAddresses.map((mint) =>
    getAssociatedTokenAddressSync(
      mint,
      ctx.wallet.publicKey,
      true, // allow PDA for safety
      mints.get(mint.toBase58())!.tokenProgram, // may be Token-2022 token
    )
  );

  const atas = await ctx.fetcher.getTokenInfos(ataAddresses, IGNORE_CACHE);
  const uninitialized = mintAddresses.filter((_, i) => !atas.get(ataAddresses[i].toBase58()));

  if (uninitialized.length > 0) {
    throw new Error(`uninitialized ATAs for mint: ${uninitialized.map((mint) => mint.toBase58()).join(", ")}`);
  }
}

type PositionBundleStateDifference = {
  positionBundle: PositionBundleData;
  bundledPositions: (PositionData|undefined)[];
  noDifference: number[];
  shouldBeDecreased: number[];
  shouldBeClosed: number[];
  shouldBeOpened: number[];
  shouldBeIncreased: number[];
};

async function checkPositionBundleStateDifference(
  ctx: WhirlpoolContext,
  positionBundlePubkey: PublicKey,
  whirlpoolPubkey: PublicKey,
  positionBundleTargetState: PositionBundleStateItem[],
): Promise<PositionBundleStateDifference> {
  // fetch all bundled positions
  const positionBundle = await ctx.fetcher.getPositionBundle(positionBundlePubkey, IGNORE_CACHE) as PositionBundleData;
  const bundledPositions = await fetchBundledPositions(ctx, positionBundle);

  // ensure that all bundled positions belong to the provided whirlpool
  if (bundledPositions.some((position) => position && !position.whirlpool.equals(whirlpoolPubkey))) {
    throw new Error(`not all bundled positions belong to the whirlpool(${whirlpoolPubkey.toBase58()})`);
  }

  // check differences between current state and target state
  const noDifference: number[] = [];
  const shouldBeDecreased: number[] = [];
  const shouldBeClosed: number[] = [];
  const shouldBeOpened: number[] = [];
  const shouldBeIncreased: number[] = [];
  for (let bundleIndex = 0; bundleIndex < POSITION_BUNDLE_SIZE; bundleIndex++) {
    const targetState = positionBundleTargetState[bundleIndex];
    const currentPosition = bundledPositions[bundleIndex];

    if (targetState.state === "closed") {
      if (currentPosition) {
        shouldBeClosed.push(bundleIndex);
      } else {
        // nop
        noDifference.push(bundleIndex);
      }
    } else {
      if (!currentPosition) {
        shouldBeOpened.push(bundleIndex);
      } else {
        if (
          currentPosition.tickLowerIndex !== targetState.lowerTickIndex ||
          currentPosition.tickUpperIndex !== targetState.upperTickIndex
        ) {
          // close and reopen
          shouldBeClosed.push(bundleIndex);
          shouldBeOpened.push(bundleIndex);
        } else if (currentPosition.liquidity.lt(targetState.liquidity)) {
          shouldBeIncreased.push(bundleIndex);
        } else if (currentPosition.liquidity.gt(targetState.liquidity)) {
          shouldBeDecreased.push(bundleIndex);
        } else {
          // nop
          noDifference.push(bundleIndex);
        }
      }
    }
  }

  return {
    positionBundle,
    bundledPositions,
    noDifference,
    shouldBeDecreased,
    shouldBeClosed,
    shouldBeOpened,
    shouldBeIncreased,
  };
}


type QuotesForDecrease = { bundleIndex: number; decrease: DecreaseLiquidityQuote; };
type QuotesForClose = { bundleIndex: number; decrease: DecreaseLiquidityQuote|undefined; collectFees: CollectFeesQuote; collectRewards: CollectRewardsQuote; };
type QuotesForOpen = { bundleIndex: number; increase: IncreaseLiquidityQuote|undefined; };
type QuotesForIncrease = { bundleIndex: number; increase: IncreaseLiquidityQuote; };

type QuotesToSync = {
  quotesForDecrease: QuotesForDecrease[];
  quotesForClose: QuotesForClose[];
  quotesForOpen: QuotesForOpen[];
  quotesForIncrease: QuotesForIncrease[];
};

async function generateQuotesToSync(
  ctx: WhirlpoolContext,
  whirlpoolPubkey: PublicKey,
  positionBundleTargetState: PositionBundleStateItem[],
  difference: PositionBundleStateDifference,
  slippageTolerance: Percentage,
): Promise<QuotesToSync> {
  const { bundledPositions, shouldBeDecreased, shouldBeClosed, shouldBeOpened, shouldBeIncreased } = difference;

  const whirlpool = await ctx.fetcher.getPool(whirlpoolPubkey, IGNORE_CACHE) as WhirlpoolData;
  const tickSpacing = whirlpool.tickSpacing;

  const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(ctx.fetcher, whirlpool, IGNORE_CACHE);

  // make TickArray cache for closing positions to calculate collectable fees and rewards
  const tickArrayStartIndexes = new Set<number>();
  for (const closingBundleIndex of shouldBeClosed) {
    const closingPosition = bundledPositions[closingBundleIndex] as PositionData;
    tickArrayStartIndexes.add(TickUtil.getStartTickIndex(closingPosition.tickLowerIndex, tickSpacing));
    tickArrayStartIndexes.add(TickUtil.getStartTickIndex(closingPosition.tickUpperIndex, tickSpacing));
  }
  const tickArrayAddresses = Array.from(tickArrayStartIndexes).map((startIndex) =>
    PDAUtil.getTickArray(ctx.program.programId, whirlpoolPubkey, startIndex).publicKey
  );
  await ctx.fetcher.getTickArrays(tickArrayAddresses, IGNORE_CACHE);

  // decrease liquidity quotes
  const quotesForDecrease = shouldBeDecreased.map((bundleIndex) => {
    const position = bundledPositions[bundleIndex] as PositionData;
    const targetState = positionBundleTargetState[bundleIndex] as PositionBundleOpenState;
    const liquidityDelta = position.liquidity.sub(targetState.liquidity);
    const decrease = decreaseLiquidityQuoteByLiquidityWithParams({
      liquidity: liquidityDelta,
      sqrtPrice: whirlpool.sqrtPrice,
      tickCurrentIndex: whirlpool.tickCurrentIndex,
      tickLowerIndex: position.tickLowerIndex,
      tickUpperIndex: position.tickUpperIndex,
      tokenExtensionCtx,
      slippageTolerance,
    });

    return { bundleIndex, decrease };
  });
  
  // close position quotes
  const quotesForClose = await Promise.all(shouldBeClosed.map(async (bundleIndex) => {
    const position = bundledPositions[bundleIndex] as PositionData;

    const decrease = position.liquidity.isZero()
      ? undefined
      : decreaseLiquidityQuoteByLiquidityWithParams({
        liquidity: position.liquidity,
        sqrtPrice: whirlpool.sqrtPrice,
        tickCurrentIndex: whirlpool.tickCurrentIndex,
        tickLowerIndex: position.tickLowerIndex,
        tickUpperIndex: position.tickUpperIndex,
        tokenExtensionCtx,
        slippageTolerance,
      }); 

    const lowerTickArrayPubkey = PDAUtil.getTickArrayFromTickIndex(
      position.tickLowerIndex,
      tickSpacing,
      whirlpoolPubkey,
      ctx.program.programId,
    ).publicKey;
    const upperTickArrayPubkey = PDAUtil.getTickArrayFromTickIndex(
      position.tickUpperIndex,
      tickSpacing,
      whirlpoolPubkey,
      ctx.program.programId,
    ).publicKey;

    // async, but no RPC calls (already cached)
    const [lowerTickArray, upperTickArray] = await ctx.fetcher.getTickArrays([lowerTickArrayPubkey, upperTickArrayPubkey], PREFER_CACHE) as [TickArrayData, TickArrayData];
    const tickLower = TickArrayUtil.getTickFromArray(lowerTickArray, position.tickLowerIndex, tickSpacing);
    const tickUpper = TickArrayUtil.getTickFromArray(upperTickArray, position.tickUpperIndex, tickSpacing);

    const collectFees = collectFeesQuote({
      position,
      whirlpool,
      tickLower,
      tickUpper,
      tokenExtensionCtx,
    });
    const collectRewards = collectRewardsQuote({
      position,
      whirlpool,
      tickLower,
      tickUpper,
      tokenExtensionCtx,
    });

    return { bundleIndex, decrease, collectFees, collectRewards };
  }));

  // open position quotes
  const quotesForOpen = shouldBeOpened.map((bundleIndex) => {
    const targetState = positionBundleTargetState[bundleIndex] as PositionBundleOpenState;
    const increase = targetState.liquidity.isZero()
      ? undefined
      : increaseLiquidityQuoteByLiquidityWithParamsUsingTokenAmountSlippage({
        liquidity: targetState.liquidity,
        sqrtPrice: whirlpool.sqrtPrice,
        tickCurrentIndex: whirlpool.tickCurrentIndex,
        tickLowerIndex: targetState.lowerTickIndex,
        tickUpperIndex: targetState.upperTickIndex,
        tokenExtensionCtx,
        slippageTolerance,
      });

    return { bundleIndex, increase };
  });

  // increase liquidity quotes
  const quotesForIncrease = shouldBeIncreased.map((bundleIndex) => {
    const position = bundledPositions[bundleIndex] as PositionData;
    const targetState = positionBundleTargetState[bundleIndex] as PositionBundleOpenState;
    const liquidityDelta = targetState.liquidity.sub(position.liquidity);
    const increase = increaseLiquidityQuoteByLiquidityWithParamsUsingTokenAmountSlippage({
      liquidity: liquidityDelta,
      sqrtPrice: whirlpool.sqrtPrice,
      tickCurrentIndex: whirlpool.tickCurrentIndex,
      tickLowerIndex: position.tickLowerIndex,
      tickUpperIndex: position.tickUpperIndex,
      tokenExtensionCtx,
      slippageTolerance,
    });

    return { bundleIndex, increase };
  });

  return { quotesForDecrease, quotesForClose, quotesForOpen, quotesForIncrease };
}

function increaseLiquidityQuoteByLiquidityWithParamsUsingTokenAmountSlippage(
  params: IncreaseLiquidityQuoteByLiquidityParam,
): IncreaseLiquidityQuote {
  const increase = increaseLiquidityQuoteByLiquidityWithParams({
    ...params,
    slippageTolerance: Percentage.fromFraction(0, 100), // not use price slippage
    tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // no transfer fee calculation
  });
  const tokenEstA = increase.tokenEstA;
  const tokenEstB = increase.tokenEstB;
  const tokenMaxA = adjustForSlippage(tokenEstA, params.slippageTolerance, true);
  const tokenMaxB = adjustForSlippage(tokenEstB, params.slippageTolerance, true);

  const tokenEstAIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(
    tokenEstA,
    params.tokenExtensionCtx.tokenMintWithProgramA,
    params.tokenExtensionCtx.currentEpoch,
  );
  const tokenEstBIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(
    tokenEstB,
    params.tokenExtensionCtx.tokenMintWithProgramB,
    params.tokenExtensionCtx.currentEpoch,
  );
  const tokenMaxAIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(
    tokenMaxA,
    params.tokenExtensionCtx.tokenMintWithProgramA,
    params.tokenExtensionCtx.currentEpoch,
  );
  const tokenMaxBIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(
    tokenMaxB,
    params.tokenExtensionCtx.tokenMintWithProgramB,
    params.tokenExtensionCtx.currentEpoch,
  );

  return {
    liquidityAmount: increase.liquidityAmount,
    tokenEstA: tokenEstAIncluded.amount,
    tokenEstB: tokenEstBIncluded.amount,
    tokenMaxA: tokenMaxAIncluded.amount,
    tokenMaxB: tokenMaxBIncluded.amount,
    transferFee: {
      deductingFromTokenEstA: tokenEstAIncluded.fee,
      deductingFromTokenEstB: tokenEstBIncluded.fee,
      deductingFromTokenMaxA: tokenMaxAIncluded.fee,
      deductingFromTokenMaxB: tokenMaxBIncluded.fee,
    },
  };
}

type BalanceDifference = {
  tokenAWithdrawnEst: BN;
  tokenBWithdrawnEst: BN;
  tokenAWithdrawnMin: BN;
  tokenBWithdrawnMin: BN;
  tokenACollected: BN;
  tokenBCollected: BN;
  rewardsCollected: [BN|undefined, BN|undefined, BN|undefined];
  tokenADepositedEst: BN;
  tokenBDepositedEst: BN;
  tokenADepositedMax: BN;
  tokenBDepositedMax: BN;
  // withdrawn - deposited = negative means deposited more than withdrawn
  tokenABalanceDeltaEst: BN; // no consideration of fees and rewards
  tokenBBalanceDeltaEst: BN; // no consideration of fees and rewards
};

function calculateBalanceDifference(quotes: QuotesToSync): BalanceDifference {
  const {
    quotesForDecrease,
    quotesForClose,
    quotesForOpen,
    quotesForIncrease,
  } = quotes;

  let tokenAWithdrawnEst = new BN(0);
  let tokenBWithdrawnEst = new BN(0);
  let tokenAWithdrawnMin = new BN(0);
  let tokenBWithdrawnMin = new BN(0);
  let tokenACollected = new BN(0);
  let tokenBCollected = new BN(0);
  let rewardsCollected: [BN|undefined, BN|undefined, BN|undefined] = [undefined, undefined, undefined];
  let tokenADepositedEst = new BN(0);
  let tokenBDepositedEst = new BN(0);
  let tokenADepositedMax = new BN(0);
  let tokenBDepositedMax = new BN(0);

  for (const { decrease } of quotesForDecrease) {
    tokenAWithdrawnEst = tokenAWithdrawnEst.add(decrease.tokenEstA);
    tokenBWithdrawnEst = tokenBWithdrawnEst.add(decrease.tokenEstB);
    tokenAWithdrawnMin = tokenAWithdrawnMin.add(decrease.tokenMinA);
    tokenBWithdrawnMin = tokenBWithdrawnMin.add(decrease.tokenMinB);
  }

  for (const { decrease, collectFees, collectRewards } of quotesForClose) {
    if (decrease) {
      tokenAWithdrawnEst = tokenAWithdrawnEst.add(decrease.tokenEstA);
      tokenBWithdrawnEst = tokenBWithdrawnEst.add(decrease.tokenEstB);
      tokenAWithdrawnMin = tokenAWithdrawnMin.add(decrease.tokenMinA);
      tokenBWithdrawnMin = tokenBWithdrawnMin.add(decrease.tokenMinB);
    }
    tokenACollected = tokenACollected.add(collectFees.feeOwedA);
    tokenBCollected = tokenBCollected.add(collectFees.feeOwedB);
    for (let i = 0; i < rewardsCollected.length; i++) {
      rewardsCollected[i] = collectRewards.rewardOwed[i]?.add(rewardsCollected[i] ?? new BN(0));
    }    
  }

  for (const { increase } of quotesForOpen) {
    if (increase) {
      tokenADepositedEst = tokenADepositedEst.add(increase.tokenEstA);
      tokenBDepositedEst = tokenBDepositedEst.add(increase.tokenEstB);
      tokenADepositedMax = tokenADepositedMax.add(increase.tokenMaxA);
      tokenBDepositedMax = tokenBDepositedMax.add(increase.tokenMaxB);
    }
  }

  for (const { increase } of quotesForIncrease) {
    tokenADepositedEst = tokenADepositedEst.add(increase.tokenEstA);
    tokenBDepositedEst = tokenBDepositedEst.add(increase.tokenEstB);
    tokenADepositedMax = tokenADepositedMax.add(increase.tokenMaxA);
    tokenBDepositedMax = tokenBDepositedMax.add(increase.tokenMaxB);
  }

  const tokenABalanceDeltaEst = tokenAWithdrawnEst.sub(tokenADepositedEst);
  const tokenBBalanceDeltaEst = tokenBWithdrawnEst.sub(tokenBDepositedEst);

  return {
    tokenAWithdrawnEst,
    tokenBWithdrawnEst,
    tokenAWithdrawnMin,
    tokenBWithdrawnMin,
    tokenACollected,
    tokenBCollected,
    rewardsCollected,
    tokenADepositedEst,
    tokenBDepositedEst,
    tokenADepositedMax,
    tokenBDepositedMax,
    tokenABalanceDeltaEst,
    tokenBBalanceDeltaEst,
  };
}

async function getToDecimalAmountFunctions(ctx: WhirlpoolContext, whirlpool: WhirlpoolData): Promise<{
  toDecimalAmountA: (amount: BN) => Decimal;
  toDecimalAmountB: (amount: BN) => Decimal;
  toDecimalAmountReward: (amount: BN, rewardIndex: number) => Decimal;
}> {
  const mintStrings = new Set<string>();
  mintStrings.add(whirlpool.tokenMintA.toBase58());
  mintStrings.add(whirlpool.tokenMintB.toBase58());
  whirlpool.rewardInfos.forEach((rewardInfo) => {
    if (PoolUtil.isRewardInitialized(rewardInfo)) {
      mintStrings.add(rewardInfo.mint.toBase58());
    }
  });

  const mintAddresses = Array.from(mintStrings).map((mintStr) => new PublicKey(mintStr));
  const mints = await ctx.fetcher.getMintInfos(mintAddresses, IGNORE_CACHE);

  const decimalsA = mints.get(whirlpool.tokenMintA.toBase58())!.decimals;
  const decimalsB = mints.get(whirlpool.tokenMintB.toBase58())!.decimals;
  const decimalsRewards = whirlpool.rewardInfos.map((rewardInfo) => {
    if (PoolUtil.isRewardInitialized(rewardInfo)) {
      return mints.get(rewardInfo.mint.toBase58())!.decimals;
    } else {
      return 0;
    }
  });

  const toDecimalAmountA = (amount: BN) => DecimalUtil.fromBN(amount, decimalsA);
  const toDecimalAmountB = (amount: BN) => DecimalUtil.fromBN(amount, decimalsB);
  const toDecimalAmountReward = (amount: BN, rewardIndex: number) => DecimalUtil.fromBN(amount, decimalsRewards[rewardIndex]);

  return { toDecimalAmountA, toDecimalAmountB, toDecimalAmountReward };
}

async function getWalletATABalance(ctx: WhirlpoolContext, whirlpool: WhirlpoolData): Promise<{
  tokenABalance: BN;
  tokenBBalance: BN;
}> {
  const mintAddresses = [whirlpool.tokenMintA, whirlpool.tokenMintB];
  const mints = await ctx.fetcher.getMintInfos(mintAddresses);

  const ataAddresses = mintAddresses.map((mint) =>
    getAssociatedTokenAddressSync(
      mint,
      ctx.wallet.publicKey,
      true, // allow PDA for safety
      mints.get(mint.toBase58())!.tokenProgram, // may be Token-2022 token
    )
  );

  const atas = await ctx.fetcher.getTokenInfos(ataAddresses, IGNORE_CACHE);

  return {
    tokenABalance: new BN(atas.get(ataAddresses[0].toBase58())!.amount.toString()),
    tokenBBalance: new BN(atas.get(ataAddresses[1].toBase58())!.amount.toString()),
  };
}


//// UTILITIES ////////////////////////////////////////////////////////////

async function fetchBundledPositions(ctx: WhirlpoolContext, positionBundle: PositionBundleData): Promise<(PositionData|undefined)[]> {
  const openBundleIndexes = PositionBundleUtil.getOccupiedBundleIndexes(positionBundle);
  const bundledPositions: (PositionData|undefined)[] = new Array(POSITION_BUNDLE_SIZE).fill(undefined);

  const addresses = openBundleIndexes.map((index) =>
    PDAUtil.getBundledPosition(ctx.program.programId, positionBundle.positionBundleMint, index).publicKey
  );
  const positions = await ctx.fetcher.getPositions(addresses, IGNORE_CACHE);

  addresses.forEach((address, i) => {
    const position = positions.get(address.toBase58());
    if (!position) {
      throw new Error("bundled position not found");
    }
    bundledPositions[openBundleIndexes[i]] = position;
  });

  return bundledPositions;
}

type PositionBundleOpenState = { state: "open"; lowerTickIndex: number; upperTickIndex: number; liquidity: BN };
type PositionBundleClosedState = { state: "closed" };
type PositionBundleStateItem = PositionBundleOpenState | PositionBundleClosedState;

function readPositionBundleStateCsv(positionBundleStateCsvPath: string, tickSpacing: number): PositionBundleStateItem[] {
  // read entire CSV file
  const csv = readFileSync(positionBundleStateCsvPath, "utf8");

  // parse CSV (trim is needed for safety (remove CR code))
  const lines = csv.split("\n");
  const header = lines[0].trim();
  const data = lines.slice(1).map((line) => line.trim().split(","));

  // check header
  const EXPECTED_HEADER = "bundle index,state,lower tick index,upper tick index,liquidity";
  if (header !== EXPECTED_HEADER) {
    console.debug(`${header}<`);
    console.debug(`${EXPECTED_HEADER}<`);
    throw new Error(`unexpected header: ${header}`);
  }

  // check data
  if (data.length !== POSITION_BUNDLE_SIZE) {
    throw new Error(`unexpected data length: ${data.length} (must be ${POSITION_BUNDLE_SIZE})`);
  }

  // parse data
  return data.map((entry, expectedBundleIndex) => {
    // sanity checks...

    if (entry.length !== 5) {
      throw new Error(`unexpected entry length: ${entry.length}, line: ${entry}`);
    }

    const bundleIndex = parseInt(entry[0]);
    if (bundleIndex !== expectedBundleIndex) {
      throw new Error(`unexpected bundle index: ${bundleIndex}, expected: ${expectedBundleIndex}`);
    }

    const state = entry[1];
    if (state === "closed") {
      return { state: "closed" };
    }
    if (state !== "open") {
      throw new Error(`unexpected state: ${state}`);
    }

    const lowerTickIndex = parseInt(entry[2]);
    const upperTickIndex = parseInt(entry[3]);
    const liquidity = new BN(entry[4]);
    if (isNaN(lowerTickIndex) || isNaN(upperTickIndex)) {
      throw new Error(`invalid tick indexes (not number): ${entry[2]}, ${entry[3]}`);
    }
    if (lowerTickIndex >= upperTickIndex) {
      throw new Error(`invalid tick indexes (lower >= upper): ${entry[2]}, ${entry[3]}`);
    }
    if (lowerTickIndex < MIN_TICK_INDEX || upperTickIndex > MAX_TICK_INDEX)  {
      throw new Error(`invalid tick indexes (out of range): ${entry[2]}, ${entry[3]}`);
    }
    if (lowerTickIndex % tickSpacing !== 0 || upperTickIndex % tickSpacing !== 0) {
      throw new Error(`invalid tick indexes (not initializable): ${entry[2]}, ${entry[3]}`);
    }

    return { state: "open", lowerTickIndex, upperTickIndex, liquidity };
  });
}

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
initialize TokenBadge...
prompt: whirlpoolsConfigPubkey:  JChtLEVR9E6B5jiHTZS1Nd9WgMULMHv2UcVryYACAFYQ
prompt: tokenMint:  FfprBPB2ULqp4tyBfzrzwxNvpGYoh8hidzSmiA5oDtmu
setting...
        whirlpoolsConfig JChtLEVR9E6B5jiHTZS1Nd9WgMULMHv2UcVryYACAFYQ
        tokenMint FfprBPB2ULqp4tyBfzrzwxNvpGYoh8hidzSmiA5oDtmu

if the above is OK, enter YES
prompt: yesno:  YES
tx: 5sQvVXTWHMdn9YVsWSqNCT2rCArMLz3Wazu67LETs2Hpfs4uHuWvBoKsz2RhaBwpc2DcE233DYQ4rs9PyzW88hj2
tokenBadge address: FZViZVK1ANAH9Ca3SfshZRpUdSfy1qpX3KGbDBCfCJNh

*/
