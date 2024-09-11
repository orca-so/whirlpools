import { writeFileSync } from "fs";
import path from "path";
import Decimal from "decimal.js";
import {
  MAX_SQRT_PRICE,
  MAX_TICK_INDEX,
  MIN_SQRT_PRICE,
  MIN_TICK_INDEX,
  TICK_ARRAY_SIZE,
  PriceMath,
} from "@orca-so/whirlpools-sdk";
import BN from "bn.js";
Decimal.set({ toExpPos: 8, toExpNeg: -8, precision: 128 });

const MAX_FEE_RATE = 10_000;
const FEE_RATE_MUL_VALUE = 1_000_000;
const MAX_PROTOCOL_FEE_RATE = 2500;
const PROTOCOL_FEE_RATE_MUL_VALUE = 10_000;
const U64_MAX = new Decimal(2).pow(64).sub(1);
const U128_MAX = new Decimal(2).pow(128).sub(1);
const U192_MAX = new Decimal(2).pow(192).sub(1);
const U256_MAX = new Decimal(2).pow(256).sub(1);

export type TestCaseJSON = {
  testId: number;
  description: string;
  tickSpacing: number;
  feeRate: number;
  protocolFeeRate: number;
  liquidity: string;
  currTickIndex: number;
  tradeAmount: string;
  amountIsInput: boolean;
  aToB: boolean;
  expectation: TestCaseExpectationJSON;
};

export type TestCaseExpectationJSON = {
  exception: string;
  amountA: string;
  amountB: string;
  nextLiquidity: string;
  nextTickIndex: number;
  nextSqrtPrice: string;
  nextFeeGrowthGlobal: string;
  nextProtocolFee: string;
};

enum LiquiditySetup {
  MaxLiquidity,
  ThirdQuartile,
  FirstQuartile,
  Zero,
}

enum CurrTickSetup {
  NearMax = 443500,
  NearMin = -443500,
  At1 = 0,
  At10 = 223027,
  AtNeg10 = -223027,
}

const feeRateVariants = [
  // TODO: Verify these values
  [MAX_FEE_RATE, MAX_PROTOCOL_FEE_RATE],
  [65535, 600], // Regular pool
  [700, 300], // Stable pool
  [0, 0],
];
const tickSpacingVariantsForConcentratedPool = [1, 8, 128];
const tickSpacingVariantsForSplashPool = [32768+1, 32768+64, 32768+128];
const liquidityVariantsForConcentratedPool = [
  LiquiditySetup.MaxLiquidity,
  LiquiditySetup.ThirdQuartile,
  LiquiditySetup.FirstQuartile,
  LiquiditySetup.Zero,
];
const liquidityVariantsForSplashPool = [
  // max liquidity = u64 max
  LiquiditySetup.ThirdQuartile,
  LiquiditySetup.FirstQuartile,
  LiquiditySetup.Zero,
];
const liquidityValues = [
  new Decimal(2).pow(110),
  new Decimal(2).pow(64),
  new Decimal(2).pow(32),
  new Decimal(0),
];
const currTickVariants = [
  CurrTickSetup.NearMax,
  CurrTickSetup.NearMin,
  CurrTickSetup.At1,
  CurrTickSetup.At10,
  CurrTickSetup.AtNeg10,
];
const tradeAmountVariants = [
  new Decimal(2).pow(64).sub(1), // u64::max
  new Decimal(10).pow(12), // 1 million in 10^6
  new Decimal(10).pow(9), // 1000 in 10^6
  new Decimal(0),
];
const exactInputVariants = [true, false];
const aToBVariants = [true, false];

const testCase = 0;

const TEST_CASE_ID_BASE_CONCENTRATED_POOL = 0;
const TEST_CASE_ID_BASE_SPLASH_POOL = 1_000_000;

main();

function main() {
  // ConcentratedPool
  generateTests(
    TEST_CASE_ID_BASE_CONCENTRATED_POOL,
    path.join("swap_test_cases.json"),
    feeRateVariants,
    tickSpacingVariantsForConcentratedPool,
    liquidityVariantsForConcentratedPool,
    currTickVariants,
    tradeAmountVariants,
    exactInputVariants,
    aToBVariants
  );

  // SplashPool
  generateTests(
    TEST_CASE_ID_BASE_SPLASH_POOL,
    path.join("swap_test_cases_splash_pool.json"),
    feeRateVariants,
    tickSpacingVariantsForSplashPool,
    liquidityVariantsForSplashPool,
    currTickVariants,
    tradeAmountVariants,
    exactInputVariants,
    aToBVariants
  );
}

