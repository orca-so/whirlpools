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
import {
  setupAdaptiveFeeTier,
  setupAdaptiveWhirlpool,
  setupConfigAndFeeTiers,
  setupWhirlpool,
} from "./utils/program";
import {
  getWhirlpoolAddress,
  WhirlpoolDeployment,
} from "@orca-so/whirlpools-client";
import { orderMints } from "../src/token";

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
      await setupAdaptiveFeeTier(1025, 64, whirlpoolDeployment);
      await setupAdaptiveFeeTier(1026, 64, whirlpoolDeployment);
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
      // Uninitialized adaptive pools do not add fixed-fee placeholders.
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

    it("Should fetch fixed and adaptive pools with the same tick spacing", async () => {
      const adaptivePool = await setupAdaptiveWhirlpool(
        mintA,
        mintB,
        1025,
        whirlpoolDeployment,
      );
      const pools = await fetchWhirlpoolsByTokenPair(
        rpc,
        mintA,
        mintB,
        whirlpoolDeployment,
      );
      assert.strictEqual(pools.length, 4);
      assert(
        pools.some(
          (pool) => pool.initialized && pool.address === concentratedPool,
        ),
      );
      const adaptive = pools.find((pool) => pool.address === adaptivePool);
      assert(adaptive?.initialized);
      assert.strictEqual(adaptive.tickSpacing, 64);
      assert.strictEqual(
        adaptive.feeTierIndexSeed[0] + adaptive.feeTierIndexSeed[1] * 256,
        1025,
      );
      assert.strictEqual(adaptive.feeRate, 500);
      assert.strictEqual(adaptive.price, 1);
      assert.strictEqual(
        adaptive.whirlpoolsConfig,
        whirlpoolDeployment.configAddress,
      );
      assert(
        pools.some((pool) => !pool.initialized && pool.address === defaultPool),
      );
    });

    it("Should fetch a pair with only an adaptive pool in either mint order", async () => {
      const [tokenA, tokenB] = orderMints(await setupMint(), await setupMint());
      const adaptivePool = await setupAdaptiveWhirlpool(
        tokenA,
        tokenB,
        1026,
        whirlpoolDeployment,
      );
      for (const [first, second] of [
        [tokenA, tokenB],
        [tokenB, tokenA],
      ]) {
        const pools = await fetchWhirlpoolsByTokenPair(
          rpc,
          first,
          second,
          whirlpoolDeployment,
        );
        const initialized = pools.filter((pool) => pool.initialized);
        assert.strictEqual(initialized.length, 1);
        assert.strictEqual(initialized[0].address, adaptivePool);
        assert.strictEqual(pools.filter((pool) => !pool.initialized).length, 3);
      }
    });

    it("Should scope adaptive discovery to the supplied configuration", async () => {
      const configAddress = await setupConfigAndFeeTiers(
        whirlpoolDeployment.programId,
      );
      const otherDeployment = WhirlpoolDeployment.custom(
        whirlpoolDeployment.programId,
        configAddress,
      );
      await setupAdaptiveFeeTier(1027, 64, otherDeployment);
      const otherPool = await setupAdaptiveWhirlpool(
        mintA,
        mintB,
        1027,
        otherDeployment,
      );
      const pools = await fetchWhirlpoolsByTokenPair(
        rpc,
        mintA,
        mintB,
        whirlpoolDeployment,
      );
      assert(!pools.some((pool) => pool.address === otherPool));
      const otherPools = await fetchWhirlpoolsByTokenPair(
        rpc,
        mintA,
        mintB,
        otherDeployment,
      );
      assert.strictEqual(
        otherPools.filter((pool) => pool.initialized).length,
        1,
      );
      assert(
        otherPools.some(
          (pool) => pool.initialized && pool.address === otherPool,
        ),
      );
      assert(
        otherPools.every((pool) => pool.whirlpoolsConfig === configAddress),
      );
    });
  },
);
