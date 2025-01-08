import { PublicKey } from "@solana/web3.js";
import { collectFeesQuote, CollectFeesQuote, collectRewardsQuote, CollectRewardsQuote, DecreaseLiquidityQuote, decreaseLiquidityQuoteByLiquidityWithParams, IGNORE_CACHE, IncreaseLiquidityQuote, IncreaseLiquidityQuoteByLiquidityParam, increaseLiquidityQuoteByLiquidityWithParams, MAX_TICK_INDEX, MIN_TICK_INDEX, NO_TOKEN_EXTENSION_CONTEXT, PDAUtil, PoolUtil, POSITION_BUNDLE_SIZE, PositionBundleData, PositionBundleUtil, PositionData, PREFER_CACHE, TickArrayData, TickArrayUtil, TickUtil, TokenExtensionUtil, WhirlpoolContext, WhirlpoolData, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { DecimalUtil, Percentage, TransactionBuilder } from "@orca-so/common-sdk";
import { sendTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";
import { readFileSync } from "fs";
import BN from "bn.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { adjustForSlippage } from "@orca-so/whirlpools-sdk/dist/utils/position-util";
import Decimal from "decimal.js";

async function main() {
  console.info("sync PositionBundle state...");

  // prompt
  console.warn("using test values");
  const positionBundlePubkeyStr = "3XmaBcpvHdNTv6u35M13w55SpJKVhxSahTkzMiVRVsqC";
  //const positionBundlePubkeyStr = await promptText("positionBundlePubkey");
  const positionBundlePubkey = new PublicKey(positionBundlePubkeyStr);
  const whirlpoolPubkeyStr = "95XaJMqCLiWtUwF9DtSvDpDbPYhEHoVyCeeNwmUD7cwr";
  //const whirlpoolPubkeyStr = await promptText("whirlpoolPubkey");
  const whirlpoolPubkey = new PublicKey(whirlpoolPubkeyStr);
  const positionBundleTargetStateCsvPath = "position_bundle_target_state.csv";
  //const positionBundleTargetStateCsvPath = await promptText("positionBundleTargetStateCsvPath");

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
    } else {
      if (!firstIteration) {
        console.warn("There are still differences between the current state and the target state (some transaction may have failed)");
      }

      // TODO: param
      const slippage = Percentage.fromFraction(1, 100); // 1%
      const quotes = await getQuotesToSync(ctx, whirlpoolPubkey, positionBundleTargetState, difference, slippage);
      const balanceDifference = calcBalanceDifference(quotes);

      const { tokenABalance, tokenBBalance } = await getWalletATABalance(ctx, whirlpool);

      console.info([
        "Position state changes:\n",
        "\n",
        `    close position:     ${difference.shouldBeClosed.length.toString().padStart(3, " ")} position(s)\n`,
        `    open  position:     ${difference.shouldBeOpened.length.toString().padStart(3, " ")} position(s)\n`,
        `    withdraw liquidity: ${difference.shouldBeDecreased.length.toString().padStart(3, " ")} position(s)\n`,
        `    deposit  liquidity: ${difference.shouldBeIncreased.length.toString().padStart(3, " ")} position(s)\n`,
        "\n",
        "Balance changes:\n",
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
      ].join(""));

      // prompt for confirmation
      const confirmed = await promptConfirm("proceed?");
      if (!confirmed) {
        console.info("aborted");
        break;
      }
    }

    console.info("syncing...");


    firstIteration = false;
  }
}

main();

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
        } else if (!currentPosition.liquidity.lt(targetState.liquidity)) {
          shouldBeIncreased.push(bundleIndex);
        } else if (!currentPosition.liquidity.gt(targetState.liquidity)) {
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

async function getQuotesToSync(
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

function calcBalanceDifference(quotes: QuotesToSync): BalanceDifference {
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