function generateTests(
  testIdBase: number,
  testCaseOutputFilePath: string,
  feeRateVariants: number[][],
  tickSpacingVariants: number[],
  liquidityVariants: LiquiditySetup[],
  currTickVariants: CurrTickSetup[],
  tradeAmountVariants: Decimal[],
  exactInputVariants: boolean[],
  aToBVariants: boolean[],
) {
  let testId = testIdBase;
  let testCases: TestCaseJSON[] = [];

  // lol.
  feeRateVariants.forEach((feeRateVariant) => {
    tickSpacingVariants.forEach((tickSpacingVariant) => {
      liquidityVariants.forEach((liquiditySetup) => {
        currTickVariants.forEach((currTickVariant) => {
          tradeAmountVariants.forEach((tradeAmount) => {
            exactInputVariants.forEach((exactInputVariant) => {
              aToBVariants.forEach((aToB) => {
                testId++;
                if (testCase > 0 && testId != testCase) {
                  return;
                }
                let expectation = generateExpectation(
                  feeRateVariant[0],
                  feeRateVariant[1],
                  getLiquidityValue(liquiditySetup),
                  currTickVariant,
                  tickSpacingVariant,
                  tradeAmount,
                  exactInputVariant,
                  aToB
                );
                testCases.push({
                  testId,
                  description: getDescription(
                    feeRateVariant[0],
                    feeRateVariant[1],
                    liquiditySetup,
                    tickSpacingVariant,
                    currTickVariant,
                    tradeAmount,
                    exactInputVariant,
                    aToB
                  ),
                  tickSpacing: tickSpacingVariant,
                  feeRate: feeRateVariant[0],
                  protocolFeeRate: feeRateVariant[1],
                  liquidity: getLiquidityValue(liquiditySetup).toFixed(0, 1),
                  currTickIndex: currTickVariant,
                  tradeAmount: tradeAmount.toFixed(0, 1),
                  amountIsInput: exactInputVariant,
                  aToB: aToB,
                  expectation: expectation,
                });
              });
            });
          });
        });
      });
    });
  });
  writeJson(
    testCaseOutputFilePath,
    testCases
  );
}

function generateExpectation(
  feeRate: number,
  protocolRate: number,
  liquidity: Decimal,
  currTick: number,
  tickSpacing: number,
  tradeAmount: Decimal,
  exactInput: boolean,
  aToB: boolean
): TestCaseExpectationJSON {
  try {
    let tradeInfo = getTradeInfo(
      currTick,
      tickSpacing,
      liquidity,
      tradeAmount,
      feeRate,
      exactInput,
      aToB
    );
    let nextFees = getFeeIncrements(
      tradeInfo.feeAmount,
      protocolRate,
      liquidity
    );
    return {
      exception: "",
      amountA: tradeInfo.amountA.toFixed(0, 1),
      amountB: tradeInfo.amountB.toFixed(0, 1),
      nextLiquidity: liquidity.toFixed(0, 1),
      nextTickIndex: tradeInfo.nextTick,
      nextSqrtPrice: tradeInfo.nextSqrtPrice.toFixed(0, 1),
      nextFeeGrowthGlobal: nextFees.nextFeeGrowthGlobal,
      nextProtocolFee: nextFees.nextProtocolFee,
    };
  } catch (e) {
    return {
      exception: (<Error>e).message,
      amountA: "0",
      amountB: "0",
      nextLiquidity: "0",
      nextTickIndex: 0,
      nextSqrtPrice: "0",
      nextFeeGrowthGlobal: "0",
      nextProtocolFee: "0",
    };
  }
}

/**
 * Expectation Helpers
 */

