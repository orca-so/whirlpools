import { Address, AddressUtil } from "@orca-so/common-sdk";
import { Connection } from "@solana/web3.js";
import invariant from "tiny-invariant";
import { AccountName, WHIRLPOOL_CODER, WhirlpoolData, getAccountSize } from "../../../types/public";
import { ParsableWhirlpool } from "../parsing";

/**
 * Retrieve a list of cached whirlpool addresses and accounts filtered by the given params using
 * getProgramAccounts.
* @category Fetcher
 *
 * @param connection The connection to use to fetch accounts
 * @param programId The Whirlpool program to search Whirlpool accounts for
 * @param configId The {@link WhirlpoolConfig} account program address to filter by
 * @returns tuple of whirlpool addresses and accounts
 */
export async function getAllWhirlpoolAccounts({
  connection,
  programId,
  configId,
}: {
  connection: Connection;
  programId: Address;
  configId: Address;
}): Promise<[Address, WhirlpoolData][]> {
  const filters = [
    { dataSize: getAccountSize(AccountName.Whirlpool) },
    {
      memcmp: WHIRLPOOL_CODER.memcmp(
        AccountName.Whirlpool,
        AddressUtil.toPubKey(configId).toBuffer()
      ),
    },
  ];

  const accounts = await connection.getProgramAccounts(AddressUtil.toPubKey(programId), {
    filters,
  });

  const parsedAccounts: [Address, WhirlpoolData][] = [];
  accounts.forEach(({ pubkey, account }) => {
    const parsedAccount = ParsableWhirlpool.parse(pubkey, account);
    invariant(!!parsedAccount, `could not parse whirlpool: ${pubkey.toBase58()}`);
    parsedAccounts.push([pubkey, parsedAccount]);
  });

  return parsedAccounts;
}