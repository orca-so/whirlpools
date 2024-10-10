import type {
  Account,
  Address,
  GetAccountInfoApi,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  IInstruction,
  Rpc,
  TransactionPartialSigner,
} from "@solana/web3.js";
import { AccountRole } from "@solana/web3.js";
import { DEFAULT_FUNDER, DEFAULT_SLIPPAGE_TOLERANCE } from "./config";
import type {
  ExactInSwapQuote,
  ExactOutSwapQuote,
  TransferFee,
} from "@orca-so/whirlpools-core";
import {
  _TICK_ARRAY_SIZE,
  getTickArrayStartTickIndex,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
} from "@orca-so/whirlpools-core";
import type { TickArray, Whirlpool } from "@orca-so/whirlpools-client";
import {
  AccountsType,
  fetchAllTickArray,
  fetchWhirlpool,
  getOracleAddress,
  getSwapV2Instruction,
  getTickArrayAddress,
} from "@orca-so/whirlpools-client";
import { getCurrentTransferFee, prepareTokenAccountsInstructions } from "./token";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import { fetchAllMint } from "@solana-program/token-2022";

// TODO: allow specify number as well as bigint
// TODO: transfer hook

type ExactInParams = {
  inputAmount: bigint;
};

type ExactOutParams = {
  outputAmount: bigint;
};

type SwapParams = (ExactInParams | ExactOutParams) & {
  mint: Address;
};

type SwapQuote<T extends SwapParams> = T extends ExactInParams
  ? ExactInSwapQuote
  : ExactOutSwapQuote;

type SwapInstructions<T extends SwapParams> = {
  instructions: IInstruction[];
  quote: SwapQuote<T>;
};

function getSwapQuote<T extends SwapParams>(
  params: T,
  whirlpool: Whirlpool,
  transferFeeA: TransferFee | undefined,
  transferFeeB: TransferFee | undefined,
  tickArrays: Account<TickArray>[],
  specifiedTokenA: boolean,
  slippageTolerance: number,
): SwapQuote<T> {
  const slippageToleranceBps = Math.floor(slippageTolerance * 10000);
  if ("inputAmount" in params) {
    return swapQuoteByInputToken(
      params.inputAmount,
      specifiedTokenA,
      slippageToleranceBps,
      whirlpool,
      tickArrays[0].data,
      tickArrays[1].data,
      tickArrays[2].data,
      tickArrays[3].data,
      tickArrays[4].data,
      transferFeeA,
      transferFeeB,
    ) as SwapQuote<T>;
  }

  return swapQuoteByOutputToken(
    params.outputAmount,
    specifiedTokenA,
    slippageToleranceBps,
    whirlpool,
    tickArrays[0].data,
    tickArrays[1].data,
    tickArrays[2].data,
    tickArrays[3].data,
    tickArrays[4].data,
    transferFeeA,
    transferFeeB,
  ) as SwapQuote<T>;
}

