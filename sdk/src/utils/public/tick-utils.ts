import { Address } from "@coral-xyz/anchor";
import { AddressUtil, PDA } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";
import {
  WhirlpoolAccountFetchOptions,
  WhirlpoolAccountFetcherInterface,
} from "../../network/public/account-fetcher";
import {
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  TICK_ARRAY_SIZE,
  TickArrayData,
  TickData,
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
  private constructor() { }

  /**
   * Get the offset index to access a tick at a given tick-index in a tick-array
   *
   * @param tickIndex The tick index for the tick that this offset would access
   * @param arrayStartIndex The starting tick for the array that this tick-index resides in
   * @param tickSpacing The tickSpacing for the Whirlpool that this tickArray belongs to
   * @returns The offset index that can access the desired tick at the given tick-array
   */
  public static getOffsetIndex(tickIndex: number, arrayStartIndex: number, tickSpacing: number) {
    return Math.floor((tickIndex - arrayStartIndex) / tickSpacing);
  }

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
    invariant(startTickIndex >= minTickIndex, `startTickIndex is too small - - ${startTickIndex}`);
    invariant(startTickIndex <= MAX_TICK_INDEX, `startTickIndex is too large - ${startTickIndex}`);
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

  /**
   *
   * Returns the tick for the inverse of the price that this tick represents.
   * Eg: Consider tick i where Pb/Pa = 1.0001 ^ i
   * inverse of this, i.e. Pa/Pb = 1 / (1.0001 ^ i) = 1.0001^-i
   * @param tick The tick to invert
   * @returns
   */
  public static invertTick(tick: number) {
    return -tick;
  }
}

/**
 * A collection of utility functions when interacting with a TickArray.
 * @category Whirlpool Utils
 */
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
   * Return a sequence of tick array pdas based on the sequence start index.
   * @param tick - A tick in the first tick-array of your sequence
   * @param tickSpacing - Tick spacing for the whirlpool
   * @param numOfTickArrays - The number of TickArray PDAs to generate
   * @param programId - Program Id of the whirlpool for these tick-arrays
   * @param whirlpoolAddress - Address for the Whirlpool for these tick-arrays
   * @returns TickArray PDAs for the sequence`
   */
  public static getTickArrayPDAs(
    tick: number,
    tickSpacing: number,
    numOfTickArrays: number,
    programId: PublicKey,
    whirlpoolAddress: PublicKey,
    aToB: boolean
  ): PDA[] {
    let arrayIndexList = [...Array(numOfTickArrays).keys()];
    if (aToB) {
      arrayIndexList = arrayIndexList.map((value) => -value);
    }
    return arrayIndexList.map((value) => {
      const startTick = TickUtil.getStartTickIndex(tick, tickSpacing, value);
      return PDAUtil.getTickArray(programId, whirlpoolAddress, startTick);
    });
  }

  /**
   * Return a string containing all of the uninitialized arrays in the provided addresses.
   * Useful for creating error messages.
   *
   * @param tickArrayAddrs - A list of tick-array addresses to verify.
   * @param cache - {@link WhirlpoolAccountFetcherInterface}
   * @param opts an {@link WhirlpoolAccountFetchOptions} object to define fetch and cache options when accessing on-chain accounts
   * @returns A string of all uninitialized tick array addresses, delimited by ",". Falsy value if all arrays are initialized.
   */
  public static async getUninitializedArraysString(
    tickArrayAddrs: Address[],
    fetcher: WhirlpoolAccountFetcherInterface,
    opts?: WhirlpoolAccountFetchOptions
  ) {
    const taAddrs = AddressUtil.toPubKeys(tickArrayAddrs);
    const tickArrayData = await fetcher.getTickArrays(taAddrs, opts);

    // Verify tick arrays are initialized if the user provided them.
    if (tickArrayData) {
      const uninitializedIndices = TickArrayUtil.getUninitializedArrays(tickArrayData);
      if (uninitializedIndices.length > 0) {
        const uninitializedArrays = uninitializedIndices
          .map((index) => taAddrs[index].toBase58())
          .join(", ");

        return uninitializedArrays;
      }
    }

    return null;
  }

  public static async getUninitializedArraysPDAs(
    ticks: number[],
    programId: PublicKey,
    whirlpoolAddress: PublicKey,
    tickSpacing: number,
    fetcher: WhirlpoolAccountFetcherInterface,
    opts: WhirlpoolAccountFetchOptions
  ) {
    const startTicks = ticks.map((tick) => TickUtil.getStartTickIndex(tick, tickSpacing));
    const removeDupeTicks = [...new Set(startTicks)];
    const tickArrayPDAs = removeDupeTicks.map((tick) =>
      PDAUtil.getTickArray(programId, whirlpoolAddress, tick)
    );
    const fetchedArrays = await fetcher.getTickArrays(
      tickArrayPDAs.map((pda) => pda.publicKey),
      opts
    );
    const uninitializedIndices = TickArrayUtil.getUninitializedArrays(fetchedArrays);
    return uninitializedIndices.map((index) => {
      return {
        startIndex: removeDupeTicks[index],
        pda: tickArrayPDAs[index],
      };
    });
  }

  /**
   * Evaluate a list of tick-array data and return the array of indices which the tick-arrays are not initialized.
   * @param tickArrays - a list of TickArrayData or null objects from WhirlpoolAccountCacheInterface.getTickArrays
   * @returns an array of array-index for the input tickArrays that requires initialization.
   */
  public static getUninitializedArrays(tickArrays: readonly (TickArrayData | null)[]): number[] {
    return tickArrays
      .map((value, index) => {
        if (!value) {
          return index;
        }
        return -1;
      })
      .filter((index) => index >= 0);
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
