import type {
  Account,
  Address,
  GetProgramAccountsApi,
  GetProgramAccountsMemcmpFilter,
  Rpc,
} from "@solana/kit";
import { getAddressEncoder, getBase58Decoder } from "@solana/kit";
import { getLockConfigDecoder, LOCK_CONFIG_DISCRIMINATOR } from "../generated";
import type { LockConfig } from "../generated/accounts/lockConfig";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";
import { fetchDecodedProgramAccounts } from "./utils";

type LockConfigFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
};

export function lockConfigPositionFilter(address: Address): LockConfigFilter {
  return {
    memcmp: {
      offset: 8n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as LockConfigFilter;
}

export function lockConfigPositionOwnerFilter(
  address: Address,
): LockConfigFilter {
  return {
    memcmp: {
      offset: 40n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as LockConfigFilter;
}

export function lockConfigWhirlpoolFilter(address: Address): LockConfigFilter {
  return {
    memcmp: {
      offset: 72n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as LockConfigFilter;
}

export async function fetchAllLockConfigWithFilter(
  rpc: Rpc<GetProgramAccountsApi>,
  ...filters: LockConfigFilter[]
): Promise<Account<LockConfig>[]> {
  const discriminator = getBase58Decoder().decode(LOCK_CONFIG_DISCRIMINATOR);
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
    getLockConfigDecoder(),
  );
}
