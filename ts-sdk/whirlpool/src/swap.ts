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
import { DEFAULT_FUNDER, DEFAULT_SLIPPAGE_TOLERANCE_BPS } from "./config";
import type {
  ExactInSwapQuote,
  ExactOutSwapQuote,
  TickArrayFacade,
  TickArrays,
  TransferFee,
} from "@orca-so/whirlpools-core";
import {
  _TICK_ARRAY_SIZE,
  getTickArrayStartTickIndex,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
} from "@orca-so/whirlpools-core";
import type { Whirlpool } from "@orca-so/whirlpools-client";
import {
  AccountsType,
  fetchAllMaybeTickArray,
  fetchWhirlpool,
  getOracleAddress,
  getSwapV2Instruction,
  getTickArrayAddress,
} from "@orca-so/whirlpools-client";
import {
  getCurrentTransferFee,
  prepareTokenAccountsInstructions,
} from "./token";
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

function createUninitializedTickArray(startTickIndex: number): TickArrayFacade {
  return {
    startTickIndex,
    ticks: Array(_TICK_ARRAY_SIZE()).fill({
      initialized: false,
      liquidityNet: 0n,
      feeGrowthOutsideA: 0n,
      feeGrowthOutsideB: 0n,
      rewardGrowthsOutside: [0n, 0n, 0n],
    }),
  };
}

async function fetchTickArrayOrDefault(
  rpc: Rpc<GetMultipleAccountsApi>,
  whirlpool: Account<Whirlpool>,
): Promise<[TickArrays, Address[]]> {
  const tickArrayStartIndex = getTickArrayStartTickIndex(
    whirlpool.data.tickCurrentIndex,
    whirlpool.data.tickSpacing,
  );
  const offset = whirlpool.data.tickSpacing * _TICK_ARRAY_SIZE();

  const tickArrayIndexes = [
    tickArrayStartIndex,
    tickArrayStartIndex + offset,
    tickArrayStartIndex + offset * 2,
    tickArrayStartIndex - offset,
    tickArrayStartIndex - offset * 2,
  ];

  const tickArrayAddresses = await Promise.all(
    tickArrayIndexes.map((startIndex) =>
      getTickArrayAddress(whirlpool.address, startIndex).then((x) => x[0]),
    ),
  );

  const maybeTickArrays = await fetchAllMaybeTickArray(rpc, tickArrayAddresses);

  const tickArrays: TickArrayFacade[] = [];

  for (let i = 0; i < maybeTickArrays.length; i++) {
    const maybeTickArray = maybeTickArrays[i];
    if (maybeTickArray.exists) {
      tickArrays.push(maybeTickArray.data);
    } else {
      tickArrays.push(createUninitializedTickArray(tickArrayIndexes[i]));
    }
  }

  return [tickArrays as TickArrays, tickArrayAddresses];
}

function getSwapQuote<T extends SwapParams>(
  params: T,
  whirlpool: Whirlpool,
  transferFeeA: TransferFee | undefined,
  transferFeeB: TransferFee | undefined,
  tickArrays: TickArrays,
  specifiedTokenA: boolean,
  slippageToleranceBps: number,
): SwapQuote<T> {
  if ("inputAmount" in params) {
    return swapQuoteByInputToken(
      params.inputAmount,
      specifiedTokenA,
      slippageToleranceBps,
      whirlpool,
      tickArrays,
      transferFeeA,
      transferFeeB,
    ) as SwapQuote<T>;
  }

  return swapQuoteByOutputToken(
    params.outputAmount,
    specifiedTokenA,
    slippageToleranceBps,
    whirlpool,
    tickArrays,
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
  slippageToleranceBps: number = DEFAULT_SLIPPAGE_TOLERANCE_BPS,
  signer: TransactionPartialSigner = DEFAULT_FUNDER,
): Promise<SwapInstructions<T>> {
  const whirlpool = await fetchWhirlpool(rpc, poolAddress);
  const [tokenA, tokenB] = await fetchAllMint(rpc, [
    whirlpool.data.tokenMintA,
    whirlpool.data.tokenMintB,
  ]);
  const specifiedTokenA = params.mint === whirlpool.data.tokenMintA;
  const specifiedInput = "inputAmount" in params;

  const [tickArrays, tickArrayAddresses] = await fetchTickArrayOrDefault(
    rpc,
    whirlpool,
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
    slippageToleranceBps,
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
    tickArray0: tickArrayAddresses[0],
    tickArray1: tickArrayAddresses[1],
    tickArray2: tickArrayAddresses[2],
    amount: specifiedAmount,
    otherAmountThreshold,
    sqrtPriceLimit: 0,
    amountSpecifiedIsInput: specifiedInput,
    aToB: specifiedTokenA,
    oracle: oracleAddress,
    remainingAccountsInfo: {
      slices: [
        { accountsType: AccountsType.SupplementalTickArrays, length: 2 },
      ],
    },
  });

  swapInstruction.accounts.push(
    { address: tickArrayAddresses[3], role: AccountRole.WRITABLE },
    { address: tickArrayAddresses[4], role: AccountRole.WRITABLE },
  );

  instructions.push(swapInstruction);
  instructions.push(...cleanupInstructions);

  return {
    quote,
    instructions,
  };
}
