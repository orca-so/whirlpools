import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";
import type { Address } from "../address-util";
import { AddressUtil } from "../address-util";
import type { ParsableEntity } from "./parsing";

export async function getParsedAccount<T>(
  connection: Connection,
  address: Address,
  parser: ParsableEntity<T>,
): Promise<T | null> {
  const value = await connection.getAccountInfo(AddressUtil.toPubKey(address));
  const key = AddressUtil.toPubKey(address);
  return parser.parse(key, value);
}

export async function getMultipleParsedAccounts<T>(
  connection: Connection,
  addresses: Address[],
  parser: ParsableEntity<T>,
  chunkSize = 100,
): Promise<(T | null)[]> {
  if (addresses.length === 0) {
    return [];
  }

  const values = await getMultipleAccounts(
    connection,
    AddressUtil.toPubKeys(addresses),
    10,
    chunkSize,
  );
  const results = values.map((val) => {
    if (val[1] === null) {
      return null;
    }
    return parser.parse(val[0], val[1]);
  });
  invariant(results.length === addresses.length, "not enough results fetched");
  return results;
}

// An entry between the key of an address and the account data for that address.
export type FetchedAccountEntry = [PublicKey, AccountInfo<Buffer> | null];
export type FetchedAccountMap = Map<string, AccountInfo<Buffer> | null>;

export async function getMultipleAccountsInMap(
  connection: Connection,
  addresses: Address[],
  timeoutAfterSeconds = 10,
  chunkSize = 100,
): Promise<Readonly<FetchedAccountMap>> {
  const results = await getMultipleAccounts(
    connection,
    addresses,
    timeoutAfterSeconds,
    chunkSize,
  );
  return results.reduce((map, [key, value]) => {
    map.set(key.toBase58(), value);
    return map;
  }, new Map<string, AccountInfo<Buffer> | null>());
}

export async function getMultipleAccounts(
  connection: Connection,
  addresses: Address[],
  timeoutAfterSeconds = 10,
  chunkSize = 100,
): Promise<Readonly<FetchedAccountEntry[]>> {
  if (addresses.length === 0) {
    return [];
  }

  const chunkCount = Math.ceil(addresses.length / chunkSize);
  const requests = Array.from(
    { length: chunkCount },
    async (_, index): Promise<FetchedAccountEntry[]> => {
      const start = index * chunkSize;
      const keys = AddressUtil.toPubKeys(
        addresses.slice(start, start + chunkSize),
      );
      const accounts = await connection.getMultipleAccountsInfo(keys);
      return accounts.map((account, i) => [keys[i], account]);
    },
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("connection.getMultipleAccountsInfo timeout"));
    }, timeoutAfterSeconds * 1000);
  });

  try {
    // Promise.all preserves chunk order even when later requests finish first.
    const chunks = await Promise.race([Promise.all(requests), timeout]);
    const result = chunks.flat();
    invariant(
      result.length === addresses.length,
      "getMultipleAccounts not enough results",
    );
    return result;
  } finally {
    clearTimeout(timer);
  }
}
