import type {
  Whirlpool,
  WhirlpoolDeployment,
} from "@orca-so/whirlpools-client";
import {
  DEFAULT_WHIRLPOOL_DEPLOYMENT,
  fetchAllMaybeTickArray,
  fetchPosition,
  fetchWhirlpool,
  getIncreaseLiquidityByTokenAmountsV2Instruction,
  getInitializeDynamicTickArrayInstruction,
  getOpenPositionWithTokenExtensionsInstruction,
  getPositionAddress,
  getTickArrayAddress,
  getDynamicTickArrayMinSize,
  increaseLiquidityMethod,
} from "@orca-so/whirlpools-client";
import {
  getFullRangeTickIndexes,
  getTickArrayStartTickIndex,
  priceToTickIndex,
  getInitializableTickIndex,
  orderTickIndexes,
} from "@orca-so/whirlpools-core";
import type {
  Account,
  Address,
  GetAccountInfoApi,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  Instruction,
  Lamports,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import { address, generateKeyPairSigner, lamports } from "@solana/kit";
import { fetchSysvarRent } from "@solana/sysvars";
import {
  DEFAULT_ADDRESS,
  FUNDER,
  SLIPPAGE_TOLERANCE_BPS,
  SPLASH_POOL_TICK_SPACING,
} from "./config";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
} from "@solana-program/token";
import { prepareTokenAccountsInstructions } from "./token";
import type { Mint } from "@solana-program/token-2022";
import {
  fetchAllMint,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import assert from "assert";
import { calculateMinimumBalanceForRentExemption } from "./sysvar";
import { executeWithCallback } from "./actionHelpers";
import { getSqrtPriceSlippageBounds } from "@orca-so/whirlpools-core";

// TODO: allow specify number as well as bigint
// TODO: transfer hook

/** RPC client for increase-liquidity operations. Requires: GetAccountInfoApi, GetMultipleAccountsApi, GetMinimumBalanceForRentExemptionApi */
type IncreaseLiquidityRpc = Rpc<
  GetAccountInfoApi &
    GetMultipleAccountsApi &
    GetMinimumBalanceForRentExemptionApi
>;

/** Represents the token max amount parameters for increasing liquidity. */
export type IncreaseLiquidityParam = {
  tokenMaxA: bigint;
  tokenMaxB: bigint;
};

/** Represents the instructions for increasing liquidity in a position. */
export type IncreaseLiquidityInstructions = {
  /** List of Solana transaction instructions to execute. */
  instructions: Instruction[];
};

/**
 * Builds token account setup, increase liquidity, and cleanup instructions from token max amounts and position params.
 */
async function getIncreaseLiquidityInstructions(
  rpc: IncreaseLiquidityRpc,
  {
    whirlpool: {
      address: whirlpoolAddress,
      data: { sqrtPrice, tokenMintA, tokenMintB, ...tokenVaults },
    },
    param: { tokenMaxA, tokenMaxB },
    mintA,
    mintB,
    slippageToleranceBps,
    authority,
    programAddress,
    ...rest
  }: {
    whirlpool: Account<Whirlpool>;
    param: IncreaseLiquidityParam;
    mintA: Account<Mint>;
    mintB: Account<Mint>;
    slippageToleranceBps: number;
    authority: TransactionSigner<string>;
    programAddress: Address;
    position: Address;
    positionTokenAccount: Address;
    tickArrayLower: Address;
    tickArrayUpper: Address;
    tickLowerIndex: number;
    tickUpperIndex: number;
  },
): Promise<{
  createTokenAccountInstructions: Instruction[];
  increaseLiquidityInstruction: Instruction;
  cleanupInstructions: Instruction[];
}> {
  const {
    createInstructions: createTokenAccountInstructions,
    cleanupInstructions,
    tokenAccountAddresses,
  } = await prepareTokenAccountsInstructions(rpc, authority, {
    [tokenMintA]: tokenMaxA,
    [tokenMintB]: tokenMaxB,
  });

  const commonInstructionParams = {
    whirlpool: whirlpoolAddress,
    positionAuthority: authority,
    tokenOwnerAccountA: tokenAccountAddresses[tokenMintA],
    tokenOwnerAccountB: tokenAccountAddresses[tokenMintB],
    tokenMintA,
    tokenMintB,
    tokenProgramA: mintA.programAddress,
    tokenProgramB: mintB.programAddress,
    memoProgram: MEMO_PROGRAM_ADDRESS,
    remainingAccountsInfo: null,
    ...tokenVaults,
    ...rest,
  };

  const { minSqrtPrice, maxSqrtPrice } = getSqrtPriceSlippageBounds(
    sqrtPrice,
    slippageToleranceBps,
  );

  const increaseLiquidityInstruction =
    getIncreaseLiquidityByTokenAmountsV2Instruction(
      {
        method: increaseLiquidityMethod("ByTokenAmounts", {
          minSqrtPrice,
          maxSqrtPrice,
          tokenMaxA,
          tokenMaxB,
        }),
        ...commonInstructionParams,
      },
      { programAddress },
    );

  return {
    createTokenAccountInstructions,
    increaseLiquidityInstruction,
    cleanupInstructions,
  };
}

/**
 * Options for {@link increaseLiquidityInstructions}.
 */
export type IncreaseLiquidityConfig = {
  /** Slippage tolerance in basis points. Defaults to the global slippage tolerance. */
  slippageToleranceBps?: number;
  /** The account authorizing the liquidity addition. Defaults to the global funder. */
  authority?: TransactionSigner<string>;
  /**
   * The Whirlpool program and config account to target. Defaults to DEFAULT_WHIRLPOOL_DEPLOYMENT if not provided.
   */
  whirlpoolDeployment?: WhirlpoolDeployment;
};

/**
 * Generates instructions to increase liquidity for an existing position.
 *
 * @param {SolanaRpc} rpc - RPC client.
 * @param {Address} positionMintAddress - The mint address of the NFT that represents the position.
 * @param {IncreaseLiquidityParam} param - Maximum amounts of token A and B to deposit.
 * @param {IncreaseLiquidityConfig} [config] - The parameters to build the increase liquidity instruction.
 * @returns {Promise<IncreaseLiquidityInstructions>} A promise that resolves to an object containing instructions.
 *
 * @example
 * import { increaseLiquidityInstructions, WhirlpoolDeployment } from '@orca-so/whirlpools';
 * import { createSolanaRpc, devnet, address } from '@solana/kit';
 * import { loadWallet } from './utils';
 *
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await loadWallet();
 * const positionMint = address("HqoV7Qv27REUtmd9UKSJGGmCRNx3531t33bDG1BUfo9K");
 * const { instructions } = await increaseLiquidityInstructions(
 *   devnetRpc,
 *   positionMint,
 *   { tokenMaxA: 10n, tokenMaxB: 12n },
 *   {
 *     slippageToleranceBps: 100,
 *     authority: wallet,
 *     whirlpoolDeployment: WhirlpoolDeployment.devnet,
 *   }
 * );
 */
export async function increaseLiquidityInstructions(
  rpc: IncreaseLiquidityRpc,
  positionMintAddress: Address,
  param: IncreaseLiquidityParam,
  config: IncreaseLiquidityConfig = {},
): Promise<IncreaseLiquidityInstructions> {
  const slippageToleranceBps =
    config.slippageToleranceBps ?? SLIPPAGE_TOLERANCE_BPS;
  const authority = config.authority ?? FUNDER;
  const whirlpoolDeployment =
    config.whirlpoolDeployment ?? DEFAULT_WHIRLPOOL_DEPLOYMENT;

  assert(
    authority.address !== DEFAULT_ADDRESS,
    "Either supply the authority or set the default funder",
  );

  const positionAddress = await getPositionAddress(
    positionMintAddress,
    whirlpoolDeployment.programId,
  );
  const position = await fetchPosition(rpc, positionAddress[0]);
  const whirlpool = await fetchWhirlpool(rpc, position.data.whirlpool);

  const [mintA, mintB, positionMint] = await fetchAllMint(rpc, [
    whirlpool.data.tokenMintA,
    whirlpool.data.tokenMintB,
    positionMintAddress,
  ]);

  const lowerTickArrayStartIndex = getTickArrayStartTickIndex(
    position.data.tickLowerIndex,
    whirlpool.data.tickSpacing,
  );
  const upperTickArrayStartIndex = getTickArrayStartTickIndex(
    position.data.tickUpperIndex,
    whirlpool.data.tickSpacing,
  );

  const [positionTokenAccount, tickArrayLower, tickArrayUpper] =
    await Promise.all([
      findAssociatedTokenPda({
        owner: authority.address,
        mint: positionMintAddress,
        tokenProgram: positionMint.programAddress,
      }).then((x) => x[0]),
      getTickArrayAddress(
        whirlpool.address,
        lowerTickArrayStartIndex,
        whirlpoolDeployment.programId,
      ).then((x) => x[0]),
      getTickArrayAddress(
        whirlpool.address,
        upperTickArrayStartIndex,
        whirlpoolDeployment.programId,
      ).then((x) => x[0]),
    ]);

  const {
    createTokenAccountInstructions,
    increaseLiquidityInstruction,
    cleanupInstructions,
  } = await getIncreaseLiquidityInstructions(rpc, {
    whirlpool,
    position: position.address,
    positionTokenAccount,
    param,
    mintA,
    mintB,
    slippageToleranceBps,
    authority,
    programAddress: whirlpoolDeployment.programId,
    tickArrayLower,
    tickArrayUpper,
    tickLowerIndex: position.data.tickLowerIndex,
    tickUpperIndex: position.data.tickUpperIndex,
  });

  const instructions: Instruction[] = [
    ...createTokenAccountInstructions,
    increaseLiquidityInstruction,
    ...cleanupInstructions,
  ];

  return {
    instructions,
  };
}

/**
 * Represents the instructions for opening a position.
 * Extends IncreaseLiquidityInstructions with initialization cost and position mint.
 */
export type OpenPositionInstructions = IncreaseLiquidityInstructions & {
  /** The initialization cost for opening the position in lamports. */
  initializationCost: Lamports;

  /** The mint address of the position NFT. */
  positionMint: Address;
};

async function internalOpenPositionInstructions(
  rpc: IncreaseLiquidityRpc,
  whirlpool: Account<Whirlpool>,
  param: IncreaseLiquidityParam,
  lowerTickIndex: number,
  upperTickIndex: number,
  mintA: Account<Mint>,
  mintB: Account<Mint>,
  slippageToleranceBps: number,
  withTokenMetadataExtension: boolean,
  funder: TransactionSigner<string>,
  whirlpoolDeployment: WhirlpoolDeployment,
): Promise<OpenPositionInstructions> {
  assert(
    funder.address !== DEFAULT_ADDRESS,
    "Either supply a funder or set the default funder",
  );
  const instructions: Instruction[] = [];

  const rent = await fetchSysvarRent(rpc);
  let nonRefundableRent: bigint = 0n;

  const tickRange = orderTickIndexes(lowerTickIndex, upperTickIndex);

  const initializableLowerTickIndex = getInitializableTickIndex(
    tickRange.tickLowerIndex,
    whirlpool.data.tickSpacing,
    false,
  );
  const initializableUpperTickIndex = getInitializableTickIndex(
    tickRange.tickUpperIndex,
    whirlpool.data.tickSpacing,
    true,
  );

  const positionMint = await generateKeyPairSigner();

  const lowerTickArrayIndex = getTickArrayStartTickIndex(
    initializableLowerTickIndex,
    whirlpool.data.tickSpacing,
  );
  const upperTickArrayIndex = getTickArrayStartTickIndex(
    initializableUpperTickIndex,
    whirlpool.data.tickSpacing,
  );

  const [
    positionAddress,
    positionTokenAccount,
    lowerTickArrayAddress,
    upperTickArrayAddress,
  ] = await Promise.all([
    getPositionAddress(positionMint.address, whirlpoolDeployment.programId),
    findAssociatedTokenPda({
      owner: funder.address,
      mint: positionMint.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }).then((x) => x[0]),
    getTickArrayAddress(
      whirlpool.address,
      lowerTickArrayIndex,
      whirlpoolDeployment.programId,
    ).then((x) => x[0]),
    getTickArrayAddress(
      whirlpool.address,
      upperTickArrayIndex,
      whirlpoolDeployment.programId,
    ).then((x) => x[0]),
  ]);

  const {
    createTokenAccountInstructions,
    increaseLiquidityInstruction,
    cleanupInstructions,
  } = await getIncreaseLiquidityInstructions(rpc, {
    whirlpool,
    position: positionAddress[0],
    positionTokenAccount,
    param,
    mintA,
    mintB,
    slippageToleranceBps,
    authority: funder,
    programAddress: whirlpoolDeployment.programId,
    tickArrayLower: lowerTickArrayAddress,
    tickArrayUpper: upperTickArrayAddress,
    tickLowerIndex: initializableLowerTickIndex,
    tickUpperIndex: initializableUpperTickIndex,
  });

  instructions.push(...createTokenAccountInstructions);

  const [lowerTickArray, upperTickArray] = await fetchAllMaybeTickArray(rpc, [
    lowerTickArrayAddress,
    upperTickArrayAddress,
  ]);

  if (!lowerTickArray.exists) {
    instructions.push(
      getInitializeDynamicTickArrayInstruction(
        {
          whirlpool: whirlpool.address,
          funder,
          tickArray: lowerTickArrayAddress,
          startTickIndex: lowerTickArrayIndex,
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

  if (!upperTickArray.exists && lowerTickArrayIndex !== upperTickArrayIndex) {
    instructions.push(
      getInitializeDynamicTickArrayInstruction(
        {
          whirlpool: whirlpool.address,
          funder,
          tickArray: upperTickArrayAddress,
          startTickIndex: upperTickArrayIndex,
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

  instructions.push(
    getOpenPositionWithTokenExtensionsInstruction(
      {
        funder,
        owner: funder.address,
        position: positionAddress[0],
        positionMint,
        positionTokenAccount,
        whirlpool: whirlpool.address,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
        tickLowerIndex: initializableLowerTickIndex,
        tickUpperIndex: initializableUpperTickIndex,
        token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
        metadataUpdateAuth: address(
          "3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr",
        ),
        withTokenMetadataExtension,
      },
      { programAddress: whirlpoolDeployment.programId },
    ),
  );

  instructions.push(increaseLiquidityInstruction);
  instructions.push(...cleanupInstructions);

  return {
    instructions,
    positionMint: positionMint.address,
    initializationCost: lamports(nonRefundableRent),
  };
}

/**
 * Options for {@link openPositionInstructions}, {@link openPositionInstructionsWithTickBounds} and {@link openFullRangePositionInstructions}.
 */
export type OpenPositionConfig = {
  slippageToleranceBps?: number;
  withTokenMetadataExtension?: boolean;
  funder?: TransactionSigner<string>;
  whirlpoolDeployment?: WhirlpoolDeployment;
};

/**
 * Opens a full-range position for a pool, typically used for Splash Pools or other full-range liquidity provisioning.
 *
 * @param {SolanaRpc} rpc - RPC client. Requires: GetAccountInfoApi, GetMultipleAccountsApi, GetMinimumBalanceForRentExemptionApi
 * @param {Address} poolAddress - The address of the liquidity pool.
 * @param {IncreaseLiquidityParam} param - Maximum amounts of token A and B to deposit.
 * @param {OpenPositionConfig} [config] - The parameters to build the open full range position instructions.
 * @returns {Promise<OpenPositionInstructions>} A promise that resolves to an object containing instructions, position mint address, and initialization cost.
 *
 * @example
 * import { openFullRangePositionInstructions, WhirlpoolDeployment } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet, address } from '@solana/kit';
 *
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner(); // CAUTION: This wallet is not persistent.
 *
 * const whirlpoolAddress = address("POOL_ADDRESS");
 *
 * const { instructions, initializationCost, positionMint } = await openFullRangePositionInstructions(
 *   devnetRpc,
 *   whirlpoolAddress,
 *   { tokenMaxA: 1_000_000n, tokenMaxB: 0n },
 *   {
 *     slippageToleranceBps: 100,
 *     withTokenMetadataExtension: true,
 *     funder: wallet,
 *     whirlpoolDeployment: WhirlpoolDeployment.devnet,
 *   },
 * );
 */
export async function openFullRangePositionInstructions(
  rpc: IncreaseLiquidityRpc,
  poolAddress: Address,
  param: IncreaseLiquidityParam,
  config: OpenPositionConfig = {},
): Promise<OpenPositionInstructions> {
  const slippageToleranceBps =
    config.slippageToleranceBps ?? SLIPPAGE_TOLERANCE_BPS;
  const withTokenMetadataExtension = config.withTokenMetadataExtension ?? true;
  const funder = config.funder ?? FUNDER;
  const whirlpoolDeployment =
    config.whirlpoolDeployment ?? DEFAULT_WHIRLPOOL_DEPLOYMENT;

  const whirlpool = await fetchWhirlpool(rpc, poolAddress);
  const tickRange = getFullRangeTickIndexes(whirlpool.data.tickSpacing);

  const [mintA, mintB] = await fetchAllMint(rpc, [
    whirlpool.data.tokenMintA,
    whirlpool.data.tokenMintB,
  ]);

  return internalOpenPositionInstructions(
    rpc,
    whirlpool,
    param,
    tickRange.tickLowerIndex,
    tickRange.tickUpperIndex,
    mintA,
    mintB,
    slippageToleranceBps,
    withTokenMetadataExtension,
    funder,
    whirlpoolDeployment,
  );
}

/**
 * Opens a new position in a concentrated liquidity pool within a specific price range.
 * This function allows you to provide liquidity for the specified range of prices and adjust liquidity parameters accordingly.
 *
 * **Note:** This function cannot be used with Splash Pools.
 *
 * @param {SolanaRpc} rpc - RPC client. Requires: GetAccountInfoApi, GetMultipleAccountsApi, GetMinimumBalanceForRentExemptionApi
 * @param {Address} poolAddress - The address of the liquidity pool where the position will be opened.
 * @param {IncreaseLiquidityParam} param - Maximum amounts of token A and B to deposit.
 * @param {number} lowerPrice - The lower bound of the price range for the position.
 * @param {number} upperPrice - The upper bound of the price range for the position.
 * @param {OpenPositionConfig} [config] - The parameters to build the open position instruction.
 *
 * @returns {Promise<OpenPositionInstructions>} A promise that resolves to an object containing instructions, position mint address, and initialization cost.
 *
 * @example
 * import { openPositionInstructions, WhirlpoolDeployment } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet, address } from '@solana/kit';
 *
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner(); // CAUTION: This wallet is not persistent.
 *
 * const whirlpoolAddress = address("POOL_ADDRESS");
 * const lowerPrice = 0.00005;
 * const upperPrice = 0.00015;
 *
 * const { instructions, initializationCost, positionMint } = await openPositionInstructions(
 *   devnetRpc,
 *   whirlpoolAddress,
 *   { tokenMaxA: 1_000_000n, tokenMaxB: 0n },
 *   lowerPrice,
 *   upperPrice,
 *   {
 *     slippageToleranceBps: 100,
 *     withTokenMetadataExtension: true,
 *     funder: wallet,
 *     whirlpoolDeployment: WhirlpoolDeployment.devnet,
 *   },
 * );
 */
export async function openPositionInstructions(
  rpc: IncreaseLiquidityRpc,
  poolAddress: Address,
  param: IncreaseLiquidityParam,
  lowerPrice: number,
  upperPrice: number,
  config: OpenPositionConfig = {},
): Promise<OpenPositionInstructions> {
  const slippageToleranceBps =
    config.slippageToleranceBps ?? SLIPPAGE_TOLERANCE_BPS;
  const withTokenMetadataExtension = config.withTokenMetadataExtension ?? true;
  const funder = config.funder ?? FUNDER;
  const whirlpoolDeployment =
    config.whirlpoolDeployment ?? DEFAULT_WHIRLPOOL_DEPLOYMENT;

  const whirlpool = await fetchWhirlpool(rpc, poolAddress);
  assertWhirlpoolSupportsConcentratedPosition(whirlpool.data);

  const [mintA, mintB] = await fetchAllMint(rpc, [
    whirlpool.data.tokenMintA,
    whirlpool.data.tokenMintB,
  ]);
  const decimalsA = mintA.data.decimals;
  const decimalsB = mintB.data.decimals;
  const lowerTickIndex = priceToTickIndex(lowerPrice, decimalsA, decimalsB);
  const upperTickIndex = priceToTickIndex(upperPrice, decimalsA, decimalsB);

  return internalOpenPositionInstructions(
    rpc,
    whirlpool,
    param,
    lowerTickIndex,
    upperTickIndex,
    mintA,
    mintB,
    slippageToleranceBps,
    withTokenMetadataExtension,
    funder,
    whirlpoolDeployment,
  );
}

/**
 * Opens a new position in a concentrated liquidity pool within a specific tick range.
 * This function allows you to provide liquidity for the specified range of ticks and adjust liquidity parameters accordingly.
 *
 * **Note:** This function cannot be used with Splash Pools.
 *
 * @param {SolanaRpc} rpc - RPC client. Requires: GetAccountInfoApi, GetMultipleAccountsApi, GetMinimumBalanceForRentExemptionApi
 * @param {Address} poolAddress - The address of the liquidity pool where the position will be opened.
 * @param {IncreaseLiquidityParam} param - Maximum amounts of token A and B to deposit.
 * @param {number} lowerTickIndex - The lower bound of the tick range for the position.
 * @param {number} upperTickIndex - The upper bound of the tick range for the position.
 * @param {OpenPositionConfig} [config] - The parameters to build the open position with tick bounds instruction.
 *
 * @returns {Promise<OpenPositionInstructions>} A promise that resolves to an object containing instructions, position mint address, and initialization cost.
 *
 * @example
 * import { openPositionInstructionsWithTickBounds, WhirlpoolDeployment } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet, address } from '@solana/kit';
 *
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner(); // CAUTION: This wallet is not persistent.
 *
 * const whirlpoolAddress = address("POOL_ADDRESS");
 * const lowerTickIndex = -44320;
 * const upperTickIndex = -22160;
 *
 * const { instructions, initializationCost, positionMint } = await openPositionInstructionsWithTickBounds(
 *   devnetRpc,
 *   whirlpoolAddress,
 *   { tokenMaxA: 1_000_000n, tokenMaxB: 0n },
 *   lowerTickIndex,
 *   upperTickIndex,
 *   {
 *     slippageToleranceBps: 100,
 *     withTokenMetadataExtension: true,
 *     funder: wallet,
 *     whirlpoolDeployment: WhirlpoolDeployment.devnet,
 *   },
 * );
 */
export async function openPositionInstructionsWithTickBounds(
  rpc: IncreaseLiquidityRpc,
  poolAddress: Address,
  param: IncreaseLiquidityParam,
  lowerTickIndex: number,
  upperTickIndex: number,
  config: OpenPositionConfig = {},
): Promise<OpenPositionInstructions> {
  const slippageToleranceBps =
    config.slippageToleranceBps ?? SLIPPAGE_TOLERANCE_BPS;
  const withTokenMetadataExtension = config.withTokenMetadataExtension ?? true;
  const funder = config.funder ?? FUNDER;
  const whirlpoolDeployment =
    config.whirlpoolDeployment ?? DEFAULT_WHIRLPOOL_DEPLOYMENT;

  const whirlpool = await fetchWhirlpool(rpc, poolAddress);
  assertWhirlpoolSupportsConcentratedPosition(whirlpool.data);

  const [mintA, mintB] = await fetchAllMint(rpc, [
    whirlpool.data.tokenMintA,
    whirlpool.data.tokenMintB,
  ]);

  return internalOpenPositionInstructions(
    rpc,
    whirlpool,
    param,
    lowerTickIndex,
    upperTickIndex,
    mintA,
    mintB,
    slippageToleranceBps,
    withTokenMetadataExtension,
    funder,
    whirlpoolDeployment,
  );
}

function assertWhirlpoolSupportsConcentratedPosition(whirlpool: Whirlpool) {
  assert(
    whirlpool.tickSpacing !== SPLASH_POOL_TICK_SPACING,
    "Splash pools only support full range positions",
  );
}

// -------- ACTIONS --------

export function increasePosLiquidity(
  positionMintAddress: Address,
  param: IncreaseLiquidityParam,
  config?: IncreaseLiquidityConfig,
) {
  return executeWithCallback((rpc) =>
    increaseLiquidityInstructions(rpc, positionMintAddress, param, config),
  );
}

export function openFullRangePosition(
  poolAddress: Address,
  param: IncreaseLiquidityParam,
  config?: OpenPositionConfig,
) {
  return executeWithCallback((rpc) =>
    openFullRangePositionInstructions(rpc, poolAddress, param, config),
  );
}

export function openConcentratedPosition(
  poolAddress: Address,
  param: IncreaseLiquidityParam,
  lowerPrice: number,
  upperPrice: number,
  config?: OpenPositionConfig,
) {
  return executeWithCallback((rpc) =>
    openPositionInstructions(
      rpc,
      poolAddress,
      param,
      lowerPrice,
      upperPrice,
      config,
    ),
  );
}

export function openConcentratedPositionWithTickBounds(
  poolAddress: Address,
  param: IncreaseLiquidityParam,
  lowerTickIndex: number,
  upperTickIndex: number,
  config?: OpenPositionConfig,
) {
  return executeWithCallback((rpc) =>
    openPositionInstructionsWithTickBounds(
      rpc,
      poolAddress,
      param,
      lowerTickIndex,
      upperTickIndex,
      config,
    ),
  );
}
