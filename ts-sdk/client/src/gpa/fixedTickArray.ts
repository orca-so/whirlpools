import type {
  Account,
  Address,
  Base58EncodedBytes,
  GetProgramAccountsApi,
  GetProgramAccountsMemcmpFilter,
  Rpc,
} from "@solana/kit";
import {
  getAddressEncoder,
  getBase58Decoder,
  getI32Encoder,
} from "@solana/kit";
import type { FixedTickArray } from "../generated/accounts/fixedTickArray";
import {
  FIXED_TICK_ARRAY_DISCRIMINATOR,
  getFixedTickArrayDecoder,
} from "../generated/accounts/fixedTickArray";
import { fetchDecodedProgramAccounts } from "./utils";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export type FixedTickArrayFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
};

export function fixedTickArrayStartTickIndexFilter(
  startTickIndex: number,
): FixedTickArrayFilter {
  return {
    memcmp: {
      offset: 8n,
      bytes: getBase58Decoder().decode(getI32Encoder().encode(startTickIndex)),
      encoding: "base58",
    },
  } as FixedTickArrayFilter;
}

export function fixedTickArrayWhirlpoolFilter(
  address: Address,
): FixedTickArrayFilter {
  return {
    memcmp: {
      offset: 9956n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as FixedTickArrayFilter;
}

export async function fetchAllFixedTickArrayWithFilter(
  rpc: Rpc<GetProgramAccountsApi>,
  ...filters: FixedTickArrayFilter[]
): Promise<Account<FixedTickArray>[]> {
  const discriminator = getBase58Decoder().decode(
    FIXED_TICK_ARRAY_DISCRIMINATOR,
  ) as Base58EncodedBytes;
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
    getFixedTickArrayDecoder(),
  );
}
