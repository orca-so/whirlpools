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
  TransactionSigner,
  prependTransactionMessageInstruction,
  IAccountLookupMeta,
  IAccountMeta,
  ITransactionMessageWithFeePayerSigner,
  TransactionMessageWithBlockhashLifetime,
  TransactionVersion,
} from "@solana/web3.js";
import {
  ConnectionContext,
  DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER,
  FeeSetting,
  TransactionConfig,
} from "./config";
import { rpcFromUrl } from "./compatibility";
import { processJitoTipForTxMessage } from "./jito";
import {
  getSetComputeUnitPriceInstruction,
  getSetComputeUnitLimitInstruction,
} from "@solana-program/compute-budget";

export type TxMessage = ITransactionMessageWithFeePayerSigner<
  string,
  TransactionSigner<string>
> &
  Omit<
    TransactionMessageWithBlockhashLifetime &
      Readonly<{
        instructions: readonly IInstruction<
          string,
          readonly (IAccountLookupMeta<string, string> | IAccountMeta<string>)[]
        >[];
        version: TransactionVersion;
      }>,
    "feePayer"
  >;

async function addPriorityInstructions(
  message: TxMessage,
  transactionConfig: TransactionConfig,
  connectionContext: ConnectionContext,
  signer: TransactionSigner
) {
  const { rpcUrl, chainId } = connectionContext;
  const { jito, priorityFee, priorityFeePercentile } = transactionConfig;
  const rpc = rpcFromUrl(rpcUrl);

  if (jito.type !== "none" && chainId === "solana") {
    message = await processJitoTipForTxMessage(message, signer, jito);
  }
  let computeUnits = await getComputeUnitsForTxMessage(rpc, message);

  if (!computeUnits) throw new Error("Transaction simulation failed");
  // add margin to compute units
  computeUnits = Math.ceil(
    computeUnits *
      (transactionConfig.computeUnitMarginMultiplier ??
        DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER)
  );

  return processPriorityFeeForTxMessage(
    message,
    computeUnits,
    priorityFee,
    priorityFeePercentile,
    connectionContext
  );
}

async function processPriorityFeeForTxMessage(
  message: TxMessage,
  computeUnits: number,
  priorityFee: FeeSetting,
  priorityFeePercentile: number,
  connectionContext: ConnectionContext
) {
  const { rpcUrl, supportsPriorityFeePercentile } = connectionContext;
  let priorityFeeMicroLamports = BigInt(0);
  if (priorityFee.type === "exact") {
    priorityFeeMicroLamports =
      (priorityFee.amountLamports * BigInt(1_000_000)) / BigInt(computeUnits);
  } else if (priorityFee.type === "dynamic") {
    const estimatedPriorityFee = await calculateDynamicPriorityFees(
      message.instructions,
      rpcUrl,
      supportsPriorityFeePercentile,
      priorityFeePercentile
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
    getSetComputeUnitLimitInstruction({ units: computeUnits }),
    message
  );

  return message;
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
  supportsPercentile: boolean,
  percentile: number
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
    const sorted = nonZero.sort((a, b) => Number((a - b) / BigInt(1_000_000)));
    const medianIndex = Math.floor(sorted.length / 2);
    const estimatedPriorityFee = sorted[medianIndex] || BigInt(0);
    return estimatedPriorityFee;
  }
}

async function getRecentPrioritizationFeesWithPercentile(
  rpcEndpoint: string,
  writableAccounts: Address[],
  percentile: number
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
          percentile: percentile * 100,
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

export { addPriorityInstructions };
