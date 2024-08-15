import { GetProgramAccountsMemcmpFilter, getBase58Decoder, getAddressEncoder, getU16Encoder, Address, Account, GetProgramAccountsApi, Rpc } from "@solana/web3.js";
import { WhirlpoolsConfig, WHIRLPOOLS_CONFIG_DISCRIMINATOR, getWhirlpoolsConfigDecoder } from "../generated/accounts/whirlpoolsConfig";
import { fetchDecodedProgramAccounts } from "./utils";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export type WhirlpoolsConfigFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
}

export function whirlpoolsConfigFeeAuthorityFilter(feeAuthority: Address): WhirlpoolsConfigFilter {
  return {
    memcmp: {
      offset: 8n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(feeAuthority)),
      encoding: "base58"
    }
  } as WhirlpoolsConfigFilter;
}

export function whirlpoolsConfigCollectProtocolFeesAuthorityFilter(collectProtocolFeesAuthority: Address): WhirlpoolsConfigFilter {
  return {
    memcmp: {
      offset: 40n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(collectProtocolFeesAuthority)),
      encoding: "base58"
    }
  } as WhirlpoolsConfigFilter;
}

export function whirlpoolsConfigRewardEmissionsSuperAuthorityFilter(rewardEmissionsSuperAuthority: Address): WhirlpoolsConfigFilter {
  return {
    memcmp: {
      offset: 72n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(rewardEmissionsSuperAuthority)),
      encoding: "base58"
    }
  } as WhirlpoolsConfigFilter;
}

export function whirlpoolsConfigDefaultProtocolFeeRateFilter(defaultFeeRate: number): WhirlpoolsConfigFilter {
  return {
    memcmp: {
      offset: 104n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(defaultFeeRate)),
      encoding: "base58"
    }
  } as WhirlpoolsConfigFilter;
}

export async function fetchAllWhirlpoolsConfigWithFilter(rpc: Rpc<GetProgramAccountsApi>, ...filters: WhirlpoolsConfigFilter[]): Promise<Account<WhirlpoolsConfig>[]> {
  const discriminator = getBase58Decoder().decode(WHIRLPOOLS_CONFIG_DISCRIMINATOR);
  const discriminatorFilter: GetProgramAccountsMemcmpFilter = {
    memcmp: {
      offset: 0n,
      bytes: discriminator,
      encoding: "base58"
    }
  };
  return fetchDecodedProgramAccounts(
    rpc,
    WHIRLPOOL_PROGRAM_ADDRESS,
    [discriminatorFilter, ...filters],
    getWhirlpoolsConfigDecoder()
  );
}
