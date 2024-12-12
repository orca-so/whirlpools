import type {
  Account,
  Address,
  GetProgramAccountsApi,
  GetProgramAccountsMemcmpFilter,
  Rpc,
} from "@solana/web3.js";
import {
  getAddressEncoder,
  getBase58Decoder,
  getU16Encoder,
} from "@solana/web3.js";
import type { Whirlpool } from "../generated/accounts/whirlpool";
import {
  WHIRLPOOL_DISCRIMINATOR,
  getWhirlpoolDecoder,
} from "../generated/accounts/whirlpool";
import { fetchDecodedProgramAccounts } from "./utils";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export type WhirlpoolFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
};

export function whirlpoolWhirlpoolConfigFilter(
  address: Address,
): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 8n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as WhirlpoolFilter;
}

export function whirlpoolTickSpacingFilter(
  tickSpacing: number,
): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 41n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(tickSpacing)),
      encoding: "base58",
    },
  } as WhirlpoolFilter;
}

export function whirlpoolFeeRateFilter(
  defaultFeeRate: number,
): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 45n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(defaultFeeRate)),
      encoding: "base58",
    },
  } as WhirlpoolFilter;
}

export function whirlpoolProtocolFeeRateFilter(
  protocolFeeRate: number,
): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 47n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(protocolFeeRate)),
      encoding: "base58",
    },
  } as WhirlpoolFilter;
}

export function whirlpoolTokenMintAFilter(
  tokenMintA: Address,
): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 101n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenMintA)),
      encoding: "base58",
    },
  } as WhirlpoolFilter;
}

export function whirlpoolTokenVaultAFilter(
  tokenVaultA: Address,
): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 133n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenVaultA)),
      encoding: "base58",
    },
  } as WhirlpoolFilter;
}

export function whirlpoolTokenMintBFilter(
  tokenMintB: Address,
): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 181n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenMintB)),
      encoding: "base58",
    },
  } as WhirlpoolFilter;
}

export function whirlpoolTokenVaultBFilter(
  tokenVaultB: Address,
): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 213n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenVaultB)),
      encoding: "base58",
    },
  } as WhirlpoolFilter;
}

export function whirlpoolRewardMint1Filter(
  rewardMint1: Address,
): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 269n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(rewardMint1)),
      encoding: "base58",
    },
  } as WhirlpoolFilter;
}

export function whirlpoolRewardVault1Filter(
  rewardVault1: Address,
): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 301n,
      bytes: getBase58Decoder().decode(
        getAddressEncoder().encode(rewardVault1),
      ),
      encoding: "base58",
    },
  } as WhirlpoolFilter;
}

export function whirlpoolRewardMint2Filter(
  rewardMint2: Address,
): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 397n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(rewardMint2)),
      encoding: "base58",
    },
  } as WhirlpoolFilter;
}

export function whirlpoolRewardVault2Filter(
  rewardVault2: Address,
): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 429n,
      bytes: getBase58Decoder().decode(
        getAddressEncoder().encode(rewardVault2),
      ),
      encoding: "base58",
    },
  } as WhirlpoolFilter;
}

export function whirlpoolRewardMint3Filter(
  rewardMint3: Address,
): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 525n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(rewardMint3)),
      encoding: "base58",
    },
  } as WhirlpoolFilter;
}

export function whirlpoolRewardVault3Filter(
  rewardVault3: Address,
): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 557n,
      bytes: getBase58Decoder().decode(
        getAddressEncoder().encode(rewardVault3),
      ),
      encoding: "base58",
    },
  } as WhirlpoolFilter;
}

/**
 * Fetches all Whirlpool accounts with the specified filters.
 *
 * This function fetches all Whirlpool accounts from the blockchain that match the specified filters.
 * It uses the Whirlpool discriminator to identify Whirlpool accounts and applies additional filters
 * provided as arguments.
 *
 * @param {Rpc<GetProgramAccountsApi>} rpc - The Solana RPC client to fetch program accounts.
 * @param {...WhirlpoolFilter[]} filters - The filters to apply when fetching Whirlpool accounts.
 * @returns {Promise<Account<Whirlpool>[]>} A promise that resolves to an array of Whirlpool accounts.
 *
 * @example
 * import { address, createSolanaRpc, devnet } from "@solana/web3.js";
 * import { fetchAllWhirlpoolWithFilter, whirlpoolWhirlpoolConfigFilter } from "@orca-so/whirlpools-client";
 *
 * const rpcDevnet = createSolanaRpc(devnet("https://api.devnet.solana.com"));
 * const WHIRLPOOLS_CONFIG_ADDRESS_DEVNET = address("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR");
 * const whirlpools = await fetchAllWhirlpoolWithFilter(rpcDevnet, whirlpoolWhirlpoolConfigFilter(WHIRLPOOLS_CONFIG_ADDRESS_DEVNET));
 */
export async function fetchAllWhirlpoolWithFilter(
  rpc: Rpc<GetProgramAccountsApi>,
  ...filters: WhirlpoolFilter[]
): Promise<Account<Whirlpool>[]> {
  const discriminator = getBase58Decoder().decode(WHIRLPOOL_DISCRIMINATOR);
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
    getWhirlpoolDecoder(),
  );
}
