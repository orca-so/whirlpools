import { describe, it, beforeAll } from "vitest";
import {
  fetchConcentratedLiquidityPool,
  fetchSplashPool,
  fetchWhirlpoolsByTokenPair,
} from "../src/pool";
import { rpc } from "./utils/mockRpc";
import assert from "assert";
import {
  SPLASH_POOL_TICK_SPACING,
  WHIRLPOOLS_CONFIG_ADDRESS,
} from "../src/config";
import type { Address } from "@solana/web3.js";
import { setupMint } from "./utils/token";
import { setupWhirlpool } from "./utils/program";
import { getWhirlpoolAddress } from "@orca-so/whirlpools-client";
import { orderMints } from "../src/token";

describe("Fetch Pool", () => {
  let mintA: Address;
  let mintB: Address;
  let defaultPool: Address;
  let concentratedPool: Address;
  let splashPool: Address;

  beforeAll(async () => {
    const mint1 = await setupMint();
    const mint2 = await setupMint();
    [mintA, mintB] = orderMints(mint1, mint2);
    concentratedPool = await setupWhirlpool(mintA, mintB, 64);
    defaultPool = await getWhirlpoolAddress(
      WHIRLPOOLS_CONFIG_ADDRESS,
      mintA,
      mintB,
      128,
    ).then((x) => x[0]);
    splashPool = await setupWhirlpool(mintA, mintB, SPLASH_POOL_TICK_SPACING);
  });

  it("Should be able to fetch a splash pool", async () => {
    const pool = await fetchSplashPool(rpc, mintA, mintB);
    assert.strictEqual(pool.initialized, true);
    assert.strictEqual(pool.liquidity, 0n);
    assert.strictEqual(pool.tickSpacing, SPLASH_POOL_TICK_SPACING);
    assert.strictEqual(pool.address, splashPool);
    assert.strictEqual(pool.tokenMintA, mintA);
    assert.strictEqual(pool.tokenMintB, mintB);
    assert.strictEqual(pool.feeRate, 1000);
    assert.strictEqual(pool.protocolFeeRate, 100);
    assert.strictEqual(pool.whirlpoolsConfig, WHIRLPOOLS_CONFIG_ADDRESS);
  });

  it("Should be able to fetch a concentrated liquidity pool", async () => {
    const pool = await fetchConcentratedLiquidityPool(rpc, mintA, mintB, 64);
    assert.strictEqual(pool.initialized, true);
    assert.strictEqual(pool.liquidity, 0n);
    assert.strictEqual(pool.tickSpacing, 64);
    assert.strictEqual(pool.address, concentratedPool);
    assert.strictEqual(pool.tokenMintA, mintA);
    assert.strictEqual(pool.tokenMintB, mintB);
    assert.strictEqual(pool.feeRate, 300);
    assert.strictEqual(pool.protocolFeeRate, 100);
    assert.strictEqual(pool.whirlpoolsConfig, WHIRLPOOLS_CONFIG_ADDRESS);
  });

  it("Should be able to try fetching a non-existent pool", async () => {
    const pool = await fetchConcentratedLiquidityPool(rpc, mintA, mintB, 128);
    assert.strictEqual(pool.initialized, false);
    assert.strictEqual(pool.tickSpacing, 128);
    assert.strictEqual(pool.address, defaultPool);
    assert.strictEqual(pool.tokenMintA, mintA);
    assert.strictEqual(pool.tokenMintB, mintB);
    assert.strictEqual(pool.feeRate, 1000);
    assert.strictEqual(pool.protocolFeeRate, 100);
    assert.strictEqual(pool.whirlpoolsConfig, WHIRLPOOLS_CONFIG_ADDRESS);
  });

  // TODO: Enable this test once solana-bankrun exposes getProgramAccounts
  it.skip("Should be able to fetch all pools for a pair", async () => {
    const pools = await fetchWhirlpoolsByTokenPair(rpc, mintA, mintB);
    assert.strictEqual(pools.length, 3);
    assert.strictEqual(pools[0].initialized, true);
    assert.strictEqual(pools[0].tickSpacing, 64);
    assert.strictEqual(pools[1].initialized, true);
    assert.strictEqual(pools[1].tickSpacing, SPLASH_POOL_TICK_SPACING);
    assert.strictEqual(pools[2].initialized, false);
    assert.strictEqual(pools[2].tickSpacing, 128);
  });
});
