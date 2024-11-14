import { fetchSysvarRent } from "@solana/sysvars"
import { GetAccountInfoApi, lamports, Rpc } from "@solana/web3.js";
import type { Lamports } from "@solana/web3.js";

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
export async function calculateMinimumBalance(rpc: Rpc<GetAccountInfoApi>, dataSize: number): Promise<Lamports> {
  const rent = await fetchSysvarRent(rpc);
  const actualDataLen = BigInt(dataSize + ACCOUNT_STORAGE_OVERHEAD);
  const rentLamportsPerYear = rent.lamportsPerByteYear * actualDataLen;
  const minimumBalance = rentLamportsPerYear * BigInt(Math.floor(rent.exemptionThreshold));
  
  return lamports(minimumBalance)
}