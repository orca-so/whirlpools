import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  Transaction,
  VersionedTransaction,
  Message,
  VersionedMessage,
  RecentPrioritizationFees,
} from "@solana/web3.js";

export const getComputeUnitsForInstructions = async (
  connection: Connection,
  instructions: TransactionInstruction[],
  payer: PublicKey,
  lookupTables?: AddressLookupTableAccount[]
): Promise<number> => {
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
  if (simulation.value.err || !simulation.value.unitsConsumed) {
    throw Error("Tx simulation failed");
  }
  return simulation.value.unitsConsumed;
};

export const getWritableAccounts = (tx: VersionedTransaction | Transaction) => {
  let message: Message | VersionedMessage;
  if (tx instanceof VersionedTransaction) {
    message = tx.message;
  } else {
    message = tx.compileMessage();
  }

  const messageKeys = message.getAccountKeys();
  const writableAccounts: PublicKey[] = [];

  // Static writable accounts
  writableAccounts.push(...messageKeys.keySegments()[0]);

  if (messageKeys.accountKeysFromLookups?.writable) {
    writableAccounts.push(...messageKeys.accountKeysFromLookups.writable);
  }
  return writableAccounts;
};

export const calculateDynamicPriorityFees = async (
  instructions: TransactionInstruction[],
  payerKey: PublicKey,
  connection: Connection,
  supportsPercentile: boolean,
  lookupTables?: AddressLookupTableAccount[]
) => {
  const messageV0 = new TransactionMessage({
    payerKey,
    instructions,
    recentBlockhash: PublicKey.default.toString(),
  }).compileToV0Message(lookupTables);
  const tx = new VersionedTransaction(messageV0);
  const writableAccounts = getWritableAccounts(tx);
  if (supportsPercentile) {
    return await getRecentPrioritizationFeesWithPercentile(
      connection.rpcEndpoint,
      writableAccounts
    );
  } else {
    const recent = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: writableAccounts,
    });
    const nonZero = recent
      .filter((pf) => pf.prioritizationFee > 0)
      .map((pf) => pf.prioritizationFee);
    const sorted = nonZero.sort((a, b) => a - b);
    const medianIndex = Math.floor(sorted.length / 2);
    const estimatedPriorityFee = sorted[medianIndex] || 0;
    return estimatedPriorityFee;
  }
};

const getRecentPrioritizationFeesWithPercentile = async (
  rpcEndpoint: string,
  writableAccounts: PublicKey[]
) => {
  const response = await fetch(rpcEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getRecentPrioritizationFees",
      params: [
        {
          lockedWritableAccounts: writableAccounts.map((pk) => pk.toBase58()),
          percentile: 5000,
        },
      ],
    }),
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }
  const last150Slots = data.result as RecentPrioritizationFees[];
  last150Slots.sort((a, b) => a.slot - b.slot);
  const last50Slots = last150Slots.slice(-50);
  const nonZeroFees = last50Slots.filter((slot) => slot.prioritizationFee > 0);
  if (nonZeroFees.length === 0) return 0;
  const sum = nonZeroFees.reduce(
    (acc, slot) => acc + slot.prioritizationFee,
    0
  );
  return Math.floor(sum / nonZeroFees.length);
};
