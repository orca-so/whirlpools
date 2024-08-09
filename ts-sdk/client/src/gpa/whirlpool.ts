import { Account, Address, getAddressEncoder, getBase58Decoder, GetProgramAccountsApi, GetProgramAccountsMemcmpFilter, getU16Encoder, Rpc } from "@solana/web3.js";
import { Whirlpool, WHIRLPOOL_DISCRIMINATOR, getWhirlpoolDecoder } from "../generated/accounts/whirlpool";
import { fetchDecodedProgramAccount } from "./utils";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export type WhirlpoolFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
}

export function whirlpoolWhirlpoolConfigFilter(address: Address): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 8n, bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)), encoding: "base58"
    }
  } as WhirlpoolFilter;
}

export function whirlpoolTickSpacingFilter(tickSpacing: number): WhirlpoolFilter {
    return {
      memcmp: {
        offset: 41n,
        bytes: getBase58Decoder().decode(getU16Encoder().encode(tickSpacing)),
        encoding: "base58"
      }
    } as WhirlpoolFilter;
}


export function whirlpoolFeeRateFilter(defaultFeeRate: number): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 45n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(defaultFeeRate)),
      encoding: "base58"
    }
  } as WhirlpoolFilter;
}

export function whirlpoolProtocolFeeRateFilter(protocolFeeRate: number): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 47n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(protocolFeeRate)),
      encoding: "base58"
    }
  } as WhirlpoolFilter;
}

export function whirlpoolTokenMintAFilter(tokenMintA: Address): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 101n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenMintA)),
      encoding: "base58"
    }
  } as WhirlpoolFilter;
}

export function whirlpoolTokenVaultAFilter(tokenVaultA: Address): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 133n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenVaultA)),
      encoding: "base58"
    }
  } as WhirlpoolFilter;
}

export function whirlpoolTokenMintBFilter(tokenMintB: Address): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 181n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenMintB)),
      encoding: "base58"
    }
  } as WhirlpoolFilter;
}

export function whirlpoolTokenVaultBFilter(tokenVaultB: Address): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 213n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenVaultB)),
      encoding: "base58"
    }
  } as WhirlpoolFilter;
}

export function whirlpoolRewardMint1Filter(rewardMint1: Address): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 269n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(rewardMint1)),
      encoding: "base58"
    }
  } as WhirlpoolFilter;
}

export function whirlpoolRewardVault1Filter(rewardVault1: Address): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 301n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(rewardVault1)),
      encoding: "base58"
    }
  } as WhirlpoolFilter;
}

export function whirlpoolRewardMint2Filter(rewardMint2: Address): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 397n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(rewardMint2)),
      encoding: "base58"
    }
  } as WhirlpoolFilter;
}

export function whirlpoolRewardVault2Filter(rewardVault2: Address): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 429n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(rewardVault2)),
      encoding: "base58"
    }
  } as WhirlpoolFilter;
}

export function whirlpoolRewardMint3Filter(rewardMint3: Address): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 525n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(rewardMint3)),
      encoding: "base58"
    }
  } as WhirlpoolFilter;
}

export function whirlpoolRewardVault3Filter(rewardVault3: Address): WhirlpoolFilter {
  return {
    memcmp: {
      offset: 557n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(rewardVault3)),
      encoding: "base58"
    }
  } as WhirlpoolFilter;
}

export async function fetchAllWhirlpoolWithFilter(rpc: Rpc<GetProgramAccountsApi>, ...filters: WhirlpoolFilter[]): Promise<Account<Whirlpool>[]> {
  const discriminator = getBase58Decoder().decode(WHIRLPOOL_DISCRIMINATOR);
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
    getWhirlpoolDecoder()
  );
}
