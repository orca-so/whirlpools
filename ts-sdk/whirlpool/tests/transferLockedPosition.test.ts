import { describe, it, beforeAll } from "vitest";
import type { Address } from "@solana/kit";
import { transferLockedPositionInstructions } from "../src/transferLockedPosition";
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
  fetchToken,
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

describe("Create TransferLockedPosition instructions", () => {
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

  const testTransferLockedPosition = async (
    poolName: string,
    positionName: string,
  ) => {
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

    // 1. First, lock the position
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

    // 2. Then, transfer the position to the new owner
    const receiver = getNextKeypair();
    const receiverTokenAccountAddress = await setupAtaTE(positionMintAddress, {
      amount: 0,
      signer: receiver,
    });
    const transferLockedPositionInstruction =
      await transferLockedPositionInstructions(
        rpc,
        {
          positionMintAddress: positionMintAddress,
          detinationTokenAccount: receiverTokenAccountAddress,
          lockConfig: lockConfigAddress,
          receiver: receiver.address,
        },
        signer,
      );

    await sendTransaction(transferLockedPositionInstruction.instructions);

    // 3. Verify the position is transferred
    const receiverTokenAccount = await fetchToken(
      rpc,
      receiverTokenAccountAddress,
    );
    assert(
      receiverTokenAccount.data.amount === BigInt(1),
      "Receiver token account amount is not the same as the token balance",
    );
    assert(
      receiverTokenAccount.data.owner === receiver.address,
      "Receiver token account owner is not the same as the receiver",
    );

    // 4. Verify the lock config is still valid
    const lockConfig = await fetchLockConfig(rpc, lockConfigAddress);
    assert(
      lockConfig.data.positionOwner === receiver.address,
      "Lock config position owner is not the same as the receiver",
    );
    assert(
      lockConfig.data.position === positionAddress,
      "Lock config position is not the same as the position",
    );
    assert(
      lockConfig.data.lockedTimestamp > 0,
      "Lock config locked timestamp is not set",
    );
    assert(
      lockConfig.data.lockType.toFixed() === LockType.Permanent.toFixed(),
      "Lock config lock type is not permanent",
    );
  };

  for (const poolName of poolTypes.keys()) {
    for (const positionTypeName of positionTypes.keys()) {
      const positionNameTE = `TE ${poolName} ${positionTypeName}`;
      it("Should transfer locked position when signer is position owner", async () => {
        await testTransferLockedPosition(poolName, positionNameTE);
      });
    }
  }
});
