import {
  fetchMaybePosition,
  getPositionAddress,
} from "@orca-so/whirlpools-client";
import { fetchToken } from "@solana-program/token";
import type { Address } from "@solana/web3.js";
import { address } from "@solana/web3.js";
import assert from "assert";
import { beforeAll, describe, it } from "vitest";
import { closePositionInstructions } from "../src/decreaseLiquidity";
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

describe("Close Position", () => {
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

  const testClosePositionInstructions = async (
    poolName: string,
    positionName: string,
  ) => {
    const [mintAName, mintBName] = poolName.split("-");
    const ataAAddress = atas.get(mintAName)!;
    const ataBAddress = atas.get(mintBName)!;
    const tokenABefore = await fetchToken(rpc, ataAAddress);
    const tokenBBefore = await fetchToken(rpc, ataBAddress);

    const positionMintAddress = positions.get(positionName)!;
    const [positionAddress, _] = await getPositionAddress(positionMintAddress);

    const { instructions, quote, feesQuote } = await closePositionInstructions(
      rpc,
      positionMintAddress,
    );
    await sendTransaction(instructions);

    const positionAfter = await fetchMaybePosition(rpc, positionAddress);
    const tokenAAfter = await fetchToken(rpc, ataAAddress);
    const tokenBAfter = await fetchToken(rpc, ataBAddress);

    assert.strictEqual(positionAfter.exists, false);

    assert.strictEqual(
      quote.tokenEstA + feesQuote.feeOwedA,
      tokenAAfter.data.amount - tokenABefore.data.amount,
    );

    assert.strictEqual(
      quote.tokenEstB + feesQuote.feeOwedB,
      tokenBAfter.data.amount - tokenBBefore.data.amount,
    );
  };

  for (const poolName of poolTypes.keys()) {
    for (const positionTypeName of positionTypes.keys()) {
      const positionName = `${poolName} ${positionTypeName}`;
      it(`Should close a position for ${positionName}`, async () => {
        await testClosePositionInstructions(poolName, positionName);
      });

      const positionNameTE = `TE ${poolName} ${positionTypeName}`;
      it(`Should close a position for ${positionNameTE}`, async () => {
        await testClosePositionInstructions(poolName, positionNameTE);
      });
    }
  }

  it("Should close a position without liquidity", async () => {
    const poolName = "A-B";
    const pool = pools.get(poolName)!;
    const positionName = "A-B with 0 liquidity";

    positions.set(
      positionName,
      await setupPosition(pool, {
        tickLower: -100,
        tickUpper: 100,
        liquidity: 0n,
      }),
    );

    await assert.doesNotReject(
      testClosePositionInstructions(poolName, positionName),
    );
  });

  it("Should throw an error if the position mint can not be found", async () => {
    const positionMintAddress: Address = address(
      "123456789abcdefghijkmnopqrstuvwxABCDEFGHJKL",
    );

    await assert.rejects(closePositionInstructions(rpc, positionMintAddress));
  });
});
