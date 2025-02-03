import {
  Address,
  CompilableTransactionMessage,
  getComputeUnitEstimateForTransactionMessageFactory,
  IInstruction,
  isWritableRole,
  MicroLamports,
  Rpc,
  Slot,
  SolanaRpcApi,
} from "@solana/web3.js";
import { DEFAULT_PRIORITIZATION, TransactionConfig } from "./config";
import { rpcFromUrl } from "./compatibility";
import { recentJitoTip } from "./jito";

async function estimatePriorityFees(
  txMessage: CompilableTransactionMessage,
  rpcUrl: string,
  isTriton: boolean,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION
): Promise<{
  priorityFeeMicroLamports: bigint;
  jitoTipLamports: bigint;
  computeUnits: number;
}> {
  const rpc = rpcFromUrl(rpcUrl);
  const computeUnits = await getComputeUnitsForTxMessage(rpc, txMessage);

  if (!computeUnits) throw new Error("Transaction simulation failed");

  let priorityFeeMicroLamports = BigInt(0);
  let jitoTipLamports = BigInt(0);

  const { priorityFee, jito, chainId } = transactionConfig;

  if (priorityFee.type === "exact") {
    priorityFeeMicroLamports =
      (priorityFee.amountLamports * BigInt(1_000_000)) / BigInt(computeUnits);
  } else if (priorityFee.type === "dynamic") {
    const estimatedPriorityFee = await calculateDynamicPriorityFees(
      txMessage.instructions,
      rpcUrl,
      chainId === "solana" && isTriton
    );

    if (!priorityFee.maxCapLamports) {
      priorityFeeMicroLamports = estimatedPriorityFee;
    } else {
      const maxCapMicroLamports =
        (priorityFee.maxCapLamports * BigInt(1_000_000)) / BigInt(computeUnits);

      priorityFeeMicroLamports =
        maxCapMicroLamports > estimatedPriorityFee
          ? estimatedPriorityFee
          : maxCapMicroLamports;
    }
  }

  if (jito.type === "exact") {
    jitoTipLamports = jito.amountLamports;
  } else if (jito.type === "dynamic" && chainId === "solana") {
    jitoTipLamports = await recentJitoTip();
  }

  return {
    jitoTipLamports,
    priorityFeeMicroLamports,
    computeUnits,
  };
}

async function getComputeUnitsForTxMessage(
  rpc: Rpc<SolanaRpcApi>,
  txMessage: CompilableTransactionMessage
) {
  const estimator = getComputeUnitEstimateForTransactionMessageFactory({
    rpc,
  });
  const estimate = await estimator(txMessage);
  return estimate;
}

function getWritableAccounts(ixs: readonly IInstruction[]) {
  const writable = new Set<Address>();
  ixs.forEach((ix) => {
    if (ix.accounts) {
      ix.accounts.forEach((acc) => {
        if (isWritableRole(acc.role)) writable.add(acc.address);
      });
    }
  });
  return Array.from(writable);
}

async function calculateDynamicPriorityFees(
  instructions: readonly IInstruction[],
  rpcUrl: string,
  supportsPercentile: boolean
) {
  const writableAccounts = getWritableAccounts(instructions);
  if (supportsPercentile) {
    return await getRecentPrioritizationFeesWithPercentile(
      rpcUrl,
      writableAccounts
    );
  } else {
    const rpc = rpcFromUrl(rpcUrl);
    const recent = await rpc
      .getRecentPrioritizationFees(writableAccounts)
      .send();
    const nonZero = recent
      .filter((pf) => pf.prioritizationFee > 0)
      .map((pf) => pf.prioritizationFee);
    const sorted = nonZero.sort((a, b) => Number((a - b) / BigInt(1_000_000)));
    const medianIndex = Math.floor(sorted.length / 2);
    const estimatedPriorityFee = sorted[medianIndex] || BigInt(0);
    return estimatedPriorityFee;
  }
}

async function getRecentPrioritizationFeesWithPercentile(
  rpcEndpoint: string,
  writableAccounts: Address[]
) {
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
          lockedWritableAccounts: writableAccounts,
          percentile: 5000,
        },
      ],
    }),
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }
  const last150Slots = data.result as RecentPrioritizationFee[];
  last150Slots.sort((a, b) => Number(a.slot - b.slot));
  const last50Slots = last150Slots.slice(-50);
  const nonZeroFees = last50Slots.filter((slot) => slot.prioritizationFee > 0);
  if (nonZeroFees.length === 0) return BigInt(0);
  const sum = nonZeroFees.reduce(
    (acc, slot) => acc + slot.prioritizationFee,
    BigInt(0)
  );

  return sum / BigInt(nonZeroFees.length);
}

type RecentPrioritizationFee = {
  /**
   * The per-compute-unit fee paid by at least one successfully
   * landed transaction, specified in increments of
   * micro-lamports (0.000001 lamports).
   */
  prioritizationFee: MicroLamports;
  /** Slot in which the fee was observed */
  slot: Slot;
};

export { estimatePriorityFees };
