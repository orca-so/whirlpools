import type { Whirlpool } from "@orca-so/whirlpools-client";
import {
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
import { wrapFunctionWithExecution } from "./actionHelpers";

// TODO: allow specify number as well as bigint
// TODO: transfer hook

/** RPC client for increase-liquidity operations. Requires: GetAccountInfoApi, GetMultipleAccountsApi, GetMinimumBalanceForRentExemptionApi */
type IncreaseLiquidityRpc = Rpc<
  GetAccountInfoApi &
    GetMultipleAccountsApi &
    GetMinimumBalanceForRentExemptionApi
>;

/**
 * Represents the token max amount parameters for increasing liquidity.
 */
export type IncreaseLiquidityParam = {
  tokenMaxA: bigint;
  tokenMaxB: bigint;
};

/**
 * Represents the instructions for increasing liquidity in a position.
 */
export type IncreaseLiquidityInstructions = {
  /** List of Solana transaction instructions to execute. */
  instructions: Instruction[];
};

const SLIPPAGE_BPS_DENOMINATOR = 10_000n;
const SQRT_SLIPPAGE_DENOMINATOR = 100n;

function sqrtBigInt(value: bigint): bigint {
  if (value < 0n) {
    throw new Error("sqrtBigInt value must be non-negative");
  }
  if (value < 2n) {
    return value;
  }
  let prev = value / 2n;
  let next = (prev + value / prev) / 2n;
  while (next < prev) {
    prev = next;
    next = (prev + value / prev) / 2n;
  }
  return prev;
}

function getSqrtPriceSlippageBounds(
  sqrtPrice: bigint,
  slippageToleranceBps: number,
): { minSqrtPrice: bigint; maxSqrtPrice: bigint } {
  const boundedBps = BigInt(
    Math.max(
      0,
      Math.min(slippageToleranceBps, Number(SLIPPAGE_BPS_DENOMINATOR)),
    ),
  );
  const lowerFactor = sqrtBigInt(SLIPPAGE_BPS_DENOMINATOR - boundedBps);
  const upperFactor = sqrtBigInt(SLIPPAGE_BPS_DENOMINATOR + boundedBps);
  return {
    minSqrtPrice: (sqrtPrice * lowerFactor) / SQRT_SLIPPAGE_DENOMINATOR,
    maxSqrtPrice: (sqrtPrice * upperFactor) / SQRT_SLIPPAGE_DENOMINATOR,
  };
}

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
    ...rest
  }: {
    whirlpool: Account<Whirlpool>;
    param: IncreaseLiquidityParam;
    mintA: Account<Mint>;
    mintB: Account<Mint>;
    slippageToleranceBps: number;
    authority: TransactionSigner<string>;
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
    getIncreaseLiquidityByTokenAmountsV2Instruction({
      method: increaseLiquidityMethod("ByTokenAmounts", {
        minSqrtPrice,
        maxSqrtPrice,
        tokenMaxA,
        tokenMaxB,
      }),
      ...commonInstructionParams,
    });

  return {
    createTokenAccountInstructions,
    increaseLiquidityInstruction,
    cleanupInstructions,
  };
}

/**
 * Generates instructions to increase liquidity for an existing position.
 *
 * @param {SolanaRpc} rpc - RPC client. Requires: GetAccountInfoApi, GetMultipleAccountsApi, GetMinimumBalanceForRentExemptionApi
 * @param {Address} positionMintAddress - The mint address of the NFT that represents the position.
 * @param {IncreaseLiquidityParam} param - Maximum amounts of token A and B to deposit.
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The maximum acceptable slippage, in basis points (BPS).
 * @param {TransactionSigner} [authority=FUNDER] - The account that authorizes the transaction.
 * @returns {Promise<IncreaseLiquidityInstructions>} A promise that resolves to an object containing instructions.
 *
 * @example
 * import { increaseLiquidityInstructions, setWhirlpoolsConfig } from '@orca-so/whirlpools';
 * import { createSolanaRpc, devnet, address } from '@solana/kit';
 * import { loadWallet } from './utils';
 *
 * await setWhirlpoolsConfig('solanaDevnet');
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await loadWallet();
 * const positionMint = address("HqoV7Qv27REUtmd9UKSJGGmCRNx3531t33bDG1BUfo9K");
 * const { instructions } = await increaseLiquidityInstructions(
 *   devnetRpc,
 *   positionMint,
 *   { tokenMaxA: 10n, tokenMaxB: 12n },
 *   100,
 *   wallet
 * );
 */
