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
  getU16Encoder,
} from "@solana/kit";
import type { FeeTier } from "../generated/accounts/feeTier";
import {
  FEE_TIER_DISCRIMINATOR,
  getFeeTierDecoder,
} from "../generated/accounts/feeTier";
import { fetchDecodedProgramAccounts } from "./utils";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

type FeeTierFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
};

export function feeTierWhirlpoolsConfigFilter(address: Address): FeeTierFilter {
  return {
    memcmp: {
      offset: 8n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as FeeTierFilter;
}

export function feeTierTickSpacingFilter(tickSpacing: number): FeeTierFilter {
  return {
    memcmp: {
      offset: 40n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(tickSpacing)),
      encoding: "base58",
    },
  } as FeeTierFilter;
}

export function feeTierFeeRateFilter(defaultFeeRate: number): FeeTierFilter {
  return {
    memcmp: {
      offset: 42n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(defaultFeeRate)),
      encoding: "base58",
    },
  } as FeeTierFilter;
}

export async function fetchAllFeeTierWithFilter(
  rpc: Rpc<GetProgramAccountsApi>,
  ...filters: FeeTierFilter[]
): Promise<Account<FeeTier>[]> {
  const discriminator = getBase58Decoder().decode(FEE_TIER_DISCRIMINATOR) as Base58EncodedBytes;
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
    getFeeTierDecoder(),
  );
}
