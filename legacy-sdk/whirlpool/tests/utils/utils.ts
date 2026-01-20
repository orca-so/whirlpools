import type { AnchorProvider } from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import type NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { TransactionBuilder } from "@orca-so/common-sdk";
import type {
  PublicKey,
  TransactionInstruction,
  Connection,
  Commitment,
} from "@solana/web3.js";

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

export function getProviderWalletKeypair(
  provider: AnchorProvider,
): web3.Keypair {
  const payer = (provider.wallet as NodeWallet).payer;
  return payer;
}

export async function requestAirdropIfBalanceLow(
  connection: Connection,
  wallet: PublicKey,
  amount: number = 50_000_000_000, // 50 SOL
  minBalance: number = 10_000_000_000, // 10 SOL
  commitment: Commitment = "confirmed",
) {
  const balance = await connection.getBalance(wallet);
  if (balance < minBalance) {
    const airdropTx = await connection.requestAirdrop(wallet, amount);
    await connection.confirmTransaction(
      {
        signature: airdropTx,
        ...(await connection.getLatestBlockhash(commitment)),
      },
      commitment,
    );
  }
}

export function remEuclid(a: number, n: number): number {
  const r = a % n;
  return r < 0 ? r + n : r;
}

export function snapTickDown(t: number, spacing: number): number {
  return t - remEuclid(t, spacing);
}

export function snapTickUp(t: number, spacing: number): number {
  const r = remEuclid(t, spacing);
  return r === 0 ? t : t + (spacing - r);
}
