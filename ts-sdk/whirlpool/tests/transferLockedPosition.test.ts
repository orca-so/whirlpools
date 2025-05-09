import { describe, it, beforeAll } from "vitest";
import type { Address } from "@solana/kit";
import { assertAccountExists } from "@solana/kit";
import { transferLockedPositionInstructions } from "../src/transferLockedPosition";
import { rpc, sendTransaction, signer } from "./utils/mockRpc";
import { setDefaultFunder } from "../src/config";
import assert from "assert";
import { setupAta, setupMint } from "./utils/token";
import {
  setupAtaTE,
  setupMintTE,
  setupMintTEFee,
} from "./utils/tokenExtensions";
import { setupWhirlpool } from "./utils/program";
import { openPositionInstructions } from "../src/increaseLiquidity";
import {
  fetchLockConfig,
  getPositionAddress,
  LockType,
} from "@orca-so/whirlpools-client";
import { lockPositionInstructions } from "../src/lockPosition";
import { getLockConfigAddress } from "../../client/src/pda/lockConfig";
import {
  fetchMaybeToken,
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
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

describe("Create TransferLockedPosition instructions", () => {
  const tickSpacing = 64;
  const tokenBalance = 1_000_000n;
  const mints: Map<string, Address> = new Map();
  const atas: Map<string, Address> = new Map();
  const pools: Map<string, Address> = new Map();

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
  });

  const testTransferLockedPositionInstructions = async (
    poolName: string,
    lowerPrice: number,
    upperPrice: number,
  ) => {
    const whirlpool = pools.get(poolName)!;
    const param = { liquidity: 10_000n };

    // Position owner has position, can lock it, and transfer it.
    const positionOwner = signer;
    const receiver = getNextKeypair();
    setDefaultFunder(positionOwner);

    // Open position by position owner
    const { instructions, positionMint } = await openPositionInstructions(
      rpc,
      whirlpool,
      param,
      lowerPrice,
      upperPrice,
    );

    const positionAddress = await getPositionAddress(positionMint);
    await sendTransaction(instructions);

    // After creating a new position, owner locks it.
    const lockConfigPda = await getLockConfigAddress(positionAddress[0]);
    const positionAta = await findAssociatedTokenPda({
      mint: positionMint,
      owner: positionOwner.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    const lockPositionIx = await lockPositionInstructions({
      lockType: LockType.Permanent,
      funder: positionOwner,
      positionAuthority: signer,
      position: positionAddress[0],
      positionMint: positionMint,
      positionTokenAccount: positionAta[0],
      lockConfigPda: lockConfigPda[0],
      whirlpool: whirlpool,
    });

    await sendTransaction(lockPositionIx.instructions);

    // Prepare a new ATA to transfer locked position.
    // This new ATA has same position mint, but different owner.
    const receiverAta = await setupAtaTE(positionMint, {
      amount: 0,
      signer: receiver,
    });

    const transferLockedPositionIx = await transferLockedPositionInstructions(
      rpc,
      {
        position: positionAddress[0],
        positionMint: positionMint,
        positionTokenAccount: positionAta[0],
        detinationTokenAccount: receiverAta,
        lockConfig: lockConfigPda[0],
        positionAuthority: positionOwner.address,
        receiver: receiver.address,
      },
      positionOwner,
    );

    await sendTransaction(transferLockedPositionIx.instructions);

    // verify lock config is still permanent
    const lockConfig = await fetchLockConfig(rpc, lockConfigPda[0]);
    assert.strictEqual(lockConfig.data.lockType, LockType.Permanent);

    // verify position is transferred
    const receiverAtaInfo = await fetchMaybeToken(rpc, receiverAta);
    assertAccountExists(receiverAtaInfo);
  };

  for (const poolName of poolTypes.keys()) {
    it("Should transfer locked position when signer is position owner", async () => {
      await testTransferLockedPositionInstructions(poolName, 0.95, 1.05);
    });
  }
});
