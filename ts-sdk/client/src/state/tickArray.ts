import type {
  Account,
  Address,
  Codec,
  Decoder,
  EncodedAccount,
  Encoder,
  FetchAccountConfig,
  FetchAccountsConfig,
  MaybeAccount,
  MaybeEncodedAccount,
} from "@solana/kit";
import {
  assertAccountExists,
  assertAccountsExist,
  combineCodec,
  fetchEncodedAccount,
  fetchEncodedAccounts,
  getU64Decoder,
} from "@solana/kit";
import type { DynamicTickArray } from "../generated/accounts/dynamicTickArray";
import {
  decodeDynamicTickArray,
  DYNAMIC_TICK_ARRAY_DISCRIMINATOR,
} from "../generated/accounts/dynamicTickArray";
import type {
  FixedTickArray,
  FixedTickArrayArgs,
} from "../generated/accounts/fixedTickArray";
import {
  decodeFixedTickArray,
  FIXED_TICK_ARRAY_DISCRIMINATOR,
  getFixedTickArrayDecoder,
  getFixedTickArrayDiscriminatorBytes,
  getFixedTickArrayEncoder,
  getFixedTickArraySize,
} from "../generated/accounts/fixedTickArray";
import type { Tick } from "../generated/types/tick";
import type { DynamicTick } from "../generated/types/dynamicTick";

const FIXED_TICK_ARRAY_DISCRIMINATOR_NUMBER = getU64Decoder().decode(
  FIXED_TICK_ARRAY_DISCRIMINATOR,
);
const DYNAMIC_TICK_ARRAY_DISCRIMINATOR_NUMBER = getU64Decoder().decode(
  DYNAMIC_TICK_ARRAY_DISCRIMINATOR,
);

export type TickArray = FixedTickArray & {
  __kind: "Fixed" | "Dynamic";
};

export function consolidateTick(tick: Tick | DynamicTick): Tick {
  if ("initialized" in tick) {
    return tick;
  }
  switch (tick.__kind) {
    case "Uninitialized":
      return {
        initialized: false,
        liquidityGross: 0n,
        liquidityNet: 0n,
        feeGrowthOutsideA: 0n,
        feeGrowthOutsideB: 0n,
        rewardGrowthsOutside: [0n, 0n, 0n],
      };
    case "Initialized":
      return {
        initialized: true,
        liquidityGross: tick.fields[0].liquidityGross,
        liquidityNet: tick.fields[0].liquidityNet,
        feeGrowthOutsideA: tick.fields[0].feeGrowthOutsideA,
        feeGrowthOutsideB: tick.fields[0].feeGrowthOutsideB,
        rewardGrowthsOutside: tick.fields[0].rewardGrowthsOutside,
      };
  }
}

export function consolidateTickArray<TAddress extends string = string>(
  tickArrayAccount: Account<FixedTickArray | DynamicTickArray, TAddress>,
): Account<TickArray, TAddress>;
export function consolidateTickArray<TAddress extends string = string>(
  tickArrayAccount: MaybeAccount<FixedTickArray | DynamicTickArray, TAddress>,
): MaybeAccount<TickArray, TAddress>;
export function consolidateTickArray<TAddress extends string = string>(
  tickArrayAccount:
    | Account<FixedTickArray | DynamicTickArray, TAddress>
    | MaybeAccount<FixedTickArray | DynamicTickArray, TAddress>,
): Account<TickArray, TAddress> | MaybeAccount<TickArray, TAddress> {
  if ("exists" in tickArrayAccount && !tickArrayAccount.exists) {
    return tickArrayAccount;
  }

  const discriminator = getU64Decoder().decode(
    tickArrayAccount.data.discriminator.subarray(0, 8),
  );
  const __kind =
    discriminator === FIXED_TICK_ARRAY_DISCRIMINATOR_NUMBER
      ? "Fixed"
      : "Dynamic";

  return {
    ...tickArrayAccount,
    data: {
      __kind,
      ...tickArrayAccount.data,
      ticks: tickArrayAccount.data.ticks.map(consolidateTick),
    },
  };
}

