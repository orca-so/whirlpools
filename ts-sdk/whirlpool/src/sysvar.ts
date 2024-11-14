import { fetchSysvarRent } from "@solana/sysvars";
import { lamports } from "@solana/web3.js";
import type { Lamports, GetAccountInfoApi, Rpc } from "@solana/web3.js";

/**
 * The overhead storage size for accounts.
 */
const ACCOUNT_STORAGE_OVERHEAD = 128;

/**
 * Calculates the minimum balance required for rent exemption for a given account size.
 *
 * @param {Rpc} rpc - The Solana RPC client to fetch sysvar rent data.
 * @param {number} dataSize - The size of the account data in bytes.
 * @returns {Promise<BigInt>} The minimum balance required for rent exemption in lamports.
 */
export async function calculateMinimumBalance(
  rpc: Rpc<GetAccountInfoApi>,
  dataSize: number,
): Promise<Lamports> {
  const rent = await fetchSysvarRent(rpc);
  const dataSizeForRent = BigInt(dataSize + ACCOUNT_STORAGE_OVERHEAD);
  const rentLamportsPerYear = rent.lamportsPerByteYear * dataSizeForRent;
  const minimumBalance =
    rentLamportsPerYear * BigInt(rent.exemptionThreshold);

  return lamports(minimumBalance);
}
