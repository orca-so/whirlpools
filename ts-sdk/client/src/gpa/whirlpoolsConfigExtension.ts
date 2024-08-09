import { GetProgramAccountsMemcmpFilter, getBase58Decoder, getAddressEncoder, Address, Account, GetProgramAccountsApi, Rpc } from "@solana/web3.js";
import { WhirlpoolsConfigExtension, WHIRLPOOLS_CONFIG_EXTENSION_DISCRIMINATOR, getWhirlpoolsConfigExtensionDecoder } from "../generated/accounts/whirlpoolsConfigExtension";
import { fetchDecodedProgramAccount } from "./utils";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export type WhirlpoolsConfigExtensionFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
}

export function whirlpoolsConfigExtensionWhirlpoolsConfigFilter(address: Address): WhirlpoolsConfigExtensionFilter {
  return {
    memcmp: {
      offset: 8n, bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)), encoding: "base58"
    }
  } as WhirlpoolsConfigExtensionFilter;
}

export function whirlpoolsConfigExtensionConfigExtensionAuthorityFilter(configExtensionAuthority: Address): WhirlpoolsConfigExtensionFilter {
  return {
    memcmp: {
      offset: 40n, bytes: getBase58Decoder().decode(getAddressEncoder().encode(configExtensionAuthority)), encoding: "base58"
    }
  } as WhirlpoolsConfigExtensionFilter;
}

export function whirlpoolsConfigExtensionConfigTokenBadgeAuthorityFilter(configTokenBadgeAuthority: Address): WhirlpoolsConfigExtensionFilter {
  return {
    memcmp: {
      offset: 72n, bytes: getBase58Decoder().decode(getAddressEncoder().encode(configTokenBadgeAuthority)), encoding: "base58"
    }
  } as WhirlpoolsConfigExtensionFilter;
}

export async function fetchAllWhirlpoolsConfigExtensionWithFilter(rpc: Rpc<GetProgramAccountsApi>, ...filters: WhirlpoolsConfigExtensionFilter[]): Promise<Account<WhirlpoolsConfigExtension>[]> {
  const discriminator = getBase58Decoder().decode(WHIRLPOOLS_CONFIG_EXTENSION_DISCRIMINATOR);
  const discriminatorFilter: GetProgramAccountsMemcmpFilter = {
    memcmp: {
      offset: 0n,
      bytes: discriminator,
      encoding: "base58"
    }
  };
  return fetchDecodedProgramAccount(
    rpc,
    WHIRLPOOL_PROGRAM_ADDRESS,
    [discriminatorFilter, ...filters],
    getWhirlpoolsConfigExtensionDecoder()
  );
}
