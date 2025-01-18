import {
  AddressLookupTableAccount,
  Blockhash,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { PrioritizationConfig } from "./types";

export const buildTransaction = async (
  instructions: TransactionInstruction[],
  recentBlockhash: Blockhash,
  payerKey: PublicKey,
  priorityConfig: PrioritizationConfig,
  estimatedComputeUnits: number,
  signatures?: Array<Uint8Array>
) => {
  const ixs = [] as TransactionInstruction[];
  ixs.push(...instructions);

  if (
    priorityConfig.mode === "both" ||
    priorityConfig.mode === "priorityFeeOnly"
  ) {
    const { fee } = priorityConfig; // TODO handle exact and dynamic lamports cases
    const setComputeUnitPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: Math.floor(
        (fee.lamports * 1_000_000) / estimatedComputeUnits
      ),
    });
    const setComputeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: estimatedComputeUnits,
    });
    instructions.unshift(setComputeUnitPriceIx, setComputeUnitLimitIx);
  }

  const messageV0 = new TransactionMessage({
    payerKey,
    recentBlockhash,
    instructions: ixs,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0, signatures);
  if (signatures) {
    signatures.forEach((signature, index) => {
      tx.addSignature(messageV0.staticAccountKeys[index], signature);
    });
  }
  return tx;
};

export const getComputeUnitsForInstructions = async (
  connection: Connection,
  instructions: TransactionInstruction[],
  payer: PublicKey,
  lookupTables?: AddressLookupTableAccount[]
): Promise<number | undefined> => {
  const testInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ...instructions,
  ];

  const testVersionedTxn = new VersionedTransaction(
    new TransactionMessage({
      instructions: testInstructions,
      payerKey: payer,
      recentBlockhash: PublicKey.default.toString(),
    }).compileToV0Message(lookupTables)
  );

  const simulation = await connection.simulateTransaction(testVersionedTxn, {
    replaceRecentBlockhash: true,
    sigVerify: false,
  });
  if (simulation.value.err) {
    return undefined;
  }
  return simulation.value.unitsConsumed;
};

export const connection = (connectionOrRpcUrl: Connection | string) => {
  return connectionOrRpcUrl instanceof Connection
    ? connectionOrRpcUrl
    : new Connection(connectionOrRpcUrl);
};
