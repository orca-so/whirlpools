import { Instruction } from "@orca-so/common-sdk";
import { createWSOLAccountInstructions } from "@orca-so/common-sdk/dist/helpers/token-instructions";
import {
  AccountLayout,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

export function isNativeMint(mint: PublicKey) {
  return mint.equals(NATIVE_MINT);
}

// TODO: Update spl-token so we get this method
export function getAssociatedTokenAddressSync(
  mint: string,
  owner: string,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), programId.toBuffer(), new PublicKey(mint).toBuffer()],
    associatedTokenProgramId
  );

  return address;
}

// TODO: Move this to common-sdk and use that in this SDK later
export function wrapSOL(
  owner: PublicKey,
  amountToWrap: BN,
  accountExemption: number,
  payer?: PublicKey,
  unwrapDestination?: PublicKey
): {
  wSolAccount: PublicKey;
  wrapIx: Instruction;
  unwrapIx: Instruction;
} {
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

  const wrapIx: Instruction = {
    instructions: [createIx, initIx],
    cleanupInstructions: [],
    signers: [tempAccount],
  };

  const unwrapIx: Instruction = {
    instructions: [closeIx],
    cleanupInstructions: [],
    signers: [],
  };

  return {
    wSolAccount: tempAccount.publicKey,
    wrapIx,
    unwrapIx,
  };
}
