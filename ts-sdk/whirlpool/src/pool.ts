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

/**
 * Type representing a pool that is not yet initialized.
 *
 * @typedef {Object} InitializablePool
 * @property {false} initialized - Indicates the pool is not initialized.
 * @property {Address} whirlpoolsConfig - The configuration address of the Whirlpool.
 * @property {number} tickSpacing - The spacing between ticks in the pool.
 * @property {number} feeRate - The fee rate applied to swaps in the pool.
 * @property {number} protocolFeeRate - The fee rate collected by the protocol.
 * @property {Address} tokenMintA - The mint address for the first token in the pool.
 * @property {Address} tokenMintB - The mint address for the second token in the pool.
 */
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

/**
 * Type representing a pool that has been initialized.
 *
 * @typedef {Object} InitializedPool
 * @property {true} initialized - Indicates the pool is initialized.
 * @extends Whirlpool
 */
type InitializedPool = {
  initialized: true;
} & Whirlpool;

/**
 * Combined type representing both initialized and uninitialized pools.
 *
 * @typedef {Object} PoolInfo
 * @property {Address} address - The address of the pool.
 * @property {boolean} initialized - Indicates whether the pool is initialized or not.
 * @property {Whirlpool | InitializablePool} - Either the fully initialized pool details or initializable pool configuration.
 */
type PoolInfo = (InitializablePool | InitializedPool) & { address: Address };

/**
 * Fetches the details of a specific Splash Pool.
 *
 * @param {Rpc<GetAccountInfoApi>} rpc - The Solana RPC client.
 * @param {Address} tokenMintOne - The first token mint address in the pool.
 * @param {Address} tokenMintTwo - The second token mint address in the pool.
 * @returns {Promise<PoolInfo>} - A promise that resolves to the pool information, which includes whether the pool is initialized or not.
 *
 * @example
 * import { fetchSplashPool } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet } from '@solana/web3.js';
 * 
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner();
 * await devnetRpc.requestAirdrop(wallet.address, lamports(1000000000n)).send();
 * 
 * const tokenMintOne = "TOKEN_MINT_ONE"; 
 * const tokenMintTwo = "TOKEN_MINT_TWO";
 * 
 * const poolInfo = await fetchSplashPool(
 *   devnetRpc,
 *   tokenMintOne,
 *   tokenMintTwo
 * );
 * 
 * console.log("Splash Pool State:", poolInfo);
 */
export async function fetchSplashPool(
  rpc: Rpc<GetAccountInfoApi>,
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
 * @param {Rpc<GetAccountInfoApi>} rpc - The Solana RPC client.
 * @param {Address} tokenMintOne - The first token mint address in the pool.
 * @param {Address} tokenMintTwo - The second token mint address in the pool.
 * @param {number} tickSpacing - The tick spacing of the pool.
 * @returns {Promise<PoolInfo>} - A promise that resolves to the pool information, which includes whether the pool is initialized or not.
 *
 * @example
 * import { fetchPool } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet } from '@solana/web3.js';
 * 
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner();
 * await devnetRpc.requestAirdrop(wallet.address, lamports(1000000000n)).send();
 * 
 * const tokenMintOne = "TOKEN_MINT_ONE";
 * const tokenMintTwo = "TOKEN_MINT_TWO";
 * const tickSpacing = 64;
 * 
 * const poolInfo = await fetchPool(
 *   devnetRpc,
 *   tokenMintOne,
 *   tokenMintTwo,
 *   tickSpacing
 * );
 * 
 * if (poolInfo.initialized) {
 *   console.log("Initialized Pool State:", poolInfo);
 * } else {
 *   console.log("Uninitialized Pool Info (Defaults):", poolInfo);
 * }
 */
export async function fetchConcentratedLiquidityPool(
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

/**
 * Fetches all possible liquidity pools between two token mints in Orca Whirlpools.
 *
 * @param {Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetProgramAccountsApi>} rpc - The Solana RPC client.
 * @param {Address} tokenMintOne - The first token mint address in the pool.
 * @param {Address} tokenMintTwo - The second token mint address in the pool.
 * @returns {Promise<PoolInfo[]>} - A promise that resolves to an array of pool information for each pool between the two tokens.
 *
 * @example
 * import { fetchWhirlpools } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet } from '@solana/web3.js';
 * 
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner();
 * await devnetRpc.requestAirdrop(wallet.address, lamports(1000000000n)).send();
 * 
 * const tokenMintOne = "TOKEN_MINT_ONE";  
 * const tokenMintTwo = "TOKEN_MINT_TWO"; 
 * 
 * const pools = await fetchWhirlpools(
 *   devnetRpc,
 *   tokenMintOne,
 *   tokenMintTwo
 * );
 * 
 * pools.forEach(pool => {
 *   if (pool.initialized) {
 *     console.log("Initialized Pool Info:", pool);
 *   } else {
 *     console.log("Uninitialized Pool Info (Defaults):", pool);
 *   }
 * });
 */
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
