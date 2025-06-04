import type {
  Account,
  Address,
  GetProgramAccountsApi,
  GetProgramAccountsMemcmpFilter,
  Rpc,
} from "@solana/kit";
import {
  getAddressEncoder,
  getBase58Decoder,
  getI32Encoder,
} from "@solana/kit";
import type { DynamicTickArray } from "../generated/accounts/dynamicTickArray";
import {
  DYNAMIC_TICK_ARRAY_DISCRIMINATOR,
  getDynamicTickArrayDecoder,
} from "../generated/accounts/dynamicTickArray";
import { fetchDecodedProgramAccounts } from "./utils";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export type DynamicTickArrayFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
};

export function dynamicTickArrayStartTickIndexFilter(
  startTickIndex: number,
): DynamicTickArrayFilter {
  return {
    memcmp: {
      offset: 8n,
      bytes: getBase58Decoder().decode(getI32Encoder().encode(startTickIndex)),
      encoding: "base58",
    },
  } as DynamicTickArrayFilter;
}

export function dynamicTickArrayWhirlpoolFilter(
  address: Address,
): DynamicTickArrayFilter {
  return {
    memcmp: {
      offset: 12n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as DynamicTickArrayFilter;
}

export async function fetchAllDynamicTickArrayWithFilter(
  rpc: Rpc<GetProgramAccountsApi>,
  ...filters: DynamicTickArrayFilter[]
): Promise<Account<DynamicTickArray>[]> {
  const discriminator = getBase58Decoder().decode(
    DYNAMIC_TICK_ARRAY_DISCRIMINATOR,
  );
  const discriminatorFilter: GetProgramAccountsMemcmpFilter = {
    memcmp: {
      offset: 0n,
      bytes: discriminator,
      encoding: "base58",
    },
  };
  return fetchDecodedProgramAccounts(
    rpc,
    WHIRLPOOL_PROGRAM_ADDRESS,
    [discriminatorFilter, ...filters],
    getDynamicTickArrayDecoder(),
  );
}
