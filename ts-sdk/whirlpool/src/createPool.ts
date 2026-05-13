import type { WhirlpoolDeployment } from "@orca-so/whirlpools-client";
import {
  DEFAULT_WHIRLPOOL_DEPLOYMENT,
  getFeeTierAddress,
  getInitializePoolV2Instruction,
  getInitializeDynamicTickArrayInstruction,
  getTickArrayAddress,
  getDynamicTickArrayMinSize,
  getTokenBadgeAddress,
  getWhirlpoolAddress,
  getWhirlpoolSize,
} from "@orca-so/whirlpools-client";
import type {
  Address,
  GetAccountInfoApi,
  GetMultipleAccountsApi,
  Instruction,
  Lamports,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import { generateKeyPairSigner, lamports } from "@solana/kit";
import { fetchSysvarRent } from "@solana/sysvars";
import { DEFAULT_ADDRESS, FUNDER, SPLASH_POOL_TICK_SPACING } from "./config";
import {
  getFullRangeTickIndexes,
  getTickArrayStartTickIndex,
  priceToSqrtPrice,
  sqrtPriceToTickIndex,
} from "@orca-so/whirlpools-core";
import { fetchAllMint } from "@solana-program/token-2022";
import assert from "assert";
import { getTokenSizeForMint, orderMints } from "./token";
import { calculateMinimumBalanceForRentExemption } from "./sysvar";
import { executeWithCallback } from "./actionHelpers";

/**
 * Represents the instructions and metadata for creating a pool.
 */
export type CreatePoolInstructions = {
  /** The list of instructions needed to create the pool. */
  instructions: Instruction[];

  /** The estimated rent exemption cost for initializing the pool, in lamports. */
  initializationCost: Lamports;

  /** The address of the newly created pool. */
  poolAddress: Address;
};

/**
 * Options for {@link createSplashPoolInstructions}.
 */
export type CreatePoolConfig = {
  /** An optional initial price of token A in terms of token B. Defaults to `1` if not provided. */
  initialPrice?: number;
  /** The account funding the initialization process. Defaults to the global funder if not provided. */
  funder?: TransactionSigner<string>;
  /**
   * The Whirlpool program and config account to target. Defaults to DEFAULT_WHIRLPOOL_DEPLOYMENT if not provided.
   */
  whirlpoolDeployment?: WhirlpoolDeployment;
};

/**
 * Creates the necessary instructions to initialize a Splash Pool on Orca Whirlpools.
 *
 * @param {SolanaRpc} rpc - A Solana RPC client for communicating with the blockchain.
 * @param {Address} tokenMintA - The first token mint address to include in the pool.
 * @param {Address} tokenMintB - The second token mint address to include in the pool.
 * @param {CreatePoolConfig} [config] - The parameters to build the create splash pool instruction.
 *
 * @returns {Promise<CreatePoolInstructions>} A promise that resolves to an object containing the pool creation instructions, the estimated initialization cost, and the pool address.
 *
 * @example
 * import { createSplashPoolInstructions, WhirlpoolDeployment } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet, address } from '@solana/kit';
 *
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner(); // CAUTION: This wallet is not persistent.
 *
 * const tokenMintOne = address("So11111111111111111111111111111111111111112");
 * const tokenMintTwo = address("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k"); // devUSDC
 *
 * const { poolAddress, instructions, initializationCost } = await createSplashPoolInstructions(
 *     devnetRpc,
 *     tokenMintOne,
 *     tokenMintTwo,
 *     {
 *       initialPrice: 0.01,
 *       funder: wallet,
 *       whirlpoolDeployment: WhirlpoolDeployment.devnet,
 *     },
 * );
 *
 * console.log(`Pool Address: ${poolAddress}`);
 * console.log(`Initialization Cost: ${initializationCost} lamports`);
 */
export function createSplashPoolInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>,
  tokenMintA: Address,
  tokenMintB: Address,
  config: CreatePoolConfig = {},
): Promise<CreatePoolInstructions> {
  return createConcentratedLiquidityPoolInstructions(
    rpc,
    tokenMintA,
    tokenMintB,
    SPLASH_POOL_TICK_SPACING,
    {
      initialPrice: config.initialPrice,
      funder: config.funder,
      whirlpoolDeployment: config.whirlpoolDeployment,
    },
  );
}

/**
 * Creates the necessary instructions to initialize a Concentrated Liquidity Pool (CLMM) on Orca Whirlpools.
 *
 * @param {SolanaRpc} rpc - A Solana RPC client for communicating with the blockchain.
 * @param {Address} tokenMintA - The first token mint address to include in the pool.
 * @param {Address} tokenMintB - The second token mint address to include in the pool.
 * @param {number} tickSpacing - The spacing between price ticks for the pool.
 * @param {CreatePoolConfig} [config] - The parameters to build the create concentrated liquidity pool instruction.
 *
 * @returns {Promise<CreatePoolInstructions>} A promise that resolves to an object containing the pool creation instructions, the estimated initialization cost, and the pool address.
 *
 * @example
 * import { createConcentratedLiquidityPoolInstructions, WhirlpoolDeployment } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet, address } from '@solana/kit';
 *
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner(); // CAUTION: This wallet is not persistent.
 *
 * const tokenMintOne = address("So11111111111111111111111111111111111111112");
 * const tokenMintTwo = address("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k"); // devUSDC
 *
 * const { poolAddress, instructions, initializationCost } = await createConcentratedLiquidityPoolInstructions(
 *     devnetRpc,
 *     tokenMintOne,
 *     tokenMintTwo,
 *     64,
 *     {
 *       initialPrice: 0.01,
 *       funder: wallet,
 *       whirlpoolDeployment: WhirlpoolDeployment.devnet,
 *     },
 * );
 *
 * console.log(`Pool Address: ${poolAddress}`);
 * console.log(`Initialization Cost: ${initializationCost} lamports`);
 */
export async function createConcentratedLiquidityPoolInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>,
  tokenMintA: Address,
  tokenMintB: Address,
  tickSpacing: number,
  config: CreatePoolConfig = {},
): Promise<CreatePoolInstructions> {
  const initialPrice = config.initialPrice ?? 1;
  const funder = config.funder ?? FUNDER;
  const whirlpoolDeployment =
    config.whirlpoolDeployment ?? DEFAULT_WHIRLPOOL_DEPLOYMENT;

  assert(
    funder.address !== DEFAULT_ADDRESS,
    "Either supply a funder or set the default funder",
  );
  assert(
    orderMints(tokenMintA, tokenMintB)[0] === tokenMintA,
    "Token order needs to be flipped to match the canonical ordering (i.e. sorted on the byte repr. of the mint pubkeys)",
  );
  const instructions: Instruction[] = [];

  const rent = await fetchSysvarRent(rpc);
  let nonRefundableRent: bigint = 0n;

  // Since TE mint data is an extension of T mint data, we can use the same fetch function
  const [mintA, mintB] = await fetchAllMint(rpc, [tokenMintA, tokenMintB]);
  const decimalsA = mintA.data.decimals;
  const decimalsB = mintB.data.decimals;
  const tokenProgramA = mintA.programAddress;
  const tokenProgramB = mintB.programAddress;

  const initialSqrtPrice = priceToSqrtPrice(initialPrice, decimalsA, decimalsB);

  const [
    poolAddress,
    feeTier,
    tokenBadgeA,
    tokenBadgeB,
    tokenVaultA,
    tokenVaultB,
  ] = await Promise.all([
    getWhirlpoolAddress(
      tokenMintA,
      tokenMintB,
      tickSpacing,
      whirlpoolDeployment,
    ).then((x) => x[0]),
    getFeeTierAddress(tickSpacing, whirlpoolDeployment).then((x) => x[0]),
    getTokenBadgeAddress(tokenMintA, whirlpoolDeployment).then((x) => x[0]),
    getTokenBadgeAddress(tokenMintB, whirlpoolDeployment).then((x) => x[0]),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  instructions.push(
    getInitializePoolV2Instruction(
      {
        whirlpoolsConfig: whirlpoolDeployment.configAddress,
        tokenMintA,
        tokenMintB,
        tokenBadgeA,
        tokenBadgeB,
        funder,
        whirlpool: poolAddress,
        tokenVaultA,
        tokenVaultB,
        tokenProgramA,
        tokenProgramB,
        feeTier,
        tickSpacing,
        initialSqrtPrice,
      },
      { programAddress: whirlpoolDeployment.programId },
    ),
  );

  nonRefundableRent += calculateMinimumBalanceForRentExemption(
    rent,
    getTokenSizeForMint(mintA),
  );
  nonRefundableRent += calculateMinimumBalanceForRentExemption(
    rent,
    getTokenSizeForMint(mintB),
  );
  nonRefundableRent += calculateMinimumBalanceForRentExemption(
    rent,
    getWhirlpoolSize(),
  );

  const fullRange = getFullRangeTickIndexes(tickSpacing);
  const lowerTickIndex = getTickArrayStartTickIndex(
    fullRange.tickLowerIndex,
    tickSpacing,
  );
  const upperTickIndex = getTickArrayStartTickIndex(
    fullRange.tickUpperIndex,
    tickSpacing,
  );
  const initialTickIndex = sqrtPriceToTickIndex(initialSqrtPrice);
  const currentTickIndex = getTickArrayStartTickIndex(
    initialTickIndex,
    tickSpacing,
  );

  const tickArrayIndexes = Array.from(
    new Set([lowerTickIndex, upperTickIndex, currentTickIndex]),
  );

  const tickArrayAddresses = await Promise.all(
    tickArrayIndexes.map((x) =>
      getTickArrayAddress(poolAddress, x, whirlpoolDeployment.programId).then(
        (x) => x[0],
      ),
    ),
  );

  for (let i = 0; i < tickArrayIndexes.length; i++) {
    instructions.push(
      getInitializeDynamicTickArrayInstruction(
        {
          whirlpool: poolAddress,
          funder,
          tickArray: tickArrayAddresses[i],
          startTickIndex: tickArrayIndexes[i],
          idempotent: false,
        },
        { programAddress: whirlpoolDeployment.programId },
      ),
    );
    nonRefundableRent += calculateMinimumBalanceForRentExemption(
      rent,
      getDynamicTickArrayMinSize(),
    );
  }

  return {
    instructions,
    poolAddress,
    initializationCost: lamports(nonRefundableRent),
  };
}

// -------- ACTIONS --------

export function createSplashPool(
  tokenMintA: Address,
  tokenMintB: Address,
  config?: CreatePoolConfig,
) {
  return executeWithCallback((rpc) =>
    createSplashPoolInstructions(rpc, tokenMintA, tokenMintB, config),
  );
}

export function createConcentratedLiquidityPool(
  tokenMintA: Address,
  tokenMintB: Address,
  tickSpacing: number,
  config?: CreatePoolConfig,
) {
  return executeWithCallback((rpc) =>
    createConcentratedLiquidityPoolInstructions(
      rpc,
      tokenMintA,
      tokenMintB,
      tickSpacing,
      config,
    ),
  );
}
