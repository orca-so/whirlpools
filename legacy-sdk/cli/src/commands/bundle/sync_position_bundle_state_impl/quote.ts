import { PublicKey } from "@solana/web3.js";
import { collectFeesQuote, CollectFeesQuote, collectRewardsQuote, CollectRewardsQuote, DecreaseLiquidityQuote, decreaseLiquidityQuoteByLiquidityWithParams, IGNORE_CACHE, IncreaseLiquidityQuote, IncreaseLiquidityQuoteByLiquidityParam, increaseLiquidityQuoteByLiquidityWithParams, MAX_TICK_INDEX, MIN_TICK_INDEX, NO_TOKEN_EXTENSION_CONTEXT, PDAUtil, PoolUtil, POSITION_BUNDLE_SIZE, PositionBundleData, PositionBundleUtil, PositionData, PREFER_CACHE, TickArrayData, TickArrayUtil, TickUtil, TokenExtensionUtil, toTx, WhirlpoolContext, WhirlpoolData, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { Percentage } from "@orca-so/common-sdk";
import BN from "bn.js";
import { adjustForSlippage } from "@orca-so/whirlpools-sdk/dist/utils/position-util";
import { PositionBundleOpenState, PositionBundleStateItem } from "./csv";
import { PositionBundleStateDifference } from "./state_difference";

export type QuotesForDecrease = { bundleIndex: number; decrease: DecreaseLiquidityQuote; };
export type QuotesForClose = { bundleIndex: number; decrease: DecreaseLiquidityQuote|undefined; collectFees: CollectFeesQuote; collectRewards: CollectRewardsQuote; };
export type QuotesForOpen = { bundleIndex: number; increase: IncreaseLiquidityQuote|undefined; };
export type QuotesForIncrease = { bundleIndex: number; increase: IncreaseLiquidityQuote; };
export type QuotesToSync = {
  quotesForDecrease: QuotesForDecrease[];
  quotesForClose: QuotesForClose[];
  quotesForOpen: QuotesForOpen[];
  quotesForIncrease: QuotesForIncrease[];
};

export async function generateQuotesToSync(
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

export type BalanceDifference = {
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

export function calculateBalanceDifference(quotes: QuotesToSync): BalanceDifference {
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