export async function swapInstructions<T extends SwapParams>(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi
  >,
  params: T,
  poolAddress: Address,
  slippageTolerance: number = DEFAULT_SLIPPAGE_TOLERANCE,
  signer: TransactionPartialSigner = DEFAULT_FUNDER,
): Promise<SwapInstructions<T>> {
  const whirlpool = await fetchWhirlpool(rpc, poolAddress);
  const [tokenA, tokenB] = await fetchAllMint(rpc, [
    whirlpool.data.tokenMintA,
    whirlpool.data.tokenMintB,
  ]);
  const specifiedTokenA = params.mint === whirlpool.data.tokenMintA;
  const specifiedInput = "inputAmount" in params;

  const tickArrayStartIndex = getTickArrayStartTickIndex(
    whirlpool.data.tickCurrentIndex,
    whirlpool.data.tickSpacing,
  );
  const offset = whirlpool.data.tickSpacing * _TICK_ARRAY_SIZE();

  const tickArrayAddresses = await Promise.all([
    getTickArrayAddress(whirlpool.address, tickArrayStartIndex).then(
      (x) => x[0],
    ),
    getTickArrayAddress(whirlpool.address, tickArrayStartIndex + offset).then(
      (x) => x[0],
    ),
    getTickArrayAddress(
      whirlpool.address,
      tickArrayStartIndex + offset * 2,
    ).then((x) => x[0]),
    getTickArrayAddress(whirlpool.address, tickArrayStartIndex - offset).then(
      (x) => x[0],
    ),
    getTickArrayAddress(
      whirlpool.address,
      tickArrayStartIndex - offset * 2,
    ).then((x) => x[0]),
  ]);

  const tickArrays = await fetchAllTickArray(
    rpc,
    tickArrayAddresses,
  );
  const oracleAddress = await getOracleAddress(whirlpool.address).then(
    (x) => x[0],
  );

  const currentEpoch = await rpc.getEpochInfo().send();
  const transferFeeA = getCurrentTransferFee(tokenA.data, currentEpoch.epoch);
  const transferFeeB = getCurrentTransferFee(tokenB.data, currentEpoch.epoch);

  const quote = getSwapQuote<T>(
    params,
    whirlpool.data,
    transferFeeA,
    transferFeeB,
    tickArrays,
    specifiedTokenA,
    slippageTolerance,
  );
  const maxInAmount = "tokenIn" in quote ? quote.tokenIn : quote.tokenMaxIn;
  const tokenAIsInput = specifiedTokenA === specifiedInput;

  const { createInstructions, cleanupInstructions, tokenAccountAddresses } =
    await prepareTokenAccountsInstructions(rpc, signer, {
      [whirlpool.data.tokenMintA]: tokenAIsInput ? maxInAmount : 0n,
      [whirlpool.data.tokenMintB]: tokenAIsInput ? 0n : maxInAmount,
    });

  const instructions: IInstruction[] = [];

  instructions.push(...createInstructions);

  const specifiedAmount =
    "inputAmount" in params ? params.inputAmount : params.outputAmount;
  const otherAmountThreshold =
    "tokenMaxIn" in quote ? quote.tokenMaxIn : quote.tokenMinOut;

  const swapInstruction = getSwapV2Instruction({
    tokenProgramA: tokenA.programAddress,
    tokenProgramB: tokenB.programAddress,
    memoProgram: MEMO_PROGRAM_ADDRESS,
    tokenAuthority: signer,
    whirlpool: whirlpool.address,
    tokenMintA: whirlpool.data.tokenMintA,
    tokenMintB: whirlpool.data.tokenMintB,
    tokenOwnerAccountA: tokenAccountAddresses[whirlpool.data.tokenMintA],
    tokenOwnerAccountB: tokenAccountAddresses[whirlpool.data.tokenMintB],
    tokenVaultA: whirlpool.data.tokenVaultA,
    tokenVaultB: whirlpool.data.tokenVaultB,
    tickArray0: tickArrays[0].address,
    tickArray1: tickArrays[1].address,
    tickArray2: tickArrays[2].address,
    amount: specifiedAmount,
    otherAmountThreshold,
    sqrtPriceLimit: 0,
    amountSpecifiedIsInput: specifiedInput,
    aToB: specifiedTokenA,
    oracle: oracleAddress,
    remainingAccountsInfo: {
      slices: [
        { accountsType: AccountsType.SupplementalTickArraysOne, length: 32 },
        { accountsType: AccountsType.SupplementalTickArraysTwo, length: 32 },
      ],
    },
  });

  swapInstruction.accounts.push(
    { address: tickArrays[3].address, role: AccountRole.WRITABLE },
    { address: tickArrays[4].address, role: AccountRole.WRITABLE },
  );

  instructions.push(swapInstruction);
  instructions.push(...cleanupInstructions);

  return {
    quote,
    instructions,
  };
}
