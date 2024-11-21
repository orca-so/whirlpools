import { describe, it, beforeAll, vi, expect } from "vitest";
import {
  increaseLiquidityInstructions,
  openPositionInstructions,
  openFullRangePositionInstructions,
} from "../src/increaseLiquidity";
import { rpc, signer, sendTransaction } from "./utils/mockRpc";
import { setupMint, setupAta } from "./utils/token";
import {
  fetchMaybePosition,
  fetchPosition,
  fetchWhirlpool,
  getPositionAddress,
} from "@orca-so/whirlpools-client";
import { fetchToken } from "@solana-program/token-2022";
import { address, type Address } from "@solana/web3.js";
import assert from "assert";
import { setupPosition, setupTEPosition, setupWhirlpool } from "./utils/program";
import { DEFAULT_FUNDER, setDefaultFunder } from "../src/config";
import { setupAtaTE, setupMintTE, setupMintTEFee } from "./utils/tokenExtensions";

describe("Increase Liquidity Instructions", () => {
  const tickSpacing = 64;
  const tokenBalance = 1_000_000n;

  let ataMap: Record<string, Address> = {};
  let whirlpools: Record<string, Address> = {};
  let positions: Record<string, Address[]> = {};

  beforeAll(async () => {
    const mintA = await setupMint();
    const mintB = await setupMint();
    const mintTEA = await setupMintTE();
    const mintTEB = await setupMintTE();
    const mintTEFee = await setupMintTEFee();

    ataMap[mintA] = await setupAta(mintA, { amount: tokenBalance });
    ataMap[mintB] = await setupAta(mintB, { amount: tokenBalance });
    ataMap[mintTEA] = await setupAtaTE(mintTEA, { amount: tokenBalance });
    ataMap[mintTEB] = await setupAtaTE(mintTEB, { amount: tokenBalance });
    ataMap[mintTEFee] = await setupAtaTE(mintTEFee, { amount: tokenBalance });

    const whirlpoolCombinations: [Address, Address][] = [
      [mintA, mintB],
      [mintA, mintTEA],
      [mintTEA, mintTEB],
      [mintA, mintTEFee],
    ];

    for (const [tokenA, tokenB] of whirlpoolCombinations) {
      const whirlpoolKey = `${tokenA.toString()}-${tokenB.toString()}`;

      whirlpools[whirlpoolKey] = await setupWhirlpool(
        tokenA,
        tokenB,
        tickSpacing
      );

      positions[whirlpoolKey] = [
        await setupPosition(whirlpools[whirlpoolKey]),
        await setupPosition(whirlpools[whirlpoolKey], {
          tickLower: 100,
          tickUpper: 200,
        }),
        await setupTEPosition(whirlpools[whirlpoolKey]),
        await setupTEPosition(whirlpools[whirlpoolKey], {
          tickLower: 100,
          tickUpper: 200,
        }),
      ];
    }
  });

  const testLiquidityIncrease = async (
    positionMint: Address,
    tokenA: Address,
    tokenB: Address,
  ) => {
    const amount = 10_000n;

    const { quote, instructions } = await increaseLiquidityInstructions(
      rpc,
      positionMint,
      { tokenA: amount }
    );
    console.log(quote, instructions);

    const tokenBeforeA = await fetchToken(rpc, ataMap[tokenA]);
    const tokenBeforeB = await fetchToken(rpc, ataMap[tokenB]);
    await sendTransaction(instructions);
    const positionAddress = await getPositionAddress(positionMint);
    const position = await fetchPosition(rpc, positionAddress[0]);
    const tokenAfterA = await fetchToken(rpc, ataMap[tokenA]);
    const tokenAfterB = await fetchToken(rpc, ataMap[tokenB]);
    const balanceChangeTokenA =
      tokenBeforeA.data.amount - tokenAfterA.data.amount;
    const balanceChangeTokenB =
      tokenBeforeB.data.amount - tokenAfterB.data.amount;

    assert.strictEqual(quote.tokenEstA, balanceChangeTokenA);
    assert.strictEqual(quote.tokenEstB, balanceChangeTokenB);
    assert.strictEqual(quote.liquidityDelta, position.data.liquidity);
  };

  it("Should throw error if authority is default address", async () => {
    const tokenAAmount = 100_000n;
    const firstWhirlpoolKey = Object.keys(positions)[0];
    const positionMint = positions[firstWhirlpoolKey][0];
    setDefaultFunder(DEFAULT_FUNDER);
    await assert.rejects(
      increaseLiquidityInstructions(
        rpc,
        positionMint,
        { tokenA: tokenAAmount },
      )
    );
    setDefaultFunder(signer);
  });

  it("Should throw error increase liquidity amount by token is equal or greater than the token balance", async () => {
    const tokenAAmount = 1_000_000n;
    const firstWhirlpoolKey = Object.keys(positions)[0];
    const positionMint = positions[firstWhirlpoolKey][0];
    setDefaultFunder(DEFAULT_FUNDER);
    await assert.rejects(
      increaseLiquidityInstructions(
        rpc,
        positionMint,
        { tokenA: tokenAAmount },
      )
    );
    setDefaultFunder(signer);
  });

  it("Should correctly handle liquidity increase for all precomputed combinations of Whirlpool and Position types", async () => {
    for (const whirlpoolKey of Object.keys(whirlpools)) {
      const [tokenA, tokenB] = whirlpoolKey.split("-");
      for (const positionMint of positions[whirlpoolKey]) {
        await testLiquidityIncrease(
          positionMint,
          address(tokenA),
          address(tokenB),
        );
      }
    }
  });
});

// describe("Open Position Instructions", () => {
//   let poolAddress: string;

//   beforeAll(async () => {
//     // Mock pool address (generated as required for test)
//     poolAddress = "POOL_ADDRESS";
//   });

//   it("Should generate instructions to open a position in a price range", async () => {
//     const param = { tokenA: 1_000_000n };
//     const lowerPrice = 0.0001;
//     const upperPrice = 0.0005;

//     const { quote, instructions, positionMint, initializationCost } =
//       await openPositionInstructions(
//         rpc,
//         poolAddress,
//         param,
//         lowerPrice,
//         upperPrice,
//         50, // Custom slippage tolerance
//         signer
//       );

//     expect(quote).toHaveProperty("tokenMaxA");
//     expect(quote).toHaveProperty("tokenMaxB");
//     expect(Array.isArray(instructions)).toBe(true);
//     expect(positionMint).toBeDefined();
//     expect(initializationCost).toBeInstanceOf(BigInt);
//   });

//   it("Should throw error for invalid pool type in openFullRangePositionInstructions", async () => {
//     await expect(
//       openFullRangePositionInstructions(rpc, poolAddress, { tokenB: 500n }, 100)
//     ).rejects.toThrow("Splash pools only support full range positions");
//   });
// });
