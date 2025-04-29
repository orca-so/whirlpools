import type {
  Account,
  Address,
  GetProgramAccountsApi,
  GetProgramAccountsMemcmpFilter,
  Rpc,
} from "@solana/kit";
import {
  getAddressEncoder,
  getBase58Decoder,
  getU16Encoder,
  getU32Encoder,
} from "@solana/kit";
import { fetchDecodedProgramAccounts } from "./utils";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";
import type {
  AdaptiveFeeTier} from "../generated";
import {
  ADAPTIVE_FEE_TIER_DISCRIMINATOR,
  getAdaptiveFeeTierDecoder,
} from "../generated";

type AdaptiveFeeTierFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
};

export function adaptiveFeeTierWhirlpoolsConfigFilter(
  address: Address,
): AdaptiveFeeTierFilter {
  return {
    memcmp: {
      offset: 8n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as AdaptiveFeeTierFilter;
}

export function adaptiveFeeTierFeeTierIndexFilter(
  feeTierIndex: number,
): AdaptiveFeeTierFilter {
  return {
    memcmp: {
      offset: 40n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(feeTierIndex)),
      encoding: "base58",
    },
  } as AdaptiveFeeTierFilter;
}

export function adaptiveFeeTierTickSpacingFilter(
  tickSpacing: number,
): AdaptiveFeeTierFilter {
  return {
    memcmp: {
      offset: 42n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(tickSpacing)),
      encoding: "base58",
    },
  } as AdaptiveFeeTierFilter;
}

export function adaptiveFeeTierInitializePoolAuthorityFilter(
  address: Address,
): AdaptiveFeeTierFilter {
  return {
    memcmp: {
      offset: 44n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as AdaptiveFeeTierFilter;
}

export function adaptiveFeeTierDelegatedFeeAuthorityFilter(
  address: Address,
): AdaptiveFeeTierFilter {
  return {
    memcmp: {
      offset: 76n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as AdaptiveFeeTierFilter;
}

export function adaptiveFeeTierDefaultBaseFeeRateFilter(
  feeRate: number,
): AdaptiveFeeTierFilter {
  return {
    memcmp: {
      offset: 108n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(feeRate)),
      encoding: "base58",
    },
  } as AdaptiveFeeTierFilter;
}

export function adaptiveFeeTierFilterPeriodFilter(
  filterPeriod: number,
): AdaptiveFeeTierFilter {
  return {
    memcmp: {
      offset: 110n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(filterPeriod)),
      encoding: "base58",
    },
  } as AdaptiveFeeTierFilter;
}

export function adaptiveFeeTierDecayPeriodFilter(
  decayPeriod: number,
): AdaptiveFeeTierFilter {
  return {
    memcmp: {
      offset: 112n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(decayPeriod)),
      encoding: "base58",
    },
  } as AdaptiveFeeTierFilter;
}

export function adaptiveFeeTierReductionFactorFilter(
  reductionFactor: number,
): AdaptiveFeeTierFilter {
  return {
    memcmp: {
      offset: 114n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(reductionFactor)),
      encoding: "base58",
    },
  } as AdaptiveFeeTierFilter;
}

export function adaptiveFeeTierAdaptiveFeeControlFactorFilter(
  adaptiveFeeControlFactor: number,
): AdaptiveFeeTierFilter {
  return {
    memcmp: {
      offset: 116n,
      bytes: getBase58Decoder().decode(
        getU32Encoder().encode(adaptiveFeeControlFactor),
      ),
      encoding: "base58",
    },
  } as AdaptiveFeeTierFilter;
}

export function adaptiveFeeTierMaxVolatilityFilter(
  maxVolatility: number,
): AdaptiveFeeTierFilter {
  return {
    memcmp: {
      offset: 120n,
      bytes: getBase58Decoder().decode(getU32Encoder().encode(maxVolatility)),
      encoding: "base58",
    },
  } as AdaptiveFeeTierFilter;
}

export function adaptiveFeeTierTickGroupSizeFilter(
  tickGroupSize: number,
): AdaptiveFeeTierFilter {
  return {
    memcmp: {
      offset: 124n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(tickGroupSize)),
      encoding: "base58",
    },
  } as AdaptiveFeeTierFilter;
}

export function adaptiveFeeTierMajorSwapThresholdTicksFilter(
  majorSwapThresholdTicks: number,
): AdaptiveFeeTierFilter {
  return {
    memcmp: {
      offset: 126n,
      bytes: getBase58Decoder().decode(
        getU16Encoder().encode(majorSwapThresholdTicks),
      ),
      encoding: "base58",
    },
  } as AdaptiveFeeTierFilter;
}

export async function fetchAllAdaptiveFeeTierWithFilter(
  rpc: Rpc<GetProgramAccountsApi>,
  ...filters: AdaptiveFeeTierFilter[]
): Promise<Account<AdaptiveFeeTier>[]> {
  const discriminator = getBase58Decoder().decode(
    ADAPTIVE_FEE_TIER_DISCRIMINATOR,
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
    getAdaptiveFeeTierDecoder(),
  );
}
