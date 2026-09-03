import type { AccountsType } from "@orca-so/whirlpools-client";
import type { Address } from "@solana/kit";
import type { AccountRole } from "@solana/kit";

export type RemainingAccount = {
  address: Address;
  role: AccountRole;
};

export type RemainingAccountsSliceInput = {
  accountsType: AccountsType;
  accounts?: RemainingAccount[];
};

/**
 * Builds remaining-account slices for V2 instructions.
 * Empty slices are omitted (same as the legacy SDK RemainingAccountsBuilder).
 */
export function buildRemainingAccounts(slices: RemainingAccountsSliceInput[]): {
  remainingAccountsInfo: {
    slices: { accountsType: AccountsType; length: number }[];
  } | null;
  extraAccounts: RemainingAccount[];
} {
  const infoSlices: { accountsType: AccountsType; length: number }[] = [];
  const extraAccounts: RemainingAccount[] = [];

  for (const slice of slices) {
    if (!slice.accounts || slice.accounts.length === 0) {
      continue;
    }
    infoSlices.push({
      accountsType: slice.accountsType,
      length: slice.accounts.length,
    });
    extraAccounts.push(...slice.accounts);
  }

  return {
    remainingAccountsInfo:
      infoSlices.length === 0 ? null : { slices: infoSlices },
    extraAccounts,
  };
}

export function appendExtraAccounts(
  instruction: { accounts?: RemainingAccount[] | readonly RemainingAccount[] },
  extraAccounts: RemainingAccount[],
): void {
  if (extraAccounts.length === 0) {
    return;
  }
  const accounts = instruction.accounts;
  if (!accounts) {
    throw new Error("instruction has no accounts");
  }
  (accounts as RemainingAccount[]).push(...extraAccounts);
}
