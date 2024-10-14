import type { Whirlpool } from "@orca-so/whirlpools-client";
import {
  fetchAllMaybeTickArray,
  fetchPosition,
  fetchWhirlpool,
  getIncreaseLiquidityInstruction,
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
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  IInstruction,
  LamportsUnsafeBeyond2Pow53Minus1,
  Rpc,
  TransactionPartialSigner,
} from "@solana/web3.js";
import { generateKeyPairSigner, lamports } from "@solana/web3.js";
import {
  DEFAULT_ADDRESS,
  DEFAULT_FUNDER,
  DEFAULT_SLIPPAGE_TOLERANCE_BPS,
  SPLASH_POOL_TICK_SPACING,
} from "./config";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getMintSize,
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

// TODO: allow specify number as well as bigint
// TODO: transfer hook

type IncreaseLiquidityQuoteParam =
  | {
      liquidity: bigint;
    }
  | {
      tokenA: bigint;
    }
  | {
      tokenB: bigint;
    };

type IncreaseLiquidityInstructions = {
  quote: IncreaseLiquidityQuote;
  initializationCost: LamportsUnsafeBeyond2Pow53Minus1;
  instructions: IInstruction[];
};

function getIncreaseLiquidityQuote(
  param: IncreaseLiquidityQuoteParam,
  pool: Whirlpool,
  tickRange: TickRange,
  slippageToleranceBps: number,
  transferFeeA: TransferFee | undefined,
  transferFeeB: TransferFee | undefined,
): IncreaseLiquidityQuote {
  if ("liquidity" in param) {
    return increaseLiquidityQuote(
      param.liquidity,
      slippageToleranceBps,
      pool.sqrtPrice,
      tickRange.tickLowerIndex,
      tickRange.tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  } else if ("tokenA" in param) {
    return increaseLiquidityQuoteA(
      param.tokenA,
      slippageToleranceBps,
      pool.sqrtPrice,
      tickRange.tickLowerIndex,
      tickRange.tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  } else {
    return increaseLiquidityQuoteB(
      param.tokenB,
      slippageToleranceBps,
      pool.sqrtPrice,
      tickRange.tickLowerIndex,
      tickRange.tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  }
}

export async function increaseLiquidityInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi
  >,
  positionMintAddress: Address,
  param: IncreaseLiquidityQuoteParam,
  slippageToleranceBps: number = DEFAULT_SLIPPAGE_TOLERANCE_BPS,
  authority: TransactionPartialSigner = DEFAULT_FUNDER,
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
  const transferFeeA = getCurrentTransferFee(mintA.data, currentEpoch.epoch);
  const transferFeeB = getCurrentTransferFee(mintB.data, currentEpoch.epoch);

  const quote = getIncreaseLiquidityQuote(
    param,
    whirlpool.data,
    position.data,
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
    getIncreaseLiquidityInstruction({
      whirlpool: whirlpool.address,
      positionAuthority: authority,
      position: position.address,
      positionTokenAccount,
      tokenOwnerAccountA: tokenAccountAddresses[whirlpool.data.tokenMintA],
      tokenOwnerAccountB: tokenAccountAddresses[whirlpool.data.tokenMintB],
      tokenVaultA: whirlpool.data.tokenVaultA,
      tokenVaultB: whirlpool.data.tokenVaultB,
      tickArrayLower,
      tickArrayUpper,
      liquidityAmount: quote.liquidityDelta,
      tokenMaxA: quote.tokenMaxA,
      tokenMaxB: quote.tokenMaxB,
    }),
  );

  instructions.push(...cleanupInstructions);

  return { quote, instructions, initializationCost: lamports(0n) };
}

async function internalOpenPositionInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi
  >,
  whirlpool: Account<Whirlpool>,
  param: IncreaseLiquidityQuoteParam,
  lowerTickIndex: number,
  upperTickIndex: number,
  mintA: Account<Mint>,
  mintB: Account<Mint>,
  slippageToleranceBps: number = DEFAULT_SLIPPAGE_TOLERANCE_BPS,
  funder: TransactionPartialSigner = DEFAULT_FUNDER,
): Promise<IncreaseLiquidityInstructions> {
  assert(
    funder.address !== DEFAULT_ADDRESS,
    "Either supply a funder or set the default funder",
  );
  const instructions: IInstruction[] = [];
  let stateSpace = 0;

  const initializableLowerTickIndex = getInitializableTickIndex(
    lowerTickIndex,
    whirlpool.data.tickSpacing,
  );
  const initializableUpperTickIndex = getInitializableTickIndex(
    upperTickIndex,
    whirlpool.data.tickSpacing,
  );
  const tickRange = orderTickIndexes(
    initializableLowerTickIndex,
    initializableUpperTickIndex,
  );

  const currentEpoch = await rpc.getEpochInfo().send();
  const transferFeeA = getCurrentTransferFee(mintA.data, currentEpoch.epoch);
  const transferFeeB = getCurrentTransferFee(mintB.data, currentEpoch.epoch);

  const quote = getIncreaseLiquidityQuote(
    param,
    whirlpool.data,
    tickRange,
    slippageToleranceBps,
    transferFeeA,
    transferFeeB,
  );

  const positionMint = await generateKeyPairSigner();

  const lowerTickArrayIndex = getTickArrayStartTickIndex(
    tickRange.tickLowerIndex,
    whirlpool.data.tickSpacing,
  );
  const upperTickArrayIndex = getTickArrayStartTickIndex(
    tickRange.tickUpperIndex,
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
    stateSpace += getTickArraySize();
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
    stateSpace += getTickArraySize();
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
      tickLowerIndex: tickRange.tickLowerIndex,
      tickUpperIndex: tickRange.tickUpperIndex,
      token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
      metadataUpdateAuth: positionAddress[0],
      withTokenMetadataExtension: true,
    }),
  );
  stateSpace += getMintSize();

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

  const nonRefundableRent = await rpc
    .getMinimumBalanceForRentExemption(BigInt(stateSpace))
    .send();
  const initializationCost = lamports(nonRefundableRent + 15616720n); // Rent + protocol fee for metaplex

  return {
    instructions,
    quote,
    initializationCost,
  };
}

