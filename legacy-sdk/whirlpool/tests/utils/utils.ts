import type { AnchorProvider } from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import { TransactionBuilder } from "@orca-so/common-sdk";

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
