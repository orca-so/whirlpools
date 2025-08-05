import { describe, it, beforeAll } from "vitest";
import { rpc, sendTransaction, signer } from "./utils/mockRpc";
import { setupMintTETransferHook } from "./utils/tokenExtensions";
import { setupAta } from "./utils/token";
import { setupConfigAndFeeTiers } from "./utils/program";
import {
  createSplashPoolInstructions,
  increaseLiquidityInstructions,
  openFullRangePositionInstructions,
  swapInstructions,
} from "../src";

describe("Transfer Hook Support", () => {
  let config: any;
  let mintA: any;
  let mintB: any;

  beforeAll(async () => {
    config = await setupConfigAndFeeTiers();
    
    // Create two mints with transfer hook extensions
    mintA = await setupMintTETransferHook({ decimals: 6 });
    mintB = await setupMintTETransferHook({ decimals: 6 });
    
    // Set up token accounts
    await setupAta(mintA, { amount: 1000000000 });
    await setupAta(mintB, { amount: 1000000000 });
  });

  describe("Pool Creation with Transfer Hooks", () => {
    it("should create splash pool with transfer hook tokens", async () => {
      const price = 1.0;
      
      const { instructions, poolAddress } = await createSplashPoolInstructions(
        rpc,
        mintA,
        mintB,
        price
      );

      // This test will fail initially because createSplashPoolInstructions 
      // uses remainingAccountsInfo: null, but transfer hook tokens require
      // additional accounts to be passed through remainingAccountsInfo
      await sendTransaction(instructions);
      
      // TODO: Once implementation is complete, verify:
      // - Pool is created successfully
      // - Transfer hook accounts are properly resolved and passed
      // - Pool state is correct
    });

    it("should create splash pool with mixed tokens (one with transfer hook, one without)", async () => {
      // Create one normal mint and one with transfer hook
      const normalMint = await setupMintTETransferHook({ decimals: 6 }); // TODO: Change to normal mint once we have that utility
      
      const { instructions } = await createSplashPoolInstructions(
        rpc,
        mintA, // transfer hook mint
        normalMint, // normal mint
        1.0
      );

      // Should work with mixed token types once implemented
      await sendTransaction(instructions);
    });
  });

  describe("Liquidity Operations with Transfer Hooks", () => {
    it("should open full range position with transfer hook tokens", async () => {
      // First create a pool
      const { poolAddress } = await createSplashPoolInstructions(
        rpc,
        mintA,
        mintB,
        1.0
      );

      const param = { tokenA: 1000000n };
      
      const { instructions, positionMint } = await openFullRangePositionInstructions(
        rpc,
        poolAddress,
        param,
        100, // slippage
        signer
      );

      // This will fail initially due to remainingAccountsInfo: null
      // but should work once transfer hook support is implemented
      await sendTransaction(instructions);
      
      // TODO: Verify position is created and liquidity is added correctly
    });

    it("should increase liquidity on existing position with transfer hook tokens", async () => {
      // Create pool and position first
      const { poolAddress } = await createSplashPoolInstructions(rpc, mintA, mintB, 1.0);
      const { positionMint } = await openFullRangePositionInstructions(
        rpc,
        poolAddress,
        { tokenA: 1000000n }
      );

      // Now increase liquidity
      const param = { tokenA: 500000n };
      
      const { instructions } = await increaseLiquidityInstructions(
        rpc,
        positionMint,
        param,
        100, // slippage
        signer
      );

      // This will fail initially due to remainingAccountsInfo: null
      await sendTransaction(instructions);
      
      // TODO: Verify liquidity increase is successful
    });
  });

  describe("Swap Operations with Transfer Hooks", () => {
    it("should perform exact-in swap with transfer hook input token", async () => {
      // Create pool first
      const { poolAddress } = await createSplashPoolInstructions(rpc, mintA, mintB, 1.0);
      
      // Add some liquidity to the pool
      await openFullRangePositionInstructions(
        rpc,
        poolAddress,
        { tokenA: 10000000n }
      );

      const swapParam = {
        inputAmount: 100000n,
        mint: mintA,
      };
      
      const { instructions } = await swapInstructions(
        rpc,
        poolAddress,
        swapParam,
        100, // slippage
        signer
      );

      // This will fail initially due to remainingAccountsInfo: null
      await sendTransaction(instructions);
      
      // TODO: Verify swap executes correctly with transfer hook accounts
    });

    it("should perform exact-out swap with transfer hook output token", async () => {
      // Create pool first
      const { poolAddress } = await createSplashPoolInstructions(rpc, mintA, mintB, 1.0);
      
      // Add liquidity
      await openFullRangePositionInstructions(
        rpc,
        poolAddress,
        { tokenA: 10000000n }
      );

      const swapParam = {
        outputAmount: 50000n,
        mint: mintB, // transfer hook token as output
      };
      
      const { instructions } = await swapInstructions(
        rpc,
        poolAddress,
        swapParam,
        100, // slippage
        signer
      );

      // This will fail initially due to remainingAccountsInfo: null
      await sendTransaction(instructions);
      
      // TODO: Verify swap executes correctly
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle tokens without transfer hooks normally", async () => {
      // TODO: Create normal Token-2022 mints without transfer hook extension
      // and verify they work normally (this should already work)
    });

    it("should handle invalid transfer hook configurations gracefully", async () => {
      // TODO: Test error scenarios like invalid transfer hook accounts
      // or misconfigured transfer hook programs
    });
  });
});