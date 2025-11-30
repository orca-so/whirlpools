import type { Address } from "@solana/kit";
import { generateKeyPairSigner } from "@solana/kit";
import { assert, beforeAll, describe, it } from "vitest";
import { setupAta, setupMint } from "./utils/token";
import {
  setupPosition,
  setupPositionBundle,
  setupTEPosition,
  setupWhirlpool,
} from "./utils/program";
import { SPLASH_POOL_TICK_SPACING } from "../src/config";
import {
  fetchPositionsForOwner,
  fetchPositionsInWhirlpool,
} from "../src/position";
import { rpc, signer } from "./utils/mockRpc";
import { getFullRangeTickIndexes } from "@orca-so/whirlpools-core";

describe("Fetch Position", () => {
  let mintA: Address;
  let mintB: Address;
  let pool: Address;
  let splashPool: Address;

  beforeAll(async () => {
    mintA = await setupMint();
    mintB = await setupMint();
    await setupAta(mintA, { amount: 500e9 });
    await setupAta(mintB, { amount: 500e9 });
    pool = await setupWhirlpool(mintA, mintB, 128);
    splashPool = await setupWhirlpool(mintA, mintB, SPLASH_POOL_TICK_SPACING);
    await setupPosition(pool);
    const splashFullRange = getFullRangeTickIndexes(SPLASH_POOL_TICK_SPACING);
    await setupPosition(splashPool, {
      tickLower: splashFullRange.tickLowerIndex,
      tickUpper: splashFullRange.tickUpperIndex,
    });
    await setupTEPosition(pool);

    // bundle with 1 position, 2 positions
    await setupPositionBundle(pool, [{ tickLower: -100, tickUpper: 100 }]);
    await setupPositionBundle(splashPool, [
      {
        tickLower: splashFullRange.tickLowerIndex,
        tickUpper: splashFullRange.tickUpperIndex,
      },
      {
        tickLower: splashFullRange.tickLowerIndex,
        tickUpper: splashFullRange.tickUpperIndex,
      },
    ]);
  });

  it("Should fetch all positions for an address", async () => {
    const positions = await fetchPositionsForOwner(rpc, signer.address);

    // 3 positions: 1 regular on pool, 1 full-range on splashPool, 1 TE on pool
    const standalone = positions.filter((p) => !p.isPositionBundle);
    assert.strictEqual(standalone.length, 3);

    const bundles = positions.filter((p) => p.isPositionBundle);
    assert.strictEqual(bundles.length, 2);
    assert.deepEqual(bundles.map((b) => b.positions.length).sort(), [1, 2]);
  });

  it("Should fetch no positions for a different address", async () => {
    const other = await generateKeyPairSigner();
    const positions = await fetchPositionsForOwner(rpc, other.address);
    assert.strictEqual(positions.length, 0);
  });

  it("Should fetch positions for a whirlpool", async () => {
    const positions = await fetchPositionsInWhirlpool(rpc, pool);
    // 3 positions in pool: 1 regular + 1 TE + 1 bundled
    assert.strictEqual(positions.length, 3);
  });
});
