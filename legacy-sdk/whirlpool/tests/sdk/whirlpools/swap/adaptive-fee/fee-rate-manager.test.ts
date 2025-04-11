import * as anchor from "@coral-xyz/anchor";
import { AdaptiveFeeVariables, FeeRateManager } from "../../../../../src/quotes/swap/fee-rate-manager";
import * as assert from "assert";
import { ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR, AdaptiveFeeConstantsData, AdaptiveFeeInfo, FEE_RATE_HARD_LIMIT, MAX_REFERENCE_AGE, MAX_SQRT_PRICE_BN, MAX_TICK_INDEX, MIN_SQRT_PRICE_BN, MIN_TICK_INDEX, REDUCTION_FACTOR_DENOMINATOR, VOLATILITY_ACCUMULATOR_SCALE_FACTOR } from "../../../../../src";
import { PriceMath } from "../../../../../src/utils/public/price-math";

// Note: straight conversion from rust test cases

describe("fee-rate-manager", () => {
  describe("StaticFeeRateManager", () => {
    function createStaticFeeRateManager(feeRate: number, aToB?: boolean) {
      return FeeRateManager.new(
        aToB ?? true,
        0,
        new anchor.BN(0),
        feeRate,
        null
      );
    }

    it("new", async () => {
      const feeRateManager = createStaticFeeRateManager(3000);
      assert.equal(feeRateManager.constructor.name, "StaticFeeRateManager");
    });

    it("updateVolatilityAccumulator", async () => {
      const feeRate = 3000;
      const feeRateManager = createStaticFeeRateManager(feeRate);

      assert.equal(feeRateManager.getTotalFeeRate(), feeRate);
      feeRateManager.updateVolatilityAccumulator();
      assert.equal(feeRateManager.getTotalFeeRate(), feeRate);
    });

    it("getTotalFeeRate", async () => {
      const staticFeeRates = [1000, 3000, 10000, 50000];

      for (const feeRate of staticFeeRates) {
        const feeRateManager = createStaticFeeRateManager(feeRate);
        assert.equal(feeRateManager.constructor.name, "StaticFeeRateManager");
        assert.equal(feeRateManager.getTotalFeeRate(), feeRate);
      }
    });

    it("getBoundedSqrtPriceTarget", async () => {
      const currLiquidity = new anchor.BN(1000000000);
      const feeRate = 3000;

      const feeRateManagerAToB = createStaticFeeRateManager(feeRate, true);

      const { boundedSqrtPriceTarget: boundedSqrtPriceTargetAToB, adaptiveFeeUpdateSkipped: adaptiveFeeUpdateSkippedAToB } =
        feeRateManagerAToB.getBoundedSqrtPriceTarget(MIN_SQRT_PRICE_BN, currLiquidity);
      assert.ok(boundedSqrtPriceTargetAToB.eq(MIN_SQRT_PRICE_BN));
      assert.equal(adaptiveFeeUpdateSkippedAToB, false);

      const feeRateManagerBToA = createStaticFeeRateManager(feeRate, false);

      const { boundedSqrtPriceTarget: boundedSqrtPriceTargetBToA, adaptiveFeeUpdateSkipped: adaptiveFeeUpdateSkippedBToA } =
        feeRateManagerBToA.getBoundedSqrtPriceTarget(MAX_SQRT_PRICE_BN, currLiquidity);
      assert.ok(boundedSqrtPriceTargetBToA.eq(MAX_SQRT_PRICE_BN));
      assert.equal(adaptiveFeeUpdateSkippedBToA, false);
    });

    it("advanceTickGroup", async () => {
      const feeRate = 3000;
      const feeRateManager = createStaticFeeRateManager(feeRate);

      assert.equal(feeRateManager.getTotalFeeRate(), feeRate);
      feeRateManager.advanceTickGroup();
      assert.equal(feeRateManager.getTotalFeeRate(), feeRate);
    });

    it("advanceTickGroupAfterSkip", async () => {
      const feeRate = 3000;
      const feeRateManager = createStaticFeeRateManager(feeRate);

      assert.throws(() => feeRateManager.advanceTickGroupAfterSkip(new anchor.BN(0), new anchor.BN(0), 0), /StaticFeeRateManager does not support advanceTickGroupAfterSkip/);
    });

    it("updateMajorSwapTimestamp", async () => {
      const feeRate = 3000;
      const feeRateManager = createStaticFeeRateManager(feeRate);

      assert.equal(feeRateManager.getTotalFeeRate(), feeRate);
      feeRateManager.updateMajorSwapTimestamp(new anchor.BN(0), new anchor.BN(0));
      assert.equal(feeRateManager.getTotalFeeRate(), feeRate);
    });

    it("getNextAdaptiveFeeInfo", async () => {
      const feeRate = 3000;
      const feeRateManager = createStaticFeeRateManager(feeRate);

      assert.equal(feeRateManager.getNextAdaptiveFeeInfo(), null);
    });
  });

  describe("AdaptiveFeeRateManager", () => {
    function now(): anchor.BN {
      return new anchor.BN(Math.floor(Date.now() / 1000));
    }

    function defaultAdaptiveFeeInfo(): AdaptiveFeeInfo {
      return {
        adaptiveFeeConstants: {
          filterPeriod: 30,
          decayPeriod: 600,
          maxVolatilityAccumulator: 350_000,
          reductionFactor: 500,
          adaptiveFeeControlFactor: 100,
          tickGroupSize: 64,
          majorSwapThresholdTicks: 64,
        },
        adaptiveFeeVariables: {
          lastReferenceUpdateTimestamp: new anchor.BN(1738863309),
          lastMajorSwapTimestamp: new anchor.BN(1738863309),
          tickGroupIndexReference: 1,
          volatilityReference: 500,
          volatilityAccumulator: 10000,
        },
      };
    }

    function checkTickGroupIndexAndVariables(
      feeRateManager: FeeRateManager,
      tickGroupIndex: number,
      lastReferenceUpdateTimestamp: anchor.BN,
      lastMajorSwapTimestamp: anchor.BN,
      tickGroupIndexReference: number,
      volatilityReference: number,
      volatilityAccumulator: number,
    ) {
      assert.equal(feeRateManager.constructor.name, "AdaptiveFeeRateManager");
      // HACK: check tickGroupIndex
      const feeRateManagerTickGroupIndex = (feeRateManager as unknown as { tickGroupIndex: number}).tickGroupIndex;
      assert.equal(feeRateManagerTickGroupIndex, tickGroupIndex);

      const variables = feeRateManager.getNextAdaptiveFeeInfo()?.adaptiveFeeVariables;
      assert.ok(variables);
      assert.equal(variables.lastReferenceUpdateTimestamp, lastReferenceUpdateTimestamp);
      assert.equal(variables.lastMajorSwapTimestamp, lastMajorSwapTimestamp);
      assert.equal(variables.tickGroupIndexReference, tickGroupIndexReference);
      assert.equal(variables.volatilityReference, volatilityReference);
      assert.equal(variables.volatilityAccumulator, volatilityAccumulator);
    }

    it("new, getNextAdaptiveFeeInfo", async () => {
      const adaptiveFeeInfo = defaultAdaptiveFeeInfo();
      const timestamp = now();
      const currentTickIndex = 128;
      const tickGroupIndex = Math.floor(currentTickIndex / adaptiveFeeInfo.adaptiveFeeConstants.tickGroupSize);
      const feeRateManager = FeeRateManager.new(
        true,
        currentTickIndex,
        timestamp,
        3000,
        adaptiveFeeInfo,
      );
      assert.equal(feeRateManager.constructor.name, "AdaptiveFeeRateManager");

      const nextAdaptiveFeeInfo = feeRateManager.getNextAdaptiveFeeInfo();
      assert.ok(nextAdaptiveFeeInfo);
      // constants should be the same
      assert.deepEqual(nextAdaptiveFeeInfo.adaptiveFeeConstants, adaptiveFeeInfo.adaptiveFeeConstants);

      // these variables should not be updated yet
      assert.equal(nextAdaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp.toString(), adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp.toString());
      assert.equal(nextAdaptiveFeeInfo.adaptiveFeeVariables.volatilityAccumulator, adaptiveFeeInfo.adaptiveFeeVariables.volatilityAccumulator);

      // references should be updated
      assert.equal(nextAdaptiveFeeInfo.adaptiveFeeVariables.lastReferenceUpdateTimestamp.toString(), timestamp.toString());
      assert.equal(nextAdaptiveFeeInfo.adaptiveFeeVariables.tickGroupIndexReference, tickGroupIndex);
      assert.equal(nextAdaptiveFeeInfo.adaptiveFeeVariables.volatilityReference, 0);
    });
    
    describe("updateReference", () => {
      it("lt filterPeriod", async () => {
        const timestamp = now();
        const adaptiveFeeConstants = defaultAdaptiveFeeInfo().adaptiveFeeConstants;

        const adaptiveFeeInfo: AdaptiveFeeInfo = {
          adaptiveFeeConstants,
          adaptiveFeeVariables: {
            lastReferenceUpdateTimestamp: timestamp,
            lastMajorSwapTimestamp: timestamp,
            tickGroupIndexReference: 1,
            volatilityReference: 500,
            volatilityAccumulator: 10000,
          },
        };

        const feeRateManager = FeeRateManager.new(
          true,
          640,
          timestamp.addn(adaptiveFeeConstants.filterPeriod - 1),
          3000,
          adaptiveFeeInfo,
        );

        const variables = feeRateManager.getNextAdaptiveFeeInfo()?.adaptiveFeeVariables;
        assert.ok(variables);
        // no change
        assert.equal(variables.lastReferenceUpdateTimestamp.toString(), timestamp.toString());
        assert.equal(variables.tickGroupIndexReference, 1);
        assert.equal(variables.volatilityReference, 500);
      });

      it("gte filterPeriod, lt decayPeriod", async () => {
        const timestamp = now();
        const adaptiveFeeConstants = defaultAdaptiveFeeInfo().adaptiveFeeConstants;

        const adaptiveFeeInfo: AdaptiveFeeInfo = {
          adaptiveFeeConstants,
          adaptiveFeeVariables: {
            lastReferenceUpdateTimestamp: timestamp,
            lastMajorSwapTimestamp: timestamp,
            tickGroupIndexReference: 1,
            volatilityReference: 500,
            volatilityAccumulator: 10000,
          },
        };

        const feeRateManager = FeeRateManager.new(
          true,
          640,
          timestamp.addn(adaptiveFeeConstants.decayPeriod - 1),
          3000,
          adaptiveFeeInfo,
        );

        const variables = feeRateManager.getNextAdaptiveFeeInfo()?.adaptiveFeeVariables;
        assert.ok(variables);
        // updated (reduction)
        assert.equal(variables.lastReferenceUpdateTimestamp.toString(), timestamp.addn(adaptiveFeeConstants.decayPeriod - 1).toString());
        assert.equal(variables.tickGroupIndexReference, 10);
        assert.equal(variables.volatilityReference, Math.floor(10000 * adaptiveFeeConstants.reductionFactor / REDUCTION_FACTOR_DENOMINATOR));
      });

      it("gte decayPeriod", async () => {
        const timestamp = now();
        const adaptiveFeeConstants = defaultAdaptiveFeeInfo().adaptiveFeeConstants;

        const adaptiveFeeInfo: AdaptiveFeeInfo = {
          adaptiveFeeConstants,
          adaptiveFeeVariables: {
            lastReferenceUpdateTimestamp: timestamp,
            lastMajorSwapTimestamp: timestamp,
            tickGroupIndexReference: 1,
            volatilityReference: 500,
            volatilityAccumulator: 10000,
          },
        };

        const feeRateManager = FeeRateManager.new(
          true,
          640,
          timestamp.addn(adaptiveFeeConstants.decayPeriod),
          3000,
          adaptiveFeeInfo,
        );

        const variables = feeRateManager.getNextAdaptiveFeeInfo()?.adaptiveFeeVariables;
        assert.ok(variables);
        // updated (reset)
        assert.equal(variables.lastReferenceUpdateTimestamp.toString(), timestamp.addn(adaptiveFeeConstants.decayPeriod).toString());
        assert.equal(variables.tickGroupIndexReference, 10);
        assert.equal(variables.volatilityReference, 0);
      });

      it("eq MAX_REFERENCE_AGE", async () => {
        const timestamp = now();
        const adaptiveFeeConstants = defaultAdaptiveFeeInfo().adaptiveFeeConstants;

        const adaptiveFeeInfo: AdaptiveFeeInfo = {
          adaptiveFeeConstants,
          adaptiveFeeVariables: {
            lastReferenceUpdateTimestamp: timestamp.subn(MAX_REFERENCE_AGE),
            lastMajorSwapTimestamp: timestamp,
            tickGroupIndexReference: 1,
            volatilityReference: 500,
            volatilityAccumulator: 10000,
          },
        };

        const feeRateManager = FeeRateManager.new(
          true,
          640,
          timestamp,
          3000,
          adaptiveFeeInfo,
        );

        const variables = feeRateManager.getNextAdaptiveFeeInfo()?.adaptiveFeeVariables;
        assert.ok(variables);
        // no change
        assert.equal(variables.lastReferenceUpdateTimestamp.toString(), timestamp.subn(MAX_REFERENCE_AGE).toString());
        assert.equal(variables.tickGroupIndexReference, 1);
        assert.equal(variables.volatilityReference, 500);
      });

      it("gt MAX_REFERENCE_AGE", async () => {
        const timestamp = now();
        const adaptiveFeeConstants = defaultAdaptiveFeeInfo().adaptiveFeeConstants;

        const adaptiveFeeInfo: AdaptiveFeeInfo = {
          adaptiveFeeConstants,
          adaptiveFeeVariables: {
            lastReferenceUpdateTimestamp: timestamp.subn(MAX_REFERENCE_AGE + 1),
            lastMajorSwapTimestamp: timestamp,
            tickGroupIndexReference: 1,
            volatilityReference: 500,
            volatilityAccumulator: 10000,
          },
        };

        const feeRateManager = FeeRateManager.new(
          true,
          640,
          timestamp,
          3000,
          adaptiveFeeInfo,
        );

        const variables = feeRateManager.getNextAdaptiveFeeInfo()?.adaptiveFeeVariables;
        assert.ok(variables);
        // updated (reset)
        assert.equal(variables.lastReferenceUpdateTimestamp.toString(), timestamp.toString());
        assert.equal(variables.tickGroupIndexReference, 10);
        assert.equal(variables.volatilityReference, 0);
      });
    });

    describe("getCoreTickGroupRange", () => {
      function test(
        tickGroupSize: number,
        tickGroupReference: number,
        volatilityReference: number,
        maxVolatilityAccumulator: number,
        expectedLowerTickGroupIndex: number | null,
        expectedUpperTickGroupIndex: number | null,
      ) {
        const adaptiveFeeConstants: AdaptiveFeeConstantsData = {
          ...defaultAdaptiveFeeInfo().adaptiveFeeConstants,
          tickGroupSize,
          maxVolatilityAccumulator,
        };

        const variables = new AdaptiveFeeVariables(
          new anchor.BN(1738863309),
          new anchor.BN(1738863309),
          tickGroupReference,
          volatilityReference,
          0,
        );
        
        const { coreTickGroupRangeLowerBound, coreTickGroupRangeUpperBound } = variables.getCoreTickGroupRange(adaptiveFeeConstants);
        assert.equal(coreTickGroupRangeLowerBound?.tickGroupIndex, expectedLowerTickGroupIndex ?? undefined);
        assert.equal(coreTickGroupRangeUpperBound?.tickGroupIndex, expectedUpperTickGroupIndex ?? undefined);
      }
      
      it("ts64", async () => {
        test(64, 0, 0, 350_000, -35, 35);
        test(64, 0, 0, 100_000, -10, 10);

        // shift by tick_group_reference
        test(64, 100, 0, 350_000, 65, 135);

        // volatility_reference should be used
        test(64, 100, 100_000, 350_000, 75, 125);

        // ceil should be used
        test(64, 100, 100_000, 350_001, 74, 126);
        test(64, 100, 100_000, 359_999, 74, 126);
        test(64, 100, 100_000, 360_000, 74, 126);
        test(64, 100, 100_000, 360_001, 73, 127);

        test(64, 100, 100_001, 350_000, 75, 125);
        test(64, 100, 109_999, 350_000, 75, 125);
        test(64, 100, 110_000, 350_000, 76, 124);
        test(64, 100, 110_001, 350_000, 76, 124);
        test(64, 100, 119_999, 350_000, 76, 124);

        // None if the left edge of lower bound is out of the tick range
        test(64, -6896, 0, 350_000, -6896 - 35, -6896 + 35);
        test(64, -6897, 0, 350_000, null, -6897 + 35);
        test(64, -6931, 0, 350_000, null, -6931 + 35);
        test(64, -6932, 0, 350_000, null, -6932 + 35);

        // None if the right edge of upper bound is out of the tick range
        test(64, 6895, 0, 350_000, 6895 - 35, 6895 + 35);
        test(64, 6896, 0, 350_000, 6896 - 35, null);
        test(64, 6930, 0, 350_000, 6930 - 35, null);
        test(64, 6931, 0, 350_000, 6931 - 35, null);

        // high volatility reference
        test(64, 0, 340_000, 350_000, -1, 1);
        test(64, 0, 349_999, 350_000, -1, 1);

        // zero max volatility accumulator (edge case: should set adaptive fee factor to 0 if adaptive fee is not used)
        test(64, 0, 0, 0, 0, 0);
        test(64, 100, 0, 0, 100, 100);
        test(64, -6931, 0, 0, -6931, -6931);
        test(64, -6932, 0, 0, null, -6932);
        test(64, 6930, 0, 0, 6930, 6930);
        test(64, 6931, 0, 0, 6931, null);
      });

      it("ts1", async () => {
        test(1, 0, 0, 350_000, -35, 35);
        test(1, 0, 0, 100_000, -10, 10);

        // shift by tick_group_reference
        test(1, 100, 0, 350_000, 65, 135);

        // None if the left edge of lower bound is out of the tick range
        // note: MIN_TICK_INDEX will not be the left edge of lower bound
        test(
            1,
            -443600,
            0,
            350_000,
            -443600 - 35,
            -443600 + 35,
        );
        test(1, -443601, 0, 350_000, null, -443601 + 35);
        test(1, -443602, 0, 350_000, null, -443602 + 35);
        test(1, -443635, 0, 350_000, null, -443635 + 35);
        test(1, -443636, 0, 350_000, null, -443636 + 35);
        test(1, -443637, 0, 350_000, null, -443637 + 35);

        // None if the right edge of upper bound is out of the tick range
        // note: MAX_TICK_INDEX will not be the right edge of upper bound
        test(1, 443599, 0, 350_000, 443599 - 35, 443599 + 35);
        test(1, 443600, 0, 350_000, 443600 - 35, null);
        test(1, 443601, 0, 350_000, 443601 - 35, null);
        test(1, 443635, 0, 350_000, 443635 - 35, null);
        test(1, 443636, 0, 350_000, 443636 - 35, null);

        // zero max volatility accumulator (edge case: should set adaptive fee factor to 0 if adaptive fee is not used)
        test(1, 0, 0, 0, 0, 0);
        test(1, 100, 0, 0, 100, 100);
        test(1, -443635, 0, 0, -443635, -443635);
        test(1, -443636, 0, 0, null, -443636);
        test(1, 443634, 0, 0, 443634, 443634);
        test(1, 443635, 0, 0, 443635, null);
      });
    });

    describe("updateVolatilityAccumulator and advanceTickGroup", () => {
      it("a to b", async () => {
        const staticFeeRate = 3000;
        const adaptiveFeeInfo = defaultAdaptiveFeeInfo();

        const currentTickIndex = 64;
        // reset references
        const timestamp = anchor.BN.max(
          adaptiveFeeInfo.adaptiveFeeVariables.lastReferenceUpdateTimestamp,
          adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp
        ).addn(adaptiveFeeInfo.adaptiveFeeConstants.decayPeriod);
        const feeRateManager = FeeRateManager.new(
          true,
          currentTickIndex,
          timestamp,
          staticFeeRate,
          adaptiveFeeInfo,
        );

        // delta = 0
        feeRateManager.updateVolatilityAccumulator();
        checkTickGroupIndexAndVariables(
          feeRateManager,
          1,
          timestamp,
          adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp,
          1,
          0,
          0,
        );
        
        // delta = 1
        feeRateManager.advanceTickGroup();
        feeRateManager.updateVolatilityAccumulator();
        checkTickGroupIndexAndVariables(
          feeRateManager,
          0,
          timestamp,
          adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp,
          1,
          0,
          VOLATILITY_ACCUMULATOR_SCALE_FACTOR
        );

        // delta = 2
        feeRateManager.advanceTickGroup();
        feeRateManager.updateVolatilityAccumulator();
        checkTickGroupIndexAndVariables(
          feeRateManager,
          -1,
          timestamp,
          adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp,
          1,
          0,
          2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR
        );

        // reductiiion
        const nextCurrentTickIndex = -32;
        const nextTimestamp = timestamp.addn(adaptiveFeeInfo.adaptiveFeeConstants.filterPeriod);
        const nextFeeRateManager = FeeRateManager.new(
          true,
          nextCurrentTickIndex,
          nextTimestamp,
          staticFeeRate,
          feeRateManager.getNextAdaptiveFeeInfo()!,
        );

        // delta = 0
        const nextVolatilityReference = Math.floor(2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR * adaptiveFeeInfo.adaptiveFeeConstants.reductionFactor / REDUCTION_FACTOR_DENOMINATOR);
        assert.ok(nextVolatilityReference > 0);
        nextFeeRateManager.updateVolatilityAccumulator();
        checkTickGroupIndexAndVariables(
          nextFeeRateManager,
          -1,
          nextTimestamp,
          adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp,
          -1,
          nextVolatilityReference,
          nextVolatilityReference,
        );

        // delta = 1
        nextFeeRateManager.advanceTickGroup();
        nextFeeRateManager.updateVolatilityAccumulator();
        checkTickGroupIndexAndVariables(
          nextFeeRateManager,
          -2,
          nextTimestamp,
          adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp,
          -1,
          nextVolatilityReference,
          nextVolatilityReference + VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );

        // delta = 2 - 100
        for (let delta = 2; delta <= 100; delta++) {
          nextFeeRateManager.advanceTickGroup();
          nextFeeRateManager.updateVolatilityAccumulator();
          checkTickGroupIndexAndVariables(
            nextFeeRateManager,
            -1 - delta,
            nextTimestamp,
            adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp,
            -1,
            nextVolatilityReference,
            Math.min(
              nextVolatilityReference + delta * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
              adaptiveFeeInfo.adaptiveFeeConstants.maxVolatilityAccumulator,
            ),
          );
        }
      });

      it("b to a", async () => {
        const staticFeeRate = 3000;
        const adaptiveFeeInfo = defaultAdaptiveFeeInfo();

        const currentTickIndex = 1024;
        // reset references
        const timestamp = anchor.BN.max(
          adaptiveFeeInfo.adaptiveFeeVariables.lastReferenceUpdateTimestamp,
          adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp
        ).addn(adaptiveFeeInfo.adaptiveFeeConstants.decayPeriod);
        const feeRateManager = FeeRateManager.new(
          false,
          currentTickIndex,
          timestamp,
          staticFeeRate,
          adaptiveFeeInfo,
        );

        // delta = 0
        feeRateManager.updateVolatilityAccumulator();
        checkTickGroupIndexAndVariables(
          feeRateManager,
          16,
          timestamp,
          adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp,
          16,
          0,
          0,
        );
        
        // delta = 1
        feeRateManager.advanceTickGroup();
        feeRateManager.updateVolatilityAccumulator();
        checkTickGroupIndexAndVariables(
          feeRateManager,
          17,
          timestamp,
          adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp,
          16,
          0,
          VOLATILITY_ACCUMULATOR_SCALE_FACTOR
        );

        // delta = 2
        feeRateManager.advanceTickGroup();
        feeRateManager.updateVolatilityAccumulator();
        checkTickGroupIndexAndVariables(
          feeRateManager,
          18,
          timestamp,
          adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp,
          16,
          0,
          2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR
        );

        // reductiiion
        const nextCurrentTickIndex = 1184;
        const nextTimestamp = timestamp.addn(adaptiveFeeInfo.adaptiveFeeConstants.filterPeriod);
        const nextFeeRateManager = FeeRateManager.new(
          false,
          nextCurrentTickIndex,
          nextTimestamp,
          staticFeeRate,
          feeRateManager.getNextAdaptiveFeeInfo()!,
        );

        // delta = 0
        const nextVolatilityReference = Math.floor(2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR * adaptiveFeeInfo.adaptiveFeeConstants.reductionFactor / REDUCTION_FACTOR_DENOMINATOR);
        assert.ok(nextVolatilityReference > 0);
        nextFeeRateManager.updateVolatilityAccumulator();
        checkTickGroupIndexAndVariables(
          nextFeeRateManager,
          18,
          nextTimestamp,
          adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp,
          18,
          nextVolatilityReference,
          nextVolatilityReference,
        );

        // delta = 1
        nextFeeRateManager.advanceTickGroup();
        nextFeeRateManager.updateVolatilityAccumulator();
        checkTickGroupIndexAndVariables(
          nextFeeRateManager,
          19,
          nextTimestamp,
          adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp,
          18,
          nextVolatilityReference,
          nextVolatilityReference + VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );

        // delta = 2 - 100
        for (let delta = 2; delta <= 100; delta++) {
          nextFeeRateManager.advanceTickGroup();
          nextFeeRateManager.updateVolatilityAccumulator();
          checkTickGroupIndexAndVariables(
            nextFeeRateManager,
            18 + delta,
            nextTimestamp,
            adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp,
            18,
            nextVolatilityReference,
            Math.min(
              nextVolatilityReference + delta * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
              adaptiveFeeInfo.adaptiveFeeConstants.maxVolatilityAccumulator,
            ),
          );
        }
      });
    });

    describe("computeAdaptiveFee", () => {
      function test(constants: AdaptiveFeeConstantsData, preCalculatedFeeRates: number[]) {
        const variables = new AdaptiveFeeVariables(
          new anchor.BN(0),
          new anchor.BN(0),
          0,
          0,
          0,
        );

        const timestamp = new anchor.BN(1738863309);
        const baseTickGroupIndex = 16;

        variables.updateReference(baseTickGroupIndex, timestamp, constants);
        for (let delta = 0; delta < preCalculatedFeeRates.length; delta++ ) {
            const tickGroupIndex = baseTickGroupIndex + delta;

            variables.updateVolatilityAccumulator(tickGroupIndex, constants);

            const feeRate = variables.computeAdaptiveFeeRate(constants);

            const volatilityAccumulator = delta * VOLATILITY_ACCUMULATOR_SCALE_FACTOR;
            const cappedVolatilityAccumulator = Math.min(volatilityAccumulator, constants.maxVolatilityAccumulator);

            const crossedTickIndexes = cappedVolatilityAccumulator * constants.tickGroupSize;
            const squaredCrossedTickIndexes = new anchor.BN(crossedTickIndexes).mul(new anchor.BN(crossedTickIndexes));
            const numerator = new anchor.BN(constants.adaptiveFeeControlFactor).mul(squaredCrossedTickIndexes);
            const denominator = new anchor.BN(ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR).muln(VOLATILITY_ACCUMULATOR_SCALE_FACTOR).muln(VOLATILITY_ACCUMULATOR_SCALE_FACTOR);
            const expectedFeeRate = numerator.add(denominator.subn(1)).div(denominator);

            const cappedExpectedFeeRate = anchor.BN.min(expectedFeeRate, new anchor.BN(FEE_RATE_HARD_LIMIT)).toNumber();

            assert.equal(feeRate, cappedExpectedFeeRate);
            assert.equal(feeRate, preCalculatedFeeRates[delta]);
        }
      }

      it("max volatility accumulator should bound fee rate", async () => {
        test(
            // copied from the contract test cases
            {

                maxVolatilityAccumulator: 350_000,
                adaptiveFeeControlFactor: 1500,
                tickGroupSize: 64,
                majorSwapThresholdTicks: 64,
                filterPeriod: 30,
                decayPeriod: 600,
                reductionFactor: 5000,
            },
            [
                0, 62, 246, 553, 984, 1536, 2212, 3011, 3933, 4977, 6144, 7435, 8848, 10384,
                12043, 13824, 15729, 17757, 19907, 22180, 24576, 27096, 29737, 32502, 35390,
                38400, 41534, 44790, 48169, 51672, 55296, 59044, 62915, 66909, 71025, 75264,
                75264, 75264, 75264, 75264, 75264, 75264, 75264, 75264, 75264, 75264, 75264,
                75264, 75264, 75264,
            ],
        );
      });

      it("fee rate hard limit should bound fee rate", async () => {
        test(
            // copied from the contract test cases
            {
              maxVolatilityAccumulator: 450_000,
              adaptiveFeeControlFactor: 1500,
              tickGroupSize: 64,
              majorSwapThresholdTicks: 64,
              filterPeriod: 30,
              decayPeriod: 600,
              reductionFactor: 5000,
          },
          [
              0, 62, 246, 553, 984, 1536, 2212, 3011, 3933, 4977, 6144, 7435, 8848, 10384,
              12043, 13824, 15729, 17757, 19907, 22180, 24576, 27096, 29737, 32502, 35390,
              38400, 41534, 44790, 48169, 51672, 55296, 59044, 62915, 66909, 71025, 75264,
              79627, 84112, 88720, 93451, 98304, 100000, 100000, 100000, 100000, 100000,
              100000, 100000, 100000, 100000,
          ],
        );
      });

      it("fee rate is not bounded in this range", async () => {
        test(
            // copied from the contract test cases
            {
                maxVolatilityAccumulator: 500_000,
                adaptiveFeeControlFactor: 1000,
                tickGroupSize: 64,
                majorSwapThresholdTicks: 64,
                filterPeriod: 30,
                decayPeriod: 600,
                reductionFactor: 5000,
            },
            [
                0, 41, 164, 369, 656, 1024, 1475, 2008, 2622, 3318, 4096, 4957, 5899, 6923,
                8029, 9216, 10486, 11838, 13272, 14787, 16384, 18064, 19825, 21668, 23593,
                25600, 27689, 29860, 32113, 34448, 36864, 39363, 41944, 44606, 47350, 50176,
                53085, 56075, 59147, 62301, 65536, 68854, 72254, 75736, 79299, 82944, 86672,
                90481, 94372, 98345,
            ],
        );
      });
    });

    it("getTotalFeeRate", async () => {
        const adaptiveFeeInfo: AdaptiveFeeInfo = {
            adaptiveFeeConstants: {
                maxVolatilityAccumulator: 450_000,
                adaptiveFeeControlFactor: 1500,
                tickGroupSize: 64,
                majorSwapThresholdTicks: 64,
                filterPeriod: 30,
                decayPeriod: 600,
                reductionFactor: 5000,
            },
            adaptiveFeeVariables: {
              lastReferenceUpdateTimestamp: new anchor.BN(0),
              lastMajorSwapTimestamp: new anchor.BN(0),
              tickGroupIndexReference: 0,
              volatilityReference: 0,
              volatilityAccumulator: 0,
            },
        };

        const timestamp = new anchor.BN(1738863309);
        const staticFeeRate = 10_000; // 1%

        const feeRateManager = FeeRateManager.new(
          true,
          1024,
          timestamp,
          staticFeeRate,
          adaptiveFeeInfo,
        );

        // copied from the contract test cases
        const preCalculatedTotalFeeRates = [
            10000, 10062, 10246, 10553, 10984, 11536, 12212, 13011, 13933, 14977, 16144, 17435,
            18848, 20384, 22043, 23824, 25729, 27757, 29907, 32180, 34576, 37096, 39737, 42502,
            45390, 48400, 51534, 54790, 58169, 61672, 65296, 69044, 72915, 76909, 81025, 85264,
            89627, 94112, 98720, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000,
            100000, 100000, 100000,
        ];

        for (const preCalculatedTotalFeeRate of preCalculatedTotalFeeRates) {
            feeRateManager.updateVolatilityAccumulator();

            const totalFeeRate = feeRateManager.getTotalFeeRate();
            assert.equal(totalFeeRate, preCalculatedTotalFeeRate);

            feeRateManager.advanceTickGroup();
        }
    });

    describe("getBoundedSqrtPriceTarget", () => {
      function test(feeRateManager: FeeRateManager, sqrtPrice: anchor.BN, liquidity: anchor.BN, expectedBoundedSqrtPrice: anchor.BN, expectedAdaptiveFeeUpdateSkipped: boolean) {
          const result = feeRateManager.getBoundedSqrtPriceTarget(sqrtPrice, liquidity);
          assert.ok(result.boundedSqrtPriceTarget.eq(expectedBoundedSqrtPrice));
          assert.equal(result.adaptiveFeeUpdateSkipped, expectedAdaptiveFeeUpdateSkipped);
      }
  
      it("a to b without skip", async () => {
        const staticFeeRate = 3000;
        const adaptiveFeeInfo = defaultAdaptiveFeeInfo();
        const nonZeroLiquidity = new anchor.BN(1_000_000_000);

        const currentTickIndex = 1024 + 32;
        // reset references
        const timestamp = anchor.BN.max(adaptiveFeeInfo.adaptiveFeeVariables.lastReferenceUpdateTimestamp, adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp)
            .addn(adaptiveFeeInfo.adaptiveFeeConstants.decayPeriod);
        const feeRateManager = FeeRateManager.new(
            true,
            currentTickIndex,
            timestamp,
            staticFeeRate,
            adaptiveFeeInfo,
        );

        // a to b = right(positive) to left(negative)

        // sqrt_price is near than the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 16),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 16),
          false,
        );

        // sqrt_price is on the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024),
          false,
        );

        // sqrt_price is far than the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024 - 16),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024),
          false,
        );

        // sqrt_price is very far than the boundary
        test(
          feeRateManager,
          MIN_SQRT_PRICE_BN,
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024),
          false,
        );

        feeRateManager.advanceTickGroup();

        test(
          feeRateManager,
          MIN_SQRT_PRICE_BN,
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 - 64),
          false,
        );
      });
      
      it("a to b with zero liquidity skip", async () => {
        const staticFeeRate = 3000;
        const adaptiveFeeInfo = defaultAdaptiveFeeInfo();
        const zeroLiquidity = new anchor.BN(0);

        const currentTickIndex = 1024 + 32;
        // reset references
        const timestamp = anchor.BN.max(adaptiveFeeInfo.adaptiveFeeVariables.lastReferenceUpdateTimestamp, adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp)
            .addn(adaptiveFeeInfo.adaptiveFeeConstants.decayPeriod);
        const feeRateManager = FeeRateManager.new(
            true,
            currentTickIndex,
            timestamp,
            staticFeeRate,
            adaptiveFeeInfo,
        );

        // a to b = right(positive) to left(negative)

        // sqrt_price is near than the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 16),
          zeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 16),
          true,
        );

        // sqrt_price is on the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024),
          zeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024),
          true,
        );

        // sqrt_price is far than the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024 - 16),
          zeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 - 16),
          true,
        );

        // sqrt_price is very far than the boundary
        test(
          feeRateManager,
          MIN_SQRT_PRICE_BN,
          zeroLiquidity,
          MIN_SQRT_PRICE_BN,
          true,
        );

        feeRateManager.advanceTickGroup();

        test(
          feeRateManager,
          MIN_SQRT_PRICE_BN,
          zeroLiquidity,
          MIN_SQRT_PRICE_BN,
          true,
        );
      });

      it("a to b with adaptive fee factor skip", async () => {
        const staticFeeRate = 3000;
        const adaptiveFeeInfo = defaultAdaptiveFeeInfo();
        const nonZeroLiquidity = new anchor.BN(1_000_000_000);

        // adaptive fee factor is zero
        adaptiveFeeInfo.adaptiveFeeConstants.adaptiveFeeControlFactor = 0;

        const currentTickIndex = 1024 + 32;
        // reset references
        const timestamp = anchor.BN.max(adaptiveFeeInfo.adaptiveFeeVariables.lastReferenceUpdateTimestamp, adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp);
        const feeRateManager = FeeRateManager.new(
          true,
          currentTickIndex,
          timestamp,
          staticFeeRate,
          adaptiveFeeInfo,
        );

        // a to b = right(positive) to left(negative)

        // sqrt_price is near than the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 16),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 16),
          true,
        );

        // sqrt_price is on the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024),
          true,
        );

        // sqrt_price is far than the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024 - 16),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 - 16),
          true,
        );

        // sqrt_price is very far than the boundary
        test(
          feeRateManager,
          MIN_SQRT_PRICE_BN,
          nonZeroLiquidity,
          MIN_SQRT_PRICE_BN,
          true,
        );

        feeRateManager.advanceTickGroup();

        test(
          feeRateManager,
          MIN_SQRT_PRICE_BN,
          nonZeroLiquidity,
          MIN_SQRT_PRICE_BN,
          true,
        );
      });

      it("a to b with max volatility skip", async () => {
        const staticFeeRate = 3000;
        const nonZeroLiquidity = new anchor.BN(1_000_000_000);

        const timestamp = new anchor.BN(1_000);
        const aToB = true;

        const adaptiveFeeInfo: AdaptiveFeeInfo = {
            adaptiveFeeConstants: {
                maxVolatilityAccumulator: 80_000,
                adaptiveFeeControlFactor: 1500,
                tickGroupSize: 64,
                majorSwapThresholdTicks: 64,
                filterPeriod: 30,
                decayPeriod: 600,
                reductionFactor: 5000,
            },
            adaptiveFeeVariables: {
                lastReferenceUpdateTimestamp: timestamp,
                lastMajorSwapTimestamp: timestamp,
                tickGroupIndexReference: 0,
                volatilityAccumulator: 0,
                volatilityReference: 0,
            },
        };

        // a to b = right(positive) to left(negative)
        // core range [-8, 8]

        // right side of core range
        {
        const currentTickIndex = 2048;
        const feeRateManager = FeeRateManager.new(
            aToB,
            currentTickIndex,
            timestamp,
            staticFeeRate,
            adaptiveFeeInfo,
        );

        // sqrt_price is near than the boundary (core range right end)
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024),
          true,
        );

        // sqrt_price is far than the boundary
        test(
          feeRateManager,
          MIN_SQRT_PRICE_BN,
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(8 * 64 + 64),
          true,
        );
      }

        // in core range
        {
        const currentTickIndex = 64 * 8 + 32;
        const feeRateManager = FeeRateManager.new(
            aToB,
            currentTickIndex,
            timestamp,
            staticFeeRate,
            adaptiveFeeInfo,
        );

        // sqrt_price is near than the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(64 * 8 + 16),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(64 * 8 + 16),
          false,
        );

        // sqrt_price is far than the boundary
        test(
          feeRateManager,
          MIN_SQRT_PRICE_BN,
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(64 * 8),
          false,
        );

        feeRateManager.advanceTickGroup();

        test(
          feeRateManager,
          MIN_SQRT_PRICE_BN,
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(64 * 7),
          false,
        );
      }

        // left side of core range
        {
        const currentTickIndex = -2048;
        const feeRateManager = FeeRateManager.new(
            aToB,
            currentTickIndex,
            timestamp,
            staticFeeRate,
            adaptiveFeeInfo,
        );

        // no boundary
        test(
          feeRateManager,
          MIN_SQRT_PRICE_BN,
          nonZeroLiquidity,
          MIN_SQRT_PRICE_BN,
          true,
        );
        }
      });

      it("b to a without skip", async () => {
        const staticFeeRate = 3000;
        const adaptiveFeeInfo = defaultAdaptiveFeeInfo();
        const nonZeroLiquidity = new anchor.BN(1_000_000_000);

        const currentTickIndex = 1024 + 32;
        // reset references
        const timestamp = anchor.BN.max(adaptiveFeeInfo.adaptiveFeeVariables.lastReferenceUpdateTimestamp, adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp);
        const feeRateManager = FeeRateManager.new(
          false,
          currentTickIndex,
          timestamp,
          staticFeeRate,
          adaptiveFeeInfo,
        );

        // b to a = left(negative) to right(positive)

        // sqrt_price is near than the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 32 + 16),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 32 + 16),
          false,
        );

        // sqrt_price is on the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 64),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 64),
          false,
        );

        // sqrt_price is far than the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 64 + 16),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 64),
          false,
        );

        // sqrt_price is very far than the boundary
        test(
          feeRateManager,
          MAX_SQRT_PRICE_BN,
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 64),
          false,
        );

        feeRateManager.advanceTickGroup();

        test(
          feeRateManager,
          MAX_SQRT_PRICE_BN,
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 64 + 64),
          false,
        );
      });

      it("b to a with zero liquidity skip", async () => {
        const staticFeeRate = 3000;
        const adaptiveFeeInfo = defaultAdaptiveFeeInfo();
        const zeroLiquidity = new anchor.BN(0);

        const currentTickIndex = 1024 + 32;
        // reset references
        const timestamp = anchor.BN.max(adaptiveFeeInfo.adaptiveFeeVariables.lastReferenceUpdateTimestamp, adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp);
        const feeRateManager = FeeRateManager.new(
          false,
          currentTickIndex,
          timestamp,
          staticFeeRate,
          adaptiveFeeInfo,
        );

        // b to a = left(negative) to right(positive)

        // sqrt_price is near than the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 32 + 16),
          zeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 32 + 16),
          true,
        );

        // sqrt_price is on the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 64),
          zeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 64),
          true,
        );

        // sqrt_price is far than the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 64 + 16),
          zeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 64 + 16),
          true,
        );

        // sqrt_price is very far than the boundary
        test(
          feeRateManager,
          MAX_SQRT_PRICE_BN,
          zeroLiquidity,
          MAX_SQRT_PRICE_BN,
          true,
        );

        feeRateManager.advanceTickGroup();

        test(
          feeRateManager,
          MAX_SQRT_PRICE_BN,
          zeroLiquidity,
          MAX_SQRT_PRICE_BN,
          true,
        );
      });

      it("b to a with adaptive fee factor skip", async () => {
        const staticFeeRate = 3000;
        const adaptiveFeeInfo = defaultAdaptiveFeeInfo();
        const nonZeroLiquidity = new anchor.BN(1_000_000_000);

        // adaptive fee factor is zero
        adaptiveFeeInfo.adaptiveFeeConstants.adaptiveFeeControlFactor = 0;

        const currentTickIndex = 1024 + 32;
        // reset references
        const timestamp = anchor.BN.max(adaptiveFeeInfo.adaptiveFeeVariables.lastReferenceUpdateTimestamp, adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp);
        const feeRateManager = FeeRateManager.new(
          false,
          currentTickIndex,
          timestamp,
          staticFeeRate,
          adaptiveFeeInfo,
        );

        // b to a = left(negative) to right(positive)

        // sqrt_price is near than the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 32 + 16),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 32 + 16),
          true,
        );

        // sqrt_price is on the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 64),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 64),
          true,
        );

        // sqrt_price is far than the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 64 + 16),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(1024 + 64 + 16),
          true,
        );

        // sqrt_price is very far than the boundary
        test(
          feeRateManager,
          MAX_SQRT_PRICE_BN,
          nonZeroLiquidity,
          MAX_SQRT_PRICE_BN,
          true,
        );

        feeRateManager.advanceTickGroup();

        test(
          feeRateManager,
          MAX_SQRT_PRICE_BN,
          nonZeroLiquidity,
          MAX_SQRT_PRICE_BN,
          true,
        );
      });

      it("b to a with max volatility skip", async () => {
        const staticFeeRate = 3000;
        const nonZeroLiquidity = new anchor.BN(1_000_000_000);

        const timestamp = new anchor.BN(1_000);
        const aToB = false;

        const adaptiveFeeInfo: AdaptiveFeeInfo = {
            adaptiveFeeConstants: {
                maxVolatilityAccumulator: 80_000,
                adaptiveFeeControlFactor: 1500,
                tickGroupSize: 64,
                majorSwapThresholdTicks: 64,
                filterPeriod: 30,
                decayPeriod: 600,
                reductionFactor: 5000,
            },
            adaptiveFeeVariables: {
                lastReferenceUpdateTimestamp: timestamp,
                lastMajorSwapTimestamp: timestamp,
                tickGroupIndexReference: 0,
                volatilityAccumulator: 0,
                volatilityReference: 0,
            },
        };

        // b to a = left(negative) to right(positive)
        // core range [-8, 8]

        // right side of core range
        {
        const currentTickIndex = 2048;
        const feeRateManager = FeeRateManager.new(
            aToB,
            currentTickIndex,
            timestamp,
            staticFeeRate,
            adaptiveFeeInfo,
        );

        // no boundary
        test(
          feeRateManager,
          MAX_SQRT_PRICE_BN,
          nonZeroLiquidity,
          MAX_SQRT_PRICE_BN,
          true,
        );
        }

        // in core range
        {
        const currentTickIndex = 64 * -8 + 32;
        const feeRateManager = FeeRateManager.new(
            aToB,
            currentTickIndex,
            timestamp,
            staticFeeRate,
            adaptiveFeeInfo,
        );

        // sqrt_price is near than the boundary
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(64 * -8 + 32 + 16),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(64 * -8 + 32 + 16),
          false,
        );

        // sqrt_price is far than the boundary
        test(
          feeRateManager,
          MAX_SQRT_PRICE_BN,
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(64 * -8 + 64),
          false,
        );

        feeRateManager.advanceTickGroup();

        test(
          feeRateManager,
          MAX_SQRT_PRICE_BN,
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(64 * -8 + 64 + 64),
          false,
        );
        }

        // left side of core range
        {
        const currentTickIndex = -2048;
        const feeRateManager = FeeRateManager.new(
            aToB,
            currentTickIndex,
            timestamp,
            staticFeeRate,
            adaptiveFeeInfo,
        );

        // sqrt_price is near than the boundary (core range left end)
        test(
          feeRateManager,
          PriceMath.tickIndexToSqrtPriceX64(-1024),
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(-1024),
          true,
        );

        // sqrt_price is far than the boundary
        test(
          feeRateManager,
          MAX_SQRT_PRICE_BN,
          nonZeroLiquidity,
          PriceMath.tickIndexToSqrtPriceX64(-8 * 64),
          true,
        );
      }

      });
    });

    describe("advanceTickGroupAfterSkip", () => {
      function buildFeeRateManager(aToB: boolean, currentTickIndex: number) {
        const timestamp = new anchor.BN(1_000);
        const staticFeeRate = 3_000;

        const adaptiveFeeInfo: AdaptiveFeeInfo = {
            adaptiveFeeConstants: {
                maxVolatilityAccumulator: 88 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
                adaptiveFeeControlFactor: 5_000,
                tickGroupSize: 64,
                majorSwapThresholdTicks: 64,
                filterPeriod: 30,
                decayPeriod: 600,
                reductionFactor: 5000,
            },
            adaptiveFeeVariables: {
                lastReferenceUpdateTimestamp: timestamp,
                lastMajorSwapTimestamp: timestamp,
                tickGroupIndexReference: 0,
                volatilityAccumulator: 0,
                volatilityReference: 0,
            },
        };

        return FeeRateManager.new(
            aToB,
            currentTickIndex,
            timestamp,
            staticFeeRate,
            adaptiveFeeInfo,
        );
      }

      function test(
        aToB: boolean,
        currentTickIndex: number,
        advanceCurrentSqrtPrice: anchor.BN,
        advanceNextTickSqrtPrice: anchor.BN,
        advanceNextTickIndex: number,
        expectedTickGroupIndex: number,
        expectedVolatilityAccumulator: number,
      ) {
        const feeRateManager = buildFeeRateManager(aToB, currentTickIndex);

        // to simulate swap loop
        feeRateManager.updateVolatilityAccumulator();

        feeRateManager
            .advanceTickGroupAfterSkip(
                advanceCurrentSqrtPrice,
                advanceNextTickSqrtPrice,
                advanceNextTickIndex,
            );

        const variables = feeRateManager.getNextAdaptiveFeeInfo()!.adaptiveFeeVariables;
        checkTickGroupIndexAndVariables(
          feeRateManager,
          expectedTickGroupIndex, // check
          variables.lastReferenceUpdateTimestamp,
          variables.lastMajorSwapTimestamp,
          variables.tickGroupIndexReference,
          variables.volatilityReference,
          expectedVolatilityAccumulator, // check
        );
    }

    it("a to b", async () => {
      // right to left
      const aToB = true;
      const tickGroupSize = 64;
      const maxVolatilityAccumulator = 88 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR;

      // In advance_tick_group_after_skip, tick_group_index will be shifted to left by 1 for the next loop.
      // If it is not a tick_group_size boundary, shifting will advance too much,
      // but tick_group_index is not recorded in the chain and the loop ends, so there is no adverse effect on subsequent processing.
      const LEFT_SHIFT = 1;

      // hit next tick
      // tick(1023) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(1023),
          PriceMath.tickIndexToSqrtPriceX64(1023),
          1023,
          15 - LEFT_SHIFT,
          15 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // tick(65) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(65),
          PriceMath.tickIndexToSqrtPriceX64(65),
          65,
          1 - LEFT_SHIFT,
          VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // tick(64) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(64),
          PriceMath.tickIndexToSqrtPriceX64(64),
          64,
          1 - LEFT_SHIFT,
          VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // tick(32) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(32),
          PriceMath.tickIndexToSqrtPriceX64(32),
          32,
          0 - LEFT_SHIFT,
          0,
      );
      // tick(0) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(0),
          PriceMath.tickIndexToSqrtPriceX64(0),
          0,
          0 - LEFT_SHIFT,
          0,
      );
      // tick(-32) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(-32),
          PriceMath.tickIndexToSqrtPriceX64(-32),
          -32,
          -1 - LEFT_SHIFT,
          VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // tick(-64) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(-64),
          PriceMath.tickIndexToSqrtPriceX64(-64),
          -64,
          -1 - LEFT_SHIFT,
          VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // tick(-65) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(-65),
          PriceMath.tickIndexToSqrtPriceX64(-65),
          -65,
          -2 - LEFT_SHIFT,
          2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // tick(-127) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(-127),
          PriceMath.tickIndexToSqrtPriceX64(-127),
          -127,
          -2 - LEFT_SHIFT,
          2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // tick(-128) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(-128),
          PriceMath.tickIndexToSqrtPriceX64(-128),
          -128,
          -2 - LEFT_SHIFT,
          2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // MIN_SQRT_PRICE <-- 1024
      test(
          aToB,
          1024,
          MIN_SQRT_PRICE_BN,
          MIN_SQRT_PRICE_BN,
          MIN_TICK_INDEX,
          Math.floor(MIN_TICK_INDEX / tickGroupSize) - LEFT_SHIFT,
          maxVolatilityAccumulator,
      );

      // NOT hit next tick
      // tick(1023) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(1023).addn(1),
          PriceMath.tickIndexToSqrtPriceX64(1023),
          1023,
          15 - LEFT_SHIFT,
          15 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // tick(65) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(65 + 1),
          PriceMath.tickIndexToSqrtPriceX64(65),
          65,
          1 - LEFT_SHIFT,
          VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // tick(64) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(64 + 1),
          PriceMath.tickIndexToSqrtPriceX64(64),
          64,
          1 - LEFT_SHIFT,
          VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // tick(32) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(32 + 1),
          PriceMath.tickIndexToSqrtPriceX64(32),
          32,
          0 - LEFT_SHIFT,
          0,
      );
      // tick(0) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(1),
          PriceMath.tickIndexToSqrtPriceX64(0),
          0,
          0 - LEFT_SHIFT,
          0,
      );
      // tick(-32) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(-32 + 1),
          PriceMath.tickIndexToSqrtPriceX64(-32),
          -32,
          -1 - LEFT_SHIFT,
          VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // tick(-64) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(-64 + 1),
          PriceMath.tickIndexToSqrtPriceX64(-64),
          -64,
          -1 - LEFT_SHIFT,
          VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // tick(-65) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(-65 + 1),
          PriceMath.tickIndexToSqrtPriceX64(-65),
          -65,
          -1 - LEFT_SHIFT,
          VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // tick(-127) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(-127 + 1),
          PriceMath.tickIndexToSqrtPriceX64(-127),
          -127,
          -2 - LEFT_SHIFT,
          2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // tick(-128) <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(-128 + 1),
          PriceMath.tickIndexToSqrtPriceX64(-128),
          -128,
          -2 - LEFT_SHIFT,
          2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // MIN_SQRT_PRICE <-- 1024
      test(
          aToB,
          1024,
          PriceMath.tickIndexToSqrtPriceX64(-64 * 44),
          MIN_SQRT_PRICE_BN,
          MIN_TICK_INDEX,
          Math.floor((-64 * 44) / tickGroupSize) - LEFT_SHIFT,
          44 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
      );
      // tick(8448) <-- 11264 (out of core range)
      test(
          aToB,
          11264,
          PriceMath.tickIndexToSqrtPriceX64(8448),
          PriceMath.tickIndexToSqrtPriceX64(8448),
          8448,
          132 - LEFT_SHIFT,
          maxVolatilityAccumulator,
      );
      // tick(11264) <-- 11264 (out of core range, amount is collected as fee, no price change)
      test(
          aToB,
          11264,
          PriceMath.tickIndexToSqrtPriceX64(11264),
          PriceMath.tickIndexToSqrtPriceX64(8448),
          8448,
          176 - LEFT_SHIFT,
          maxVolatilityAccumulator,
      );
  });

    it("b to a", async () => {
        // left to right
        const aToB = false;
        const tickGroupSize = 64;
        const maxVolatilityAccumulator = 88 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR;

        // In advance_tick_group_after_skip, tick_group_index will be shifted to right by 1 for the next loop.
        // If it is not a tick_group_size boundary, shifting will advance too much,
        // but tick_group_index is not recorded in the chain and the loop ends, so there is no adverse effect on subsequent processing.
        const RIGHT_SHIFT = 1;

        // hit next tick
        // -1024 --> tick(-1023)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(-1023),
            PriceMath.tickIndexToSqrtPriceX64(-1023),
            -1023,
            -16 + RIGHT_SHIFT,
            16 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -1024 --> tick(-65)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(-65),
            PriceMath.tickIndexToSqrtPriceX64(-65),
            -65,
            -2 + RIGHT_SHIFT,
            2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -1024 --> tick(-64)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(-64),
            PriceMath.tickIndexToSqrtPriceX64(-64),
            -64,
            -2 + RIGHT_SHIFT,
            2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -1024 --> tick(-32)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(-32),
            PriceMath.tickIndexToSqrtPriceX64(-32),
            -32,
            -1 + RIGHT_SHIFT,
            VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -1024 --> tick(0)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(0),
            PriceMath.tickIndexToSqrtPriceX64(0),
            0,
            -1 + RIGHT_SHIFT,
            VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -1024 --> tick(32)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(32),
            PriceMath.tickIndexToSqrtPriceX64(32),
            32,
            0 + RIGHT_SHIFT,
            0,
        );
        // -1024 --> tick(64)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(64),
            PriceMath.tickIndexToSqrtPriceX64(64),
            64,
            0 + RIGHT_SHIFT,
            0,
        );
        // -1024 --> tick(65)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(65),
            PriceMath.tickIndexToSqrtPriceX64(65),
            65,
            1 + RIGHT_SHIFT,
            VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -1024 --> tick(127)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(127),
            PriceMath.tickIndexToSqrtPriceX64(127),
            127,
            1 + RIGHT_SHIFT,
            VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -1024 --> tick(128)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(128),
            PriceMath.tickIndexToSqrtPriceX64(128),
            128,
            1 + RIGHT_SHIFT,
            VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -1024 --> MAX_SQRT_PRICE
        test(
            aToB,
            -1024,
            MAX_SQRT_PRICE_BN,
            MAX_SQRT_PRICE_BN,
            MAX_TICK_INDEX,
            Math.floor(MAX_TICK_INDEX / tickGroupSize) + RIGHT_SHIFT,
            maxVolatilityAccumulator,
        );

        // NOT hit next tick
        // -1024 --> tick(-1023)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(-1023).subn(1),
            PriceMath.tickIndexToSqrtPriceX64(-1023),
            -1023,
            -16 + RIGHT_SHIFT,
            16 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -1024 --> tick(-65)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(-65 - 1),
            PriceMath.tickIndexToSqrtPriceX64(-65),
            -65,
            -2 + RIGHT_SHIFT,
            2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -1024 --> tick(-64)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(-64 - 1),
            PriceMath.tickIndexToSqrtPriceX64(-64),
            -64,
            -2 + RIGHT_SHIFT,
            2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -1024 --> tick(-32)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(-32 - 1),
            PriceMath.tickIndexToSqrtPriceX64(-32),
            -32,
            -1 + RIGHT_SHIFT,
            VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -1024 --> tick(0)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(0 - 1),
            PriceMath.tickIndexToSqrtPriceX64(0),
            0,
            -1 + RIGHT_SHIFT,
            VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -1024 --> tick(32)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(32 - 1),
            PriceMath.tickIndexToSqrtPriceX64(32),
            32,
            0 + RIGHT_SHIFT,
            0,
        );
        // -1024 --> tick(64)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(64 - 1),
            PriceMath.tickIndexToSqrtPriceX64(64),
            64,
            0 + RIGHT_SHIFT,
            0,
        );
        // -1024 --> tick(65)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(65 - 1),
            PriceMath.tickIndexToSqrtPriceX64(65),
            65,
            0 + RIGHT_SHIFT,
            0,
        );
        // -1024 --> tick(127)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(127 - 1),
            PriceMath.tickIndexToSqrtPriceX64(127),
            127,
            1 + RIGHT_SHIFT,
            VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -1024 --> tick(128)
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(128 - 1),
            PriceMath.tickIndexToSqrtPriceX64(128),
            128,
            1 + RIGHT_SHIFT,
            VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -1024 --> MAX_SQRT_PRICE
        test(
            aToB,
            -1024,
            PriceMath.tickIndexToSqrtPriceX64(64 * 44),
            MAX_SQRT_PRICE_BN,
            MAX_TICK_INDEX,
            Math.floor((64 * (44 - 1)) / tickGroupSize) + RIGHT_SHIFT,
            (44 - 1) * VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        );
        // -11264 --> tick(-8448) (out of core range)
        test(
            aToB,
            -11264,
            PriceMath.tickIndexToSqrtPriceX64(-8448),
            PriceMath.tickIndexToSqrtPriceX64(-8448),
            -8448,
            -133 + RIGHT_SHIFT,
            maxVolatilityAccumulator,
        );
        // -11264 --> tick(-11264) (out of core range, amount is collected as fee, no price change)
        test(
            aToB,
            -11264,
            PriceMath.tickIndexToSqrtPriceX64(-11264),
            PriceMath.tickIndexToSqrtPriceX64(-8448),
            -8448,
            -176 + RIGHT_SHIFT,
            maxVolatilityAccumulator,
        );
    });
    });

    describe("updateMajorSwapTimestamp", () => {
      it("a to b", async () => {
        const adaptiveFeeInfo = defaultAdaptiveFeeInfo();
        const timestamp = now();
        const currentTickIndex = 128;

        const feeRateManager = FeeRateManager.new(
          true,
          currentTickIndex,
          timestamp,
          3000,
          adaptiveFeeInfo,
        );

        const majorSwapThresholdTicks = adaptiveFeeInfo.adaptiveFeeConstants.majorSwapThresholdTicks;

        const preSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(currentTickIndex);
        const postSqrtPriceMinor = PriceMath.tickIndexToSqrtPriceX64(currentTickIndex - majorSwapThresholdTicks + 1);
        const postSqrtPriceMajor = PriceMath.tickIndexToSqrtPriceX64(currentTickIndex - majorSwapThresholdTicks - 1);

        // minor: no update
        assert.ok(feeRateManager.getNextAdaptiveFeeInfo()?.adaptiveFeeVariables.lastMajorSwapTimestamp.lt(timestamp));
        feeRateManager.updateMajorSwapTimestamp(preSqrtPrice, postSqrtPriceMinor);
        assert.ok(feeRateManager.getNextAdaptiveFeeInfo()?.adaptiveFeeVariables.lastMajorSwapTimestamp.lt(timestamp));

        // major: update
        assert.ok(feeRateManager.getNextAdaptiveFeeInfo()?.adaptiveFeeVariables.lastMajorSwapTimestamp.lt(timestamp));
        feeRateManager.updateMajorSwapTimestamp(preSqrtPrice, postSqrtPriceMajor);
        assert.ok(feeRateManager.getNextAdaptiveFeeInfo()?.adaptiveFeeVariables.lastMajorSwapTimestamp.eq(timestamp));
      });

      it("b to a", async () => {
        const adaptiveFeeInfo = defaultAdaptiveFeeInfo();
        const timestamp = now();
        const currentTickIndex = 128;

        const feeRateManager = FeeRateManager.new(
          true,
          currentTickIndex,
          timestamp,
          3000,
          adaptiveFeeInfo,
        );

        const majorSwapThresholdTicks = adaptiveFeeInfo.adaptiveFeeConstants.majorSwapThresholdTicks;

        const preSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(currentTickIndex);
        const postSqrtPriceMinor = PriceMath.tickIndexToSqrtPriceX64(currentTickIndex + majorSwapThresholdTicks - 1);
        const postSqrtPriceMajor = PriceMath.tickIndexToSqrtPriceX64(currentTickIndex + majorSwapThresholdTicks + 1);

        // minor: no update
        assert.ok(feeRateManager.getNextAdaptiveFeeInfo()?.adaptiveFeeVariables.lastMajorSwapTimestamp.lt(timestamp));
        feeRateManager.updateMajorSwapTimestamp(preSqrtPrice, postSqrtPriceMinor);
        assert.ok(feeRateManager.getNextAdaptiveFeeInfo()?.adaptiveFeeVariables.lastMajorSwapTimestamp.lt(timestamp));

        // major: update
        assert.ok(feeRateManager.getNextAdaptiveFeeInfo()?.adaptiveFeeVariables.lastMajorSwapTimestamp.lt(timestamp));
        feeRateManager.updateMajorSwapTimestamp(preSqrtPrice, postSqrtPriceMajor);
        assert.ok(feeRateManager.getNextAdaptiveFeeInfo()?.adaptiveFeeVariables.lastMajorSwapTimestamp.eq(timestamp));
      });
    });

  });
});
