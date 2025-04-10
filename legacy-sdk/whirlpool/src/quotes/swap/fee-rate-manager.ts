import { BN } from "@coral-xyz/anchor";
import invariant from "tiny-invariant";
import { AdaptiveFeeInfo } from "../public";
import { ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR, AdaptiveFeeConstantsData, AdaptiveFeeVariablesData, FEE_RATE_HARD_LIMIT, MAX_REFERENCE_AGE, MAX_TICK_INDEX, MIN_TICK_INDEX, REDUCTION_FACTOR_DENOMINATOR, VOLATILITY_ACCUMULATOR_SCALE_FACTOR } from "../../types/public";
import { PriceMath } from "../../utils/public";

export abstract class FeeRateManager {
  public static new(
    aToB: boolean,
    currentTickIndex: number,
    timestamp: BN,
    staticFeeRate: number,
    adaptiveFeeInfo: AdaptiveFeeInfo | null,
  ): FeeRateManager {
    if (!adaptiveFeeInfo) {
      return new StaticFeeRateManager(staticFeeRate);
    }
    return new AdaptiveFeeRateManager(aToB, currentTickIndex, timestamp, staticFeeRate, adaptiveFeeInfo);
  }

  public abstract updateVolatilityAccumulator(): void;
  public abstract getTotalFeeRate(): number;
  public abstract getBoundedSqrtPriceTarget(sqrtPrice: BN, currLiquidity: BN): { boundedSqrtPriceTarget: BN, adaptiveFeeUpdateSkipped: boolean };
  public abstract advanceTickGroup(): void;
  public abstract advanceTickGroupAfterSkip(sqrtPrice: BN, nextTickSqrtPrice: BN, nextTickIndex: number): void;
  public abstract updateMajorSwapTimestamp(preSqrtPrice: BN, postSqrtPrice: BN): void;
  public abstract getNextAdaptiveFeeInfo(): AdaptiveFeeInfo | null;
}

class StaticFeeRateManager extends FeeRateManager {
  constructor(
    private staticFeeRate: number,
  ) {
    super();
  }

  public updateVolatilityAccumulator(): void {
    // do nothing
  }

  public getTotalFeeRate(): number {
    return this.staticFeeRate;
  }

  public getBoundedSqrtPriceTarget(sqrtPrice: BN, currLiquidity: BN): { boundedSqrtPriceTarget: BN, adaptiveFeeUpdateSkipped: boolean } {
    return {
      boundedSqrtPriceTarget: sqrtPrice,
      adaptiveFeeUpdateSkipped: false,
    };
  }

  public advanceTickGroup(): void {
    // do nothing
  }

  public advanceTickGroupAfterSkip(sqrtPrice: BN, nextTickSqrtPrice: BN, nextTickIndex: number): void {
    // do nothing
  }

  public updateMajorSwapTimestamp(preSqrtPrice: BN, postSqrtPrice: BN): void {
    // do nothing
  }

  public getNextAdaptiveFeeInfo(): AdaptiveFeeInfo | null {
    return null;
  }
}

class AdaptiveFeeRateManager extends FeeRateManager {
  private tickGroupIndex: number;
  private adaptiveFeeConstants: AdaptiveFeeConstantsData;
  private adaptiveFeeVariables: AdaptiveFeeVariables;
  private coreTickGroupRangeLowerBound: { tickGroupIndex: number, sqrtPrice: BN } | null;
  private coreTickGroupRangeUpperBound: { tickGroupIndex: number, sqrtPrice: BN } | null;

  constructor(
    private aToB: boolean,
    private currentTickIndex: number,
    private timestamp: BN,
    private staticFeeRate: number,
    adaptiveFeeInfo: AdaptiveFeeInfo,
  ) {
    super();

    this.adaptiveFeeConstants = adaptiveFeeInfo.adaptiveFeeConstants;
    this.adaptiveFeeVariables = new AdaptiveFeeVariables(
      adaptiveFeeInfo.adaptiveFeeVariables.lastReferenceUpdateTimestamp,
      adaptiveFeeInfo.adaptiveFeeVariables.lastMajorSwapTimestamp,
      adaptiveFeeInfo.adaptiveFeeVariables.tickGroupIndexReference,
      adaptiveFeeInfo.adaptiveFeeVariables.volatilityReference,
      adaptiveFeeInfo.adaptiveFeeVariables.volatilityAccumulator,
    );

    this.tickGroupIndex = Math.floor(this.currentTickIndex / this.adaptiveFeeConstants.tickGroupSize);

    this.adaptiveFeeVariables.updateReference(this.tickGroupIndex, this.timestamp, this.adaptiveFeeConstants);

    const { coreTickGroupRangeLowerBound, coreTickGroupRangeUpperBound } = this.adaptiveFeeVariables.getCoreTickGroupRange(this.adaptiveFeeConstants);
    this.coreTickGroupRangeLowerBound = coreTickGroupRangeLowerBound;
    this.coreTickGroupRangeUpperBound = coreTickGroupRangeUpperBound;
  }
  
