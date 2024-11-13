import { describe, it, beforeAll } from "vitest";
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
import type { Address, Lamports } from "@solana/web3.js";
import { lamports } from "@solana/web3.js";
import { _TICK_ARRAY_SIZE, getFullRangeTickIndexes, getTickArrayStartTickIndex, priceToSqrtPrice, sqrtPriceToTickIndex } from "@orca-so/whirlpools-core";
import { setupMintTE, setupMintTEFee } from "./utils/tokenExtensions";



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

    const { instructions, poolAddress } =
      await createSplashPoolInstructions(rpc, mintA, mintB, price);
    await sendTransaction(instructions);

    const pool = await fetchWhirlpool(rpc, poolAddress);
    assert.strictEqual(sqrtPrice, pool.data.sqrtPrice);
    assert.strictEqual(mintA, pool.data.tokenMintA);
    assert.strictEqual(mintB, pool.data.tokenMintB);
    assert.strictEqual(SPLASH_POOL_TICK_SPACING, pool.data.tickSpacing);
  })

  it("Should estimate initialization costs correctly", async () => {
    const assertEstInitializationCost = async (estInitializationCost, poolAddress, tickSpacing) => {
      const pool = await fetchWhirlpool(rpc, poolAddress);
      const tokenVaultA = await rpc.getAccountInfo(pool.data.tokenVaultA).send();
      const tokenVaultB = await rpc.getAccountInfo(pool.data.tokenVaultB).send();
      const fullRange = getFullRangeTickIndexes(tickSpacing);
      const lowerTickIndex = getTickArrayStartTickIndex(
        fullRange.tickLowerIndex,
        tickSpacing,
      );
      const upperTickIndex = getTickArrayStartTickIndex(
        fullRange.tickUpperIndex,
        tickSpacing,
      );
      const initialTickIndex = sqrtPriceToTickIndex(pool.data.sqrtPrice);
      const currentTickIndex = getTickArrayStartTickIndex(
        initialTickIndex,
        tickSpacing,
      );
      const tickArrayIndexes = Array.from(
        new Set([lowerTickIndex, upperTickIndex, currentTickIndex]),
      );
      const tickArrayAddresses = await Promise.all(
        tickArrayIndexes.map((x) =>
          getTickArrayAddress(poolAddress, x).then((x) => x[0]),
        ),
      );
      const tickArrayAccounts = await Promise.all(
        tickArrayAddresses.map(async (address) => {
          const accountInfo = await rpc.getAccountInfo(address).send();
          return accountInfo;
        })
      );

      const poolLamports = pool.lamports;
      const vaultALamports = tokenVaultA.value?.lamports ?? lamports(0n);
      const vaultBLamports = tokenVaultB.value?.lamports ?? lamports(0n);
      
      const tickArrayLamports = tickArrayAccounts.reduce<Lamports>((acc, account) => {
        return lamports(acc + (account.value?.lamports ?? 0n));
      }, lamports(0n));
      
      const minRentExempt = poolLamports + vaultALamports + vaultBLamports + tickArrayLamports;

      assert.strictEqual(estInitializationCost, minRentExempt)
    }

    let tickSpacing = 64
    const testPoolInstructionsCLMM =
      await createConcentratedLiquidityPoolInstructions(rpc, mintA, mintB, tickSpacing);
    await sendTransaction(testPoolInstructionsCLMM.instructions);
    assertEstInitializationCost(testPoolInstructionsCLMM.estInitializationCost, testPoolInstructionsCLMM.poolAddress, tickSpacing);

    const mint3 = await setupMint()
    const mint4 = await setupMint()
    const [mintC, mintD] = orderMints(mint3, mint4);
    const testPoolInstructionsSplash =
      await createSplashPoolInstructions(rpc, mintC, mintD);
    await sendTransaction(testPoolInstructionsSplash.instructions);
    assertEstInitializationCost(testPoolInstructionsSplash.estInitializationCost, testPoolInstructionsSplash.poolAddress, SPLASH_POOL_TICK_SPACING);

    const mint5 = await setupMintTE()
    const mint6 = await setupMintTEFee()
    const [mintE, mintF] = orderMints(mint5, mint6);
    const testPoolTE =
      await createConcentratedLiquidityPoolInstructions(rpc, mintE, mintF, tickSpacing);
    await sendTransaction(testPoolTE.instructions);
    assertEstInitializationCost(testPoolTE.estInitializationCost, testPoolTE.poolAddress, tickSpacing);
  })
});


