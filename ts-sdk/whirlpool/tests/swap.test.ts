import { fetchToken } from "@solana-program/token-2022";
import type { Address } from "@solana/web3.js";
import assert from "assert";
import { beforeAll, describe, it } from "vitest";
import { swapInstructions } from "../src/swap";
import { rpc, sendTransaction } from "./utils/mockRpc";
import {
  setupPosition,
  setupTEPosition,
  setupWhirlpool,
} from "./utils/program";
import { setupAta, setupMint } from "./utils/token";

import {
  setupAtaTE,
  setupMintTE,
  setupMintTEFee,
} from "./utils/tokenExtensions";

const mintTypes = new Map([
  ["A", setupMint],
  ["B", setupMint],
  ["TEA", setupMintTE],
  ["TEB", setupMintTE],
  ["TEFee", setupMintTEFee],
]);

const ataTypes = new Map([
  ["A", setupAta],
  ["B", setupAta],
  ["TEA", setupAtaTE],
  ["TEB", setupAtaTE],
  ["TEFee", setupAtaTE],
]);

const poolTypes = new Map([
  ["A-B", setupWhirlpool],
  ["A-TEA", setupWhirlpool],
  ["TEA-TEB", setupWhirlpool],
  ["A-TEFee", setupWhirlpool],
]);

const positionTypes = new Map([
  ["equally centered", { tickLower: -100, tickUpper: 100 }],
  ["one sided A", { tickLower: -100, tickUpper: -1 }],
  ["one sided B", { tickLower: 1, tickUpper: 100 }],
]);

