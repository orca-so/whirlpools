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
import { orderMints } from "./token";
import { sqrtPriceToPrice } from "@orca-so/whirlpools-core";
import { fetchAllMint } from "@solana-program/token";

/**
 * Type representing a pool that is not yet initialized.
 */
export type InitializablePool = {
  /** Indicates the pool is not initialized. */
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

/**
 * Type representing a pool that has been initialized.
 * Extends the `Whirlpool` type, inheriting all its properties.
 */
export type InitializedPool = {
  /** Indicates the pool is initialized. */
  initialized: true;
  price: number;
} & Whirlpool;

/**
 * Combined type representing both initialized and uninitialized pools.
 */
export type PoolInfo = (InitializablePool | InitializedPool) & {
  /** The address of the pool. */
  address: Address;
};

/**
 * Fetches the details of a specific Splash Pool.
 *
 * @param {SolanaRpc} rpc - The Solana RPC client.
 * @param {Address} tokenMintOne - The first token mint address in the pool.
 * @param {Address} tokenMintTwo - The second token mint address in the pool.
 * @returns {Promise<PoolInfo>} - A promise that resolves to the pool information, which includes whether the pool is initialized or not.
 *
 * @example
 * import { fetchSplashPool, setWhirlpoolsConfig } from '@orca-so/whirlpools';
 * import { createSolanaRpc, devnet, address } from '@solana/web3.js';
 *
 * await setWhirlpoolsConfig('solanaDevnet');
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const tokenMintOne = address("So11111111111111111111111111111111111111112");
 * const tokenMintTwo = address("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k"); // devUSDC
 *
 * const poolInfo = await fetchSplashPool(
 *   devnetRpc,
 *   tokenMintOne,
 *   tokenMintTwo
 * );
 *
 * if (poolInfo.initialized) {
 *   console.log("Pool is initialized:", poolInfo);
 * } else {
 *   console.log("Pool is not initialized:", poolInfo);
 * };
 */
export async function fetchSplashPool(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>,
  tokenMintOne: Address,
  tokenMintTwo: Address,
): Promise<PoolInfo> {
  return fetchConcentratedLiquidityPool(
    rpc,
    tokenMintOne,
    tokenMintTwo,
    SPLASH_POOL_TICK_SPACING,
  );
}

/**
 * Fetches the details of a specific Concentrated Liquidity Pool.
 *
 * @param {SolanaRpc} rpc - The Solana RPC client.
 * @param {Address} tokenMintOne - The first token mint address in the pool.
 * @param {Address} tokenMintTwo - The second token mint address in the pool.
 * @param {number} tickSpacing - The tick spacing of the pool.
 * @returns {Promise<PoolInfo>} - A promise that resolves to the pool information, which includes whether the pool is initialized or not.
 *
 * @example
 * import { fetchConcentratedLiquidityPool, setWhirlpoolsConfig } from '@orca-so/whirlpools';
 * import { createSolanaRpc, devnet, address } from '@solana/web3.js';
 *
 * await setWhirlpoolsConfig('solanaDevnet');
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 *
 * const tokenMintOne = address("So11111111111111111111111111111111111111112");
 * const tokenMintTwo = address("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k");
 * const tickSpacing = 64;
 *
 * const poolInfo = await fetchConcentratedLiquidityPool(
 *   devnetRpc,
 *   tokenMintOne,
 *   tokenMintTwo,
 *   tickSpacing
 * );
 *
 * if (poolInfo.initialized) {
 *   console.log("Pool is initialized:", poolInfo);
 * } else {
 *   console.log("Pool is not initialized:", poolInfo);
 * };
 */
export async function fetchConcentratedLiquidityPool(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>,
  tokenMintOne: Address,
  tokenMintTwo: Address,
  tickSpacing: number,
): Promise<PoolInfo> {
  const [tokenMintA, tokenMintB] = orderMints(tokenMintOne, tokenMintTwo);
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

  const [mintA, mintB] = await fetchAllMint(rpc, [tokenMintA, tokenMintB]);

  if (poolAccount.exists) {
    const poolPrice = sqrtPriceToPrice(
      poolAccount.data.sqrtPrice,
      mintA.data.decimals,
      mintB.data.decimals,
    );
    return {
      initialized: true,
      address: poolAddress,
      price: poolPrice,
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

/**
 * Fetches all possible liquidity pools between two token mints in Orca Whirlpools.
 * If a pool does not exist, it creates a placeholder account for the uninitialized pool with default data
 *
 * @param {SolanaRpc} rpc - The Solana RPC client.
 * @param {Address} tokenMintOne - The first token mint address in the pool.
 * @param {Address} tokenMintTwo - The second token mint address in the pool.
 * @returns {Promise<PoolInfo[]>} - A promise that resolves to an array of pool information for each pool between the two tokens.
 *
 * @example
 * import { fetchWhirlpoolsByTokenPair, setWhirlpoolsConfig } from '@orca-so/whirlpools';
 * import { createSolanaRpc, devnet, address } from '@solana/web3.js';
 *
 * await setWhirlpoolsConfig('solanaDevnet');
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 *
 * const tokenMintOne = address("So11111111111111111111111111111111111111112");
 * const tokenMintTwo = address("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k");
 *
 * const poolInfos = await fetchWhirlpoolsByTokenPair(
 *   devnetRpc,
 *   tokenMintOne,
 *   tokenMintTwo
 * );
 *
 * poolInfos.forEach((poolInfo) => {
 *   if (poolInfo.initialized) {
 *     console.log("Pool is initialized:", poolInfo);
 *   } else {
 *     console.log("Pool is not initialized:", poolInfo);
 *   }
 * });
 */
export async function fetchWhirlpoolsByTokenPair(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetProgramAccountsApi>,
  tokenMintOne: Address,
  tokenMintTwo: Address,
): Promise<PoolInfo[]> {
  const [tokenMintA, tokenMintB] = orderMints(tokenMintOne, tokenMintTwo);
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

  const [mintA, mintB] = await fetchAllMint(rpc, [tokenMintA, tokenMintB]);

  const pools: PoolInfo[] = [];
  for (let i = 0; i < supportedTickSpacings.length; i++) {
    const tickSpacing = supportedTickSpacings[i];
    const feeTierAccount = feeTierAccounts[i];
    const poolAccount = poolAccounts[i];
    const poolAddress = poolAddresses[i];

    if (poolAccount.exists) {
      const poolPrice = sqrtPriceToPrice(
        poolAccount.data.sqrtPrice,
        mintA.data.decimals,
        mintB.data.decimals,
      );
      pools.push({
        initialized: true,
        address: poolAddress,
        price: poolPrice,
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
