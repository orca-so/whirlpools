import { describe, it, beforeAll } from "vitest";
import { decreaseLiquidityInstructions } from "../src/decreaseLiquidity";
import { rpc, signer, sendTransaction } from "./utils/mockRpc";
import { setupMint, setupAta } from "./utils/token";
import { fetchPosition, getPositionAddress } from "@orca-so/whirlpools-client";
import { increaseLiquidityInstructions } from "../src/increaseLiquidity";
import { fetchToken } from "@solana-program/token-2022";
import type { Address } from "@solana/web3.js";
import assert from "assert";
import {
  setupPosition,
  setupTEPosition,
  setupWhirlpool,
} from "./utils/program";
import { DEFAULT_FUNDER, setDefaultFunder } from "../src/config";
import {
  setupAtaTE,
  setupMintTE,
  setupMintTEFee,
} from "./utils/tokenExtensions";

/**
 * Maps the "type" labels we want to use to a function that creates the mint.
 */
const mintTypes = new Map<string, () => Promise<Address>>([
  ["A", setupMint],
  ["B", setupMint],
  ["TEA", setupMintTE],
  ["TEB", setupMintTE],
  ["TEFee", setupMintTEFee],
]);

/**
 * Maps the "type" labels for token accounts to the function that creates them (ATA vs ATA with token-2022).
 */
const ataTypes = new Map<
  string,
  (mint: Address, cfg: { amount?: bigint | number }) => Promise<Address>
>([
  ["A", setupAta],
  ["B", setupAta],
  ["TEA", setupAtaTE],
  ["TEB", setupAtaTE],
  ["TEFee", setupAtaTE],
]);

/**
 * Maps labels like "A-B" to the function that creates a concentrated-liquidity pool.
 */
const poolTypes = new Map<
  string,
  (mintA: Address, mintB: Address, tickSpacing: number) => Promise<Address>
>([
  ["A-B", setupWhirlpool],
  ["A-TEA", setupWhirlpool],
  ["TEA-TEB", setupWhirlpool],
  ["A-TEFee", setupWhirlpool],
]);

/**
 * A few typical position layouts (tick ranges).
 */
const positionTypes = new Map<string, { tickLower: number; tickUpper: number }>(
  [
    ["equally centered", { tickLower: -100, tickUpper: 100 }],
    ["one sided A", { tickLower: -100, tickUpper: -1 }],
    ["one sided B", { tickLower: 1, tickUpper: 100 }],
  ],
);

