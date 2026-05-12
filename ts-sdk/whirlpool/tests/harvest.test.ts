import { fetchToken } from "@solana-program/token";
import type { Address } from "@solana/kit";
import assert from "assert";
import { beforeAll, describe, it } from "vitest";
import { harvestPositionInstructions } from "../src/harvest";
import { swapInstructions } from "../src/swap";
import {
  getTestContext,
  rpc,
  sendTransaction,
  TEST_WHIRLPOOL_DEPLOYMENTS,
} from "./utils/mockRpc";
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

const poolNames = ["A-B", "A-TEA", "TEA-TEB", "A-TEFee"];

const positionTypes = new Map([
  ["equally centered", { tickLower: -100, tickUpper: 100 }],
  ["one sided A", { tickLower: -100, tickUpper: -1 }],
  ["one sided B", { tickLower: 1, tickUpper: 100 }],
]);

await getTestContext();

describe.each(TEST_WHIRLPOOL_DEPLOYMENTS)(
  "Harvest ($programId)",
  (whirlpoolDeployment) => {
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

      for (const name of poolNames) {
        const [mintAKey, mintBKey] = name.split("-");
        const mintA = mints.get(mintAKey)!;
        const mintB = mints.get(mintBKey)!;
        pools.set(
          name,
          await setupWhirlpool(mintA, mintB, tickSpacing, {
            whirlpoolDeployment,
          }),
        );
      }

      for (const [poolName, poolAddress] of pools) {
        for (const [positionTypeName, tickRange] of positionTypes) {
          const position = await setupPosition(poolAddress, {
            ...tickRange,
            liquidity: initialLiquidity,
            whirlpoolDeployment,
          });
          positions.set(`${poolName} ${positionTypeName}`, position);

          const positionTE = await setupTEPosition(poolAddress, {
            ...tickRange,
            liquidity: initialLiquidity,
            whirlpoolDeployment,
          });
          positions.set(`TE ${poolName} ${positionTypeName}`, positionTE);
        }
      }

      for (const [poolName, poolAddress] of pools) {
        const [mintAName, mintBName] = poolName.split("-");
        const mintAAddress = mints.get(mintAName)!;
        const mintBAddress = mints.get(mintBName)!;

        let { instructions: swap_instructions } = await swapInstructions(
          rpc,
          { inputAmount: 100n, mint: mintAAddress },
          poolAddress,
          { whirlpoolDeployment },
        );
        await sendTransaction(swap_instructions);

        // Do another swap to generate more fees
        ({ instructions: swap_instructions } = await swapInstructions(
          rpc,
          { outputAmount: 100n, mint: mintAAddress },
          poolAddress,
          { whirlpoolDeployment },
        ));
        await sendTransaction(swap_instructions);

        // Do another swap to generate more fees
        ({ instructions: swap_instructions } = await swapInstructions(
          rpc,
          { inputAmount: 100n, mint: mintBAddress },
          poolAddress,
          { whirlpoolDeployment },
        ));
        await sendTransaction(swap_instructions);

        // Do another swap to generate more fees
        ({ instructions: swap_instructions } = await swapInstructions(
          rpc,
          { outputAmount: 100n, mint: mintBAddress },
          poolAddress,
          { whirlpoolDeployment },
        ));
        await sendTransaction(swap_instructions);
      }
    });

    const testHarvestPositionInstructions = async (
      poolName: string,
      positionName: string,
    ) => {
      const [mintAName, mintBName] = poolName.split("-");
      const ataAAddress = atas.get(mintAName)!;
      const ataBAddress = atas.get(mintBName)!;

      const positionMintAddress = positions.get(positionName)!;

      const tokenABefore = await fetchToken(rpc, ataAAddress);
      const tokenBBefore = await fetchToken(rpc, ataBAddress);

      const { instructions: harvest_instructions, feesQuote } =
        await harvestPositionInstructions(rpc, positionMintAddress, {
          whirlpoolDeployment,
        });
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

    const testHarvestPositionInstructionsWithoutFees = async (
      _poolName: string,
      positionName: string,
    ) => {
      const positionMintAddress = positions.get(positionName)!;

      const { instructions: harvest_instructions, feesQuote } =
        await harvestPositionInstructions(rpc, positionMintAddress, {
          whirlpoolDeployment,
        });
      await sendTransaction(harvest_instructions);

      assert.strictEqual(feesQuote.feeOwedA, 0n);

      assert.strictEqual(feesQuote.feeOwedB, 0n);
    };

    for (const poolName of poolNames) {
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

    for (const poolName of poolNames) {
      for (const positionTypeName of positionTypes.keys()) {
        const positionName = `${poolName} ${positionTypeName}`;
        it(`Should harvest a position without fees for ${positionName}`, async () => {
          await testHarvestPositionInstructionsWithoutFees(
            poolName,
            positionName,
          );
        });

        const positionNameTE = `TE ${poolName} ${positionTypeName}`;
        it(`Should harvest a position without fees for ${positionNameTE}`, async () => {
          await testHarvestPositionInstructionsWithoutFees(
            poolName,
            positionNameTE,
          );
        });
      }
    }
  },
);
