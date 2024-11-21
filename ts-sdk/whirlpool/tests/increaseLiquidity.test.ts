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
  getPositionAddress,
} from "@orca-so/whirlpools-client";
import type { Address } from "@solana/web3.js";
import assert from "assert";
import { setupPosition, setupTEPosition, setupWhirlpool } from "./utils/program";
import { DEFAULT_FUNDER, setDefaultFunder } from "../src/config";

describe("Increase Liquidity Instructions", () => {
  let mintA: Address;
  let mintB: Address;
  let ataA: Address;
  let ataB: Address;
  let whirlpool: Address;
  let positionMint: Address;
  let positionTEMint: Address;

  beforeAll(async () => {
    const tickSpacing = 64;
    mintA = await setupMint();
    mintB = await setupMint();
    ataA = await setupAta(mintA, { amount: 1_000_000n });
    ataB = await setupAta(mintB, { amount: 1_000_000n });
    whirlpool = await setupWhirlpool(mintA, mintB, tickSpacing);
    positionMint = await setupPosition(whirlpool);
    positionTEMint = await setupTEPosition(whirlpool);
  });

  it("Should throw error if authority is default address", async () => {
    const tokenAAmount = 100_000n;
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

  it("Should increase liquidity in a position with the correct amount", async () => {
    const amount = 100_000n;

    const { quote, instructions } = await increaseLiquidityInstructions(
      rpc,
      positionMint,
      { tokenA: amount },
    );
    
    const positionAddress = await getPositionAddress(positionMint);
    const positionBefore = await fetchPosition(rpc, positionAddress[0]);
    await sendTransaction(instructions);
    const positionAfter = await fetchPosition(rpc, positionAddress[0]);
  
    assert.strictEqual(positionBefore.data.liquidity, 0n);
    assert.strictEqual(quote.liquidityDelta, positionAfter.data.liquidity);
  });

  it("Should increase liquidity in a TE position with the correct amount", async () => {
    const tokenAAmount = 100_000n;

    const { quote, instructions } = await increaseLiquidityInstructions(
      rpc,
      positionTEMint,
      { tokenA: tokenAAmount },
    );
    
    const positionAddress = await getPositionAddress(positionTEMint);
    const positionBefore = await fetchPosition(rpc, positionAddress[0]);
    await sendTransaction(instructions);
    const positionAfter = await fetchPosition(rpc, positionAddress[0]);

    assert.strictEqual(positionBefore.data.liquidity, 0n);
    assert.strictEqual(quote.liquidityDelta, positionAfter.data.liquidity);
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
