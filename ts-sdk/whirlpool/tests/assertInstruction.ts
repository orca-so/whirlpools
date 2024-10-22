import {
  getCreateAccountInstructionDataDecoder,
  getCreateAccountWithSeedInstructionDataDecoder,
  getTransferSolInstructionDataDecoder,
  SYSTEM_PROGRAM_ADDRESS,
} from "@solana-program/system";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  getCloseAccountInstructionDataDecoder,
  getCreateAssociatedTokenInstructionDataDecoder,
  getInitializeAccount3InstructionDataDecoder,
  getSyncNativeInstructionDataDecoder,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import type { Address, IInstruction } from "@solana/web3.js";
import assert from "assert";

export function assertCreateAtaInstruction(
  instruction: IInstruction,
  checks: {
    ata: Address;
    idempotent?: boolean;
    owner: Address;
    mint: Address;
    tokenProgram?: Address;
  },
) {
  assert.strictEqual(
    instruction.programAddress,
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  );

  try {
    const data = getCreateAssociatedTokenInstructionDataDecoder().decode(
      instruction.data ?? new Uint8Array(),
    );
    const idempotent = checks.idempotent ?? false;
    assert.strictEqual(data.discriminator, idempotent ? 1 : 0);
  } catch {
    assert.fail("Could not decode instruction data");
  }

  assert.strictEqual(instruction.accounts?.[0].address, checks.owner);
  assert.strictEqual(instruction.accounts?.[1].address, checks.ata);
  assert.strictEqual(instruction.accounts?.[2].address, checks.owner);
  assert.strictEqual(instruction.accounts?.[3].address, checks.mint);
  assert.strictEqual(
    instruction.accounts?.[5].address,
    checks.tokenProgram ?? TOKEN_PROGRAM_ADDRESS,
  );
}

export function assertCloseAccountInstruction(
  instruction: IInstruction,
  checks: { account: Address; owner: Address },
) {
  assert.strictEqual(instruction.programAddress, TOKEN_PROGRAM_ADDRESS);

  try {
    const data = getCloseAccountInstructionDataDecoder().decode(
      instruction.data ?? new Uint8Array(),
    );
    assert.strictEqual(data.discriminator, 9);
  } catch {
    assert.fail("Could not decode instruction data");
  }

  assert.strictEqual(instruction.accounts?.[0].address, checks.account);
  assert.strictEqual(instruction.accounts?.[1].address, checks.owner);
  assert.strictEqual(instruction.accounts?.[2].address, checks.owner);
}

export function assertSolTransferInstruction(
  instruction: IInstruction,
  checks: { from: Address; to: Address; amount: bigint },
) {
  assert.strictEqual(instruction.programAddress, SYSTEM_PROGRAM_ADDRESS);

  try {
    const data = getTransferSolInstructionDataDecoder().decode(
      instruction.data ?? new Uint8Array(),
    );
    assert.strictEqual(data.discriminator, 2);
    assert.strictEqual(data.amount, checks.amount);
  } catch {
    assert.fail("Could not decode instruction data");
  }

  assert.strictEqual(instruction.accounts?.[0].address, checks.from);
  assert.strictEqual(instruction.accounts?.[1].address, checks.to);
}

export function assertSyncNativeInstruction(
  instruction: IInstruction,
  checks: { account: Address },
) {
  assert.strictEqual(instruction.programAddress, TOKEN_PROGRAM_ADDRESS);

  try {
    const data = getSyncNativeInstructionDataDecoder().decode(
      instruction.data ?? new Uint8Array(),
    );
    assert.strictEqual(data.discriminator, 17);
  } catch {
    assert.fail("Could not decode instruction data");
  }

  assert.strictEqual(instruction.accounts?.[0].address, checks.account);
}

export function assertCreateAccountInstruction(
  instruction: IInstruction,
  checks: { account: Address; payer: Address; owner: Address },
) {
  assert.strictEqual(instruction.programAddress, SYSTEM_PROGRAM_ADDRESS);

  try {
    const data = getCreateAccountInstructionDataDecoder().decode(
      instruction.data ?? new Uint8Array(),
    );
    assert.strictEqual(data.discriminator, 0);
    assert.strictEqual(data.programAddress, checks.owner);
  } catch {
    assert.fail("Could not decode instruction data");
  }

  assert.strictEqual(instruction.accounts?.[0].address, checks.payer);
  assert.strictEqual(instruction.accounts?.[1].address, checks.account);
}

export function assertCreateAccountWithSeedInstruction(
  instruction: IInstruction,
  checks: { account: Address; payer: Address; owner: Address; seed: string },
) {
  assert.strictEqual(instruction.programAddress, SYSTEM_PROGRAM_ADDRESS);

  try {
    const data = getCreateAccountWithSeedInstructionDataDecoder().decode(
      instruction.data ?? new Uint8Array(),
    );
    assert.strictEqual(data.discriminator, 3);
    assert.strictEqual(data.programAddress, checks.owner);
    assert.strictEqual(data.seed, checks.seed);
  } catch {
    assert.fail("Could not decode instruction data");
  }

  assert.strictEqual(instruction.accounts?.[0].address, checks.payer);
  assert.strictEqual(instruction.accounts?.[1].address, checks.account);
  assert.strictEqual(instruction.accounts?.[2].address, checks.payer);
}

export function assertInitializeAccountInstruction(
  instruction: IInstruction,
  checks: { account: Address; mint: Address; owner: Address },
) {
  assert.strictEqual(instruction.programAddress, TOKEN_PROGRAM_ADDRESS);

  try {
    const data = getInitializeAccount3InstructionDataDecoder().decode(
      instruction.data ?? new Uint8Array(),
    );
    assert.strictEqual(data.discriminator, 18);
    assert.strictEqual(data.owner, checks.owner);
  } catch {
    assert.fail("Could not decode instruction data");
  }

  assert.strictEqual(instruction.accounts?.[0].address, checks.account);
  assert.strictEqual(instruction.accounts?.[1].address, checks.mint);
}