function getTradeInfo(
  currTick: number,
  tickSpacing: number,
  liquidity: Decimal,
  tradeAmount: Decimal,
  feeRate: number,
  exactInput: boolean,
  aToB: boolean
) {
  let feeAmount = new Decimal(0);

  let currSqrtPrice = toDecimal(tickIndexToSqrtPriceX64(currTick));
  let nextSqrtPrice: Decimal;
  let targetSqrtPrice: Decimal = toDecimal(
    tickIndexToSqrtPriceX64(getLastTickInSequence(currTick, tickSpacing, aToB))
  );

  if (tradeAmount.eq(0)) {
    throw new Error("ZeroTradableAmount");
  }
  /**
   * If the swap states that the trade_amount is the maximum input, the actual tradable input is max - fees
   * Otherwise, we derive the required amountIn (incl fees) from the specified output (trade_amount)
   */
  if (exactInput) {
    let postFeeTradeAmount = tradeAmount
      .mul(FEE_RATE_MUL_VALUE - feeRate)
      .div(FEE_RATE_MUL_VALUE)
      // Note(yugure) add .floor() to make it integer
      .floor();

    const tryAmountIn = aToB
      ? tryGetAmountADelta(targetSqrtPrice, currSqrtPrice, liquidity, true)
      : tryGetAmountBDelta(targetSqrtPrice, currSqrtPrice, liquidity, true);

    // Note(yugure): original script used tradeAmount, but postFeeTradeAmount should be used.
    if (tryAmountIn.type === "ExceedsMax" || (tryAmountIn.type === "Valid" && tryAmountIn.value.gt(postFeeTradeAmount))) {
      nextSqrtPrice = getNextSqrtPriceFromInput(
        currSqrtPrice,
        liquidity,
        postFeeTradeAmount,
        exactInput,
        aToB
      );
    } else {
      nextSqrtPrice = targetSqrtPrice;
    }
  } else {
    const tryAmountOut = aToB
      ? tryGetAmountBDelta(targetSqrtPrice, currSqrtPrice, liquidity, false)
      : tryGetAmountADelta(targetSqrtPrice, currSqrtPrice, liquidity, false);

    if (tryAmountOut.type === "ExceedsMax" || (tryAmountOut.type === "Valid" && tryAmountOut.value.gt(tradeAmount))) {
      nextSqrtPrice = getNextSqrtPriceFromOutput(
        currSqrtPrice,
        liquidity,
        tradeAmount,
        exactInput,
        aToB
      );
    } else {
      nextSqrtPrice = targetSqrtPrice;
    }
  }

  nextSqrtPrice = Decimal.min(
    Decimal.max(nextSqrtPrice, MIN_SQRT_PRICE),
    MAX_SQRT_PRICE
  );

  let maxSwap = nextSqrtPrice.eq(targetSqrtPrice);

  let amountIn: Decimal;
  let amountOut: Decimal;

  if (aToB) {
    amountIn = getAmountADelta(nextSqrtPrice, currSqrtPrice, liquidity, true);
    amountOut = getAmountBDelta(nextSqrtPrice, currSqrtPrice, liquidity, false);
  } else {
    amountIn = getAmountBDelta(currSqrtPrice, nextSqrtPrice, liquidity, true);
    amountOut = getAmountADelta(currSqrtPrice, nextSqrtPrice, liquidity, false);
  }

  if (!exactInput && amountOut.gt(tradeAmount)) {
    amountOut = tradeAmount;
  }

  if (exactInput && !maxSwap) {
    feeAmount = tradeAmount.sub(amountIn);
  } else {
    feeAmount = amountIn
      .mul(feeRate)
      .div(FEE_RATE_MUL_VALUE - feeRate)
      .ceil();
  }

  let remaining: Decimal = tradeAmount,
    calculated: Decimal;
  if (exactInput) {
    remaining = remaining.sub(amountIn.add(feeAmount));
    calculated = amountOut;
  } else {
    remaining = remaining.sub(amountOut);
    calculated = amountIn.add(feeAmount);
  }

  // Note(yugure): ported from swap_manager.rs (checked_sub and checked_add)
  if (remaining.isNegative()) {
    // checked_sub equivalent
    throw new Error("AmountRemainingOverflow");
  }
  if (calculated.gt(U64_MAX)) {
    // checked_add equivalent
    throw new Error("AmountCalcOverflow");
  }

  let amountA: Decimal, amountB: Decimal;
  if (aToB == exactInput) {
    amountA = tradeAmount.sub(remaining);
    amountB = calculated;
  } else {
    amountA = calculated;
    amountB = tradeAmount.sub(remaining);
  }

  if (amountA.gt(U64_MAX) || amountB.gt(U64_MAX)) {
    // Note(yugure): in the current implementation, this is not possible (so I use panic)
    panic();
    throw new Error("TokenMaxExceeded");
  }

  if (amountA.lt(0) || amountB.lt(0)) {
    // Note(yugure): in the current implementation, this is not possible (so I use panic)
    panic();
    throw new Error("TokenMinSubceeded");
  }

  let nextTick = sqrtPriceX64ToTickIndex(toBN(nextSqrtPrice));

  if (nextSqrtPrice.eq(targetSqrtPrice) && aToB) {
    nextTick -= 1;
  }

  return {
    amountA,
    amountB,
    nextSqrtPrice,
    nextTick,
    feeAmount,
  };
}

