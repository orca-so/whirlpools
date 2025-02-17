import {
  getSetComputeUnitPriceInstruction,
  getSetComputeUnitLimitInstruction,
} from "@solana-program/compute-budget";
import {
  prependTransactionMessageInstruction,
  IInstruction,
  isWritableRole,
  MicroLamports,
  Address,
  Slot,
} from "@solana/web3.js";
import { rpcFromUrl } from "./compatibility";
import {
  TransactionConfig,
  ConnectionContext,
  DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER,
  Percentile,
} from "./config";
import { TxMessage } from "./priorityFees";

export async function processComputeBudgetForTxMessage(
  message: TxMessage,
  computeUnits: number,
  transactionConfig: TransactionConfig,
  connectionContext: ConnectionContext
) {
  const { rpcUrl, supportsPriorityFeePercentile } = connectionContext;
  const { priorityFee } = transactionConfig;
  let priorityFeeMicroLamports = BigInt(0);
  if (priorityFee.type === "exact") {
    priorityFeeMicroLamports =
      (priorityFee.amountLamports * BigInt(1_000_000)) / BigInt(computeUnits);
  } else if (priorityFee.type === "dynamic") {
    const estimatedPriorityFee = await calculateDynamicPriorityFees(
      message.instructions,
      rpcUrl,
      supportsPriorityFeePercentile,
      priorityFee.priorityFeePercentile ?? "50"
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

  if (priorityFeeMicroLamports > 0) {
    message = prependTransactionMessageInstruction(
      getSetComputeUnitPriceInstruction({
        microLamports: priorityFeeMicroLamports,
      }),
      message
    );
  }
  message = prependTransactionMessageInstruction(
    getSetComputeUnitLimitInstruction({
      units: Math.ceil(
        computeUnits *
          (transactionConfig.computeUnitMarginMultiplier ??
            DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER)
      ),
    }),
    message
  );

  return message;
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
  supportsPercentile: boolean,
  percentile: Percentile
) {
  const writableAccounts = getWritableAccounts(instructions);
  if (supportsPercentile) {
    return await getRecentPrioritizationFeesWithPercentile(
      rpcUrl,
      writableAccounts,
      percentile
    );
  } else {
    const rpc = rpcFromUrl(rpcUrl);
    const recent = await rpc
      .getRecentPrioritizationFees(writableAccounts)
      .send();
    const nonZero = recent
      .filter((pf) => pf.prioritizationFee > 0)
      .map((pf) => pf.prioritizationFee);
    const sorted = nonZero.sort((a, b) => Number(a - b));

    if (percentile === "50") {
      const mid = sorted.length / 2;
      if (sorted.length === 0) return BigInt(0);
      if (sorted.length % 2 === 0) {
        return (
          (sorted[Math.floor(mid - 1)] + sorted[Math.floor(mid)]) / BigInt(2)
        );
      } else {
        return sorted[Math.floor(mid)];
      }
    }
    return (
      sorted[
        Math.floor(sorted.length * (percentileNumber(percentile) / 100))
      ] || BigInt(0)
    );
  }
}

async function getRecentPrioritizationFeesWithPercentile(
  rpcEndpoint: string,
  writableAccounts: Address[],
  percentile: Percentile
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
          percentile: percentileNumber(percentile) * 100,
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
  const sorted = nonZeroFees
    .map((slot) => slot.prioritizationFee)
    .sort((a, b) => Number(a - b));
  const medianIndex = Math.floor(sorted.length / 2);
  return sorted[medianIndex];
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

function percentileNumber(percentile: Percentile) {
  switch (percentile) {
    case "25":
      return 25;
    case "50":
      return 50;
    case "75":
      return 75;
    case "95":
      return 95;
    case "99":
      return 99;
  }
}
