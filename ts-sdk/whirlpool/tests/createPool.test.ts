import { describe, it, beforeAll } from "vitest";
import {
  createSplashPoolInstructions,
  createConcentratedLiquidityPoolInstructions,
} from "../src/createPool";
import {
  DEFAULT_FUNDER,
  setDefaultFunder,
  SPLASH_POOL_TICK_SPACING,
} from "../src/config";
import { setupMint } from "./utils/token";
import { setupMintTE, setupMintTEFee } from "./utils/tokenExtensions";
import { orderMints } from "../src/token";
import { rpc, sendTransaction, signer } from "./utils/mockRpc";
import { fetchMaybeWhirlpool } from "@orca-so/whirlpools-client";
import assert from "assert";
import type { Address } from "@solana/web3.js";
import { assertAccountExists } from "@solana/web3.js";
import { _TICK_ARRAY_SIZE, priceToSqrtPrice } from "@orca-so/whirlpools-core";

describe("Create Pool", () => {
  let mint1: Address;
  let mint2: Address;
  let mintTE1: Address;
  let mintTE2: Address;
  let mintTEFee1: Address;
  let mintTEFee2: Address;

  beforeAll(async () => {
    mint1 = await setupMint();
    mint2 = await setupMint();
    mintTE1 = await setupMintTE();
    mintTE2 = await setupMintTE();
    mintTEFee1 = await setupMintTEFee();
    mintTEFee2 = await setupMintTEFee();
  });

  it("Should throw an error if funder is not set", async () => {
    const [mintA, mintB] = orderMints(mint1, mint2);
    setDefaultFunder(DEFAULT_FUNDER);
    await assert.rejects(
      createConcentratedLiquidityPoolInstructions(rpc, mintA, mintB, 64, 1),
    );
    setDefaultFunder(signer);
  });

  it("Should throw an error if token mints are not ordered correctly", async () => {
    const [mintA, mintB] = orderMints(mint1, mint2);
    await assert.rejects(
      createConcentratedLiquidityPoolInstructions(rpc, mintB, mintA, 64, 1),
    );
  });

  it("Should create splash pool", async () => {
    const [mintA, mintB] = orderMints(mint1, mint2);
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, estInitializationCost } =
      await createSplashPoolInstructions(rpc, mintA, mintB, price);

    const balanceBefore = await rpc.getBalance(signer.address).send();
    const maybePool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assert.strictEqual(maybePool.exists, false);

    await sendTransaction(instructions);

    const pool = await fetchMaybeWhirlpool(rpc, poolAddress);
    const balanceAfter = await rpc.getBalance(signer.address).send();
    const balanceChange = balanceBefore.value - balanceAfter.value;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;

    assertAccountExists(pool);
    assert.strictEqual(estInitializationCost, minRentExempt);
    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintA, pool.data.tokenMintA);
    assert.strictEqual(mintB, pool.data.tokenMintB);
    assert.strictEqual(SPLASH_POOL_TICK_SPACING, pool.data.tickSpacing);
  });

  it("Should create splash pool with 1 TE token (without extension)", async () => {
    const [mintA, mintB] = orderMints(mint1, mintTE1);
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, estInitializationCost } =
      await createSplashPoolInstructions(rpc, mintA, mintB, price);

    const balanceBefore = await rpc.getBalance(signer.address).send();
    const maybePool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assert.strictEqual(maybePool.exists, false);

    await sendTransaction(instructions);

    const pool = await fetchMaybeWhirlpool(rpc, poolAddress);
    const balanceAfter = await rpc.getBalance(signer.address).send();
    const balanceChange = balanceBefore.value - balanceAfter.value;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;

    assertAccountExists(pool);
    assert.strictEqual(estInitializationCost, minRentExempt);
    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintA, pool.data.tokenMintA);
    assert.strictEqual(mintB, pool.data.tokenMintB);
    assert.strictEqual(SPLASH_POOL_TICK_SPACING, pool.data.tickSpacing);
  });

  it("Should create splash pool with 2 TE tokens (without extensions)", async () => {
    const [mintA, mintB] = orderMints(mintTE1, mintTE2);
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, estInitializationCost } =
      await createSplashPoolInstructions(rpc, mintA, mintB, price);

    const balanceBefore = await rpc.getBalance(signer.address).send();
    const maybePool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assert.strictEqual(maybePool.exists, false);

    await sendTransaction(instructions);

    const pool = await fetchMaybeWhirlpool(rpc, poolAddress);
    const balanceAfter = await rpc.getBalance(signer.address).send();
    const balanceChange = balanceBefore.value - balanceAfter.value;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;

    assertAccountExists(pool);
    assert.strictEqual(estInitializationCost, minRentExempt);
    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintA, pool.data.tokenMintA);
    assert.strictEqual(mintB, pool.data.tokenMintB);
    assert.strictEqual(SPLASH_POOL_TICK_SPACING, pool.data.tickSpacing);
  });

  it("Should create splash pool with 1 TE tokens (with extension)", async () => {
    const [mintA, mintB] = orderMints(mint1, mintTEFee1);
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, estInitializationCost } =
      await createSplashPoolInstructions(rpc, mintA, mintB, price);

    const balanceBefore = await rpc.getBalance(signer.address).send();
    const maybePool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assert.strictEqual(maybePool.exists, false);

    await sendTransaction(instructions);

    const pool = await fetchMaybeWhirlpool(rpc, poolAddress);
    const balanceAfter = await rpc.getBalance(signer.address).send();
    const balanceChange = balanceBefore.value - balanceAfter.value;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;

    assertAccountExists(pool);
    assert.strictEqual(estInitializationCost, minRentExempt);
    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintA, pool.data.tokenMintA);
    assert.strictEqual(mintB, pool.data.tokenMintB);
    assert.strictEqual(SPLASH_POOL_TICK_SPACING, pool.data.tickSpacing);
  });

  it("Should create concentrated liquidity pool", async () => {
    const [mintA, mintB] = orderMints(mint1, mint2);
    const tickSpacing = 64;
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, estInitializationCost } =
      await createConcentratedLiquidityPoolInstructions(
        rpc,
        mintA,
        mintB,
        tickSpacing,
        price,
      );

    const balanceBefore = await rpc.getBalance(signer.address).send();
    const maybePool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assert.strictEqual(maybePool.exists, false);

    await sendTransaction(instructions);

    const pool = await fetchMaybeWhirlpool(rpc, poolAddress);
    const balanceAfter = await rpc.getBalance(signer.address).send();
    const balanceChange = balanceBefore.value - balanceAfter.value;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;

    assertAccountExists(pool);
    assert.strictEqual(estInitializationCost, minRentExempt);
    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintA, pool.data.tokenMintA);
    assert.strictEqual(mintB, pool.data.tokenMintB);
    assert.strictEqual(tickSpacing, pool.data.tickSpacing);
  });

  it("Should create concentrated liquidity pool with 1 TE token (without extension)", async () => {
    const [mintA, mintB] = orderMints(mint1, mintTE1);
    const tickSpacing = 64;
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, estInitializationCost } =
      await createConcentratedLiquidityPoolInstructions(
        rpc,
        mintA,
        mintB,
        tickSpacing,
        price,
      );

    const balanceBefore = await rpc.getBalance(signer.address).send();
    const maybePool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assert.strictEqual(maybePool.exists, false);

    await sendTransaction(instructions);

    const pool = await fetchMaybeWhirlpool(rpc, poolAddress);
    const balanceAfter = await rpc.getBalance(signer.address).send();
    const balanceChange = balanceBefore.value - balanceAfter.value;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;

    assertAccountExists(pool);
    assert.strictEqual(estInitializationCost, minRentExempt);
    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintA, pool.data.tokenMintA);
    assert.strictEqual(mintB, pool.data.tokenMintB);
    assert.strictEqual(tickSpacing, pool.data.tickSpacing);
  });

  it("Should create splash concentrated liquidity with 2 TE tokens (without extensions)", async () => {
    const [mintA, mintB] = orderMints(mintTE1, mintTE2);
    const tickSpacing = 64;
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, estInitializationCost } =
      await createConcentratedLiquidityPoolInstructions(
        rpc,
        mintA,
        mintB,
        tickSpacing,
        price,
      );

    const balanceBefore = await rpc.getBalance(signer.address).send();
    const maybePool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assert.strictEqual(maybePool.exists, false);

    await sendTransaction(instructions);

    const pool = await fetchMaybeWhirlpool(rpc, poolAddress);
    const balanceAfter = await rpc.getBalance(signer.address).send();
    const balanceChange = balanceBefore.value - balanceAfter.value;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;

    assertAccountExists(pool);
    assert.strictEqual(estInitializationCost, minRentExempt);
    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintA, pool.data.tokenMintA);
    assert.strictEqual(mintB, pool.data.tokenMintB);
    assert.strictEqual(tickSpacing, pool.data.tickSpacing);
  });

  it("Should create splash concentrated liquidity with 1 TE token (with extension)", async () => {
    const [mintA, mintB] = orderMints(mint1, mintTEFee2);
    const tickSpacing = 64;
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, estInitializationCost } =
      await createConcentratedLiquidityPoolInstructions(
        rpc,
        mintA,
        mintB,
        tickSpacing,
        price,
      );

    const balanceBefore = await rpc.getBalance(signer.address).send();
    const maybePool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assert.strictEqual(maybePool.exists, false);

    await sendTransaction(instructions);

    const pool = await fetchMaybeWhirlpool(rpc, poolAddress);
    const balanceAfter = await rpc.getBalance(signer.address).send();
    const balanceChange = balanceBefore.value - balanceAfter.value;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;

    assertAccountExists(pool);
    assert.strictEqual(estInitializationCost, minRentExempt);
    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintA, pool.data.tokenMintA);
    assert.strictEqual(mintB, pool.data.tokenMintB);
    assert.strictEqual(tickSpacing, pool.data.tickSpacing);
  });
});