  public updateVolatilityAccumulator(): void {
    this.adaptiveFeeVariables.updateVolatilityAccumulator(this.tickGroupIndex, this.adaptiveFeeConstants);
  }

  public getTotalFeeRate(): number {
    const adaptiveFeeRate = this.adaptiveFeeVariables.computeAdaptiveFeeRate(this.adaptiveFeeConstants);
    const totalFeeRate = this.staticFeeRate + adaptiveFeeRate;
    return Math.min(totalFeeRate, FEE_RATE_HARD_LIMIT);
  }

  public getBoundedSqrtPriceTarget(sqrtPrice: BN, currLiquidity: BN): { boundedSqrtPriceTarget: BN, adaptiveFeeUpdateSkipped: boolean } {
    if (this.adaptiveFeeConstants.adaptiveFeeControlFactor === 0) {
      return {
        boundedSqrtPriceTarget: sqrtPrice,
        adaptiveFeeUpdateSkipped: true,
      };
    }

    if (currLiquidity.isZero()) {
      return {
        boundedSqrtPriceTarget: sqrtPrice,
        adaptiveFeeUpdateSkipped: true,
      };
    }
    
    if (this.coreTickGroupRangeLowerBound && this.tickGroupIndex < this.coreTickGroupRangeLowerBound.tickGroupIndex) {
      if (this.aToB) {
        return {
          boundedSqrtPriceTarget: sqrtPrice,
          adaptiveFeeUpdateSkipped: true,
        };
      } else {
        return {
          boundedSqrtPriceTarget: BN.min(sqrtPrice, this.coreTickGroupRangeLowerBound.sqrtPrice),
          adaptiveFeeUpdateSkipped: true,
        };
      }
    }

    if (this.coreTickGroupRangeUpperBound && this.tickGroupIndex > this.coreTickGroupRangeUpperBound.tickGroupIndex) {
      if (this.aToB) {
        return {
          boundedSqrtPriceTarget: BN.max(sqrtPrice, this.coreTickGroupRangeUpperBound.sqrtPrice),
          adaptiveFeeUpdateSkipped: true,
        };
      } else {
        return {
          boundedSqrtPriceTarget: sqrtPrice,
          adaptiveFeeUpdateSkipped: true,
        };
      }
    }

    const boundaryTickIndex = this.aToB
    ? (this.tickGroupIndex * this.adaptiveFeeConstants.tickGroupSize)
    : (this.tickGroupIndex * this.adaptiveFeeConstants.tickGroupSize + this.adaptiveFeeConstants.tickGroupSize);

    const boundarySqrtPrice = PriceMath.tickIndexToSqrtPriceX64(
      Math.max(MIN_TICK_INDEX, Math.min(boundaryTickIndex, MAX_TICK_INDEX))
    );

    if (this.aToB) {
      return {
        boundedSqrtPriceTarget: BN.max(sqrtPrice, boundarySqrtPrice),
        adaptiveFeeUpdateSkipped: false,
      };
    } else {
      return {
        boundedSqrtPriceTarget: BN.min(sqrtPrice, boundarySqrtPrice),
        adaptiveFeeUpdateSkipped: false,
      };
    }
  }

  public advanceTickGroup(): void {
    if (this.aToB) {
      this.tickGroupIndex--;
    } else {
      this.tickGroupIndex++;
    }
  }

