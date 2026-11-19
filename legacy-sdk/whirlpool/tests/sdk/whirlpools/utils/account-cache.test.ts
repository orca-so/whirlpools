import { SimpleAccountFetcher, type ParsableEntity } from "@orca-so/common-sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { IGNORE_CACHE } from "../../../../src/network/public/fetcher/fetcher-types";

const address = PublicKey.default;
const account = {
  data: Buffer.alloc(0),
  executable: false,
  lamports: 10,
  owner: address,
};
const balance: ParsableEntity<number> = {
  parse: (_, info) => info?.lamports ?? null,
};

function setup() {
  const connection = new Connection("http://127.0.0.1:8899");
  const fetcher = new SimpleAccountFetcher(connection, new Map());
  const single = vi
    .spyOn(connection, "getAccountInfo")
    .mockResolvedValue(account);
  const batch = vi
    .spyOn(connection, "getMultipleAccountsInfo")
    .mockResolvedValue([account]);
  return { fetcher, single, batch };
}

describe("account cache", () => {
  it("retries after an RPC failure with the default retention policy", async () => {
    const { fetcher, single } = setup();
    single.mockRejectedValueOnce(new Error("RPC unavailable"));
    expect(await fetcher.getAccount(address, balance)).toBeNull();
    expect(await fetcher.getAccount(address, balance)).toBe(10);
    expect(single).toHaveBeenCalledTimes(2);
  });

  it("keeps the last successful read when a forced refresh fails", async () => {
    const { fetcher, single } = setup();
    expect(await fetcher.getAccount(address, balance, undefined, 100)).toBe(10);
    single.mockRejectedValueOnce(new Error("RPC unavailable"));
    expect(
      await fetcher.getAccount(address, balance, IGNORE_CACHE, 101),
    ).toBeNull();
    expect(await fetcher.getAccount(address, balance, undefined, 102)).toBe(10);
    expect(single).toHaveBeenCalledTimes(2);
  });

  it("caches a successful RPC response for a missing account", async () => {
    const { fetcher, single } = setup();
    single.mockResolvedValueOnce(null);
    expect(await fetcher.getAccount(address, balance)).toBeNull();
    expect(await fetcher.getAccount(address, balance)).toBeNull();
    expect(single).toHaveBeenCalledTimes(1);
  });

  it("always refetches for IGNORE_CACHE, including within one millisecond", async () => {
    const { fetcher, single, batch } = setup();
    const now = 100;
    await fetcher.getAccount(address, balance, undefined, now);
    single.mockResolvedValueOnce({ ...account, lamports: 11 });
    expect(await fetcher.getAccount(address, balance, IGNORE_CACHE, now)).toBe(
      11,
    );
    batch.mockResolvedValueOnce([{ ...account, lamports: 12 }]);
    const accounts = await fetcher.getAccounts(
      [address],
      balance,
      IGNORE_CACHE,
      now,
    );
    expect(accounts.get(address.toBase58())).toBe(12);
    batch.mockResolvedValueOnce([{ ...account, lamports: 13 }]);
    expect(
      await fetcher.getAccountsAsArray([address], balance, IGNORE_CACHE, now),
    ).toEqual([13]);
    expect(single).toHaveBeenCalledTimes(2);
    expect(batch).toHaveBeenCalledTimes(2);
  });

  it("honors an inclusive positive retention window for single and batch reads", async () => {
    const { fetcher, single, batch } = setup();
    const opts = { maxAge: 10 };
    await fetcher.getAccount(address, balance, opts, 100);
    expect(
      await fetcher.getAccountsAsArray([address], balance, opts, 110),
    ).toEqual([10]);
    expect(batch).not.toHaveBeenCalled();
    expect(await fetcher.getAccount(address, balance, opts, 110)).toBe(10);
    expect(single).toHaveBeenCalledTimes(1);
    await fetcher.getAccounts([address], balance, opts, 111);
    expect(batch).toHaveBeenCalledTimes(1);
  });
});
