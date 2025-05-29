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
  getU64Encoder,
} from "@solana/kit";
import { fetchDecodedProgramAccounts } from "./utils";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";
import type { Oracle } from "../generated";
import { getOracleDecoder, ORACLE_DISCRIMINATOR } from "../generated";

type OracleFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
};

export function oracleWhirlpoolFilter(address: Address): OracleFilter {
  return {
    memcmp: {
      offset: 8n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as OracleFilter;
}

export function oracleTradeEnableTimestampFilter(
  timestamp: number | bigint,
): OracleFilter {
  return {
    memcmp: {
      offset: 40n,
      bytes: getBase58Decoder().decode(getU64Encoder().encode(timestamp)),
      encoding: "base58",
    },
  } as OracleFilter;
}

export function oracleFilterPeriodFilter(filterPeriod: number): OracleFilter {
  return {
    memcmp: {
      offset: 48n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(filterPeriod)),
      encoding: "base58",
    },
  } as OracleFilter;
}

export function oracleDecayPeriodFilter(decayPeriod: number): OracleFilter {
  return {
    memcmp: {
      offset: 50n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(decayPeriod)),
      encoding: "base58",
    },
  } as OracleFilter;
}

export function oracleReductionFactorFilter(
  reductionFactor: number,
): OracleFilter {
  return {
    memcmp: {
      offset: 52n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(reductionFactor)),
      encoding: "base58",
    },
  } as OracleFilter;
}

export function oracleAdaptiveFeeControlFactorFilter(
  adaptiveFeeControlFactor: number,
): OracleFilter {
  return {
    memcmp: {
      offset: 54n,
      bytes: getBase58Decoder().decode(
        getU32Encoder().encode(adaptiveFeeControlFactor),
      ),
      encoding: "base58",
    },
  } as OracleFilter;
}

export function oracleMaxVolatilityFilter(maxVolatility: number): OracleFilter {
  return {
    memcmp: {
      offset: 58n,
      bytes: getBase58Decoder().decode(getU32Encoder().encode(maxVolatility)),
      encoding: "base58",
    },
  } as OracleFilter;
}

export function oracleTickGroupSizeFilter(tickGroupSize: number): OracleFilter {
  return {
    memcmp: {
      offset: 62n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(tickGroupSize)),
      encoding: "base58",
    },
  } as OracleFilter;
}

export function oracleMajorSwapThresholdTicksFilter(
  majorSwapThresholdTicks: number,
): OracleFilter {
  return {
    memcmp: {
      offset: 64n,
      bytes: getBase58Decoder().decode(
        getU16Encoder().encode(majorSwapThresholdTicks),
      ),
      encoding: "base58",
    },
  } as OracleFilter;
}

export async function fetchAllOracleWithFilter(
  rpc: Rpc<GetProgramAccountsApi>,
  ...filters: OracleFilter[]
): Promise<Account<Oracle>[]> {
  const discriminator = getBase58Decoder().decode(ORACLE_DISCRIMINATOR);
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
    getOracleDecoder(),
  );
}