  public advanceTickGroupAfterSkip(sqrtPrice: BN, nextTickSqrtPrice: BN, nextTickIndex: number): void {
    const [tickIndex, isOnTickGroupBoundary] = (() => {
      if (sqrtPrice.eq(nextTickSqrtPrice)) {
        const isOnTickGroupBoundary = nextTickIndex % this.adaptiveFeeConstants.tickGroupSize === 0;
        return [nextTickIndex, isOnTickGroupBoundary];
      } else {
        const tickIndex = PriceMath.sqrtPriceX64ToTickIndex(sqrtPrice);
        const isOnTickGroupBoundary = tickIndex % this.adaptiveFeeConstants.tickGroupSize === 0 && sqrtPrice.eq(PriceMath.tickIndexToSqrtPriceX64(tickIndex));
        return [tickIndex, isOnTickGroupBoundary];
      }
    })();

    const lastTraversedTickGroupIndex = isOnTickGroupBoundary && !this.aToB
      ? tickIndex / this.adaptiveFeeConstants.tickGroupSize - 1
      : Math.floor(tickIndex / this.adaptiveFeeConstants.tickGroupSize);

    if (
      (this.aToB && lastTraversedTickGroupIndex < this.tickGroupIndex) ||
      (!this.aToB && lastTraversedTickGroupIndex > this.tickGroupIndex)
    ) {
      this.tickGroupIndex = lastTraversedTickGroupIndex;
      this.adaptiveFeeVariables.updateVolatilityAccumulator(this.tickGroupIndex, this.adaptiveFeeConstants);
    }

    if (this.aToB) {
      this.tickGroupIndex--;
    } else {
      this.tickGroupIndex++;
    }
  }

  public updateMajorSwapTimestamp(preSqrtPrice: BN, postSqrtPrice: BN): void {
    this.adaptiveFeeVariables.updateMajorSwapTimestamp(preSqrtPrice, postSqrtPrice, this.timestamp, this.adaptiveFeeConstants);
  }

  public getNextAdaptiveFeeInfo(): AdaptiveFeeInfo | null {
    return {
      adaptiveFeeConstants: this.adaptiveFeeConstants,
      adaptiveFeeVariables: this.adaptiveFeeVariables.toData(),
    };
  }
}

class AdaptiveFeeVariables {
  public constructor(
    private lastReferenceUpdateTimestamp: BN,
    private lastMajorSwapTimestamp: BN,
    private tickGroupIndexReference: number,
    private volatilityReference: number,
    private volatilityAccumulator: number,
  ) {}

  public getCoreTickGroupRange(adaptiveFeeConstants: AdaptiveFeeConstantsData): { coreTickGroupRangeLowerBound: { tickGroupIndex: number, sqrtPrice: BN } | null, coreTickGroupRangeUpperBound: { tickGroupIndex: number, sqrtPrice: BN } | null} {
    const maxVolatilityAccumulatorTickGroupIndexDelta = Math.ceil(
      (adaptiveFeeConstants.maxVolatilityAccumulator - this.volatilityReference) / VOLATILITY_ACCUMULATOR_SCALE_FACTOR
    );

    const coreTickGroupRangeLowerIndex = this.tickGroupIndexReference - maxVolatilityAccumulatorTickGroupIndexDelta;
    const coreTickGroupRangeUpperIndex = this.tickGroupIndexReference + maxVolatilityAccumulatorTickGroupIndexDelta;

    const coreTickGroupRangeLowerBoundTickIndex = coreTickGroupRangeLowerIndex * adaptiveFeeConstants.tickGroupSize;
    const coreTickGroupRangeUpperBoundTickIndex = coreTickGroupRangeUpperIndex * adaptiveFeeConstants.tickGroupSize + adaptiveFeeConstants.tickGroupSize;

    const coreTickGroupRangeLowerBound = coreTickGroupRangeLowerBoundTickIndex > MIN_TICK_INDEX ? { tickGroupIndex: coreTickGroupRangeLowerIndex, sqrtPrice: PriceMath.tickIndexToSqrtPriceX64(coreTickGroupRangeLowerBoundTickIndex) } : null;
    const coreTickGroupRangeUpperBound = coreTickGroupRangeUpperBoundTickIndex < MAX_TICK_INDEX ? { tickGroupIndex: coreTickGroupRangeUpperIndex, sqrtPrice: PriceMath.tickIndexToSqrtPriceX64(coreTickGroupRangeUpperBoundTickIndex) } : null;

    return { coreTickGroupRangeLowerBound, coreTickGroupRangeUpperBound };
  }

