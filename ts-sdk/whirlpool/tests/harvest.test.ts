import { fetchToken } from "@solana-program/token";
import type { Address } from "@solana/web3.js";
import assert from "assert";
import { beforeAll, describe, it } from "vitest";
import { harvestPositionInstructions } from "../src/harvest";
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

describe("Harvest", () => {
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

  const testHarvestPositionInstructions = async (
    poolName: string,
    positionName: string,
  ) => {
    const [mintAName, mintBName] = poolName.split("-");
    const mintAAddress = mints.get(mintAName)!;
    const mintBAddress = mints.get(mintBName)!;
    const ataAAddress = atas.get(mintAName)!;
    const ataBAddress = atas.get(mintBName)!;

    const poolAddress = pools.get(poolName)!;
    const positionMintAddress = positions.get(positionName)!;

    let { instructions: swap_instructions } = await swapInstructions(
      rpc,
      { inputAmount: 100n, mint: mintAAddress },
      poolAddress,
    );
    await sendTransaction(swap_instructions);

    ({ instructions: swap_instructions } = await swapInstructions(
      rpc,
      { outputAmount: 100n, mint: mintBAddress },
      poolAddress,
    ));
    await sendTransaction(swap_instructions);

    const tokenABefore = await fetchToken(rpc, ataAAddress);
    const tokenBBefore = await fetchToken(rpc, ataBAddress);

    const { instructions: harvest_instructions, feesQuote } =
      await harvestPositionInstructions(rpc, positionMintAddress);
    await sendTransaction(harvest_instructions);

    const tokenAAfter = await fetchToken(rpc, ataAAddress);
    const tokenBAfter = await fetchToken(rpc, ataBAddress);

    assert.strictEqual(
      feesQuote.feeOwedA,
      tokenAAfter.data.amount - tokenABefore.data.amount,
    );

    assert.strictEqual(
      feesQuote.feeOwedB,
      tokenBAfter.data.amount - tokenBBefore.data.amount,
    );
  };

  for (const poolName of poolTypes.keys()) {
    for (const positionTypeName of positionTypes.keys()) {
      const positionName = `${poolName} ${positionTypeName}`;
      it(`Should harvest a position for ${positionName}`, async () => {
        await testHarvestPositionInstructions(poolName, positionName);
      });

      const positionNameTE = `TE ${poolName} ${positionTypeName}`;
      it(`Should harvest a position for ${positionNameTE}`, async () => {
        await testHarvestPositionInstructions(poolName, positionNameTE);
      });
    }
  }
});
