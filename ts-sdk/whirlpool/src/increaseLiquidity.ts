import type { Whirlpool } from "@orca-so/whirlpools-client";
import {
  fetchAllMaybeTickArray,
  fetchPosition,
  fetchWhirlpool,
  getIncreaseLiquidityInstruction,
  getInitializeTickArrayInstruction,
  getOpenPositionInstruction,
  getOpenPositionWithMetadataInstruction,
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
  DEFAULT_SLIPPAGE_TOLERANCE,
} from "./config";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getMintSize,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import invariant from "tiny-invariant";
import { getCurrentTransferFee, prepareTokenAccountsInstructions } from "./token";
import type { Mint} from "@solana-program/token-2022";
import { fetchAllMint, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";

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
  slippageTolerance: number,
  transferFeeA: TransferFee | undefined,
  transferFeeB: TransferFee | undefined,
): IncreaseLiquidityQuote {
  const slippageToleranceBps = Math.floor(slippageTolerance * 10000);
  if ("liquidity" in param) {
    return increaseLiquidityQuote(
      param.liquidity,
      slippageToleranceBps,
      pool.tickCurrentIndex,
      tickRange.tickLowerIndex,
      tickRange.tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  } else if ("tokenA" in param) {
    return increaseLiquidityQuoteA(
      param.tokenA,
      slippageToleranceBps,
      pool.tickCurrentIndex,
      tickRange.tickLowerIndex,
      tickRange.tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  } else {
    return increaseLiquidityQuoteB(
      param.tokenB,
      slippageToleranceBps,
      pool.tickCurrentIndex,
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
  positionMint: Address,
  param: IncreaseLiquidityQuoteParam,
  slippageTolerance: number = DEFAULT_SLIPPAGE_TOLERANCE,
  authority: TransactionPartialSigner = DEFAULT_FUNDER,
): Promise<IncreaseLiquidityInstructions> {
  invariant(
    authority.address !== DEFAULT_ADDRESS,
    "Either supply the authority or set the default funder",
  );

  const positionAddress = await getPositionAddress(positionMint);
  const position = await fetchPosition(rpc, positionAddress[0]);
  const whirlpool = await fetchWhirlpool(rpc, position.data.whirlpool);

  const currentEpoch = await rpc.getEpochInfo().send();
  const [mintA, mintB] = await fetchAllMint(rpc, [whirlpool.data.tokenMintA, whirlpool.data.tokenMintB]);
  const transferFeeA = getCurrentTransferFee(mintA.data, currentEpoch.epoch);
  const transferFeeB = getCurrentTransferFee(mintB.data, currentEpoch.epoch);

  const quote = getIncreaseLiquidityQuote(
    param,
    whirlpool.data,
    position.data,
    slippageTolerance,
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
        mint: positionMint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
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
  mintA: Mint,
  mintB: Mint,
  slippageTolerance: number = DEFAULT_SLIPPAGE_TOLERANCE,
  funder: TransactionPartialSigner = DEFAULT_FUNDER,
): Promise<IncreaseLiquidityInstructions> {
  invariant(
    funder.address !== DEFAULT_ADDRESS,
    "Either supply a funder or set the default funder",
  );
  const instructions: IInstruction[] = [];
  let stateSpace = 0;

  const initializableLowerTickIndex = getInitializableTickIndex(
    lowerTickIndex,
    whirlpool.data.tickSpacing,
    false,
  );
  const initializableUpperTickIndex = getInitializableTickIndex(
    upperTickIndex,
    whirlpool.data.tickSpacing,
    true,
  );
  const tickRange = orderTickIndexes(
    initializableLowerTickIndex,
    initializableUpperTickIndex,
  );

  const currentEpoch = await rpc.getEpochInfo().send();
  const transferFeeA = getCurrentTransferFee(mintA, currentEpoch.epoch);
  const transferFeeB = getCurrentTransferFee(mintB, currentEpoch.epoch);

  const quote = getIncreaseLiquidityQuote(
    param,
    whirlpool.data,
    tickRange,
    slippageTolerance,
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
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
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

  if (!upperTickArray.exists) {
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
    getIncreaseLiquidityInstruction({
      whirlpool: whirlpool.address,
      positionAuthority: funder,
      position: positionAddress[0],
      positionTokenAccount,
      tokenOwnerAccountA: tokenAccountAddresses[whirlpool.data.tokenMintA],
      tokenOwnerAccountB: tokenAccountAddresses[whirlpool.data.tokenMintB],
      tokenVaultA: whirlpool.data.tokenVaultA,
      tokenVaultB: whirlpool.data.tokenVaultB,
      tickArrayLower: lowerTickArrayAddress,
      tickArrayUpper: upperTickArrayAddress,
      liquidityAmount: quote.liquidityDelta,
      tokenMaxA: quote.tokenMaxA,
      tokenMaxB: quote.tokenMaxB,
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
  slippageTolerance: number = DEFAULT_SLIPPAGE_TOLERANCE,
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
    mintA.data,
    mintB.data,
    slippageTolerance,
    funder,
  );
}

export async function openSplashPoolPositionInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi
  >,
  poolAddress: Address,
  param: IncreaseLiquidityQuoteParam,
  slippageTolerance: number = DEFAULT_SLIPPAGE_TOLERANCE,
  funder: TransactionPartialSigner = DEFAULT_FUNDER,
): Promise<IncreaseLiquidityInstructions> {
  const whirlpool = await fetchWhirlpool(rpc, poolAddress);
  const [mintA, mintB] = await fetchAllMint(rpc, [
    whirlpool.data.tokenMintA,
    whirlpool.data.tokenMintB,
  ]);
  const tickRange = getFullRangeTickIndexes(whirlpool.data.tickSpacing);
  return internalOpenPositionInstructions(
    rpc,
    whirlpool,
    param,
    tickRange.tickLowerIndex,
    tickRange.tickUpperIndex,
    mintA.data,
    mintB.data,
    slippageTolerance,
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
  slippageTolerance: number = DEFAULT_SLIPPAGE_TOLERANCE,
  funder: TransactionPartialSigner = DEFAULT_FUNDER,
): Promise<IncreaseLiquidityInstructions> {
  const whirlpool = await fetchWhirlpool(rpc, poolAddress);
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
    mintA.data,
    mintB.data,
    slippageTolerance,
    funder,
  );
}