export async function increaseLiquidityInstructions(
  rpc: IncreaseLiquidityRpc,
  positionMintAddress: Address,
  param: IncreaseLiquidityParam,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  authority: TransactionSigner<string> = FUNDER,
): Promise<IncreaseLiquidityInstructions> {
  assert(
    authority.address !== DEFAULT_ADDRESS,
    "Either supply the authority or set the default funder",
  );

  const positionAddress = await getPositionAddress(positionMintAddress);
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
      getTickArrayAddress(whirlpool.address, lowerTickArrayStartIndex).then(
        (x) => x[0],
      ),
      getTickArrayAddress(whirlpool.address, upperTickArrayStartIndex).then(
        (x) => x[0],
      ),
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
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  withTokenMetadataExtension: boolean = true,
  funder: TransactionSigner<string> = FUNDER,
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
    getPositionAddress(positionMint.address),
    findAssociatedTokenPda({
      owner: funder.address,
      mint: positionMint.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }).then((x) => x[0]),
    getTickArrayAddress(whirlpool.address, lowerTickArrayIndex).then(
      (x) => x[0],
    ),
    getTickArrayAddress(whirlpool.address, upperTickArrayIndex).then(
      (x) => x[0],
    ),
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
      getInitializeDynamicTickArrayInstruction({
        whirlpool: whirlpool.address,
        funder,
        tickArray: lowerTickArrayAddress,
        startTickIndex: lowerTickArrayIndex,
        idempotent: false,
      }),
    );
    nonRefundableRent += calculateMinimumBalanceForRentExemption(
      rent,
      getDynamicTickArrayMinSize(),
    );
  }

  if (!upperTickArray.exists && lowerTickArrayIndex !== upperTickArrayIndex) {
    instructions.push(
      getInitializeDynamicTickArrayInstruction({
        whirlpool: whirlpool.address,
        funder,
        tickArray: upperTickArrayAddress,
        startTickIndex: upperTickArrayIndex,
        idempotent: false,
      }),
    );
    nonRefundableRent += calculateMinimumBalanceForRentExemption(
      rent,
      getDynamicTickArrayMinSize(),
    );
  }

  instructions.push(
    getOpenPositionWithTokenExtensionsInstruction({
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
    }),
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
 * Opens a full-range position for a pool, typically used for Splash Pools or other full-range liquidity provisioning.
 *
 * @param {SolanaRpc} rpc - RPC client. Requires: GetAccountInfoApi, GetMultipleAccountsApi, GetMinimumBalanceForRentExemptionApi
 * @param {Address} poolAddress - The address of the liquidity pool.
 * @param {IncreaseLiquidityParam} param - Maximum amounts of token A and B to deposit.
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The maximum acceptable slippage, in basis points (BPS).
 * @param {boolean} [withTokenMetadataExtension=true] - Whether to include the token metadata extension.
 * @param {TransactionSigner} [funder=FUNDER] - The account funding the transaction.
 * @returns {Promise<OpenPositionInstructions>} A promise that resolves to an object containing instructions, position mint address, and initialization cost.
 *
 * @example
 * import { openFullRangePositionInstructions, setWhirlpoolsConfig } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet, address } from '@solana/kit';
 *
 * await setWhirlpoolsConfig('solanaDevnet');
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner(); // CAUTION: This wallet is not persistent.
 *
 * const whirlpoolAddress = address("POOL_ADDRESS");
 *
 * const { instructions, initializationCost, positionMint } = await openFullRangePositionInstructions(
 *   devnetRpc,
 *   whirlpoolAddress,
 *   { tokenMaxA: 1_000_000n, tokenMaxB: 0n },
 *   100,
 *   true,
 *   wallet
 * );
 */
export async function openFullRangePositionInstructions(
  rpc: IncreaseLiquidityRpc,
  poolAddress: Address,
  param: IncreaseLiquidityParam,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  withTokenMetadataExtension: boolean = true,
  funder: TransactionSigner<string> = FUNDER,
): Promise<OpenPositionInstructions> {
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
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The slippage tolerance for adding liquidity, in basis points (BPS).
 * @param {boolean} [withTokenMetadataExtension=true] - Whether to include the token metadata extension.
 * @param {TransactionSigner} [funder=FUNDER] - The account funding the transaction.
 *
 * @returns {Promise<OpenPositionInstructions>} A promise that resolves to an object containing instructions, position mint address, and initialization cost.
 *
 * @example
 * import { openPositionInstructions, setWhirlpoolsConfig } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet, address } from '@solana/kit';
 *
 * await setWhirlpoolsConfig('solanaDevnet');
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
 *   100,
 *   true,
 *   wallet
 * );
 */
export async function openPositionInstructions(
  rpc: IncreaseLiquidityRpc,
  poolAddress: Address,
  param: IncreaseLiquidityParam,
  lowerPrice: number,
  upperPrice: number,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  withTokenMetadataExtension: boolean = true,
  funder: TransactionSigner<string> = FUNDER,
): Promise<OpenPositionInstructions> {
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
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The slippage tolerance for adding liquidity, in basis points (BPS).
 * @param {boolean} [withTokenMetadataExtension=true] - Whether to include the token metadata extension.
 * @param {TransactionSigner} [funder=FUNDER] - The account funding the transaction.
 *
 * @returns {Promise<OpenPositionInstructions>} A promise that resolves to an object containing instructions, position mint address, and initialization cost.
 *
 * @example
 * import { openPositionInstructionsWithTickBounds, setWhirlpoolsConfig } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet, address } from '@solana/kit';
 *
 * await setWhirlpoolsConfig('solanaDevnet');
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
 *   100,
 *   true,
 *   wallet
 * );
 */
export async function openPositionInstructionsWithTickBounds(
  rpc: IncreaseLiquidityRpc,
  poolAddress: Address,
  param: IncreaseLiquidityParam,
  lowerTickIndex: number,
  upperTickIndex: number,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  withTokenMetadataExtension: boolean = true,
  funder: TransactionSigner<string> = FUNDER,
): Promise<OpenPositionInstructions> {
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
  );
}

function assertWhirlpoolSupportsConcentratedPosition(whirlpool: Whirlpool) {
  assert(
    whirlpool.tickSpacing !== SPLASH_POOL_TICK_SPACING,
    "Splash pools only support full range positions",
  );
}

// -------- ACTIONS --------

export const increasePosLiquidity = wrapFunctionWithExecution(
  increaseLiquidityInstructions,
);

export const openFullRangePosition = wrapFunctionWithExecution(
  openFullRangePositionInstructions,
);

export const openConcentratedPosition = wrapFunctionWithExecution(
  openPositionInstructions,
);

export const openConcentratedPositionWithTickBounds = wrapFunctionWithExecution(
  openPositionInstructionsWithTickBounds,
);