export function decodeTickArray<TAddress extends string = string>(
  encodedAccount: EncodedAccount<TAddress>,
): Account<TickArray, TAddress>;
export function decodeTickArray<TAddress extends string = string>(
  encodedAccount: MaybeEncodedAccount<TAddress>,
): MaybeAccount<TickArray, TAddress>;
export function decodeTickArray<TAddress extends string = string>(
  encodedAccount: EncodedAccount<TAddress> | MaybeEncodedAccount<TAddress>,
): Account<TickArray, TAddress> | MaybeAccount<TickArray, TAddress> {
  if ("exists" in encodedAccount && !encodedAccount.exists) {
    return encodedAccount;
  }
  const discriminator = getU64Decoder().decode(
    encodedAccount.data.subarray(0, 8),
  );
  switch (discriminator) {
    case FIXED_TICK_ARRAY_DISCRIMINATOR_NUMBER:
      return consolidateTickArray(decodeFixedTickArray(encodedAccount));
    case DYNAMIC_TICK_ARRAY_DISCRIMINATOR_NUMBER:
      return consolidateTickArray(decodeDynamicTickArray(encodedAccount));
    default:
      throw new Error(`Unknown discriminator: ${discriminator}`);
  }
}

export async function fetchTickArray<TAddress extends string = string>(
  rpc: Parameters<typeof fetchEncodedAccount>[0],
  address: Address<TAddress>,
  config?: FetchAccountConfig,
): Promise<Account<TickArray, TAddress>> {
  const maybeAccount = await fetchMaybeTickArray(rpc, address, config);
  assertAccountExists(maybeAccount);
  return maybeAccount;
}

export async function fetchMaybeTickArray<TAddress extends string = string>(
  rpc: Parameters<typeof fetchEncodedAccount>[0],
  address: Address<TAddress>,
  config?: FetchAccountConfig,
): Promise<MaybeAccount<TickArray, TAddress>> {
  const maybeAccount = await fetchEncodedAccount(rpc, address, config);
  return decodeTickArray(maybeAccount);
}

export async function fetchAllTickArray(
  rpc: Parameters<typeof fetchEncodedAccounts>[0],
  addresses: Array<Address>,
  config?: FetchAccountsConfig,
): Promise<Account<TickArray>[]> {
  const maybeAccounts = await fetchAllMaybeTickArray(rpc, addresses, config);
  assertAccountsExist(maybeAccounts);
  return maybeAccounts;
}

export async function fetchAllMaybeTickArray(
  rpc: Parameters<typeof fetchEncodedAccounts>[0],
  addresses: Array<Address>,
  config?: FetchAccountsConfig,
): Promise<MaybeAccount<TickArray>[]> {
  const maybeAccounts = await fetchEncodedAccounts(rpc, addresses, config);
  return maybeAccounts.map((maybeAccount) => decodeTickArray(maybeAccount));
}

// Backwards compatibility

/**
 * @deprecated use `FixedTickArrayArgs` or `DynamicTickArrayArgs` instead
 */
export type TickArrayArgs = FixedTickArrayArgs;

/**
 * @deprecated use `getFixedTickArraySize` or `getDynamicTickArray(Min|Max)Size` instead
 */
export function getTickArraySize(): number {
  return getFixedTickArraySize();
}

/**
 * @deprecated use `FIXED_TICK_ARRAY_DISCRIMINATOR` or `DYNAMIC_TICK_ARRAY_DISCRIMINATOR` instead
 */
export const TICK_ARRAY_DISCRIMINATOR = FIXED_TICK_ARRAY_DISCRIMINATOR;

/**
 * @deprecated use `getFixedTickArrayDiscriminatorBytes` or `getDynamicTickArrayDiscriminatorBytes` instead
 */
export function getTickArrayDiscriminatorBytes() {
  return getFixedTickArrayDiscriminatorBytes();
}

/**
 * @deprecated use `getFixedTickArrayEncoder` or `getDynamicTickArrayEncoder` instead
 */
export function getTickArrayEncoder(): Encoder<FixedTickArrayArgs> {
  return getFixedTickArrayEncoder();
}

/**
 * @deprecated use `getFixedTickArrayDecoder` or `getDynamicTickArrayDecoder` instead
 */
export function getTickArrayDecoder(): Decoder<FixedTickArray> {
  return getFixedTickArrayDecoder();
}

/**
 * @deprecated use `getFixedTickArrayCodec` or `getDynamicTickArrayCodec` instead
 */
export function getTickArrayCodec(): Codec<FixedTickArrayArgs, FixedTickArray> {
  return combineCodec(getFixedTickArrayEncoder(), getFixedTickArrayDecoder());
}
