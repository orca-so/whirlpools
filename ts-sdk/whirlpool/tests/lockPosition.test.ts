import { describe, it, beforeAll } from "vitest";
import type { Address } from "@solana/kit";
import { rpc, sendTransaction, signer } from "./utils/mockRpc";
import assert from "assert";
import { setupAta, setupMint } from "./utils/token";
import {
  setupAtaTE,
  setupMintTE,
  setupMintTEFee,
} from "./utils/tokenExtensions";
import {
  setupPosition,
  setupTEPosition,
  setupWhirlpool,
} from "./utils/program";
import {
  fetchLockConfig,
  getPositionAddress,
  LockType,
} from "@orca-so/whirlpools-client";
import { lockPositionInstructions } from "../src/lockPosition";
import { getLockConfigAddress } from "../../client/src/pda/lockConfig";
import {
  fetchMaybeMint,
  findAssociatedTokenPda,
} from "@solana-program/token-2022";
import { getNextKeypair } from "./utils/keypair";

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

describe("LockPosition instructions", () => {
  const tickSpacing = 64;
  const tokenBalance = 1_000_000n;
  const initialLiquidity = 100_000n;
  const mints: Map<string, Address> = new Map();
  const atas: Map<string, Address> = new Map();
  const pools: Map<string, Address> = new Map();
  const positions: Map<string, Address> = new Map();

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

  const testlockPosition = async (poolName: string, positionName: string) => {
    const positionMintAddress = positions.get(positionName)!;
    const [positionAddress] = await getPositionAddress(positionMintAddress);
    const [lockConfigAddress] = await getLockConfigAddress(positionAddress);
    const positionMint = await fetchMaybeMint(rpc, positionMintAddress);

    assert(positionMint.exists, "Position mint not found");

    const [positionTokenAccountAddress] = await findAssociatedTokenPda({
      owner: signer.address,
      mint: positionMintAddress,
      tokenProgram: positionMint.programAddress,
    });
    const lockPositionInstruction = await lockPositionInstructions({
      lockType: LockType.Permanent,
      funder: signer,
      positionAuthority: signer,
      position: positionAddress,
      positionMint: positionMintAddress,
      positionTokenAccount: positionTokenAccountAddress,
      lockConfigPda: lockConfigAddress,
      whirlpool: pools.get(poolName)!,
    });

    await sendTransaction(lockPositionInstruction.instructions);

    // Verify lock config
    const lockConfig = await fetchLockConfig(rpc, lockConfigAddress);
    assert(
      lockConfig.data.lockType.toFixed() == LockType.Permanent.toFixed(),
      "Lock config lock type is not permanent",
    );
    assert(
      lockConfig.data.lockedTimestamp > 0,
      "Lock config locked timestamp is not set",
    );
    assert(
      lockConfig.data.position == positionAddress,
      "Lock config position is not the same as the position",
    );
    assert(
      lockConfig.data.positionOwner === signer.address,
      "Lock config position owner is not the same as the signer",
    );
  };

  const testNonTEshouldFailedLockPosition = async (poolName: string, positionName: string) => {
    const positionMintAddress = positions.get(positionName)!;
    const [positionAddress] = await getPositionAddress(positionMintAddress);
    const [lockConfigAddress] = await getLockConfigAddress(positionAddress);
    const positionMint = await fetchMaybeMint(rpc, positionMintAddress);

    assert(positionMint.exists, "Position mint not found");

    const [positionTokenAccountAddress] = await findAssociatedTokenPda({
      owner: signer.address,
      mint: positionMintAddress,
      tokenProgram: positionMint.programAddress,
    });
    const lockPositionInstruction = await lockPositionInstructions({
      lockType: LockType.Permanent,
      funder: signer,
      positionAuthority: signer,
      position: positionAddress,
      positionMint: positionMintAddress,
      positionTokenAccount: positionTokenAccountAddress,
      lockConfigPda: lockConfigAddress,
      whirlpool: pools.get(poolName)!,
    });

    await assert.rejects(sendTransaction(lockPositionInstruction.instructions));
  }

  const shouldFailedWhenOwnerIsNotFunder = async (poolName: string, positionName: string) => {
    const funder = getNextKeypair();
    const positionMintAddress = positions.get(positionName)!;
    const [positionAddress] = await getPositionAddress(positionMintAddress);
    const [lockConfigAddress] = await getLockConfigAddress(positionAddress);
    const positionMint = await fetchMaybeMint(rpc, positionMintAddress);

    assert(positionMint.exists, "Position mint not found");

    const [positionTokenAccountAddress] = await findAssociatedTokenPda({
      owner: signer.address,
      mint: positionMintAddress,
      tokenProgram: positionMint.programAddress,
    });
    const lockPositionInstruction = await lockPositionInstructions({
      lockType: LockType.Permanent,
      funder: funder,
      positionAuthority: signer,
      position: positionAddress,
      positionMint: positionMintAddress,
      positionTokenAccount: positionTokenAccountAddress,
      lockConfigPda: lockConfigAddress,
      whirlpool: pools.get(poolName)!,
    });

    await assert.rejects(sendTransaction(lockPositionInstruction.instructions));
  }

  for (const poolName of poolTypes.keys()) {
    for (const positionTypeName of positionTypes.keys()) {
      const positionNameTE = `TE ${poolName} ${positionTypeName}`;
      it(`Should be able to lock position for ${positionNameTE}`, async () => {
        await testlockPosition(poolName, positionNameTE);
      });
    }
  }

  for (const poolName of poolTypes.keys()) {
    for (const positionTypeName of positionTypes.keys()) {
      const positionNameTE = `TE ${poolName} ${positionTypeName}`;
      it(`Should fail when position owner is not funder ${positionNameTE}`, async () => {
        await shouldFailedWhenOwnerIsNotFunder(poolName, positionNameTE);
      });
    }
  }

  for (const poolName of poolTypes.keys()) {
    for (const positionTypeName of positionTypes.keys()) {
      const positionName = `${poolName} ${positionTypeName}`;
      it(`Should fail to lock position for ${positionName}`, async () => {
        await testNonTEshouldFailedLockPosition(poolName, positionName);
      });
    }
  }
});
