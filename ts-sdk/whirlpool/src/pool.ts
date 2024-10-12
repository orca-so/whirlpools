import type { Whirlpool } from "@orca-so/whirlpools-client";
import {
  getFeeTierAddress,
  getWhirlpoolAddress,
  fetchWhirlpoolsConfig,
  fetchFeeTier,
  fetchMaybeWhirlpool,
  fetchAllMaybeWhirlpool,
  fetchAllFeeTierWithFilter,
  feeTierWhirlpoolsConfigFilter,
} from "@orca-so/whirlpools-client";
import type {
  Rpc,
  GetAccountInfoApi,
  GetMultipleAccountsApi,
  Address,
  GetProgramAccountsApi,
} from "@solana/web3.js";
import { SPLASH_POOL_TICK_SPACING, WHIRLPOOLS_CONFIG_ADDRESS } from "./config";

type InitializablePool = {
  initialized: false;
} & Pick<
  Whirlpool,
  | "whirlpoolsConfig"
  | "tickSpacing"
  | "feeRate"
  | "protocolFeeRate"
  | "tokenMintA"
  | "tokenMintB"
>;

type InitializedPool = {
  initialized: true;
} & Whirlpool;

type PoolInfo = (InitializablePool | InitializedPool) & { address: Address };

export async function fetchSplashPool(
  rpc: Rpc<GetAccountInfoApi>,
  tokenMintOne: Address,
  tokenMintTwo: Address,
): Promise<PoolInfo> {
  return fetchWhirlpool(
    rpc,
    tokenMintOne,
    tokenMintTwo,
    SPLASH_POOL_TICK_SPACING,
  );
}

export async function fetchWhirlpool(
  rpc: Rpc<GetAccountInfoApi>,
  tokenMintOne: Address,
  tokenMintTwo: Address,
  tickSpacing: number,
): Promise<PoolInfo> {
  const [tokenMintA, tokenMintB] =
    Buffer.from(tokenMintOne) < Buffer.from(tokenMintTwo)
      ? [tokenMintOne, tokenMintTwo]
      : [tokenMintTwo, tokenMintOne];
  const feeTierAddress = await getFeeTierAddress(
    WHIRLPOOLS_CONFIG_ADDRESS,
    tickSpacing,
  ).then((x) => x[0]);
  const poolAddress = await getWhirlpoolAddress(
    WHIRLPOOLS_CONFIG_ADDRESS,
    tokenMintA,
    tokenMintB,
    tickSpacing,
  ).then((x) => x[0]);

  // TODO: this is multiple rpc calls. Can we do it in one?
  const [configAccount, feeTierAccount, poolAccount] = await Promise.all([
    fetchWhirlpoolsConfig(rpc, WHIRLPOOLS_CONFIG_ADDRESS),
    fetchFeeTier(rpc, feeTierAddress),
    fetchMaybeWhirlpool(rpc, poolAddress),
  ]);

  if (poolAccount.exists) {
    return {
      initialized: true,
      address: poolAddress,
      ...poolAccount.data,
    };
  } else {
    return {
      initialized: false,
      address: poolAddress,
      whirlpoolsConfig: WHIRLPOOLS_CONFIG_ADDRESS,
      tickSpacing,
      feeRate: feeTierAccount.data.defaultFeeRate,
      protocolFeeRate: configAccount.data.defaultProtocolFeeRate,
      tokenMintA: tokenMintA,
      tokenMintB: tokenMintB,
    };
  }
}

export async function fetchWhirlpools(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetProgramAccountsApi>,
  tokenMintOne: Address,
  tokenMintTwo: Address,
): Promise<PoolInfo[]> {
  const [tokenMintA, tokenMintB] =
    Buffer.from(tokenMintOne) < Buffer.from(tokenMintTwo)
      ? [tokenMintOne, tokenMintTwo]
      : [tokenMintTwo, tokenMintOne];

  const feeTierAccounts = await fetchAllFeeTierWithFilter(
    rpc,
    feeTierWhirlpoolsConfigFilter(WHIRLPOOLS_CONFIG_ADDRESS),
  );

  const supportedTickSpacings = feeTierAccounts.map((x) => x.data.tickSpacing);

  const poolAddresses = await Promise.all(
    supportedTickSpacings.map((x) =>
      getWhirlpoolAddress(
        WHIRLPOOLS_CONFIG_ADDRESS,
        tokenMintA,
        tokenMintB,
        x,
      ).then((x) => x[0]),
    ),
  );

  // TODO: this is multiple rpc calls. Can we do it in one?
  const [configAccount, poolAccounts] = await Promise.all([
    fetchWhirlpoolsConfig(rpc, WHIRLPOOLS_CONFIG_ADDRESS),
    fetchAllMaybeWhirlpool(rpc, poolAddresses),
  ]);

  const pools: PoolInfo[] = [];
  for (let i = 0; i < supportedTickSpacings.length; i++) {
    const tickSpacing = supportedTickSpacings[i];
    const feeTierAccount = feeTierAccounts[i];
    const poolAccount = poolAccounts[i];
    const poolAddress = poolAddresses[i];

    if (poolAccount.exists) {
      pools.push({
        initialized: true,
        address: poolAddress,
        ...poolAccount.data,
      });
    } else {
      pools.push({
        initialized: false,
        address: poolAddress,
        whirlpoolsConfig: WHIRLPOOLS_CONFIG_ADDRESS,
        tickSpacing,
        feeRate: feeTierAccount.data.defaultFeeRate,
        protocolFeeRate: configAccount.data.defaultProtocolFeeRate,
        tokenMintA,
        tokenMintB,
      });
    }
  }
  return pools;
}
