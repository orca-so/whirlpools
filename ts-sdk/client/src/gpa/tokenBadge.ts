import type {
  GetProgramAccountsMemcmpFilter,
  Address,
  Account,
  GetProgramAccountsApi,
  Rpc,
  Base58EncodedBytes,
} from "@solana/kit";
import { getBase58Decoder, getAddressEncoder } from "@solana/kit";
import type { TokenBadge } from "../generated/accounts/tokenBadge";
import {
  TOKEN_BADGE_DISCRIMINATOR,
  getTokenBadgeDecoder,
} from "../generated/accounts/tokenBadge";
import { fetchDecodedProgramAccounts } from "./utils";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export type TokenBadgeFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
};

export function tokenBadgeWhirlpoolsConfigFilter(
  address: Address,
): TokenBadgeFilter {
  return {
    memcmp: {
      offset: 8n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as TokenBadgeFilter;
}

export function tokenBadgeTokenMintFilter(address: Address): TokenBadgeFilter {
  return {
    memcmp: {
      offset: 40n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as TokenBadgeFilter;
}

export async function fetchAllTokenBadgeWithFilter(
  rpc: Rpc<GetProgramAccountsApi>,
  ...filters: TokenBadgeFilter[]
): Promise<Account<TokenBadge>[]> {
  const discriminator = getBase58Decoder().decode(TOKEN_BADGE_DISCRIMINATOR) as Base58EncodedBytes;
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
    getTokenBadgeDecoder(),
  );
}
