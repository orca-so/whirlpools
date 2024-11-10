import { describe, it, beforeAll } from "vitest";
import {
  createSplashPoolInstructions,
  createConcentratedLiquidityPoolInstructions,
} from "../src/createPool";
import {
  SPLASH_POOL_TICK_SPACING,
  WHIRLPOOLS_CONFIG_ADDRESS,
} from "../src/config";
import { setupMint } from "./utils/token";
import { orderMints } from "../src/token";
import { rpc } from "./utils/mockRpc";
import { getWhirlpoolAddress } from "@orca-so/whirlpools-client";
import assert from "assert";
import type { Address, KeyPairSigner } from "@solana/web3.js";
import { generateKeyPairSigner } from "@solana/web3.js";



describe("Create Pool", () => {
  let mintA: Address;
  let mintB: Address;
  let funder: KeyPairSigner;

  beforeAll(async () => {
    const mint1 = await setupMint();
    const mint2 = await setupMint();
    [mintA, mintB] = orderMints(mint1, mint2);
    funder = await generateKeyPairSigner();
  })

  it("Should return the correct Whirlpool PDA", async () => {
    const { poolAddress } = await createSplashPoolInstructions(rpc, mintA, mintB, SPLASH_POOL_TICK_SPACING, funder);
    const whirlpoolAddress = await getWhirlpoolAddress(WHIRLPOOLS_CONFIG_ADDRESS, mintA, mintB, SPLASH_POOL_TICK_SPACING);
    assert.strictEqual(poolAddress, whirlpoolAddress[0]);
  })

  it("Should delegate parameters correctly to createConcentratedLiquidityPoolInstructions", async () => {
    const splashPoolResult = await createSplashPoolInstructions(rpc, mintA, mintB, 1, funder);
    const concentratedLiquidityPoolResult = await createConcentratedLiquidityPoolInstructions(rpc, mintA, mintB, SPLASH_POOL_TICK_SPACING, 1, funder);
    assert.strictEqual(splashPoolResult.estInitializationCost, concentratedLiquidityPoolResult.estInitializationCost);
    assert.strictEqual(splashPoolResult.poolAddress, concentratedLiquidityPoolResult.poolAddress);
    assert.strictEqual(splashPoolResult.instructions, concentratedLiquidityPoolResult.instructions); // tokenvaultKeypairs are not equal
  });
});
