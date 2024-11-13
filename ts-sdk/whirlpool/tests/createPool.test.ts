import { describe, it, beforeAll, afterEach } from "vitest";
import {
  createSplashPoolInstructions,
  createConcentratedLiquidityPoolInstructions,
} from "../src/createPool";
import {
  DEFAULT_FUNDER,
  resetConfiguration,
  setDefaultFunder,
  SPLASH_POOL_TICK_SPACING,
  WHIRLPOOLS_CONFIG_ADDRESS,
} from "../src/config";
import { setupMint } from "./utils/token";
import { orderMints } from "../src/token";
import { rpc, sendTransaction, signer } from "./utils/mockRpc";
import { fetchWhirlpool, getTickArrayAddress, getWhirlpoolAddress } from "@orca-so/whirlpools-client";
import assert from "assert";
import type { Address, KeyPairSigner } from "@solana/web3.js";
import { generateKeyPairSigner, lamports } from "@solana/web3.js";
import { _TICK_ARRAY_SIZE, getTickArrayStartTickIndex, priceToSqrtPrice } from "@orca-so/whirlpools-core";



describe("Create Pool", () => {
  let mintA: Address;
  let mintB: Address;

  beforeAll(async () => {
    const mint1 = await setupMint();
    const mint2 = await setupMint();
    [mintA, mintB] = orderMints(mint1, mint2);
  })

  it("Should throw an error if funder is not set", async () => {
    setDefaultFunder(DEFAULT_FUNDER);
    await assert.rejects(
      createConcentratedLiquidityPoolInstructions(rpc, mintA, mintB, 64, 1),
      {
        name: 'AssertionError',
        message: 'Either supply a funder or set the default funder'
      }
    );
    setDefaultFunder(signer);
  });

  it("Should throw an error if token mints are not ordered", async () => {
    await assert.rejects(
      createConcentratedLiquidityPoolInstructions(rpc, mintB, mintA, 64, 1),
      {
        name: 'AssertionError',
        message: 'Token order needs to be flipped to match the canonical ordering (i.e. sorted on the byte repr. of the mint pubkeys)'
      }
    );
  })

  it("Should create valid splash pool instructions", async () => {
    const price = 10;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6)

    let signerAccount = await rpc.getAccountInfo(signer.address).send();
    const balanceBefore = signerAccount.value?.lamports ?? lamports(0n);
    const { estInitializationCost, instructions, poolAddress } =
      await createSplashPoolInstructions(rpc, mintA, mintB, price);
    await sendTransaction(instructions);

    const tickArrayAddress1 = await getTickArrayAddress(poolAddress, -SPLASH_POOL_TICK_SPACING * 88)
    const tickArrayAddress2 = await getTickArrayAddress(poolAddress, 0);

    const pool = await fetchWhirlpool(rpc, poolAddress);
    const tokenVaultA = await rpc.getAccountInfo(pool.data.tokenVaultA).send();
    const tokenVaultB = await rpc.getAccountInfo(pool.data.tokenVaultB).send();
    const tickArray1 = await rpc.getAccountInfo(tickArrayAddress1[0]).send();
    const tickArray2 = await rpc.getAccountInfo(tickArrayAddress2[0]).send();
    
    const poolLamports = pool.lamports;
    const vaultALamports = tokenVaultA.value?.lamports ?? lamports(0n);
    const vaultBLamports = tokenVaultB.value?.lamports ?? lamports(0n);
    const tickArray1Lamports = tickArray1.value?.lamports ?? lamports(0n);
    const tickArray2Lamports = tickArray2.value?.lamports ?? lamports(0n);
    const minRentExempt = poolLamports + vaultALamports + vaultBLamports + tickArray1Lamports + tickArray2Lamports;
    
    signerAccount = await rpc.getAccountInfo(signer.address).send();
    const balanceAfter = signerAccount.value?.lamports ?? lamports(0n);
    const balanceChange = balanceBefore - balanceAfter;

    assert.strictEqual(minRentExempt, balanceChange)
    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintA, pool.data.tokenMintA);
    assert.strictEqual(mintB, pool.data.tokenMintB);
    assert.strictEqual(SPLASH_POOL_TICK_SPACING, pool.data.tickSpacing);
  })

  // it("Should create valid splash pool instructions", async () => {
  //   const price = 10;

  //   let signerAccount = await rpc.getAccountInfo(signer.address).send();
  //   const balanceBefore = signerAccount.value?.lamports ?? lamports(0n);
  //   const { instructions, estInitializationCost } =
  //     await createSplashPoolInstructions(rpc, mintA, mintB, price);
  //   await sendTransaction(instructions);

  //   signerAccount = await rpc.getAccountInfo(signer.address).send();
  //   const balanceAfter = signerAccount.value?.lamports ?? lamports(0n);
  //   const balanceChange = balanceBefore - balanceAfter;

  //   assert.strictEqual(estInitializationCost, balanceChange)
  // })
});


