import { Provider } from "@project-serum/anchor";
import { Transaction, Signer, TransactionInstruction } from "@solana/web3.js";

export const EMPTY_INSTRUCTION: Instruction = {
  instructions: [],
  cleanupInstructions: [],
  signers: [],
};

export type Instruction = {
  instructions: TransactionInstruction[];
  cleanupInstructions: TransactionInstruction[];
  signers: Signer[];
};

export type TransactionPayload = {
  transaction: Transaction;
  signers: Signer[];
};

export class TransactionBuilder {
  private provider: Provider;
  private instructions: Instruction[];
  private signers: Signer[];

  constructor(provider: Provider) {
    this.provider = provider;
    this.instructions = [];
    this.signers = [];
  }

  addInstruction(instruction: Instruction): TransactionBuilder {
    this.instructions.push(instruction);
    return this;
  }

  addSigner(signer: Signer): TransactionBuilder {
    this.signers.push(signer);
    return this;
  }

  isEmpty(): boolean {
    return this.instructions.length == 0;
  }

  /**
   * Compresses all instructions & signers in this builder
   * into one single instruction
   * @param compressPost Compress all post instructions into the instructions field
   * @returns Instruction object containing all
   */
  compressIx(compressPost: boolean): Instruction {
    let instructions: TransactionInstruction[] = [];
    let cleanupInstructions: TransactionInstruction[] = [];
    let signers: Signer[] = [];
    this.instructions.forEach((curr) => {
      instructions = instructions.concat(curr.instructions);
      // Cleanup instructions should execute in reverse order
      cleanupInstructions = curr.cleanupInstructions.concat(cleanupInstructions);
      signers = signers.concat(curr.signers);
    });

    if (compressPost) {
      instructions = instructions.concat(cleanupInstructions);
      cleanupInstructions = [];
    }

    return {
      instructions: [...instructions],
      cleanupInstructions: [...cleanupInstructions],
      signers,
    };
  }

  /**
   * Constructs a transaction payload with the gathered instructions
   * @returns a TransactionPayload object that can be excuted or agregated into other transactions
   */
  async build(): Promise<TransactionPayload> {
    const recentBlockHash = (await this.provider.connection.getRecentBlockhash("singleGossip"))
      .blockhash;

    const transaction = new Transaction({
      recentBlockhash: recentBlockHash,
      feePayer: this.provider.wallet.publicKey,
    });

    const ix = this.compressIx(true);

    transaction.add(...ix.instructions);
    transaction.feePayer = this.provider.wallet.publicKey;

    return {
      transaction: transaction,
      signers: ix.signers.concat(this.signers),
    };
  }

  /**
   * Constructs a transaction payload with the gathered instructions, sign it with the provider and send it out
   * @returns the txId of the transaction
   */
  async buildAndExecute(): Promise<string> {
    const tx = await this.build();
    return this.provider.send(tx.transaction, tx.signers, { commitment: "confirmed" });
  }
}
