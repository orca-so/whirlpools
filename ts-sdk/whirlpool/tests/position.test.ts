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
import {
  getTestContext,
  rpc,
  signer,
  TEST_WHIRLPOOL_DEPLOYMENTS,
} from "./utils/mockRpc";
import { getFullRangeTickIndexes } from "@orca-so/whirlpools-core";

await getTestContext();

describe.each(TEST_WHIRLPOOL_DEPLOYMENTS)(
  "Fetch Position ($programId)",
  (whirlpoolDeployment) => {
    let mintA: Address;
    let mintB: Address;
    let pool: Address;
    let splashPool: Address;

    beforeAll(async () => {
      mintA = await setupMint();
      mintB = await setupMint();
      await setupAta(mintA, { amount: 500e9 });
      await setupAta(mintB, { amount: 500e9 });
      pool = await setupWhirlpool(mintA, mintB, 128, { whirlpoolDeployment });
      splashPool = await setupWhirlpool(
        mintA,
        mintB,
        SPLASH_POOL_TICK_SPACING,
        { whirlpoolDeployment },
      );
      await setupPosition(pool, { whirlpoolDeployment });
      const splashFullRange = getFullRangeTickIndexes(SPLASH_POOL_TICK_SPACING);
      await setupPosition(splashPool, {
        tickLower: splashFullRange.tickLowerIndex,
        tickUpper: splashFullRange.tickUpperIndex,
        whirlpoolDeployment,
      });
      await setupTEPosition(pool, { whirlpoolDeployment });

      // bundle with 1 position, 2 positions
      await setupPositionBundle(pool, [{ tickLower: -100, tickUpper: 100 }], {
        whirlpoolDeployment,
      });
      await setupPositionBundle(
        splashPool,
        [
          {
            tickLower: splashFullRange.tickLowerIndex,
            tickUpper: splashFullRange.tickUpperIndex,
          },
          {
            tickLower: splashFullRange.tickLowerIndex,
            tickUpper: splashFullRange.tickUpperIndex,
          },
        ],
        { whirlpoolDeployment },
      );
    });

    it("Should fetch all positions for an address", async () => {
      const positions = await fetchPositionsForOwner(
        rpc,
        signer.address,
        whirlpoolDeployment,
      );

      // 3 positions: 1 regular on pool, 1 full-range on splashPool, 1 TE on pool
      const standalone = positions.filter((p) => !p.isPositionBundle);
      assert.strictEqual(standalone.length, 3);

      const bundles = positions.filter((p) => p.isPositionBundle);
      assert.strictEqual(bundles.length, 2);
      assert.deepEqual(bundles.map((b) => b.positions.length).sort(), [1, 2]);
    });

    it("Should fetch no positions for a different address", async () => {
      const other = await generateKeyPairSigner();
      const positions = await fetchPositionsForOwner(
        rpc,
        other.address,
        whirlpoolDeployment,
      );
      assert.strictEqual(positions.length, 0);
    });

    it("Should fetch positions for a whirlpool", async () => {
      const positions = await fetchPositionsInWhirlpool(
        rpc,
        pool,
        whirlpoolDeployment,
      );
      // 3 positions in pool: 1 regular + 1 TE + 1 bundled
      assert.strictEqual(positions.length, 3);
    });
  },
);
