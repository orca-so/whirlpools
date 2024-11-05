import {
  getFeeTierAddress,
  getInitializePoolV2Instruction,
  getInitializeTickArrayInstruction,
  getTickArrayAddress,
  getTickArraySize,
  getTokenBadgeAddress,
  getWhirlpoolAddress,
  getWhirlpoolSize,
} from "@orca-so/whirlpools-client";
import type {
  Address,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  IInstruction,
  LamportsUnsafeBeyond2Pow53Minus1,
  Rpc,
  TransactionSigner,
} from "@solana/web3.js";
import { generateKeyPairSigner } from "@solana/web3.js";
import {
  DEFAULT_ADDRESS,
  FUNDER,
  SPLASH_POOL_TICK_SPACING,
  WHIRLPOOLS_CONFIG_ADDRESS,
} from "./config";
import {
  getFullRangeTickIndexes,
  getTickArrayStartTickIndex,
  priceToSqrtPrice,
  sqrtPriceToTickIndex,
} from "@orca-so/whirlpools-core";
import { fetchAllMint, getTokenSize } from "@solana-program/token";
import assert from "assert";
import { orderMints } from "./token";

/**
 * Represents the instructions and metadata for creating a pool.
 */
export type CreatePoolInstructions = {
  /** The list of instructions needed to create the pool. */
  instructions: IInstruction[];

  /** The estimated rent exemption cost for initializing the pool, in lamports. */
  estInitializationCost: LamportsUnsafeBeyond2Pow53Minus1;

  /** The address of the newly created pool. */
  poolAddress: Address;
};

/**
 * Creates the necessary instructions to initialize a Splash Pool on Orca Whirlpools.
 *
 * @param {SolanaRpc} rpc - A Solana RPC client for communicating with the blockchain.
 * @param {Address} tokenMintA - The first token mint address to include in the pool.
 * @param {Address} tokenMintB - The second token mint address to include in the pool.
 * @param {number} [initialPrice=1] - The initial price of token 1 in terms of token 2.
 * @param {TransactionSigner} [funder=FUNDER] - The account that will fund the initialization process.
 *
 * @returns {Promise<CreatePoolInstructions>} A promise that resolves to an object containing the pool creation instructions, the estimated initialization cost, and the pool address.
 *
 * @example
 * import { createSplashPoolInstructions } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet } from '@solana/web3.js';
 *
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner();
 * await devnetRpc.requestAirdrop(wallet.address, lamports(1000000000n)).send();
 *
 * const tokenMintOne = "TOKEN_MINT_ADDRESS_1";
 * const tokenMintTwo = "TOKEN_MINT_ADDRESS_2";
 * const initialPrice = 0.01;
 *
 * const { poolAddress, instructions, initializationCost } = await createSplashPoolInstructions(
 *   devnetRpc,
 *   tokenMintOne,
 *   tokenMintTwo,
 *   initialPrice,
 *   wallet
 * );
 */
export function createSplashPoolInstructions(
  rpc: Rpc<GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi>,
  tokenMintA: Address,
  tokenMintB: Address,
  initialPrice: number = 1,
  funder: TransactionSigner = FUNDER,
): Promise<CreatePoolInstructions> {
  return createConcentratedLiquidityPoolInstructions(
    rpc,
    tokenMintA,
    tokenMintB,
    SPLASH_POOL_TICK_SPACING,
    initialPrice,
    funder,
  );
}

/**
 * Creates the necessary instructions to initialize a Concentrated Liquidity Pool (CLMM) on Orca Whirlpools.
 *
 * @param {SolanaRpc} rpc - A Solana RPC client for communicating with the blockchain.
 * @param {Address} tokenMintA - The first token mint address to include in the pool.
 * @param {Address} tokenMintB - The second token mint address to include in the pool.
 * @param {number} tickSpacing - The spacing between price ticks for the pool.
 * @param {number} [initialPrice=1] - The initial price of token 1 in terms of token 2.
 * @param {TransactionSigner} [funder=FUNDER] - The account that will fund the initialization process.
 *
 * @returns {Promise<CreatePoolInstructions>} A promise that resolves to an object containing the pool creation instructions, the estimated initialization cost, and the pool address.
 *
 * @example
 * import { createConcentratedLiquidityPool } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet } from '@solana/web3.js';
 *
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner();
 * await devnetRpc.requestAirdrop(wallet.address, lamports(1000000000n)).send();
 *
 * const tokenMintOne = "TOKEN_MINT_ADDRESS_1";
 * const tokenMintTwo = "TOKEN_MINT_ADDRESS_2";
 * const tickSpacing = 64;
 * const initialPrice = 0.01;
 *
 * const { poolAddress, instructions, initializationCost } = await createConcentratedLiquidityPool(
 *   devnetRpc,
 *   tokenMintOne,
 *   tokenMintTwo,
 *   tickSpacing,
 *   initialPrice,
 *   wallet
 * );
 */
export async function createConcentratedLiquidityPoolInstructions(
  rpc: Rpc<GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi>,
  tokenMintA: Address,
  tokenMintB: Address,
  tickSpacing: number,
  initialPrice: number = 1,
  funder: TransactionSigner = FUNDER,
): Promise<CreatePoolInstructions> {
  assert(
    funder.address !== DEFAULT_ADDRESS,
    "Either supply a funder or set the default funder",
  );
  assert(
    orderMints(tokenMintA, tokenMintB)[0] === tokenMintA,
    "Token order needs to be flipped to match the canonical ordering (i.e. sorted on the byte repr. of the mint pubkeys)",
  );
  const instructions: IInstruction[] = [];
  let stateSpace = 0;

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
      WHIRLPOOLS_CONFIG_ADDRESS,
      tokenMintA,
      tokenMintB,
      tickSpacing,
    ).then((x) => x[0]),
    getFeeTierAddress(WHIRLPOOLS_CONFIG_ADDRESS, tickSpacing).then((x) => x[0]),
    getTokenBadgeAddress(WHIRLPOOLS_CONFIG_ADDRESS, tokenMintA).then(
      (x) => x[0],
    ),
    getTokenBadgeAddress(WHIRLPOOLS_CONFIG_ADDRESS, tokenMintB).then(
      (x) => x[0],
    ),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  instructions.push(
    getInitializePoolV2Instruction({
      whirlpoolsConfig: WHIRLPOOLS_CONFIG_ADDRESS,
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
    }),
  );

  stateSpace += getTokenSize() * 2;
  stateSpace += getWhirlpoolSize();

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
      getTickArrayAddress(poolAddress, x).then((x) => x[0]),
    ),
  );

  for (let i = 0; i < tickArrayIndexes.length; i++) {
    instructions.push(
      getInitializeTickArrayInstruction({
        whirlpool: poolAddress,
        funder,
        tickArray: tickArrayAddresses[i],
        startTickIndex: tickArrayIndexes[i],
      }),
    );
    stateSpace += getTickArraySize();
  }

  const nonRefundableRent = await rpc
    .getMinimumBalanceForRentExemption(BigInt(stateSpace))
    .send();

  return {
    instructions,
    poolAddress,
    estInitializationCost: nonRefundableRent,
  };
}
