import type { Address } from "@solana/web3.js";
import { generateKeyPairSigner } from "@solana/web3.js";
import { assert, beforeAll, describe, it } from "vitest";
import { setupAta, setupMint } from "./utils/token";
import {
  setupPosition,
  setupPositionBundle,
  setupTEPosition,
  setupWhirlpool,
} from "./utils/program";
import { SPLASH_POOL_TICK_SPACING } from "../src/config";
import {
  fetchPositionsForOwner,
  fetchPositionsInWhirlpool,
} from "../src/position";
import { rpc, signer } from "./utils/mockRpc";

describe("Fetch Position", () => {
  let mintA: Address;
  let mintB: Address;
  let pool: Address;
  let splashPool: Address;

  beforeAll(async () => {
    mintA = await setupMint();
    mintB = await setupMint();
    await setupAta(mintA, { amount: 500e9 });
    await setupAta(mintB, { amount: 500e9 });
    pool = await setupWhirlpool(mintA, mintB, 128);
    splashPool = await setupWhirlpool(mintA, mintB, SPLASH_POOL_TICK_SPACING);
    await setupPosition(pool);
    await setupPosition(splashPool);
    await setupTEPosition(pool);
    await setupPositionBundle(pool);
    await setupPositionBundle(splashPool, [{}, {}]);
  });

  // TODO: enable this when solana-bankrun supports gpa
  it.skip("Should fetch all positions for an address", async () => {
    const positions = await fetchPositionsForOwner(rpc, signer.address);
    assert.strictEqual(positions.length, 5);
  });

  // TODO: enable this when solana-bankrun supports gpa
  it.skip("Should fetch no positions for a different address", async () => {
    const other = await generateKeyPairSigner();
    const positions = await fetchPositionsForOwner(rpc, other.address);
    assert.strictEqual(positions.length, 0);
  });

  // TODO: enable this when solana-bankrun supports gpa
  it.skip("Should fetch positions for a whirlpool", async () => {
    const positions = await fetchPositionsInWhirlpool(rpc, pool);
    assert.strictEqual(positions.length, 3);
  });
});
