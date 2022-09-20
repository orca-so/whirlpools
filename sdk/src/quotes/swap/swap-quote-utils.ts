import { TickArray, TickArrayUtil } from "../..";

export function checkIfAllTickArraysInitialized(tickArrays: TickArray[]) {
  // Check if all the tick arrays have been initialized.
  const uninitializedIndices = TickArrayUtil.getUninitializedArrays(
    tickArrays.map((array) => array.data)
  );
  if (uninitializedIndices.length > 0) {
    const uninitializedArrays = uninitializedIndices
      .map((index) => tickArrays[index].address.toBase58())
      .join(", ");
    throw new Error(`TickArray addresses - [${uninitializedArrays}] need to be initialized.`);
  }
}
