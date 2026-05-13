import { describe, it, beforeAll } from "vitest";
import {
  fetchConcentratedLiquidityPool,
  fetchSplashPool,
  fetchWhirlpoolsByTokenPair,
} from "../src/pool";
import {
  getTestContext,
  rpc,
  TEST_WHIRLPOOL_DEPLOYMENTS,
} from "./utils/mockRpc";
import assert from "assert";
import { SPLASH_POOL_TICK_SPACING } from "../src/config";
import type { Address } from "@solana/kit";
import { setupMint } from "./utils/token";
import { setupWhirlpool } from "./utils/program";
import { getWhirlpoolAddress } from "@orca-so/whirlpools-client";

// Ensure both deployments are initialized so the parametrized describe.each below
// sees real config addresses, not the static `mainnet` placeholders.
await getTestContext();

describe.each(TEST_WHIRLPOOL_DEPLOYMENTS)(
  "Fetch Pool ($programId)",
  (whirlpoolDeployment) => {
    let mintA: Address;
    let mintB: Address;
    let defaultPool: Address;
    let concentratedPool: Address;
    let splashPool: Address;

    beforeAll(async () => {
      mintA = await setupMint();
      mintB = await setupMint();
      concentratedPool = await setupWhirlpool(mintA, mintB, 64, {
        whirlpoolDeployment,
      });
      defaultPool = await getWhirlpoolAddress(
        mintA,
        mintB,
        128,
        whirlpoolDeployment,
      ).then((x) => x[0]);
      splashPool = await setupWhirlpool(
        mintA,
        mintB,
        SPLASH_POOL_TICK_SPACING,
        { whirlpoolDeployment },
      );
    });

    it("Should be able to fetch a splash pool", async () => {
      const pool = await fetchSplashPool(
        rpc,
        mintA,
        mintB,
        whirlpoolDeployment,
      );
      assert.strictEqual(pool.initialized, true);
      assert.strictEqual(pool.liquidity, 0n);
      assert.strictEqual(pool.tickSpacing, SPLASH_POOL_TICK_SPACING);
      assert.strictEqual(pool.address, splashPool);
      assert.strictEqual(pool.tokenMintA, mintA);
      assert.strictEqual(pool.tokenMintB, mintB);
      assert.strictEqual(pool.feeRate, 1000);
      assert.strictEqual(pool.protocolFeeRate, 100);
      assert.strictEqual(
        pool.whirlpoolsConfig,
        whirlpoolDeployment.configAddress,
      );
    });

    it("Should be able to fetch a concentrated liquidity pool", async () => {
      const pool = await fetchConcentratedLiquidityPool(
        rpc,
        mintA,
        mintB,
        64,
        whirlpoolDeployment,
      );
      assert.strictEqual(pool.initialized, true);
      assert.strictEqual(pool.liquidity, 0n);
      assert.strictEqual(pool.tickSpacing, 64);
      assert.strictEqual(pool.address, concentratedPool);
      assert.strictEqual(pool.tokenMintA, mintA);
      assert.strictEqual(pool.tokenMintB, mintB);
      assert.strictEqual(pool.feeRate, 300);
      assert.strictEqual(pool.protocolFeeRate, 100);
      assert.strictEqual(
        pool.whirlpoolsConfig,
        whirlpoolDeployment.configAddress,
      );
    });

    it("Should be able to try fetching a non-existent pool", async () => {
      const pool = await fetchConcentratedLiquidityPool(
        rpc,
        mintA,
        mintB,
        128,
        whirlpoolDeployment,
      );
      assert.strictEqual(pool.initialized, false);
      assert.strictEqual(pool.tickSpacing, 128);
      assert.strictEqual(pool.address, defaultPool);
      assert.strictEqual(pool.tokenMintA, mintA);
      assert.strictEqual(pool.tokenMintB, mintB);
      assert.strictEqual(pool.feeRate, 1000);
      assert.strictEqual(pool.protocolFeeRate, 100);
      assert.strictEqual(
        pool.whirlpoolsConfig,
        whirlpoolDeployment.configAddress,
      );
    });

    it("Should be able to fetch all pools for a pair", async () => {
      const pools = await fetchWhirlpoolsByTokenPair(
        rpc,
        mintA,
        mintB,
        whirlpoolDeployment,
      );
      assert.strictEqual(pools.length, 3);

      // Note: we use find because ordering is not guaranteed
      const pool0 = pools.find((p) => p.tickSpacing === 64);
      assert.strictEqual(pool0?.initialized, true);
      assert.strictEqual(pool0?.tickSpacing, 64);

      const pool1 = pools.find(
        (p) => p.tickSpacing === SPLASH_POOL_TICK_SPACING,
      );
      assert.strictEqual(pool1?.initialized, true);
      assert.strictEqual(pool1?.tickSpacing, SPLASH_POOL_TICK_SPACING);

      const pool2 = pools.find((p) => p.tickSpacing === 128);
      assert.strictEqual(pool2?.initialized, false);
      assert.strictEqual(pool2?.tickSpacing, 128);
    });
  },
);
