import type {
  Account,
  Address,
  Base58EncodedBytes,
  GetProgramAccountsApi,
  GetProgramAccountsMemcmpFilter,
  Rpc,
} from "@solana/kit";
import { getAddressEncoder, getBase58Decoder } from "@solana/kit";
import type { PositionBundle } from "../generated/accounts/positionBundle";
import {
  POSITION_BUNDLE_DISCRIMINATOR,
  getPositionBundleDecoder,
} from "../generated/accounts/positionBundle";
import { fetchDecodedProgramAccounts } from "./utils";

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
  filters: PositionBundleFilter[],
  programAddress?: Address,
): Promise<Account<PositionBundle>[]> {
  const discriminator = getBase58Decoder().decode(
    POSITION_BUNDLE_DISCRIMINATOR,
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
    [discriminatorFilter, ...filters],
    getPositionBundleDecoder(),
    programAddress,
  );
}
