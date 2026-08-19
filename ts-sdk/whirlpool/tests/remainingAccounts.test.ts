import { describe, it } from "vitest";
import assert from "assert";
import { AccountsType } from "@orca-so/whirlpools-client";
import { AccountRole, address } from "@solana/kit";
import { buildRemainingAccounts } from "../src/remainingAccounts";

describe("buildRemainingAccounts", () => {
  it("omits empty slices and returns null info when nothing is attached", () => {
    const result = buildRemainingAccounts([
      { accountsType: AccountsType.TransferHookA, accounts: undefined },
      { accountsType: AccountsType.TransferHookB, accounts: [] },
    ]);
    assert.strictEqual(result.remainingAccountsInfo, null);
    assert.strictEqual(result.extraAccounts.length, 0);
  });

  it("preserves slice order TransferHook then SupplementalTickArrays", () => {
    const tickA = address("So11111111111111111111111111111111111111112");
    const tickB = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    const hook = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    const result = buildRemainingAccounts([
      {
        accountsType: AccountsType.TransferHookA,
        accounts: [{ address: hook, role: AccountRole.READONLY }],
      },
      { accountsType: AccountsType.TransferHookB },
      {
        accountsType: AccountsType.SupplementalTickArrays,
        accounts: [
          { address: tickA, role: AccountRole.WRITABLE },
          { address: tickB, role: AccountRole.WRITABLE },
        ],
      },
    ]);
    assert.deepStrictEqual(
      result.remainingAccountsInfo?.slices.map((s) => s.accountsType),
      [AccountsType.TransferHookA, AccountsType.SupplementalTickArrays],
    );
    assert.strictEqual(result.extraAccounts.length, 3);
    assert.strictEqual(result.extraAccounts[0]?.address, hook);
  });
});
