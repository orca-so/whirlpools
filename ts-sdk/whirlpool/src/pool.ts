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
 * @param {SolanaRpc} rpc - The Solana RPC client.
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
 * If a pool does not exist, it creates a placeholder account for the uninitialized pool with default data
 * 
 * @param {SolanaRpc} rpc - The Solana RPC client.
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
