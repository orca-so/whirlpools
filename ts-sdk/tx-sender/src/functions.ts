import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
  ComputeBudgetProgram,
  TransactionMessage,
  Transaction,
  Keypair,
  SystemProgram,
} from "@solana/web3.js";
import {
  calculateDynamicPriorityFees,
  getComputeUnitsForInstructions,
} from "./utils";
import { TransactionConfig } from "./types";
import { BaseSignerWalletAdapter } from "@solana/wallet-adapter-base";
import { getJitoTipAddress, recentJitoTip } from "./jito";

export const DEFAULT_PRIORITIZATION: TransactionConfig = {
  priorityFee: {
    type: "dynamic",
    maxCapLamports: 4_000_000, // 0.004 SOL
  },
  jito: {
    type: "dynamic",
    maxCapLamports: 4_000_000, // 0.004 SOL
  },
  chainId: "solana",
};

export const signAndSendTransaction = async (
  transaction: VersionedTransaction | Transaction,
  wallet: Keypair | BaseSignerWalletAdapter,
  connection: Connection
): Promise<string> => {
  const signed =
    wallet instanceof BaseSignerWalletAdapter
      ? await wallet.signTransaction(transaction)
      : (() => {
          if (transaction instanceof VersionedTransaction) {
            transaction.sign([wallet]);
          } else {
            transaction.sign(wallet);
          }
          return transaction;
        })();
  // TODO retry logic with backoff
  // TODO blockhash expiration handling
  return connection.sendRawTransaction(signed.serialize());
};

export const buildTransaction = async (
  instructions: TransactionInstruction[],
  payerKey: PublicKey,
  connectionContext: {
    connection: Connection;
    isTriton: boolean;
  },
  transactionConfig: TransactionConfig,
  lookupTables?: AddressLookupTableAccount[],
  signatures?: Array<Uint8Array>
) => {
  const { connection, isTriton } = connectionContext;
  const { blockhash: recentBlockhash } = await connection.getLatestBlockhash({
    commitment: "confirmed",
  });
  const estimatedComputeUnits = await getComputeUnitsForInstructions(
    connection,
    instructions,
    payerKey,
    lookupTables
  );
  const ixs = [] as TransactionInstruction[];
  ixs.push(...instructions);

  const { priorityFeeMicroLamports, jitoTipLamports } =
    await estimatePriorityFees(
      instructions,
      connection,
      isTriton,
      payerKey,
      transactionConfig,
      lookupTables
    );

  if (priorityFeeMicroLamports > 0) {
    const setComputeUnitPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFeeMicroLamports,
    });
    const setComputeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: estimatedComputeUnits, // todo add margin ?
    });
    instructions.unshift(setComputeUnitPriceIx, setComputeUnitLimitIx);
  }

  if (jitoTipLamports > 0) {
    instructions.unshift(
      SystemProgram.transfer({
        fromPubkey: payerKey,
        toPubkey: getJitoTipAddress(),
        lamports: jitoTipLamports,
      })
    );
  }

  const messageV0 = new TransactionMessage({
    payerKey,
    recentBlockhash,
    instructions: ixs,
  }).compileToV0Message(lookupTables);

  const tx = new VersionedTransaction(messageV0, signatures);
  if (signatures) {
    signatures.forEach((signature, index) => {
      tx.addSignature(messageV0.staticAccountKeys[index], signature);
    });
  }
  return tx;
};

export const estimatePriorityFees = async (
  instructions: TransactionInstruction[],
  connection: Connection,
  isTriton: boolean,
  feePayer: PublicKey,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION,
  lookupTables?: AddressLookupTableAccount[]
): Promise<{
  priorityFeeMicroLamports: number;
  jitoTipLamports: number;
}> => {
  const computeUnits = await getComputeUnitsForInstructions(
    connection,
    instructions,
    feePayer,
    lookupTables
  );
  let priorityFeeMicroLamports = 0,
    jitoTipLamports = 0;

  const { priorityFee, jito } = transactionConfig;
  if (!computeUnits) throw new Error("Tx simulation failed");

  if (priorityFee.type === "exact") {
    priorityFeeMicroLamports = Math.floor(
      (priorityFee.amountLamports * 1_000_000) / computeUnits
    );
  } else if (priorityFee.type === "dynamic") {
    const estimatedPriorityFee = await calculateDynamicPriorityFees(
      instructions,
      feePayer,
      connection,
      transactionConfig.chainId === "solana" && isTriton,
      lookupTables
    );

    if (!priorityFee.maxCapLamports) {
      priorityFeeMicroLamports = estimatedPriorityFee;
    } else {
      const maxCapMicroLamports = Math.floor(
        (priorityFee.maxCapLamports * 1_000_000) / computeUnits
      );
      priorityFeeMicroLamports = Math.min(
        maxCapMicroLamports,
        estimatedPriorityFee
      );
    }
  }

  if (jito.type === "exact") {
    jitoTipLamports = jito.amountLamports;
  } else if (jito.type === "dynamic") {
    jitoTipLamports = await recentJitoTip();
  }

  return {
    jitoTipLamports,
    priorityFeeMicroLamports,
  };
};
