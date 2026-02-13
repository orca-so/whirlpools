import {
  fetchPosition,
  fetchWhirlpool,
  getPositionAddress,
} from "@orca-so/whirlpools-client";
import { fetchToken } from "@solana-program/token-2022";
import type { Address } from "@solana/kit";
import assert from "assert";
import { beforeAll, describe, it } from "vitest";
import {
  DEFAULT_FUNDER,
  setDefaultFunder,
  setEnforceTokenBalanceCheck,
} from "../src/config";
import { increaseLiquidityInstructions } from "../src/increaseLiquidity";
import { rpc, sendTransaction, signer } from "./utils/mockRpc";
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
import { assertAmountClose, assertLiquidityClose } from "./utils/assert";
import { getConstrainingQuote } from "./utils/quote";

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

describe("Increase Liquidity Instructions", () => {
  const tickSpacing = 64;
  const tokenBalance = 1_000_000n;
  const atas: Map<string, Address> = new Map();
  const positions: Map<string, Address> = new Map();
  const minAbsoluteTolerance = 2n;
  const relativeToleranceBps = 100n;

  beforeAll(async () => {
    const mints: Map<string, Address> = new Map();
    for (const [name, setup] of mintTypes) {
      mints.set(name, await setup());
    }

    for (const [name, setup] of ataTypes) {
      const mint = mints.get(name)!;
      atas.set(name, await setup(mint, { amount: tokenBalance }));
    }

    const pools: Map<string, Address> = new Map();
    for (const [name, setup] of poolTypes) {
      const [mintAKey, mintBKey] = name.split("-");
      const mintA = mints.get(mintAKey)!;
      const mintB = mints.get(mintBKey)!;
      pools.set(name, await setup(mintA, mintB, tickSpacing));
    }

    for (const [poolName, poolAddress] of pools) {
      for (const [positionTypeName, tickRange] of positionTypes) {
        const position = await setupPosition(poolAddress, tickRange);
        positions.set(`${poolName} ${positionTypeName}`, position);
        const positionTE = await setupTEPosition(poolAddress, tickRange);
        positions.set(`TE ${poolName} ${positionTypeName}`, positionTE);
      }
    }
  });

  const slippageToleranceBps = 100;
  const baseTokenAmount = 10_000n;

  const testIncreaseLiquidity = async (
    positionName: string,
    poolName: string,
  ) => {
    const positionMint = positions.get(positionName)!;
    const [mintAKey, mintBKey] = poolName.split("-");
    const ataA = atas.get(mintAKey)!;
    const ataB = atas.get(mintBKey)!;

    const isOneSidedA = positionName.includes("one sided A");
    const isOneSidedB = positionName.includes("one sided B");
    // One-sided A: range below price (ticks -100 to -1) -> deposit only token B
    // One-sided B: range above price (ticks 1 to 100) -> deposit only token A
    const param = {
      tokenMaxA: isOneSidedA ? 0n : baseTokenAmount,
      tokenMaxB: isOneSidedB ? 0n : baseTokenAmount,
    };

    const positionAddress = await getPositionAddress(positionMint);
    const position = await fetchPosition(rpc, positionAddress[0]);
    const whirlpool = await fetchWhirlpool(rpc, position.data.whirlpool);
    const { sqrtPrice } = whirlpool.data;
    const tickLower = position.data.tickLowerIndex;
    const tickUpper = position.data.tickUpperIndex;

    const quote = getConstrainingQuote(
      param,
      slippageToleranceBps,
      sqrtPrice,
      tickLower,
      tickUpper,
    );

    const { instructions } = await increaseLiquidityInstructions(
      rpc,
      positionMint,
      param,
      slippageToleranceBps,
    );

    const tokenBeforeA = await fetchToken(rpc, ataA);
    const tokenBeforeB = await fetchToken(rpc, ataB);
    await sendTransaction(instructions);
    const positionAfter = await fetchPosition(rpc, positionAddress[0]);
    const tokenAfterA = await fetchToken(rpc, ataA);
    const tokenAfterB = await fetchToken(rpc, ataB);
    const balanceChangeTokenA =
      tokenBeforeA.data.amount - tokenAfterA.data.amount;
    const balanceChangeTokenB =
      tokenBeforeB.data.amount - tokenAfterB.data.amount;

    const toleranceA = poolName.includes("TEFee") ? 200n : minAbsoluteTolerance;
    const toleranceB = poolName.includes("TEFee") ? 200n : minAbsoluteTolerance;
    assertAmountClose(
      quote.tokenEstA,
      balanceChangeTokenA,
      toleranceA,
      "token A",
    );
    assertAmountClose(
      quote.tokenEstB,
      balanceChangeTokenB,
      toleranceB,
      "token B",
    );
    assertLiquidityClose(
      quote.liquidityDelta,
      positionAfter.data.liquidity,
      relativeToleranceBps,
      minAbsoluteTolerance,
    );
  };

  for (const poolName of poolTypes.keys()) {
    for (const positionTypeName of positionTypes.keys()) {
      const positionName = `${poolName} ${positionTypeName}`;
      it(`Increase liquidity for ${positionName}`, async () => {
        await testIncreaseLiquidity(positionName, poolName);
      });
      const positionNameTE = `TE ${poolName} ${positionTypeName}`;
      it(`Increase liquidity for ${positionNameTE}`, async () => {
        await testIncreaseLiquidity(positionNameTE, poolName);
      });
    }
  }

  it("Should throw error if authority is default address", async () => {
    const tokenAAmount = 1_000_000n;
    const tokenBAmount = 1_000_000n;
    setDefaultFunder(DEFAULT_FUNDER);
    const postiionMintAddress = positions.entries().next().value?.[1];
    assert(postiionMintAddress, "Position mint address is not found");
    await assert.rejects(
      increaseLiquidityInstructions(rpc, postiionMintAddress, {
        tokenMaxA: tokenAAmount,
        tokenMaxB: tokenBAmount,
      }),
    );
    setDefaultFunder(signer);
  });

  it("Should throw error increase liquidity amount by token is equal or greater than the token balance", async () => {
    const tokenAAmount = 1_000_000n;
    const tokenBAmount = 1_000_000n;
    // By default, the balance check is skipped. We must enable the check to trigger the rejection.
    setEnforceTokenBalanceCheck(true);
    const postiionMintAddress = positions.entries().next().value?.[1];
    assert(postiionMintAddress, "Position mint address is not found");
    await assert.rejects(
      increaseLiquidityInstructions(rpc, postiionMintAddress, {
        tokenMaxA: tokenAAmount,
        tokenMaxB: tokenBAmount,
      }),
    );
    setEnforceTokenBalanceCheck(false);
  });
});
