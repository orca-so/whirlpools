import type {
  Account,
  Address,
  GetProgramAccountsApi,
  GetProgramAccountsMemcmpFilter,
  Rpc,
} from "@solana/web3.js";
import { getAddressEncoder, getBase58Decoder } from "@solana/web3.js";
import type { PositionBundle } from "../generated/accounts/positionBundle";
import {
  POSITION_BUNDLE_DISCRIMINATOR,
  getPositionBundleDecoder,
} from "../generated/accounts/positionBundle";
import { fetchDecodedProgramAccounts } from "./utils";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export type PositionBundleFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
};

export function positionBundleMintFilter(
  address: Address,
): PositionBundleFilter {
  return {
    memcmp: {
      offset: 8n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as PositionBundleFilter;
}

export async function fetchAllPositionBundleWithFilter(
  rpc: Rpc<GetProgramAccountsApi>,
  ...filters: PositionBundleFilter[]
): Promise<Account<PositionBundle>[]> {
  const discriminator = getBase58Decoder().decode(
    POSITION_BUNDLE_DISCRIMINATOR,
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
    getPositionBundleDecoder(),
  );
}
