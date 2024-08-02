import { SwapErrorCode, WhirlpoolsError } from "../../errors/errors";
import {
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  TickArray,
  TickArrayData,
  TickData,
  TICK_ARRAY_SIZE,
} from "../../types/public";
import { TickArrayIndex } from "./tick-array-index";
import { PublicKey } from "@solana/web3.js";

type InitializedTickArray = TickArray & {
  // override
  data: TickArrayData;
};

/**
 * NOTE: differs from contract method of having the swap manager keep track of array index.
 * This is due to the initial requirement to lazy load tick-arrays. This requirement is no longer necessary.
 */
export class TickArraySequence {
  private sequence: InitializedTickArray[];
  private touchedArrays: boolean[];
  private startArrayIndex: number;

  constructor(
    tickArrays: Readonly<TickArray[]>,
    readonly tickSpacing: number,
    readonly aToB: boolean
  ) {
    if (!tickArrays[0] || !tickArrays[0].data) {
      throw new Error("TickArray index 0 must be initialized");
    }

    // If an uninitialized TickArray appears, truncate all TickArrays after it (inclusive).
    this.sequence = [];
    for (const tickArray of tickArrays) {
      if (!tickArray || !tickArray.data) {
        break;
      }
      this.sequence.push({
        address: tickArray.address,
        startTickIndex: tickArray.data.startTickIndex,
        data: tickArray.data,
      });
    }

    this.touchedArrays = [...Array<boolean>(this.sequence.length).fill(false)];
    this.startArrayIndex = TickArrayIndex.fromTickIndex(
      this.sequence[0].data.startTickIndex,
      this.tickSpacing
    ).arrayIndex;
  }

  isValidTickArray0(tickCurrentIndex: number) {
    const shift = this.aToB ? 0 : this.tickSpacing;
    const tickArray = this.sequence[0].data;
    return this.checkIfIndexIsInTickArrayRange(tickArray.startTickIndex, tickCurrentIndex + shift);
  }

  getNumOfTouchedArrays() {
    return this.touchedArrays.filter((val) => !!val).length;
  }

  getTouchedArrays(minArraySize: number): PublicKey[] {
    let result = this.touchedArrays.reduce<PublicKey[]>((prev, curr, index) => {
      if (curr) {
        prev.push(this.sequence[index].address);
      }
      return prev;
    }, []);

    // Edge case: nothing was ever touched.
    if (result.length === 0) {
      return [];
    }

    // The quote object should contain the specified amount of tick arrays to be plugged
    // directly into the swap instruction.
    // If the result does not fit minArraySize, pad the rest with the last touched array
    const sizeDiff = minArraySize - result.length;
    if (sizeDiff > 0) {
      result = result.concat(Array(sizeDiff).fill(result[result.length - 1]));
    }

    return result;
  }

  getTick(index: number): TickData {
    const targetTaIndex = TickArrayIndex.fromTickIndex(index, this.tickSpacing);

    if (!this.isArrayIndexInBounds(targetTaIndex, this.aToB)) {
      throw new Error("Provided tick index is out of bounds for this sequence.");
    }

    const localArrayIndex = this.getLocalArrayIndex(targetTaIndex.arrayIndex, this.aToB);
    const tickArray = this.sequence[localArrayIndex].data;

    this.touchedArrays[localArrayIndex] = true;

    if (!tickArray) {
      throw new WhirlpoolsError(
        `TickArray at index ${localArrayIndex} is not initialized.`,
        SwapErrorCode.TickArrayIndexNotInitialized
      );
    }

    if (!this.checkIfIndexIsInTickArrayRange(tickArray.startTickIndex, index)) {
      throw new WhirlpoolsError(
        `TickArray at index ${localArrayIndex} is unexpected for this sequence.`,
        SwapErrorCode.TickArraySequenceInvalid
      );
    }

    return tickArray.ticks[targetTaIndex.offsetIndex];
  }
  /**
   * if a->b, currIndex is included in the search
   * if b->a, currIndex is always ignored
   * @param currIndex
   * @returns
   */
  findNextInitializedTickIndex(currIndex: number) {
    const searchIndex = this.aToB ? currIndex : currIndex + this.tickSpacing;
    let currTaIndex = TickArrayIndex.fromTickIndex(searchIndex, this.tickSpacing);

    // Throw error if the search attempted to search for an index out of bounds
    if (!this.isArrayIndexInBounds(currTaIndex, this.aToB)) {
      throw new WhirlpoolsError(
        `Swap input value traversed too many arrays. Out of bounds at attempt to traverse tick index - ${currTaIndex.toTickIndex()}.`,
        SwapErrorCode.TickArraySequenceInvalid
      );
    }

    while (this.isArrayIndexInBounds(currTaIndex, this.aToB)) {
      const currTickData = this.getTick(currTaIndex.toTickIndex());
      if (currTickData.initialized) {
        return { nextIndex: currTaIndex.toTickIndex(), nextTickData: currTickData };
      }
      currTaIndex = this.aToB
        ? currTaIndex.toPrevInitializableTickIndex()
        : currTaIndex.toNextInitializableTickIndex();
    }

    const lastIndexInArray = Math.max(
      Math.min(
        this.aToB ? currTaIndex.toTickIndex() + this.tickSpacing : currTaIndex.toTickIndex() - 1,
        MAX_TICK_INDEX
      ),
      MIN_TICK_INDEX
    );

    return { nextIndex: lastIndexInArray, nextTickData: null };
  }

  private getLocalArrayIndex(arrayIndex: number, aToB: boolean) {
    return aToB ? this.startArrayIndex - arrayIndex : arrayIndex - this.startArrayIndex;
  }

  /**
   * Check whether the array index potentially exists in this sequence.
   * Note: assumes the sequence of tick-arrays are sequential
   * @param index
   */
  private isArrayIndexInBounds(index: TickArrayIndex, aToB: boolean) {
    // a+0...a+n-1 array index is ok
    const localArrayIndex = this.getLocalArrayIndex(index.arrayIndex, aToB);
    const seqLength = this.sequence.length;
    return localArrayIndex >= 0 && localArrayIndex < seqLength;
  }

  private checkIfIndexIsInTickArrayRange(startTick: number, tickIndex: number) {
    const upperBound = startTick + this.tickSpacing * TICK_ARRAY_SIZE;
    return tickIndex >= startTick && tickIndex < upperBound;
  }
}
