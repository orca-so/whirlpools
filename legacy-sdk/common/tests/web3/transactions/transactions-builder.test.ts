import type { TransactionInstruction } from "@solana/web3.js";
import { SystemProgram, Keypair } from "@solana/web3.js";
import {
  defaultTransactionBuilderOptions,
  isVersionedTransaction,
  MEASUREMENT_BLOCKHASH,
  TransactionBuilder,
} from "../../../src/web3";
import { createTestContext } from "../../test-context";

jest.setTimeout(100 * 1000 /* ms */);

describe("transactions-builder", () => {
  const ctx = createTestContext();

  describe("txnSize", () => {
    const buildTransactionBuilder = (
      transferIxNum: number,
      version: "legacy" | number,
    ) => {
      const { wallet, connection } = ctx;

      const ixs: TransactionInstruction[] = [];
      for (let i = 0; i < transferIxNum; i++) {
        ixs.push(
          SystemProgram.transfer({
            programId: SystemProgram.programId,
            fromPubkey: wallet.publicKey,
            lamports: 10_000_000,
            toPubkey: Keypair.generate().publicKey,
          }),
        );
      }

      const builder = new TransactionBuilder(connection, wallet, {
        ...defaultTransactionBuilderOptions,
        defaultBuildOption: {
          maxSupportedTransactionVersion: version,
          latestBlockhash: MEASUREMENT_BLOCKHASH,
          blockhashCommitment: "confirmed",
        },
      });

      builder.addInstruction({
        instructions: ixs,
        cleanupInstructions: [],
        signers: [],
      });

      return builder;
    };

    it("empty", async () => {
      const { wallet, connection } = ctx;
      const builder = new TransactionBuilder(connection, wallet);

      const size = builder.txnSize();
      expect(size).toEqual(0);
    });

    it("legacy: size < PACKET_DATA_SIZE", async () => {
      const builder = buildTransactionBuilder(15, "legacy");

      // should be legacy
      const transaction = await builder.build();
      expect(isVersionedTransaction(transaction.transaction)).toBeFalsy();

      const size = builder.txnSize();
      expect(size).toEqual(901);
    });

    it("legacy: size > PACKET_DATA_SIZE", async () => {
      const builder = buildTransactionBuilder(22, "legacy");

      // should be legacy
      const transaction = await builder.build();
      expect(isVersionedTransaction(transaction.transaction)).toBeFalsy();

      // logical size: 1244 > PACKET_DATA_SIZE
      expect(() => builder.txnSize()).toThrow(
        /Unable to measure transaction size/,
      );
    });

    it("v0: size < PACKET_DATA_SIZE", async () => {
      const builder = buildTransactionBuilder(15, 0);

      // should be versioned
      const transaction = await builder.build();
      expect(isVersionedTransaction(transaction.transaction)).toBeTruthy();

      const size = builder.txnSize();
      expect(size).toEqual(903);
    });

    it("v0: size > PACKET_DATA_SIZE", async () => {
      const builder = buildTransactionBuilder(22, 0);

      // should be versioned
      const transaction = await builder.build();
      expect(isVersionedTransaction(transaction.transaction)).toBeTruthy();

      // logical size: 1246 > PACKET_DATA_SIZE
      expect(() => builder.txnSize()).toThrow(
        /Unable to measure transaction size/,
      );
    });

    it("v0: size >> PACKET_DATA_SIZE", async () => {
      const builder = buildTransactionBuilder(42, 0);

      // should be versioned
      const transaction = await builder.build();
      expect(isVersionedTransaction(transaction.transaction)).toBeTruthy();

      // logical size: 2226 >> PACKET_DATA_SIZE
      expect(() => builder.txnSize()).toThrow(
        /Unable to measure transaction size/,
      );
    });
  });
});
