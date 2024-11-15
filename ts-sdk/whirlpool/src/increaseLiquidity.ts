import type { Whirlpool } from "@orca-so/whirlpools-client";
import {
  fetchAllMaybeTickArray,
  fetchPosition,
  fetchWhirlpool,
  getIncreaseLiquidityV2Instruction,
  getInitializeTickArrayInstruction,
  getOpenPositionWithTokenExtensionsInstruction,
  getPositionAddress,
  getTickArrayAddress,
  getTickArraySize,
} from "@orca-so/whirlpools-client";
import type {
  IncreaseLiquidityQuote,
  TickRange,
  TransferFee,
} from "@orca-so/whirlpools-core";
import {
  _MAX_TICK_INDEX,
  _MIN_TICK_INDEX,
  getFullRangeTickIndexes,
  getTickArrayStartTickIndex,
  increaseLiquidityQuote,
  increaseLiquidityQuoteA,
  increaseLiquidityQuoteB,
  priceToTickIndex,
  getInitializableTickIndex,
  orderTickIndexes,
} from "@orca-so/whirlpools-core";
import type {
  Account,
  Address,
  GetAccountInfoApi,
  GetEpochInfoApi,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  IInstruction,
  Lamports,
  Rpc,
  TransactionSigner,
} from "@solana/web3.js";
import { address, generateKeyPairSigner, lamports } from "@solana/web3.js";
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
import {
  getCurrentTransferFee,
  prepareTokenAccountsInstructions,
} from "./token";
import type { Mint } from "@solana-program/token-2022";
import {
  fetchAllMint,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import assert from "assert";
import { calculateMinimumBalanceForRentExemption } from "./sysvar";

// TODO: allow specify number as well as bigint
// TODO: transfer hook

/**
 * Represents the parameters for increasing liquidity.
 * You must choose only one of the properties (`liquidity`, `tokenA`, or `tokenB`).
 * The SDK will compute the other two based on the input provided.
 */
export type IncreaseLiquidityQuoteParam =
  | {
      /** The amount of liquidity to increase. */
      liquidity: bigint;
    }
  | {
      /** The amount of Token A to add. */
      tokenA: bigint;
    }
  | {
      /** The amount of Token B to add. */
      tokenB: bigint;
    };

/**
 * Represents the instructions and quote for increasing liquidity in a position.
 */
export type IncreaseLiquidityInstructions = {
  /** The quote object with details about the increase in liquidity, including the liquidity delta, estimated tokens, and maximum token amounts based on slippage tolerance. */
  quote: IncreaseLiquidityQuote;

  /** List of Solana transaction instructions to execute. */
  instructions: IInstruction[];
};

function getIncreaseLiquidityQuote(
  param: IncreaseLiquidityQuoteParam,
  pool: Whirlpool,
  tickLowerIndex: number,
  tickUpperIndex: number,
  slippageToleranceBps: number,
  transferFeeA: TransferFee | undefined,
  transferFeeB: TransferFee | undefined,
): IncreaseLiquidityQuote {
  if ("liquidity" in param) {
    return increaseLiquidityQuote(
      param.liquidity,
      slippageToleranceBps,
      pool.sqrtPrice,
      tickLowerIndex,
      tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  } else if ("tokenA" in param) {
    return increaseLiquidityQuoteA(
      param.tokenA,
      slippageToleranceBps,
      pool.sqrtPrice,
      tickLowerIndex,
      tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  } else {
    return increaseLiquidityQuoteB(
      param.tokenB,
      slippageToleranceBps,
      pool.sqrtPrice,
      tickLowerIndex,
      tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  }
}

/**
 * Generates instructions to increase liquidity for an existing position.
 *
 * @param {SolanaRpc} rpc - The Solana RPC client.
 * @param {Address} positionMintAddress - The mint address of the NFT that represents the position.
 * @param {IncreaseLiquidityQuoteParam} param - The parameters for adding liquidity. Can specify liquidity, Token A, or Token B amounts.
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The maximum acceptable slippage, in basis points (BPS).
 * @param {TransactionSigner} [authority=FUNDER] - The account that authorizes the transaction.
 * @returns {Promise<IncreaseLiquidityInstructions>} A promise that resolves to an object containing instructions, quote, position mint address, and initialization costs for increasing liquidity.
 *
 * @example
 * import { increaseLiquidityInstructions } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet, lamports } from '@solana/web3.js';
 *
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const keyPairBytes = new Uint8Array(JSON.parse(fs.readFileSync('path/to/solana-keypair.json', 'utf8')));
 * const wallet = await generateKeyPairSigner(); // CAUTION: This wallet is not persistent.
 * await devnetRpc.requestAirdrop(wallet.address, lamports(1000000000n)).send();
 *
 * const positionMint = "POSITION_MINT";
 *
 * const param = { tokenA: 1_000_000n };
 *
 * const { quote, instructions, initializationCost, positionMint } = await increaseLiquidityInstructions(
 *   devnetRpc,
 *   positionMint,
 *   param,
 *   100,
 *   wallet
 * );
 */
export async function increaseLiquidityInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi &
      GetEpochInfoApi
  >,
  positionMintAddress: Address,
  param: IncreaseLiquidityQuoteParam,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  authority: TransactionSigner = FUNDER,
): Promise<IncreaseLiquidityInstructions> {
  assert(
    authority.address !== DEFAULT_ADDRESS,
    "Either supply the authority or set the default funder",
  );

  const positionAddress = await getPositionAddress(positionMintAddress);
  const position = await fetchPosition(rpc, positionAddress[0]);
  const whirlpool = await fetchWhirlpool(rpc, position.data.whirlpool);

  const currentEpoch = await rpc.getEpochInfo().send();
  const [mintA, mintB, positionMint] = await fetchAllMint(rpc, [
    whirlpool.data.tokenMintA,
    whirlpool.data.tokenMintB,
    positionMintAddress,
  ]);
  const transferFeeA = getCurrentTransferFee(mintA, currentEpoch.epoch);
  const transferFeeB = getCurrentTransferFee(mintB, currentEpoch.epoch);

  const quote = getIncreaseLiquidityQuote(
    param,
    whirlpool.data,
    position.data.tickLowerIndex,
    position.data.tickUpperIndex,
    slippageToleranceBps,
    transferFeeA,
    transferFeeB,
  );
  const instructions: IInstruction[] = [];

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

  const { createInstructions, cleanupInstructions, tokenAccountAddresses } =
    await prepareTokenAccountsInstructions(rpc, authority, {
      [whirlpool.data.tokenMintA]: quote.tokenMaxA,
      [whirlpool.data.tokenMintB]: quote.tokenMaxB,
    });

  instructions.push(...createInstructions);

  // Since position exists tick arrays must also already exist

  instructions.push(
    getIncreaseLiquidityV2Instruction({
      whirlpool: whirlpool.address,
      positionAuthority: authority,
      position: position.address,
      positionTokenAccount,
      tokenOwnerAccountA: tokenAccountAddresses[whirlpool.data.tokenMintA],
      tokenOwnerAccountB: tokenAccountAddresses[whirlpool.data.tokenMintB],
      tokenVaultA: whirlpool.data.tokenVaultA,
      tokenVaultB: whirlpool.data.tokenVaultB,
      tokenMintA: whirlpool.data.tokenMintA,
      tokenMintB: whirlpool.data.tokenMintB,
      tokenProgramA: mintA.programAddress,
      tokenProgramB: mintB.programAddress,
      tickArrayLower,
      tickArrayUpper,
      liquidityAmount: quote.liquidityDelta,
      tokenMaxA: quote.tokenMaxA,
      tokenMaxB: quote.tokenMaxB,
      memoProgram: MEMO_PROGRAM_ADDRESS,
      remainingAccountsInfo: null,
    }),
  );

  instructions.push(...cleanupInstructions);

  return {
    quote,
    instructions,
  };
}

/**
 * Represents the instructions and quote for opening a position.
 * Extends IncreaseLiquidityInstructions with additional fields for position initialization.
 */
export type OpenPositionInstructions = IncreaseLiquidityInstructions & {
  /** The initialization cost for opening the position in lamports. */
  initializationCost: Lamports;

  /** The mint address of the position NFT. */
  positionMint: Address;
};

async function internalOpenPositionInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi &
      GetEpochInfoApi
  >,
  whirlpool: Account<Whirlpool>,
  param: IncreaseLiquidityQuoteParam,
  lowerTickIndex: number,
  upperTickIndex: number,
  mintA: Account<Mint>,
  mintB: Account<Mint>,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  funder: TransactionSigner = FUNDER,
): Promise<OpenPositionInstructions> {
  assert(
    funder.address !== DEFAULT_ADDRESS,
    "Either supply a funder or set the default funder",
  );
  const instructions: IInstruction[] = [];
  
  const rent = await fetchSysvarRent(rpc);
  let nonRefundableRent: bigint = 0n;

  const tickRange = orderTickIndexes(
    lowerTickIndex,
    upperTickIndex,
  );

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

  const currentEpoch = await rpc.getEpochInfo().send();
  const transferFeeA = getCurrentTransferFee(mintA, currentEpoch.epoch);
  const transferFeeB = getCurrentTransferFee(mintB, currentEpoch.epoch);

  const quote = getIncreaseLiquidityQuote(
    param,
    whirlpool.data,
    initializableLowerTickIndex,
    initializableUpperTickIndex,
    slippageToleranceBps,
    transferFeeA,
    transferFeeB,
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

  const { createInstructions, cleanupInstructions, tokenAccountAddresses } =
    await prepareTokenAccountsInstructions(rpc, funder, {
      [whirlpool.data.tokenMintA]: quote.tokenMaxA,
      [whirlpool.data.tokenMintB]: quote.tokenMaxB,
    });

  instructions.push(...createInstructions);

  const [lowerTickArray, upperTickArray] = await fetchAllMaybeTickArray(rpc, [
    lowerTickArrayAddress,
    upperTickArrayAddress,
  ]);

  if (!lowerTickArray.exists) {
    instructions.push(
      getInitializeTickArrayInstruction({
        whirlpool: whirlpool.address,
        funder,
        tickArray: lowerTickArrayAddress,
        startTickIndex: lowerTickIndex,
      }),
    );
    nonRefundableRent += calculateMinimumBalanceForRentExemption(rent, getTickArraySize());
  }

  if (!upperTickArray.exists && lowerTickArrayIndex !== upperTickArrayIndex) {
    instructions.push(
      getInitializeTickArrayInstruction({
        whirlpool: whirlpool.address,
        funder,
        tickArray: upperTickArrayAddress,
        startTickIndex: upperTickIndex,
      }),
    );
    nonRefundableRent += calculateMinimumBalanceForRentExemption(rent, getTickArraySize());
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
      withTokenMetadataExtension: true,
    }),
  );

  instructions.push(
    getIncreaseLiquidityV2Instruction({
      whirlpool: whirlpool.address,
      positionAuthority: funder,
      position: positionAddress[0],
      positionTokenAccount,
      tokenOwnerAccountA: tokenAccountAddresses[whirlpool.data.tokenMintA],
      tokenOwnerAccountB: tokenAccountAddresses[whirlpool.data.tokenMintB],
      tokenVaultA: whirlpool.data.tokenVaultA,
      tokenVaultB: whirlpool.data.tokenVaultB,
      tokenMintA: whirlpool.data.tokenMintA,
      tokenMintB: whirlpool.data.tokenMintB,
      tokenProgramA: mintA.programAddress,
      tokenProgramB: mintB.programAddress,
      tickArrayLower: lowerTickArrayAddress,
      tickArrayUpper: upperTickArrayAddress,
      liquidityAmount: quote.liquidityDelta,
      tokenMaxA: quote.tokenMaxA,
      tokenMaxB: quote.tokenMaxB,
      memoProgram: MEMO_PROGRAM_ADDRESS,
      remainingAccountsInfo: null,
    }),
  );

  instructions.push(...cleanupInstructions);

  return {
    instructions,
    quote,
    positionMint: positionMint.address,
    initializationCost: lamports(nonRefundableRent),
  };
}

/**
 * Opens a full-range position for a pool, typically used for Splash Pools or other full-range liquidity provisioning.
 *
 * @param {SolanaRpc} rpc - The Solana RPC client.
 * @param {Address} poolAddress - The address of the liquidity pool.
 * @param {IncreaseLiquidityQuoteParam} param - The parameters for adding liquidity, where one of `liquidity`, `tokenA`, or `tokenB` must be specified. The SDK will compute the others.
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The maximum acceptable slippage, in basis points (BPS).
 * @param {TransactionSigner} [funder=FUNDER] - The account funding the transaction.
 * @returns {Promise<OpenPositionInstructions>} A promise that resolves to an object containing the instructions, quote, position mint address, and initialization costs for increasing liquidity.
 *
 * @example
 * import { openFullRangePositionInstructions } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet, lamports } from '@solana/web3.js';
 *
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const keyPairBytes = new Uint8Array(JSON.parse(fs.readFileSync('path/to/solana-keypair.json', 'utf8')));
 * const wallet = await generateKeyPairSigner(); // CAUTION: This wallet is not persistent.
 * await devnetRpc.requestAirdrop(wallet.address, lamports(1000000000n)).send();
 *
 * const poolAddress = "POOL_ADDRESS";
 *
 * const param = { tokenA: 1_000_000n };
 *
 * const { quote, instructions, initializationCost, positionMint } = await openFullRangePositionInstructions(
 *   devnetRpc,
 *   poolAddress,
 *   param,
 *   100,
 *   wallet
 * );
 */
export async function openFullRangePositionInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi &
      GetEpochInfoApi
  >,
  poolAddress: Address,
  param: IncreaseLiquidityQuoteParam,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  funder: TransactionSigner = FUNDER,
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
    funder,
  );
}