export async function openFullRangePositionInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi
  >,
  poolAddress: Address,
  param: IncreaseLiquidityQuoteParam,
  slippageToleranceBps: number = DEFAULT_SLIPPAGE_TOLERANCE_BPS,
  funder: TransactionPartialSigner = DEFAULT_FUNDER,
): Promise<IncreaseLiquidityInstructions> {
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

export async function openPositionInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi
  >,
  poolAddress: Address,
  param: IncreaseLiquidityQuoteParam,
  lowerPrice: number,
  upperPrice: number,
  slippageToleranceBps: number = DEFAULT_SLIPPAGE_TOLERANCE_BPS,
  funder: TransactionPartialSigner = DEFAULT_FUNDER,
): Promise<IncreaseLiquidityInstructions> {
  const whirlpool = await fetchWhirlpool(rpc, poolAddress);
  assert(whirlpool.data.tickSpacing !== SPLASH_POOL_TICK_SPACING, "Splash pools only support full range positions");
  const [mintA, mintB] = await fetchAllMint(rpc, [
    whirlpool.data.tokenMintA,
    whirlpool.data.tokenMintB,
  ]);
  const decimalsA = mintA.data.decimals;
  const decimalsB = mintB.data.decimals;
  const lowerTickIndex = priceToTickIndex(lowerPrice, decimalsA, decimalsB);
  const lowerInitializableTickIndex = getInitializableTickIndex(
    lowerTickIndex,
    whirlpool.data.tickSpacing,
  );
  const upperTickIndex = priceToTickIndex(upperPrice, decimalsA, decimalsB);
  const upperInitializableTickIndex = getInitializableTickIndex(
    upperTickIndex,
    whirlpool.data.tickSpacing,
  );
  return internalOpenPositionInstructions(
    rpc,
    whirlpool,
    param,
    lowerInitializableTickIndex,
    upperInitializableTickIndex,
    mintA,
    mintB,
    slippageToleranceBps,
    funder,
  );
}
