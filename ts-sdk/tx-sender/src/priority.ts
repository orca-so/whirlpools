import { Address, IInstruction } from "@solana/web3.js";
import { connection, getWritableAccounts } from "./utils";
import { RecentPrioritizationFee } from "./types";

export const calculateDynamicPriorityFees = async (
  instructions: IInstruction[],
  rpcUrl: string,
  supportsPercentile: boolean
  // lookupTables?: AddressLookupTableAccount[] TODO add support
) => {
  const writableAccounts = getWritableAccounts(instructions);
  if (supportsPercentile) {
    return await getRecentPrioritizationFeesWithPercentile(
      rpcUrl,
      writableAccounts
    );
  } else {
    const rpc = connection(rpcUrl);
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
};

const getRecentPrioritizationFeesWithPercentile = async (
  rpcEndpoint: string,
  writableAccounts: Address[]
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
};