describe("Decrease Liquidity Instructions", () => {
  const tickSpacing = 64;
  const tokenBalance = 1_000_000n;

  // We store the addresses of minted tokens in here.
  const mints: Map<string, Address> = new Map();

  // We store the addresses of the ATAs we create, keyed by the same label (A, B, TEA, TEB, etc.)
  const atas: Map<string, Address> = new Map();

  // We store the addresses of the pools, keyed by something like "A-B" or "A-TEFee".
  const pools: Map<string, Address> = new Map();

  // We store the addresses of the positions, keyed by strings like "A-B equally centered" or "TE A-TEB one sided A", etc.
  // We also create both a “normal” position and a token-2022 position for each pool (just like in increaseLiquidity tests).
  const positions: Map<string, Address> = new Map();

  beforeAll(async () => {
    /**
     * 1. Create mints
     */
    for (const [label, setupFn] of mintTypes.entries()) {
      mints.set(label, await setupFn());
    }

    /**
     * 2. Create ATAs for each mint, funding them with `tokenBalance`.
     */
    for (const [label, ataFn] of ataTypes.entries()) {
      const mintAddress = mints.get(label)!;
      const ata = await ataFn(mintAddress, { amount: tokenBalance });
      atas.set(label, ata);
    }

    /**
     * 3. Create each pool combination we want
     */
    for (const [poolLabel, setupFn] of poolTypes.entries()) {
      const [mintAKey, mintBKey] = poolLabel.split("-");
      const mintA = mints.get(mintAKey)!;
      const mintB = mints.get(mintBKey)!;
      const poolAddr = await setupFn(mintA, mintB, tickSpacing);
      pools.set(poolLabel, poolAddr);
    }

    /**
     * 4. Create positions for each (pool x position-type) combination
     *    We also create a token-2022 position (TE) for each pool.
     */
    for (const [poolLabel, poolAddress] of pools.entries()) {
      for (const [posTypeLabel, tickRange] of positionTypes.entries()) {
        // Normal SPL position
        const posAddr = await setupPosition(poolAddress, tickRange);
        positions.set(`${poolLabel} ${posTypeLabel}`, posAddr);

        // Token-2022 position
        const posTEAddr = await setupTEPosition(poolAddress, tickRange);
        positions.set(`TE ${poolLabel} ${posTypeLabel}`, posTEAddr);
      }
    }

    /**
     * 5. We add some initial liquidity (so that we have something to decrease!)
     *    For each position minted above, let's add 20,000 liquidity.
     */
    for (const [, posAddr] of positions.entries()) {
      // We'll just add 20k liquidity. This is enough to test partial decreases, etc.
      const { instructions } = await increaseLiquidityInstructions(
        rpc,
        posAddr,
        { liquidity: 20_000n }, // param
        100, // slippage
        signer, // authority
      );

      await sendTransaction(instructions);
    }
  });

  /**
   * Helper function to run the actual test scenario:
   * - measure tokenA/B before
   * - call decreaseLiquidityInstructions
   * - measure tokenA/B after
   * - confirm the difference matches the quote
   * - confirm position.liquidity has decreased
   *
   * @param positionName position label in the `positions` map
   * @param poolName e.g. 'A-B'
   * @param param e.g. { liquidity: 500n } or { tokenA: 10n } or { tokenB: 15n }
   */
  const testDecreaseLiquidity = async (
    positionName: string,
    poolName: string,
    param: { liquidity?: bigint; tokenA?: bigint; tokenB?: bigint },
  ) => {
    const positionMint = positions.get(positionName)!;
    const [mintAKey, mintBKey] = poolName.split("-");
    const ataA = atas.get(mintAKey)!;
    const ataB = atas.get(mintBKey)!;

    // Grab user balances BEFORE
    const tokenBeforeA = await fetchToken(rpc, ataA);
    const tokenBeforeB = await fetchToken(rpc, ataB);

    // Generate instructions
    const { quote, instructions } = await decreaseLiquidityInstructions(
      rpc,
      positionMint,
      param,
      100, // slippageToleranceBps
      signer, // authority
    );

    // Send them
    await sendTransaction(instructions);

    // Grab user balances AFTER
    const tokenAfterA = await fetchToken(rpc, ataA);
    const tokenAfterB = await fetchToken(rpc, ataB);

    const balanceChangeTokenA =
      tokenAfterA.data.amount - tokenBeforeA.data.amount;
    const balanceChangeTokenB =
      tokenAfterB.data.amount - tokenBeforeB.data.amount;

    // Check that the actual token changes match the quote
    assert.strictEqual(
      quote.tokenEstA,
      balanceChangeTokenA,
      "token A mismatch",
    );
    assert.strictEqual(
      quote.tokenEstB,
      balanceChangeTokenB,
      "token B mismatch",
    );

    // Check that position liquidity is decreased accordingly
    const [positionAddrPda] = await getPositionAddress(positionMint);
    const position = await fetchPosition(rpc, positionAddrPda);
    const liquidityDiff = 20_000n - position.data.liquidity; // we seeded 20k earlier

    assert.strictEqual(
      quote.liquidityDelta,
      liquidityDiff,
      "liquidityDelta mismatch",
    );
  };

  for (const poolName of poolTypes.keys()) {
    for (const positionTypeName of positionTypes.keys()) {
      // A normal SPL position
      const positionName = `${poolName} ${positionTypeName}`;
      // A token-2022 position
      const positionNameTE = `TE ${poolName} ${positionTypeName}`;

      it(`Decrease liquidity by 'liquidity' for ${positionName}`, async () => {
        await testDecreaseLiquidity(positionName, poolName, {
          liquidity: 100n,
        });
      });

      // same set for TE position
      it(`Decrease liquidity by 'liquidity' for ${positionNameTE}`, async () => {
        await testDecreaseLiquidity(positionNameTE, poolName, {
          liquidity: 100n,
        });
      });
    }
  }

  it("Should throw error if authority is default address", async () => {
    const positionKey = positions.entries().next().value[0]; // any valid position
    const positionMint = positions.get(positionKey)!;
    setDefaultFunder(DEFAULT_FUNDER); // set authority to the no-op address

    await assert.rejects(
      decreaseLiquidityInstructions(rpc, positionMint, { liquidity: 1_000n }),
      /Either supply the authority or set the default funder/,
    );

    // Restore a working default
    setDefaultFunder(signer);
  });

  it("Should reject if requested liquidity is bigger than the position's current liquidity", async () => {
    const positionKey = positions.entries().next().value[0];
    const positionMint = positions.get(positionKey)!;

    await assert.rejects(
      (async () => {
        // 1) build instructions
        const { instructions } = await decreaseLiquidityInstructions(
          rpc,
          positionMint,
          { liquidity: 100_000n },
          100,
          signer,
        );
        // 2) attempt to send them (should fail on-chain)
        await sendTransaction(instructions);
      })(),
      /custom program error: 0x177f/,
    );
  });
});