function getFeeIncrements(
  feeAmount: Decimal,
  protocolRate: number,
  currLiquidity: Decimal
) {
  let globalFee = feeAmount,
    protocolFee = new Decimal(0);
  if (protocolRate > 0) {
    let delta = globalFee
      .mul(protocolRate)
      .div(PROTOCOL_FEE_RATE_MUL_VALUE)
      .floor();
    globalFee = globalFee.sub(delta);
    protocolFee = delta;
  }

  let feeGlobalForInputToken = new Decimal(0);
  if (currLiquidity.gt(0)) {
    feeGlobalForInputToken = toX64(globalFee).div(currLiquidity).floor();
  }

  return {
    nextFeeGrowthGlobal: feeGlobalForInputToken.toFixed(0, 1),
    nextProtocolFee: protocolFee.toFixed(0, 1),
  };
}

/**
 * Math Methods
 */

function getLastTickInSequence(
  currTick: number,
  tickSpacing: number,
  aToB: boolean
) {
  const numTicksInArray = TICK_ARRAY_SIZE * tickSpacing;
  const startTick = getStartTick(currTick, tickSpacing);
  const potentialLast = aToB
    ? startTick - 2 * numTicksInArray
    : startTick + 3 * numTicksInArray - 1;
  return Math.max(Math.min(potentialLast, MAX_TICK_INDEX), MIN_TICK_INDEX);
}

function getStartTick(currTick: number, tickSpacing: number) {
  const numTicksInArray = TICK_ARRAY_SIZE * tickSpacing;
  const currTickDecimal = new Decimal(currTick);

  return currTickDecimal
    .div(numTicksInArray)
    .floor()
    .mul(numTicksInArray)
    .toNumber();
}

function getNextSqrtPriceFromInput(
  currSqrtPrice: Decimal,
  liquidity: Decimal,
  tradeAmount: Decimal,
  exactIn: boolean,
  aToB: boolean
) {
  return aToB
    ? getNextSqrtPriceFromTokenARoundingUp(
        currSqrtPrice,
        liquidity,
        tradeAmount,
        true
      )
    : getNextSqrtPriceFromTokenBRoundingDown(
        currSqrtPrice,
        liquidity,
        tradeAmount,
        true
      );
}

function getNextSqrtPriceFromOutput(
  currSqrtPrice: Decimal,
  liquidity: Decimal,
  tradeAmount: Decimal,
  exactIn: boolean,
  aToB: boolean
) {
  return aToB
    ? getNextSqrtPriceFromTokenBRoundingDown(
        currSqrtPrice,
        liquidity,
        tradeAmount,
        false
      )
    : getNextSqrtPriceFromTokenARoundingUp(
        currSqrtPrice,
        liquidity,
        tradeAmount,
        false
      );
}

// sqrt_price_new = (sqrt_price * liquidity) / (liquidity + amount * sqrt_price)
function getNextSqrtPriceFromTokenARoundingUp(
  currSqrtPrice: Decimal,
  liquidity: Decimal,
  tradeAmount: Decimal,
  add: boolean
) {
  if (tradeAmount.eq(0) || liquidity.eq(0)) {
    return currSqrtPrice;
  }

  let liquidityX64 = toX64(liquidity);
  let product = tradeAmount.mul(currSqrtPrice);
  if (add) {
    let denominator = liquidityX64.add(product);
    let numerator = liquidityX64.mul(currSqrtPrice);
    if (numerator.gt(U256_MAX)) {
      throw new Error("MultiplicationOverflow");
    }

    let result = numerator.div(denominator);
    return result.ceil();
  } else {
    let denominator = liquidityX64.sub(product);
    let numerator = liquidityX64.mul(currSqrtPrice);
    if (numerator.gt(U256_MAX)) {
      throw new Error("MultiplicationOverflow");
    }

    if (denominator.lte(0)) {
      throw new Error("DivideByZero");
    }
    let result = numerator.div(denominator);
    return result.ceil();
  }
}

