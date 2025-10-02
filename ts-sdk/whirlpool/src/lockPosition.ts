import type { LockType } from "@orca-so/whirlpools-client";
import type { Address, Instruction, TransactionSigner } from "@solana/kit";

import { getLockPositionInstruction } from "@orca-so/whirlpools-client";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { address } from "@solana/kit";
import { SystemProgram } from "@solana/web3.js";

/**
 * Parameters to lock a position (TokenExtensions based position only).
 *
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
  lockType: LockType;
  funder: TransactionSigner<Address>;
  positionAuthority: TransactionSigner<Address>;
  position: Address;
  positionMint: Address;
  positionTokenAccount: Address;
  lockConfigPda: Address;
  whirlpool: Address;
};

/**
 * Represents the instructions for locking a position.
 */
export type LockPositionInstructions = {
  /** The list of instructions needed to lock a position. */
  instructions: Instruction[];
};

/**
 * Generates instructions to lock a position.
 *
 * @param {LockPositionParams} param - The parameters for locking a position.
 * @returns {Promise<LockPositionInstructions>} A promise that resolves to an object containing instructions.
 *
 * @example
 * import { lockPositionInstructions, setWhirlpoolsConfig } from "@orca-so/whirlpools";
 * import { getLockConfigAddress, LockTypeLabel } from "@orca-so/whirlpools-client";
 * import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
 * import { address, createSolanaRpc, devnet } from "@solana/kit";
 * import { SystemProgram } from "@solana/web3.js";
 * import { loadWallet } from "./utils";
 *
 * await setWhirlpoolsConfig("solanaDevnet");
 * const devnetRpc = createSolanaRpc(devnet("https://api.devnet.solana.com"));
 * const wallet = await loadWallet();
 *
 * const position = address("5uiTr6jPdCXNfBWyfhAS9HScpkhGpoPEsaKcYUDMB2Nw");
 * const positionMint = address("GcMV7oY15BYxJxKuKTXXRYVxzSpeMfvYMHAxoQHqrtQJ");
 * const positionTokenAccount = address("2t3H9fSEJftE6TS7kgTYqRbnhdRUkCRfxdULybFTgWPu");
 * const whirlpool = address("3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt");
 * const lockConfigPda = await getLockConfigAddress(position);
 *
 * const instructions = await lockPositionInstructions({
 *   funder: wallet,
 *   positionAuthority: wallet,
 *   position,
 *   positionMint,
 *   positionTokenAccount,
 *   whirlpool,
 *   lockConfig: lockConfigPda,
 *   lockType: LockTypeLabel.Permanent,
 * });
 */
export async function lockPositionInstructions(
  params: LockPositionParams,
): Promise<LockPositionInstructions> {
  const instructions: Instruction[] = [];

  instructions.push(
    getLockPositionInstruction({
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
    }),
  );

  return {
    instructions,
  };
}
