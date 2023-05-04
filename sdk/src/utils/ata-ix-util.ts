import { Token } from "@solana/spl-token";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

export function createAssociatedTokenAccountInstruction(
  associatedTokenProgramId: PublicKey,
  tokenProgramId: PublicKey,
  mint: PublicKey,
  associatedAccount: PublicKey,
  owner: PublicKey,
  payer: PublicKey,
  modeIdempotent: boolean
): TransactionInstruction {
  if (!modeIdempotent) {
    return Token.createAssociatedTokenAccountInstruction(
      associatedTokenProgramId,
      tokenProgramId,
      mint,
      associatedAccount,
      owner,
      payer
    );
  }

  // create CreateIdempotent instruction
  // spl-token v0.1.8 doesn't have a method for CreateIdempotent.
  // https://github.com/solana-labs/solana-program-library/blob/master/associated-token-account/program/src/instruction.rs#L26
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: associatedAccount, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: tokenProgramId, isSigner: false, isWritable: false },
  ];
  const instructionData = Buffer.from([1]);

  return new TransactionInstruction({
    keys,
    programId: associatedTokenProgramId,
    data: instructionData,
  });
}
