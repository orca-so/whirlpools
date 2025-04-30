import type { AnchorProvider } from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import { TransactionBuilder } from "@orca-so/common-sdk";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";

export function systemTransferTx(
  provider: AnchorProvider,
  toPubkey: web3.PublicKey,
  lamports: number,
  fromPubkey: web3.PublicKey = provider.wallet.publicKey,
): TransactionBuilder {
  return new TransactionBuilder(
    provider.connection,
    provider.wallet,
  ).addInstruction({
    instructions: [
      web3.SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports,
      }),
    ],
    cleanupInstructions: [],
    signers: [],
  });
}

export function sleep(ms: number): Promise<unknown> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function dropIsSignerFlag(
  ix: TransactionInstruction,
  signer: PublicKey,
): TransactionInstruction {
  // drop isSigner flag
  const keysWithoutSign = ix.keys.map((key) => {
    if (key.pubkey.equals(signer)) {
      return {
        pubkey: key.pubkey,
        isSigner: false,
        isWritable: key.isWritable,
      };
    }
    return key;
  });

  return {
    ...ix,
    keys: keysWithoutSign,
  };
}

export function dropIsWritableFlag(
  ix: TransactionInstruction,
  writableAccount: PublicKey,
): TransactionInstruction {
  // drop isSigner flag
  const keysWithoutWritable = ix.keys.map((key) => {
    if (key.pubkey.equals(writableAccount)) {
      return {
        pubkey: key.pubkey,
        isSigner: key.isSigner,
        isWritable: false,
      };
    }
    return key;
  });

  return {
    ...ix,
    keys: keysWithoutWritable,
  };
}

export function rewritePubkey(
  ix: TransactionInstruction,
  oldPubkey: PublicKey,
  newPubkey: PublicKey,
): TransactionInstruction {
  const ixWithWrongAccount = {
    ...ix,
    keys: ix.keys.map((key) => {
      if (key.pubkey.equals(oldPubkey)) {
        return { ...key, pubkey: newPubkey };
      }
      return key;
    }),
  };

  return ixWithWrongAccount;
}