function getNextSqrtPriceFromTokenBRoundingDown(
  currSqrtPrice: Decimal,
  liquidity: Decimal,
  tradeAmount: Decimal,
  add: boolean
) {
  if (tradeAmount.eq(0) || liquidity.eq(0)) {
    return currSqrtPrice;
  }

  if (add) {
    let quotient = toX64(tradeAmount).div(liquidity).floor();
    let result = currSqrtPrice.add(quotient);
    if (result.gt(toDecimal(tickIndexToSqrtPriceX64(443636)))) {
      throw new Error("SqrtPriceOutOfBounds");
    }
    return result;
  } else {
    let quotient = toX64(tradeAmount).div(liquidity).ceil();
    let result = currSqrtPrice.sub(quotient);
    if (result.lt(toDecimal(tickIndexToSqrtPriceX64(-443636)))) {
      throw new Error("SqrtPriceOutOfBounds");
    }
    return result;
  }
}

function getAmountADelta(
  sqrtPrice1: Decimal,
  sqrtPrice2: Decimal,
  liquidity: Decimal,
  round: boolean
): Decimal {
  const result = tryGetAmountADelta(
    sqrtPrice1,
    sqrtPrice2,
    liquidity,
    round
  );
  if (result.type === "ExceedsMax") {
    throw result.error;
  }
  return result.value;
}

type AmountDeltaU64 = AmountDeltaU64Valid | AmountDeltaU64ExceedsMax;
type AmountDeltaU64Valid = {
  type: "Valid";
  value: Decimal;
}
type AmountDeltaU64ExceedsMax = {
  type: "ExceedsMax";
  error: Error;
}

function tryGetAmountADelta(
  sqrtPrice1: Decimal,
  sqrtPrice2: Decimal,
  liquidity: Decimal,
  round: boolean
): AmountDeltaU64 {
  let sqrtPriceLower = Decimal.min(sqrtPrice1, sqrtPrice2);
  let sqrtPriceUpper = Decimal.max(sqrtPrice1, sqrtPrice2);

  let diff = sqrtPriceUpper.sub(sqrtPriceLower);
  let dem = sqrtPriceUpper.mul(sqrtPriceLower);
  let product = liquidity.mul(diff);
  let num = toX64(product);

  // eslint-disable-next-line no-console
  console.log(
    `liquidity - ${liquidity.toFixed(0, 1)}, diff - ${diff.toFixed(0, 1)}`
  );
  // eslint-disable-next-line no-console
  console.log(`product - ${product.toFixed(0, 1)} >192 - ${num.gt(U256_MAX)}`);
  if (product.gt(U192_MAX)) {
    throw new Error("MultiplicationOverflow");
  }

  let result = round ? num.div(dem).ceil() : num.div(dem).floor();

  if (result.gt(U128_MAX)) {
    return {
      type: "ExceedsMax",
      error: new Error("NumberDownCastError")
    };
  }

  if (result.gt(U64_MAX)) {
    // eslint-disable-next-line no-console
    console.log(`result exceed token - ${result.toFixed(0, 1)}`);
    return {
      type: "ExceedsMax",
      error: new Error("TokenMaxExceeded")
    };
  }

  return {
    type: "Valid",
    value: result
  };
}

function getAmountBDelta(
  sqrtPrice1: Decimal,
  sqrtPrice2: Decimal,
  liquidity: Decimal,
  round: boolean
): Decimal {
  const result = tryGetAmountBDelta(
    sqrtPrice1,
    sqrtPrice2,
    liquidity,
    round
  );
  if (result.type === "ExceedsMax") {
    throw result.error;
  }
  return result.value;
}

function tryGetAmountBDelta(
  sqrtPrice1: Decimal,
  sqrtPrice2: Decimal,
  liquidity: Decimal,
  round: boolean
): AmountDeltaU64 {
  let sqrtPriceLower = Decimal.min(sqrtPrice1, sqrtPrice2);
  let sqrtPriceUpper = Decimal.max(sqrtPrice1, sqrtPrice2);
  let diff = sqrtPriceUpper.sub(sqrtPriceLower);

  let product = liquidity.mul(diff);

  if (product.gt(U128_MAX)) {
    return {
      type: "ExceedsMax",
      error: new Error("MultiplicationShiftRightOverflow")
    };
  }

  let result = fromX64(product);

  return {
    type: "Valid",
    value: round ? result.ceil() : result.floor()
  };
}

