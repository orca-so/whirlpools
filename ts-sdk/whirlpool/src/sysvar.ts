import type { SysvarRent } from "@solana/sysvars";

/**
 * The overhead storage size for accounts.
 */
const ACCOUNT_STORAGE_OVERHEAD = 128;

/**
 * Calculates the minimum balance required for rent exemption for a given account size.
 *
 * @param {Rpc} rpc - The Solana RPC client to fetch sysvar rent data.
 * @param {number} dataSize - The size of the account data in bytes.
 * @returns {bigint} The minimum balance required for rent exemption in lamports.
 */
export function calculateMinimumBalanceForRentExemption(
  rent: SysvarRent,
  dataSize: number,
): bigint {
  const dataSizeForRent = BigInt(dataSize + ACCOUNT_STORAGE_OVERHEAD);
  const rentLamportsPerYear = rent.lamportsPerByteYear * dataSizeForRent;
  const minimumBalance = rentLamportsPerYear * BigInt(rent.exemptionThreshold);

  return minimumBalance;
}
