import type { LockType, WhirlpoolDeployment } from "@orca-so/whirlpools-client";
import type { Address, Instruction, TransactionSigner } from "@solana/kit";

import {
  DEFAULT_WHIRLPOOL_DEPLOYMENT,
  getLockPositionInstruction,
} from "@orca-so/whirlpools-client";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { address } from "@solana/kit";
import { SystemProgram } from "@solana/web3.js";

/**
 * Parameters to lock a position (TokenExtensions based position only).
 */
export type LockPositionParams = {
  lockType: LockType;
  funder: TransactionSigner<Address>;
  positionAuthority: TransactionSigner<Address>;
  position: Address;
  positionMint: Address;
  positionTokenAccount: Address;
  lockConfigPda: Address;
  whirlpool: Address;
  /**
   * The Whirlpool program and config account to target. Defaults to DEFAULT_WHIRLPOOL_DEPLOYMENT if not provided.
   */
  whirlpoolDeployment?: WhirlpoolDeployment;
};

/**
 * Represents the instructions for locking a position.
 */
export type LockPositionInstructions = {
  instructions: Instruction[];
};

/**
 * Generates instructions to lock a position.
 */
export async function lockPositionInstructions(
  params: LockPositionParams,
): Promise<LockPositionInstructions> {
  const whirlpoolDeployment =
    params.whirlpoolDeployment ?? DEFAULT_WHIRLPOOL_DEPLOYMENT;

  const instructions: Instruction[] = [];

  instructions.push(
    getLockPositionInstruction(
      {
        funder: params.funder,
        positionAuthority: params.positionAuthority,
        position: params.position,
        positionMint: params.positionMint,
        positionTokenAccount: params.positionTokenAccount,
        lockConfig: params.lockConfigPda,
        whirlpool: params.whirlpool,
        token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
        systemProgram: address(SystemProgram.programId.toBase58()),
        lockType: params.lockType,
      },
      { programAddress: whirlpoolDeployment.programId },
    ),
  );

  return {
    instructions,
  };
}