  public updateReference(tickGroupIndex: number, timestamp: BN, adaptiveFeeConstants: AdaptiveFeeConstantsData): void {
    const maxTimestamp = BN.max(this.lastReferenceUpdateTimestamp, this.lastMajorSwapTimestamp);
    invariant(timestamp.gte(maxTimestamp), "Invalid timestamp");

    const referenceAge = timestamp.sub(this.lastReferenceUpdateTimestamp);
    if (referenceAge.gtn(MAX_REFERENCE_AGE)) {
      this.tickGroupIndexReference = tickGroupIndex;
      this.volatilityReference = 0;
      this.lastReferenceUpdateTimestamp = timestamp;
      return;
    }

    const elapsed = timestamp.sub(maxTimestamp);
    if (elapsed.ltn(adaptiveFeeConstants.filterPeriod)) {
      // high frequency trade
      // no change
    } else if (elapsed.ltn(adaptiveFeeConstants.decayPeriod)) {
      // NOT high frequency trade
      this.tickGroupIndexReference = tickGroupIndex;
      this.volatilityReference = Math.floor(this.volatilityAccumulator * adaptiveFeeConstants.reductionFactor / REDUCTION_FACTOR_DENOMINATOR);
      this.lastReferenceUpdateTimestamp = timestamp;
    } else {
      // Out of decay time window
      this.tickGroupIndexReference = tickGroupIndex;
      this.volatilityReference = 0;
      this.lastReferenceUpdateTimestamp = timestamp;
    }
  }

  public updateVolatilityAccumulator(tickGroupIndex: number, adaptiveFeeConstants: AdaptiveFeeConstantsData): void {
    const indexDelta = Math.abs(this.tickGroupIndexReference - tickGroupIndex);
    const volatilityAccumulator = this.volatilityReference + indexDelta * VOLATILITY_ACCUMULATOR_SCALE_FACTOR;
    this.volatilityAccumulator = Math.min(volatilityAccumulator, adaptiveFeeConstants.maxVolatilityAccumulator);
  }

  public updateMajorSwapTimestamp(preSqrtPrice: BN, postSqrtPrice: BN, timestamp: BN, adaptiveFeeConstants: AdaptiveFeeConstantsData): void {
    if (AdaptiveFeeVariables.isMajorSwap(preSqrtPrice, postSqrtPrice, adaptiveFeeConstants.majorSwapThresholdTicks)) {
      this.lastMajorSwapTimestamp = timestamp;
    }
  }

  public computeAdaptiveFeeRate(adaptiveFeeConstants: AdaptiveFeeConstantsData): number {
    const crossed = this.volatilityAccumulator * adaptiveFeeConstants.tickGroupSize;
    const squared = new BN(crossed).mul(new BN(crossed));
  
    const dividend = new BN(adaptiveFeeConstants.adaptiveFeeControlFactor).mul(squared);
    const divisor = new BN(ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR).mul(new BN(VOLATILITY_ACCUMULATOR_SCALE_FACTOR)).mul(new BN(VOLATILITY_ACCUMULATOR_SCALE_FACTOR));
  
    // ceil division
    // BN is used, so no overflow risk
    const feeRate = dividend.add(divisor.subn(1)).div(divisor);
  
    if (feeRate.gtn(FEE_RATE_HARD_LIMIT)) {
      return FEE_RATE_HARD_LIMIT;
    }
  
    return feeRate.toNumber();
  }
  
  public toData(): AdaptiveFeeVariablesData {
    return {
      lastReferenceUpdateTimestamp: this.lastReferenceUpdateTimestamp,
      lastMajorSwapTimestamp: this.lastMajorSwapTimestamp,
      tickGroupIndexReference: this.tickGroupIndexReference,
      volatilityReference: this.volatilityReference,
      volatilityAccumulator: this.volatilityAccumulator,
    };
  }

  static isMajorSwap(preSqrtPrice: BN, postSqrtPrice: BN, majorSwapThresholdTicks: number): boolean {
    const [smallerSqrtPrice, largerSqrtPrice] = preSqrtPrice.lt(postSqrtPrice) ? [preSqrtPrice, postSqrtPrice] : [postSqrtPrice, preSqrtPrice];
    const majorSwapSqrtPriceFactor = PriceMath.tickIndexToSqrtPriceX64(majorSwapThresholdTicks);
    const majorSwapSqrtPriceTarget = smallerSqrtPrice.mul(majorSwapSqrtPriceFactor).shrn(64);
    return largerSqrtPrice.gte(majorSwapSqrtPriceTarget);
  }
}

