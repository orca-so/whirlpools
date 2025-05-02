import type { Program } from "@coral-xyz/anchor";
import type { Instruction, PDA } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { LockTypeData } from "..";
import type { Whirlpool } from "../artifacts/whirlpool";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";

/**
 * Parameters to lock a position (TokenExtensions based position only).
 *
 * @category Instruction Types
 * @param lockType - The type of lock to apply to the position.
 * @param funder - The account that would fund the creation of LockConfig account
 * @param positionAuthority - authority that owns the token corresponding to this desired position.
 * @param position - PublicKey for the position which will be locked.
 * @param positionMint - PublicKey for the mint token for the Position token.
 * @param positionTokenAccount - The associated token address for the position token in the owners wallet.
 * @param lockConfigPda - PDA for the LockConfig account that will be created to manage lock state.
 * @param whirlpool - PublicKey for the whirlpool that the position belongs to.
 */
export type LockPositionParams = {
  lockType: LockTypeData;
  funder: PublicKey;
  positionAuthority: PublicKey;
  position: PublicKey;
  positionMint: PublicKey;
  positionTokenAccount: PublicKey;
  lockConfigPda: PDA;
  whirlpool: PublicKey;
};

/**
 * Lock the position to prevent any liquidity changes.
 *
 * #### Special Errors
 * `PositionAlreadyLocked` - The provided position is already locked.
 * `PositionNotLockable` - The provided position is not lockable (e.g. An empty position).
 *
 * @category Instructions
 * @param program - program object containing services required to generate the instruction
 * @param params - LockPositionParams object.
 * @returns - Instruction to perform the action.
 */
export function lockPositionIx(
  program: Program<Whirlpool>,
  params: LockPositionParams,
): Instruction {
  const ix = program.instruction.lockPosition(params.lockType, {
    accounts: {
      funder: params.funder,
      positionAuthority: params.positionAuthority,
      position: params.position,
      positionMint: params.positionMint,
      positionTokenAccount: params.positionTokenAccount,
      lockConfig: params.lockConfigPda.publicKey,
      whirlpool: params.whirlpool,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
