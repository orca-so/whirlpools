import { TransactionBuilder } from "@orca-so/common-sdk";
import { web3, AnchorProvider } from "@project-serum/anchor";

export function systemTransferTx(
  provider: AnchorProvider,
  toPubkey: web3.PublicKey,
  lamports: number
): TransactionBuilder {
  return new TransactionBuilder(provider.connection, provider.wallet).addInstruction({
    instructions: [
      web3.SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
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
