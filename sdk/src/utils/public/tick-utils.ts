import invariant from "tiny-invariant";
import { Address, BN } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  TickArrayData,
  TickData,
  TICK_ARRAY_SIZE,
} from "../../types/public";
import { PDAUtil } from "./pda-utils";

enum TickSearchDirection {
  Left,
  Right,
}

/**
 * A collection of utility functions when interacting with Ticks.
 * @category Whirlpool Utils
 */
export class TickUtil {
  private constructor() {}

  /**
   * Get the startIndex of the tick array containing tickIndex.
   *
   * @param tickIndex
   * @param tickSpacing
   * @param offset can be used to get neighboring tick array startIndex.
   * @returns
   */
  public static getStartTickIndex(tickIndex: number, tickSpacing: number, offset = 0): number {
    const realIndex = Math.floor(tickIndex / tickSpacing / TICK_ARRAY_SIZE);
    const startTickIndex = (realIndex + offset) * tickSpacing * TICK_ARRAY_SIZE;

    const ticksInArray = TICK_ARRAY_SIZE * tickSpacing;
    const minTickIndex = MIN_TICK_INDEX - ((MIN_TICK_INDEX % ticksInArray) + ticksInArray);
    invariant(startTickIndex >= minTickIndex, "startTickIndex is too small");
    invariant(startTickIndex <= MAX_TICK_INDEX, "startTickIndex is too large");
    return startTickIndex;
  }

  /**
   * Get the nearest (rounding down) valid tick index from the tickIndex.
   * A valid tick index is a point on the tick spacing grid line.
   */
  public static getInitializableTickIndex(tickIndex: number, tickSpacing: number): number {
    return tickIndex - (tickIndex % tickSpacing);
  }

  public static getNextInitializableTickIndex(tickIndex: number, tickSpacing: number) {
    return TickUtil.getInitializableTickIndex(tickIndex, tickSpacing) + tickSpacing;
  }

  public static getPrevInitializableTickIndex(tickIndex: number, tickSpacing: number) {
    return TickUtil.getInitializableTickIndex(tickIndex, tickSpacing) - tickSpacing;
  }

  /**
   * Get the previous initialized tick index within the same tick array.
   *
   * @param account
   * @param currentTickIndex
   * @param tickSpacing
   * @returns
   */
  public static findPreviousInitializedTickIndex(
    account: TickArrayData,
    currentTickIndex: number,
    tickSpacing: number
  ): number | null {
    return TickUtil.findInitializedTick(
      account,
      currentTickIndex,
      tickSpacing,
      TickSearchDirection.Left
    );
  }

  /**
   * Get the next initialized tick index within the same tick array.
   * @param account
   * @param currentTickIndex
   * @param tickSpacing
   * @returns
   */
  public static findNextInitializedTickIndex(
    account: TickArrayData,
    currentTickIndex: number,
    tickSpacing: number
  ): number | null {
    return TickUtil.findInitializedTick(
      account,
      currentTickIndex,
      tickSpacing,
      TickSearchDirection.Right
    );
  }

  private static findInitializedTick(
    account: TickArrayData,
    currentTickIndex: number,
    tickSpacing: number,
    searchDirection: TickSearchDirection
  ): number | null {
    const currentTickArrayIndex = tickIndexToInnerIndex(
      account.startTickIndex,
      currentTickIndex,
      tickSpacing
    );

    const increment = searchDirection === TickSearchDirection.Right ? 1 : -1;

    let stepInitializedTickArrayIndex =
      searchDirection === TickSearchDirection.Right
        ? currentTickArrayIndex + increment
        : currentTickArrayIndex;
    while (
      stepInitializedTickArrayIndex >= 0 &&
      stepInitializedTickArrayIndex < account.ticks.length
    ) {
      if (account.ticks[stepInitializedTickArrayIndex]?.initialized) {
        return innerIndexToTickIndex(
          account.startTickIndex,
          stepInitializedTickArrayIndex,
          tickSpacing
        );
      }

      stepInitializedTickArrayIndex += increment;
    }

    return null;
  }

  public static checkTickInBounds(tick: number) {
    return tick <= MAX_TICK_INDEX && tick >= MIN_TICK_INDEX;
  }

  public static isTickInitializable(tick: number, tickSpacing: number) {
    return tick % tickSpacing === 0;
  }
}

export class TickArrayUtil {
  /**
   * Get the tick from tickArray with a global tickIndex.
   */
  public static getTickFromArray(
    tickArray: TickArrayData,
    tickIndex: number,
    tickSpacing: number
  ): TickData {
    const realIndex = tickIndexToInnerIndex(tickArray.startTickIndex, tickIndex, tickSpacing);
    const tick = tickArray.ticks[realIndex];
    invariant(
      !!tick,
      `tick realIndex out of range - start - ${tickArray.startTickIndex} index - ${tickIndex}, realIndex - ${realIndex}`
    );
    return tick;
  }

  /**
   *
   * @param tickLowerIndex
   * @param tickUpperIndex
   * @param tickSpacing
   * @param whirlpool
   * @param programId
   * @returns
   */
  public static getAdjacentTickArrays(
    tickLowerIndex: number,
    tickUpperIndex: number,
    tickSpacing: number,
    whirlpool: PublicKey,
    programId: PublicKey
  ): [PublicKey, PublicKey] {
    return [
      PDAUtil.getTickArrayFromTickIndex(tickLowerIndex, tickSpacing, whirlpool, programId)
        .publicKey,
      PDAUtil.getTickArrayFromTickIndex(tickUpperIndex, tickSpacing, whirlpool, programId)
        .publicKey,
    ];
  }
}

function tickIndexToInnerIndex(
  startTickIndex: number,
  tickIndex: number,
  tickSpacing: number
): number {
  return Math.floor((tickIndex - startTickIndex) / tickSpacing);
}

function innerIndexToTickIndex(
  startTickIndex: number,
  tickArrayIndex: number,
  tickSpacing: number
): number {
  return startTickIndex + tickArrayIndex * tickSpacing;
}
