import type { Account, Address, GetProgramAccountsApi, Rpc } from "@solana/kit";
import type { DynamicTickArrayFilter } from "./dynamicTickArray";
import {
  dynamicTickArrayStartTickIndexFilter,
  dynamicTickArrayWhirlpoolFilter,
  fetchAllDynamicTickArrayWithFilter,
} from "./dynamicTickArray";
import type { TickArray } from "../state/tickArray";
import { consolidateTickArray } from "../state/tickArray";
import type { FixedTickArrayFilter } from "./fixedTickArray";
import {
  fetchAllFixedTickArrayWithFilter,
  fixedTickArrayStartTickIndexFilter,
  fixedTickArrayWhirlpoolFilter,
} from "./fixedTickArray";

export type TickArrayFilter = {
  fixed: FixedTickArrayFilter;
  dynamic: DynamicTickArrayFilter;
  readonly __kind: unique symbol;
};

export function tickArrayStartTickIndexFilter(
  startTickIndex: number,
): TickArrayFilter {
  return {
    fixed: fixedTickArrayStartTickIndexFilter(startTickIndex),
    dynamic: dynamicTickArrayStartTickIndexFilter(startTickIndex),
  } as TickArrayFilter;
}

export function tickArrayWhirlpoolFilter(address: Address): TickArrayFilter {
  return {
    fixed: fixedTickArrayWhirlpoolFilter(address),
    dynamic: dynamicTickArrayWhirlpoolFilter(address),
  } as TickArrayFilter;
}

export async function fetchAllTickArrayWithFilter(
  rpc: Rpc<GetProgramAccountsApi>,
  ...filters: TickArrayFilter[]
): Promise<Account<TickArray>[]> {
  const fixedAccounts = await fetchAllFixedTickArrayWithFilter(
    rpc,
    ...filters.map((filter) => filter.fixed),
  );
  const dynamicAccounts = await fetchAllDynamicTickArrayWithFilter(
    rpc,
    ...filters.map((filter) => filter.dynamic),
  );

  const tickArrays: Account<TickArray>[] = [];
  for (const account of fixedAccounts) {
    tickArrays.push(consolidateTickArray(account));
  }
  for (const account of dynamicAccounts) {
    tickArrays.push(consolidateTickArray(account));
  }

  return tickArrays;
}