describe("Swap", () => {
  const atas: Map<string, Address> = new Map();
  const initialLiquidity = 100_000n;
  const mints: Map<string, Address> = new Map();
  const pools: Map<string, Address> = new Map();
  const positions: Map<string, Address> = new Map();
  const tickSpacing = 64;
  const tokenBalance = 1_000_000n;

  beforeAll(async () => {
    for (const [name, setup] of mintTypes) {
      mints.set(name, await setup());
    }

    for (const [name, setup] of ataTypes) {
      const mint = mints.get(name)!;
      atas.set(name, await setup(mint, { amount: tokenBalance }));
    }

    for (const [name, setup] of poolTypes) {
      const [mintAKey, mintBKey] = name.split("-");
      const mintA = mints.get(mintAKey)!;
      const mintB = mints.get(mintBKey)!;
      pools.set(name, await setup(mintA, mintB, tickSpacing));
    }

    for (const [poolName, poolAddress] of pools) {
      for (const [positionTypeName, tickRange] of positionTypes) {
        const position = await setupPosition(poolAddress, {
          ...tickRange,
          liquidity: initialLiquidity,
        });
        positions.set(`${poolName} ${positionTypeName}`, position);

        const positionTE = await setupTEPosition(poolAddress, {
          ...tickRange,
          liquidity: initialLiquidity,
        });
        positions.set(`TE ${poolName} ${positionTypeName}`, positionTE);
      }
    }
  });

  const testSwapAExactIn = async (poolName: string) => {
    const [mintAName, mintBName] = poolName.split("-");
    const mintAAddress = mints.get(mintAName)!;
    const ataAAddress = atas.get(mintAName)!;
    const ataBAddress = atas.get(mintBName)!;
    const poolAddress = pools.get(poolName)!;

    let tokenABefore = await fetchToken(rpc, ataAAddress);
    let tokenBBefore = await fetchToken(rpc, ataBAddress);

    const { instructions, quote } = await swapInstructions(
      rpc,
      { inputAmount: 100n, mint: mintAAddress },
      poolAddress,
      100, // slippage
    );
    await sendTransaction(instructions);

    let tokenAAfter = await fetchToken(rpc, ataAAddress);
    let tokenBAfter = await fetchToken(rpc, ataBAddress);

    assert.strictEqual(
      -quote.tokenIn,
      tokenAAfter.data.amount - tokenABefore.data.amount,
    );

    assert.strictEqual(
      quote.tokenEstOut,
      tokenBAfter.data.amount - tokenBBefore.data.amount,
    );
  };

  const testSwapAExactOut = async (poolName: string) => {
    const [mintAName, mintBName] = poolName.split("-");
    const mintAAddress = mints.get(mintAName)!;
    const ataAAddress = atas.get(mintAName)!;
    const ataBAddress = atas.get(mintBName)!;
    const poolAddress = pools.get(poolName)!;

    let tokenABefore = await fetchToken(rpc, ataAAddress);
    let tokenBBefore = await fetchToken(rpc, ataBAddress);

    const { instructions, quote } = await swapInstructions(
      rpc,
      { outputAmount: 100n, mint: mintAAddress },
      poolAddress,
      100, // slippage
    );
    await sendTransaction(instructions);

    let tokenAAfter = await fetchToken(rpc, ataAAddress);
    let tokenBAfter = await fetchToken(rpc, ataBAddress);

    assert.strictEqual(
      quote.tokenOut,
      tokenAAfter.data.amount - tokenABefore.data.amount,
    );

    assert.strictEqual(
      -quote.tokenEstIn,
      tokenBAfter.data.amount - tokenBBefore.data.amount,
    );
  };

  const testSwapBExactIn = async (poolName: string) => {
    const [mintAName, mintBName] = poolName.split("-");
    const mintBAddress = mints.get(mintBName)!;
    const ataAAddress = atas.get(mintAName)!;
    const ataBAddress = atas.get(mintBName)!;
    const poolAddress = pools.get(poolName)!;

    let tokenABefore = await fetchToken(rpc, ataAAddress);
    let tokenBBefore = await fetchToken(rpc, ataBAddress);

    const { instructions, quote } = await swapInstructions(
      rpc,
      { inputAmount: 100n, mint: mintBAddress },
      poolAddress,
      100, // slippage
    );
    await sendTransaction(instructions);

    let tokenAAfter = await fetchToken(rpc, ataAAddress);
    let tokenBAfter = await fetchToken(rpc, ataBAddress);

    assert.strictEqual(
      quote.tokenEstOut,
      tokenAAfter.data.amount - tokenABefore.data.amount,
    );

    assert.strictEqual(
      -quote.tokenIn,
      tokenBAfter.data.amount - tokenBBefore.data.amount,
    );
  };

  const testSwapBExactOut = async (poolName: string) => {
    const [mintAName, mintBName] = poolName.split("-");
    const mintBAddress = mints.get(mintBName)!;
    const ataAAddress = atas.get(mintAName)!;
    const ataBAddress = atas.get(mintBName)!;
    const poolAddress = pools.get(poolName)!;

    let tokenABefore = await fetchToken(rpc, ataAAddress);
    let tokenBBefore = await fetchToken(rpc, ataBAddress);

    const { instructions, quote } = await swapInstructions(
      rpc,
      { outputAmount: 100n, mint: mintBAddress },
      poolAddress,
      100, // slippage
    );
    await sendTransaction(instructions);

    let tokenAAfter = await fetchToken(rpc, ataAAddress);
    let tokenBAfter = await fetchToken(rpc, ataBAddress);

    assert.strictEqual(
      -quote.tokenEstIn,
      tokenAAfter.data.amount - tokenABefore.data.amount,
    );

    assert.strictEqual(
      quote.tokenOut,
      tokenBAfter.data.amount - tokenBBefore.data.amount,
    );
  };

  for (const poolName of poolTypes.keys()) {
    it(`Should swap A to B in ${poolName} using A amount`, async () => {
      await testSwapAExactIn(poolName);
    });

    it(`Should swap B to A in ${poolName} using A amount`, async () => {
      await testSwapAExactOut(poolName);
    });

    it(`Should swap B to A in ${poolName} using B amount`, async () => {
      await testSwapBExactIn(poolName);
    });

    it(`Should swap A to B in ${poolName} using B amount`, async () => {
      await testSwapBExactOut(poolName);
    });
  }
});
