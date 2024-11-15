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
import { rpc, sendTransaction, signer } from "./utils/mockRpc";
import { fetchMaybeWhirlpool } from "@orca-so/whirlpools-client";
import assert from "assert";
import type { Address } from "@solana/web3.js";
import { assertAccountExists } from "@solana/web3.js";
import { _TICK_ARRAY_SIZE, priceToSqrtPrice } from "@orca-so/whirlpools-core";

describe("Create Pool", () => {
  let mintA: Address;
  let mintB: Address;
  let mintTEA: Address;
  let mintTEB: Address;
  let mintTEFee: Address;
  const tickSpacing = 64;

  beforeAll(async () => {
    mintA = await setupMint();
    mintB = await setupMint();
    mintTEA = await setupMintTE();
    mintTEB = await setupMintTE();
    mintTEFee = await setupMintTEFee();
  });

  it("Should throw an error if funder is not set", async () => {
    setDefaultFunder(DEFAULT_FUNDER);
    await assert.rejects(
      createConcentratedLiquidityPoolInstructions(
        rpc,
        mintA,
        mintB,
        tickSpacing,
        1,
      ),
    );
    setDefaultFunder(signer);
  });

  it("Should throw an error if token mints are not ordered correctly", async () => {
    await assert.rejects(
      createConcentratedLiquidityPoolInstructions(
        rpc,
        mintB,
        mintA,
        tickSpacing,
        1,
      ),
    );
  });

  it("Should create splash pool", async () => {
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
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, estInitializationCost } =
      await createSplashPoolInstructions(rpc, mintA, mintTEA, price);

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
    assert.strictEqual(mintTEA, pool.data.tokenMintB);
    assert.strictEqual(SPLASH_POOL_TICK_SPACING, pool.data.tickSpacing);
  });

  it("Should create splash pool with 2 TE tokens (without extensions)", async () => {
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, estInitializationCost } =
      await createSplashPoolInstructions(rpc, mintTEA, mintTEB, price);

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
    assert.strictEqual(mintTEA, pool.data.tokenMintA);
    assert.strictEqual(mintTEB, pool.data.tokenMintB);
    assert.strictEqual(SPLASH_POOL_TICK_SPACING, pool.data.tickSpacing);
  });

  it("Should create splash pool with 1 TE tokens (with extension)", async () => {
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, estInitializationCost } =
      await createSplashPoolInstructions(rpc, mintA, mintTEFee, price);

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
    assert.strictEqual(mintTEFee, pool.data.tokenMintB);
    assert.strictEqual(SPLASH_POOL_TICK_SPACING, pool.data.tickSpacing);
  });

  it("Should create concentrated liquidity pool", async () => {
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
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, estInitializationCost } =
      await createConcentratedLiquidityPoolInstructions(
        rpc,
        mintA,
        mintTEA,
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
    assert.strictEqual(mintTEA, pool.data.tokenMintB);
    assert.strictEqual(tickSpacing, pool.data.tickSpacing);
  });

  it("Should create splash concentrated liquidity with 2 TE tokens (without extensions)", async () => {
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, estInitializationCost } =
      await createConcentratedLiquidityPoolInstructions(
        rpc,
        mintTEA,
        mintTEB,
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
    assert.strictEqual(mintTEA, pool.data.tokenMintA);
    assert.strictEqual(mintTEB, pool.data.tokenMintB);
    assert.strictEqual(tickSpacing, pool.data.tickSpacing);
  });

  it("Should create splash concentrated liquidity with 1 TE token (with extension)", async () => {
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, estInitializationCost } =
      await createConcentratedLiquidityPoolInstructions(
        rpc,
        mintA,
        mintTEFee,
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
    assert.strictEqual(mintTEFee, pool.data.tokenMintB);
    assert.strictEqual(tickSpacing, pool.data.tickSpacing);
  });
});
