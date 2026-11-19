import { getMultipleAccounts } from "@orca-so/common-sdk";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addresses = [SystemProgram.programId, new PublicKey(1)];

describe("batched account reads", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports an RPC error immediately even while another chunk is pending", async () => {
    const connection = new Connection("http://127.0.0.1:8899");
    const failure = new Error("RPC unavailable");
    vi.spyOn(connection, "getMultipleAccountsInfo")
      .mockReturnValueOnce(new Promise<never>(() => {}))
      .mockRejectedValueOnce(failure);

    const onError = vi.fn();
    const read = getMultipleAccounts(connection, addresses, 10, 1).catch(
      onError,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(vi.getTimerCount()).toBe(0);
    await read;
  });

  it("preserves input order and clears the timeout when chunks finish out of order", async () => {
    const connection = new Connection("http://127.0.0.1:8899");
    const account = {
      data: Buffer.alloc(0),
      executable: false,
      lamports: 1,
      owner: addresses[1],
    };
    vi.spyOn(connection, "getMultipleAccountsInfo")
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve([null]), 5)),
      )
      .mockResolvedValueOnce([account]);

    const read = getMultipleAccounts(connection, addresses, 10, 1);
    await vi.advanceTimersByTimeAsync(5);
    expect(await read).toEqual([
      [addresses[0], null],
      [addresses[1], account],
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still times out when an RPC request never settles", async () => {
    const connection = new Connection("http://127.0.0.1:8899");
    vi.spyOn(connection, "getMultipleAccountsInfo").mockReturnValue(
      new Promise<never>(() => {}),
    );

    const check = expect(
      getMultipleAccounts(connection, addresses, 1),
    ).rejects.toThrow("connection.getMultipleAccountsInfo timeout");
    await vi.advanceTimersByTimeAsync(1000);
    await check;
  });
});