/**
 * Helpers
 */

function getDescription(
  feeRate: number,
  protocolRate: number,
  liquidity: LiquiditySetup,
  tickSpacing: number,
  currTick: CurrTickSetup,
  tradeAmount: Decimal,
  exactInput: boolean,
  aToB: boolean
) {
  let feeRateText = getFeeRateText(feeRate, protocolRate);
  let tradeInfoText = getTokenDirectionText(tradeAmount, exactInput, aToB);
  let poolInfoText = poolSetupText(liquidity, tickSpacing);
  let curTickText = getCurrTickText(currTick);
  return `${poolInfoText}${tradeInfoText}${curTickText}${feeRateText}`;
}

function getTokenDirectionText(
  tradeAmount: Decimal,
  exactInput: boolean,
  aToB: boolean
) {
  let tradeAmountString = tradeAmount.toString();
  if (exactInput && aToB) {
    return `swap exactly ${tradeAmountString} tokenA to tokenB`;
  }
  if (!exactInput && aToB) {
    return `swap tokenA to exactly ${tradeAmountString} tokenB`;
  }
  if (exactInput && !aToB) {
    return `swap exactly ${tradeAmountString} tokenB to tokenA`;
  }
  if (!exactInput && !aToB) {
    return `swap tokenB to exactly ${tradeAmountString} tokenA`;
  }
}

function getCurrTickText(currTickSetup: CurrTickSetup) {
  switch (currTickSetup) {
    case CurrTickSetup.NearMax:
      return " at near max tick";
    case CurrTickSetup.NearMin:
      return " at near min tick";
    case CurrTickSetup.At1:
      return " at tick 0 (p = 1)";
    case CurrTickSetup.At10:
      return " at tick 223027";
    case CurrTickSetup.AtNeg10:
      return " at tick -223027";
  }
}

function getFeeRateText(feeRate: number, protocolRate: number) {
  let feeRatePercentage = new Decimal(feeRate).div(10000).toFixed(2);

  return ` with ${feeRatePercentage}%/${protocolRate} fee`;
}

function poolSetupText(liquiditySetup: LiquiditySetup, tickSpacing: number) {
  return `In a ts_${tickSpacing} pool with ${getLiquiditySetupText(
    liquiditySetup
  )} liquidity, `;
}

function getLiquiditySetupText(setup: LiquiditySetup) {
  switch (setup) {
    case LiquiditySetup.MaxLiquidity:
      return "2^110";
    case LiquiditySetup.ThirdQuartile:
      return "2^64";
    case LiquiditySetup.FirstQuartile:
      return "2^32";
    case LiquiditySetup.Zero:
      return "0";
    default:
      return "unknown";
  }
}

function getLiquidityValue(setup: LiquiditySetup) {
  switch (setup) {
    case LiquiditySetup.MaxLiquidity:
      return liquidityValues[0];
    case LiquiditySetup.ThirdQuartile:
      return liquidityValues[1];
    case LiquiditySetup.FirstQuartile:
      return liquidityValues[2];
    case LiquiditySetup.Zero:
      return liquidityValues[3];
    default:
      return new Decimal(-1);
  }
}

function toX64(num: Decimal) {
  return num.mul(new Decimal(2).pow(64));
}

function fromX64(num: Decimal) {
  return num.div(new Decimal(2).pow(64));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeJson(pathToFile: string, data: any): void {
  const pathName = path.join(__dirname, "../", pathToFile);
  const stringifiedData = JSON.stringify(data, null, 2);
  // eslint-disable-next-line no-console
  console.log(`Writing to file - ${pathName}`);
  writeFileSync(pathName, stringifiedData);
}

function toDecimal(bn: BN) {
  return new Decimal(bn.toString());
}

function toBN(decimal: Decimal) {
  return new BN(decimal.toFixed(0, 1));
}

function sqrtPriceX64ToTickIndex(sqrtPriceX64: BN): number {
  return PriceMath.sqrtPriceX64ToTickIndex(sqrtPriceX64);
}

function tickIndexToSqrtPriceX64(tickIndex: number): BN {
  return PriceMath.tickIndexToSqrtPriceX64(tickIndex);
}

function panic() {
  // eslint-disable-next-line no-console
  console.error("PANIC!");
  process.exit(1);
}