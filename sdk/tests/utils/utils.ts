import { TransactionBuilder } from "@orca-so/common-sdk";
import { web3, Provider } from "@project-serum/anchor";

export function systemTransferTx(
  provider: Provider,
  toPubkey: web3.PublicKey,
  lamports: number
): TransactionBuilder {
  return new TransactionBuilder(provider).addInstruction({
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
