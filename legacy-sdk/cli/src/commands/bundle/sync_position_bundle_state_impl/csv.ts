import { readFileSync } from "fs";
import BN from "bn.js";
import {
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  POSITION_BUNDLE_SIZE,
} from "@orca-so/whirlpools-sdk";

export type PositionBundleOpenState = {
  state: "open";
  lowerTickIndex: number;
  upperTickIndex: number;
  liquidity: BN;
};
export type PositionBundleClosedState = { state: "closed" };
export type PositionBundleStateItem =
  | PositionBundleOpenState
  | PositionBundleClosedState;

export function readPositionBundleStateCsv(
  positionBundleStateCsvPath: string,
  tickSpacing: number,
): PositionBundleStateItem[] {
  // read entire CSV file
  const csv = readFileSync(positionBundleStateCsvPath, "utf8");

  // parse CSV (trim is needed for safety (remove CR code))
  const lines = csv.split("\n");
  const header = lines[0].trim();
  const data = lines.slice(1).map((line) => line.trim().split(","));

  // check header
  const EXPECTED_HEADER =
    "bundle index,state,lower tick index,upper tick index,liquidity";
  if (header !== EXPECTED_HEADER) {
    console.debug(`${header}<`);
    console.debug(`${EXPECTED_HEADER}<`);
    throw new Error(`unexpected header: ${header}`);
  }

  // check data
  if (data.length !== POSITION_BUNDLE_SIZE) {
    throw new Error(
      `unexpected data length: ${data.length} (must be ${POSITION_BUNDLE_SIZE})`,
    );
  }

  // parse data
  return data.map((entry, expectedBundleIndex) => {
    // sanity checks...

    if (entry.length !== 5) {
      throw new Error(
        `unexpected entry length: ${entry.length}, line: ${entry}`,
      );
    }

    const bundleIndex = parseInt(entry[0]);
    if (bundleIndex !== expectedBundleIndex) {
      throw new Error(
        `unexpected bundle index: ${bundleIndex}, expected: ${expectedBundleIndex}`,
      );
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
      throw new Error(
        `invalid tick indexes (not number): ${entry[2]}, ${entry[3]}`,
      );
    }
    if (lowerTickIndex >= upperTickIndex) {
      throw new Error(
        `invalid tick indexes (lower >= upper): ${entry[2]}, ${entry[3]}`,
      );
    }
    if (lowerTickIndex < MIN_TICK_INDEX || upperTickIndex > MAX_TICK_INDEX) {
      throw new Error(
        `invalid tick indexes (out of range): ${entry[2]}, ${entry[3]}`,
      );
    }
    if (
      lowerTickIndex % tickSpacing !== 0 ||
      upperTickIndex % tickSpacing !== 0
    ) {
      throw new Error(
        `invalid tick indexes (not initializable): ${entry[2]}, ${entry[3]}`,
      );
    }

    return { state: "open", lowerTickIndex, upperTickIndex, liquidity };
  });
}
