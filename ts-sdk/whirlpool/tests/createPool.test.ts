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
import {
  fetchMaybeWhirlpool,
} from "@orca-so/whirlpools-client";
import assert from "assert";
import type { Address } from "@solana/web3.js";
import { assertAccountExists, lamports } from "@solana/web3.js";
import {
  _TICK_ARRAY_SIZE,
  priceToSqrtPrice,
} from "@orca-so/whirlpools-core";

describe("Create Pool", () => {
  let mintA: Address;
  let mintB: Address;

  beforeAll(async () => {
    const mint1 = await setupMint();
    const mint2 = await setupMint();
    [mintA, mintB] = orderMints(mint1, mint2);
  });

  it("Should throw an error if funder is not set", async () => {
    setDefaultFunder(DEFAULT_FUNDER);
    await assert.rejects(
      createConcentratedLiquidityPoolInstructions(rpc, mintA, mintB, 64, 1),
    );
    setDefaultFunder(signer);
  });

  it("Should throw an error if token mints are not ordered correctly", async () => {
    await assert.rejects(
      createConcentratedLiquidityPoolInstructions(rpc, mintB, mintA, 64, 1),
    );
  });

  it("Should create splash pool", async () => {
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    let signerAccount = await rpc.getAccountInfo(signer.address).send();
    const balanceBefore = signerAccount.value?.lamports ?? lamports(0n);

    const { instructions, poolAddress, estInitializationCost } = await createSplashPoolInstructions(
      rpc,
      mintA,
      mintB,
      price,
    );

    const maybePool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assert.strictEqual(maybePool.exists, false)

    await sendTransaction(instructions);

    const pool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assertAccountExists(pool);

    signerAccount = await rpc.getAccountInfo(signer.address).send();
    const balanceAfter = signerAccount.value?.lamports ?? lamports(0n);
    const balanceChange = balanceBefore - balanceAfter;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;
    assert.strictEqual(estInitializationCost, minRentExempt);

    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintA, pool.data.tokenMintA);
    assert.strictEqual(mintB, pool.data.tokenMintB);
    assert.strictEqual(SPLASH_POOL_TICK_SPACING, pool.data.tickSpacing);
  });

  it("Should create splash pool with 1 TE token", async () => {
    const mint1 = await setupMint();
    const mint2 = await setupMintTEFee();
    const [mintC, mintD] = orderMints(mint1, mint2);
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    let signerAccount = await rpc.getAccountInfo(signer.address).send();
    const balanceBefore = signerAccount.value?.lamports ?? lamports(0n);

    const { instructions, poolAddress, estInitializationCost } = await createSplashPoolInstructions(
      rpc,
      mintC,
      mintD,
      price,
    );

    const maybePool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assert.strictEqual(maybePool.exists, false)

    await sendTransaction(instructions);

    const pool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assertAccountExists(pool);

    signerAccount = await rpc.getAccountInfo(signer.address).send();
    const balanceAfter = signerAccount.value?.lamports ?? lamports(0n);
    const balanceChange = balanceBefore - balanceAfter;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;
    assert.strictEqual(estInitializationCost, minRentExempt);

    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintC, pool.data.tokenMintA);
    assert.strictEqual(mintD, pool.data.tokenMintB);
    assert.strictEqual(SPLASH_POOL_TICK_SPACING, pool.data.tickSpacing);
  });

  it("Should create splash pool with 2 TE tokens", async () => {
    const mint1 = await setupMintTEFee();
    const mint2 = await setupMintTEFee();
    const [mintC, mintD] = orderMints(mint1, mint2);
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    let signerAccount = await rpc.getAccountInfo(signer.address).send();
    const balanceBefore = signerAccount.value?.lamports ?? lamports(0n);

    const { instructions, poolAddress, estInitializationCost } = await createSplashPoolInstructions(
      rpc,
      mintC,
      mintD,
      price,
    );

    const maybePool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assert.strictEqual(maybePool.exists, false)

    await sendTransaction(instructions);

    const pool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assertAccountExists(pool);

    signerAccount = await rpc.getAccountInfo(signer.address).send();
    const balanceAfter = signerAccount.value?.lamports ?? lamports(0n);
    const balanceChange = balanceBefore - balanceAfter;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;
    assert.strictEqual(estInitializationCost, minRentExempt);

    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintC, pool.data.tokenMintA);
    assert.strictEqual(mintD, pool.data.tokenMintB);
    assert.strictEqual(SPLASH_POOL_TICK_SPACING, pool.data.tickSpacing);
  });

  it("Should create concentrated liquidity pool", async () => {
    const tickSpacing = 64
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    let signerAccount = await rpc.getAccountInfo(signer.address).send();
    const balanceBefore = signerAccount.value?.lamports ?? lamports(0n);

    const { instructions, poolAddress, estInitializationCost } = await createConcentratedLiquidityPoolInstructions(
      rpc,
      mintA,
      mintB,
      tickSpacing,
      price,
    );

    const maybePool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assert.strictEqual(maybePool.exists, false)

    await sendTransaction(instructions);

    const pool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assertAccountExists(pool);

    signerAccount = await rpc.getAccountInfo(signer.address).send();
    const balanceAfter = signerAccount.value?.lamports ?? lamports(0n);
    const balanceChange = balanceBefore - balanceAfter;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;
    assert.strictEqual(estInitializationCost, minRentExempt);

    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintA, pool.data.tokenMintA);
    assert.strictEqual(mintB, pool.data.tokenMintB);
    assert.strictEqual(tickSpacing, pool.data.tickSpacing);
  });

  it("Should create concentrated liquidity pool with 1 TE token", async () => {
    const mint1 = await setupMint();
    const mint2 = await setupMintTEFee();
    const [mintC, mintD] = orderMints(mint1, mint2);
    const tickSpacing = 64;
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    let signerAccount = await rpc.getAccountInfo(signer.address).send();
    const balanceBefore = signerAccount.value?.lamports ?? lamports(0n);

    const { instructions, poolAddress, estInitializationCost } = await createConcentratedLiquidityPoolInstructions(
      rpc,
      mintC,
      mintD,
      tickSpacing,
      price,
    );

    const maybePool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assert.strictEqual(maybePool.exists, false)

    await sendTransaction(instructions);

    const pool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assertAccountExists(pool);

    signerAccount = await rpc.getAccountInfo(signer.address).send();
    const balanceAfter = signerAccount.value?.lamports ?? lamports(0n);
    const balanceChange = balanceBefore - balanceAfter;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;
    assert.strictEqual(estInitializationCost, minRentExempt);

    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintC, pool.data.tokenMintA);
    assert.strictEqual(mintD, pool.data.tokenMintB);
    assert.strictEqual(tickSpacing, pool.data.tickSpacing);
  });

  it("Should create splash concentrated liquidity with 2 TE tokens", async () => {
    const mint1 = await setupMintTEFee();
    const mint2 = await setupMintTEFee();
    const [mintC, mintD] = orderMints(mint1, mint2);
    const tickSpacing = 64;
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    let signerAccount = await rpc.getAccountInfo(signer.address).send();
    const balanceBefore = signerAccount.value?.lamports ?? lamports(0n);

    const { instructions, poolAddress, estInitializationCost } = await createConcentratedLiquidityPoolInstructions(
      rpc,
      mintC,
      mintD,
      tickSpacing,
      price,
    );

    const maybePool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assert.strictEqual(maybePool.exists, false)

    await sendTransaction(instructions);

    const pool = await fetchMaybeWhirlpool(rpc, poolAddress);
    assertAccountExists(pool);

    signerAccount = await rpc.getAccountInfo(signer.address).send();
    const balanceAfter = signerAccount.value?.lamports ?? lamports(0n);
    const balanceChange = balanceBefore - balanceAfter;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;
    assert.strictEqual(estInitializationCost, minRentExempt);

    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintC, pool.data.tokenMintA);
    assert.strictEqual(mintD, pool.data.tokenMintB);
    assert.strictEqual(tickSpacing, pool.data.tickSpacing);
  });
});
