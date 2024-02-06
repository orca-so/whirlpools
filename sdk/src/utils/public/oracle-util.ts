import invariant from "tiny-invariant";
import { PositionBundleData, POSITION_BUNDLE_SIZE, WhirlpoolData, OracleData, OracleObservationData, NUM_ORACLE_OBSERVATIONS, MIN_TICK_INDEX, MAX_TICK_INDEX } from "../../types/public";
import { BN } from "bn.js";

/**
 * A collection of utility functions when interacting with a Oracle.
 * @category Whirlpool Utils
 */
export class OracleUtil {
  private constructor() {}

  public static getTickIndex(
    whirlpool: WhirlpoolData,
    oracle: OracleData,
    secondsAgo: number,
    nowInSeconds: number = Math.floor(Date.now() / 1000)
  ): number {
    invariant(secondsAgo > 0, "secondsAgo must be positive");

    const tickCurrentIndex = whirlpool.tickCurrentIndex;

    const currentObservation = getObservation(oracle, 0, nowInSeconds, tickCurrentIndex);
    const pastObservation = getObservation(oracle, secondsAgo, nowInSeconds, tickCurrentIndex);

    const deltaTickCumulative = currentObservation.tickCumulative.sub(pastObservation.tickCumulative);

    // mean = floor(deltaTickCumulative / secondsAgo)
    const divmod = deltaTickCumulative.divmod(new BN(secondsAgo));
    const meanTickIndex = deltaTickCumulative.isNeg() && !divmod.mod.isZero()
      ? divmod.div.addn(-1).toNumber()
      : divmod.div.toNumber();

    invariant(meanTickIndex >= MIN_TICK_INDEX);
    invariant(meanTickIndex <= MAX_TICK_INDEX);

    return meanTickIndex;
  }

}

function getObservation(
  oracle: OracleData,
  secondsAgo: number,
  nowInSeconds: number,
  tickCurrentIndex: number,
): OracleObservationData {
  invariant(secondsAgo >= 0, "secondsAgo must not be negative");

  const targetTimestamp = nowInSeconds - secondsAgo;

  const newestObservationIndex = oracle.observationIndex;
  const newestObservation = oracle.observations[newestObservationIndex];

  if (targetTimestamp === newestObservation.timestamp) {
    return newestObservation;
  } else if (targetTimestamp > newestObservation.timestamp) {
    return extrapolate(newestObservation, targetTimestamp, tickCurrentIndex)
  }

  invariant(targetTimestamp < newestObservation.timestamp);

  const oldestObservationIndex = getOldestObservationIndex(oracle);
  const oldestObservation = oracle.observations[oldestObservationIndex];

  if (targetTimestamp === oldestObservation.timestamp) {
    return oldestObservation;
  } else if (targetTimestamp < oldestObservation.timestamp) {
    throw new Error("secondsAgo is too large, no observation exists for that time");
  }

  invariant(targetTimestamp > oldestObservation.timestamp);

  // Linear search due to small number of elements
  let result: OracleObservationData;
  for (let i = 0; i < NUM_ORACLE_OBSERVATIONS; i++) {
    const observationIndex = (oldestObservationIndex + i) % NUM_ORACLE_OBSERVATIONS;
    const nextObservationIndex = (observationIndex + 1) % NUM_ORACLE_OBSERVATIONS;

    const observation = oracle.observations[observationIndex];
    const nextObservation = oracle.observations[nextObservationIndex];

    if (targetTimestamp < nextObservation.timestamp) {
      result = interpolate(observation, nextObservation, targetTimestamp);
      break;
    }
  }
  return result!;
}

function extrapolate(
  newestObservation: OracleObservationData,
  targetTimestamp: number,
  tickCurrentIndex: number,
): OracleObservationData {
  const elapsed = targetTimestamp - newestObservation.timestamp;
  const delta = new BN(tickCurrentIndex).mul(new BN(elapsed));

  return {
    timestamp: targetTimestamp,
    tickCumulative: newestObservation.tickCumulative.add(delta),
  };
}

function interpolate(
  observation: OracleObservationData,
  nextObservation: OracleObservationData,
  targetTimestamp: number,
): OracleObservationData {
  const elapsed = targetTimestamp - observation.timestamp;
  const tickCumulativeDelta = nextObservation.tickCumulative.sub(observation.tickCumulative);
  const timestampDelta = new BN(nextObservation.timestamp - observation.timestamp);
  const delta = tickCumulativeDelta.div(timestampDelta).mul(new BN(elapsed));

  return {
    timestamp: targetTimestamp,
    tickCumulative: observation.tickCumulative.add(delta),
  };
}

function isInitializedObservation(
  observation: OracleObservationData,
): boolean {
  return observation.timestamp !== 0;
}

function getOldestObservationIndex(
  oracle: OracleData,
): number {
  const nextIndex = (oracle.observationIndex + 1) % NUM_ORACLE_OBSERVATIONS;
  const nextObservation = oracle.observations[nextIndex];
  return isInitializedObservation(nextObservation) ? nextIndex : 0;
}
