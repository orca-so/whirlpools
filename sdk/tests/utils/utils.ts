import { web3, utils, Provider } from "@project-serum/anchor";
import { PDA } from "../../src/types/public/helper-types";
import { TransactionBuilder } from "../../src/utils/transactions/transactions-builder";

// Wrapper around findProgramAddress that returns a PDA object
export function findProgramAddress(seeds: (Uint8Array | Buffer)[], programId: web3.PublicKey): PDA {
  const [publicKey, bump] = utils.publicKey.findProgramAddressSync(seeds, programId);
  return { publicKey, bump };
}

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
