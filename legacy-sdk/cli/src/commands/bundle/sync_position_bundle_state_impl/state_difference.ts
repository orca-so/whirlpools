import type { PublicKey } from "@solana/web3.js";
import {
  IGNORE_CACHE,
  PDAUtil,
  POSITION_BUNDLE_SIZE,
  PositionBundleUtil,
} from "@orca-so/whirlpools-sdk";
import type {
  PositionBundleData,
  PositionData,
  WhirlpoolContext,
} from "@orca-so/whirlpools-sdk";
import type { PositionBundleStateItem } from "./csv";

export type PositionBundleStateDifference = {
  positionBundle: PositionBundleData;
  bundledPositions: (PositionData | undefined)[];
  noDifference: number[];
  shouldBeDecreased: number[];
  shouldBeClosed: number[];
  shouldBeOpened: number[];
  shouldBeIncreased: number[];
};

export async function checkPositionBundleStateDifference(
  ctx: WhirlpoolContext,
  positionBundlePubkey: PublicKey,
  whirlpoolPubkey: PublicKey,
  positionBundleTargetState: PositionBundleStateItem[],
): Promise<PositionBundleStateDifference> {
  // fetch all bundled positions
  const positionBundle = (await ctx.fetcher.getPositionBundle(
    positionBundlePubkey,
    IGNORE_CACHE,
  )) as PositionBundleData;
  const bundledPositions = await fetchBundledPositions(ctx, positionBundle);

  // ensure that all bundled positions belong to the provided whirlpool
  if (
    bundledPositions.some(
      (position) => position && !position.whirlpool.equals(whirlpoolPubkey),
    )
  ) {
    throw new Error(
      `not all bundled positions belong to the whirlpool(${whirlpoolPubkey.toBase58()})`,
    );
  }

  // check differences between current state and target state
  const noDifference: number[] = [];
  const shouldBeDecreased: number[] = [];
  const shouldBeClosed: number[] = [];
  const shouldBeOpened: number[] = [];
  const shouldBeIncreased: number[] = [];
  for (let bundleIndex = 0; bundleIndex < POSITION_BUNDLE_SIZE; bundleIndex++) {
    const targetState = positionBundleTargetState[bundleIndex];
    const currentPosition = bundledPositions[bundleIndex];

    if (targetState.state === "closed") {
      if (currentPosition) {
        shouldBeClosed.push(bundleIndex);
      } else {
        // nop
        noDifference.push(bundleIndex);
      }
    } else {
      if (!currentPosition) {
        shouldBeOpened.push(bundleIndex);
      } else {
        if (
          currentPosition.tickLowerIndex !== targetState.lowerTickIndex ||
          currentPosition.tickUpperIndex !== targetState.upperTickIndex
        ) {
          // close and reopen
          shouldBeClosed.push(bundleIndex);
          shouldBeOpened.push(bundleIndex);
        } else if (currentPosition.liquidity.lt(targetState.liquidity)) {
          shouldBeIncreased.push(bundleIndex);
        } else if (currentPosition.liquidity.gt(targetState.liquidity)) {
          shouldBeDecreased.push(bundleIndex);
        } else {
          // nop
          noDifference.push(bundleIndex);
        }
      }
    }
  }

  return {
    positionBundle,
    bundledPositions,
    noDifference,
    shouldBeDecreased,
    shouldBeClosed,
    shouldBeOpened,
    shouldBeIncreased,
  };
}

async function fetchBundledPositions(
  ctx: WhirlpoolContext,
  positionBundle: PositionBundleData,
): Promise<(PositionData | undefined)[]> {
  const openBundleIndexes =
    PositionBundleUtil.getOccupiedBundleIndexes(positionBundle);
  const bundledPositions: (PositionData | undefined)[] = new Array(
    POSITION_BUNDLE_SIZE,
  ).fill(undefined);

  const addresses = openBundleIndexes.map(
    (index) =>
      PDAUtil.getBundledPosition(
        ctx.program.programId,
        positionBundle.positionBundleMint,
        index,
      ).publicKey,
  );
  const positions = await ctx.fetcher.getPositions(addresses, IGNORE_CACHE);

  addresses.forEach((address, i) => {
    const position = positions.get(address.toBase58());
    if (!position) {
      throw new Error("bundled position not found");
    }
    bundledPositions[openBundleIndexes[i]] = position;
  });

  return bundledPositions;
}
