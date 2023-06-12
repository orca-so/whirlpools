import { Instruction } from "@orca-so/common-sdk";
import {
  AccountLayout,
  NATIVE_MINT,
  Token,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

export function isNativeMint(mint: PublicKey) {
  return mint.equals(NATIVE_MINT);
}

// TODO: This is a temp fn to help add payer / differing destination params to the original method
// Deprecate this as soon as we move to sync-native. Can consider moving to common-sdk for posterity.
export function createWSOLAccountInstructions(
  owner: PublicKey,
  amountToWrap: BN,
  accountExemption: number,
  payer?: PublicKey,
  unwrapDestination?: PublicKey
): { address: PublicKey } & Instruction {
  const payerKey = payer ?? owner;
  const unwrapDestinationKey = unwrapDestination ?? payer ?? owner;
  const tempAccount = new Keypair();

  const createIx = SystemProgram.createAccount({
    fromPubkey: payerKey,
    newAccountPubkey: tempAccount.publicKey,
    lamports: amountToWrap.toNumber() + accountExemption,
    space: AccountLayout.span,
    programId: TOKEN_PROGRAM_ID,
  });

  const initIx = Token.createInitAccountInstruction(
    TOKEN_PROGRAM_ID,
    NATIVE_MINT,
    tempAccount.publicKey,
    owner
  );

  const closeIx = Token.createCloseAccountInstruction(
    TOKEN_PROGRAM_ID,
    tempAccount.publicKey,
    unwrapDestinationKey,
    owner,
    []
  );

  return {
    address: tempAccount.publicKey,
    instructions: [createIx, initIx],
    cleanupInstructions: [closeIx],
    signers: [tempAccount],
  };
}