/**
 * Opens a new position in a concentrated liquidity pool within a specific price range.
 * This function allows you to provide liquidity for the specified range of prices and adjust liquidity parameters accordingly.
 *
 * **Note:** This function cannot be used with Splash Pools.
 *
 * @param {SolanaRpc} rpc - A Solana RPC client used to interact with the blockchain.
 * @param {Address} poolAddress - The address of the liquidity pool where the position will be opened.
 * @param {IncreaseLiquidityQuoteParam} param - The parameters for increasing liquidity, where you must choose one (`liquidity`, `tokenA`, or `tokenB`). The SDK will compute the other two.
 * @param {number} lowerPrice - The lower bound of the price range for the position.
 * @param {number} upperPrice - The upper bound of the price range for the position.
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The slippage tolerance for adding liquidity, in basis points (BPS).
 * @param {TransactionSigner} [funder=FUNDER] - The account funding the transaction.
 *
 * @returns {Promise<OpenPositionInstructions>} A promise that resolves to an object containing instructions, quote, position mint address, and initialization costs for increasing liquidity.
 *
 * @example
 * import { openPositionInstructions } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet } from '@solana/web3.js';
 *
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner();
 * await devnetRpc.requestAirdrop(wallet.address, lamports(1000000000n)).send();
 *
 * const poolAddress = "POOL_ADDRESS";
 *
 * const param = { tokenA: 1_000_000n };
 * const lowerPrice = 0.00005;
 * const upperPrice = 0.00015;
 *
 * const { quote, instructions, initializationCost, positionMint } = await openPositionInstructions(
 *   devnetRpc,
 *   poolAddress,
 *   param,
 *   lowerPrice,
 *   upperPrice,
 *   100,
 *   wallet
 * );
 */
export async function openPositionInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi &
      GetEpochInfoApi
  >,
  poolAddress: Address,
  param: IncreaseLiquidityQuoteParam,
  lowerPrice: number,
  upperPrice: number,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  funder: TransactionSigner = FUNDER,
): Promise<OpenPositionInstructions> {
  const whirlpool = await fetchWhirlpool(rpc, poolAddress);
  assert(
    whirlpool.data.tickSpacing !== SPLASH_POOL_TICK_SPACING,
    "Splash pools only support full range positions",
  );
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
    funder,
  );
}
