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
import { AccountRole, lamports } from "@solana/web3.js";
import { DEFAULT_FUNDER, DEFAULT_SLIPPAGE_TOLERANCE_BPS } from "./config";
import type {
  ExactInSwapQuote,
  ExactOutSwapQuote,
  TickArrayFacade,
  TransferFee,
} from "@orca-so/whirlpools-core";
import {
  _TICK_ARRAY_SIZE,
  getTickArrayStartTickIndex,
  swapQuoteByInputToken5,
  swapQuoteByOutputToken5,
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

function createUninitializedTickArray(
  address: Address,
  startTickIndex: number,
  programAddress: Address,
): Account<TickArrayFacade> {
  return {
    address,
    data: {
      startTickIndex,
      ticks: Array(_TICK_ARRAY_SIZE()).fill({
        initialized: false,
        liquidityNet: 0n,
        feeGrowthOutsideA: 0n,
        feeGrowthOutsideB: 0n,
        rewardGrowthsOutside: [0n, 0n, 0n],
      }),
    },
    executable: false,
    lamports: lamports(0n),
    programAddress,
  };
}

async function fetchTickArrayOrDefault(
  rpc: Rpc<GetMultipleAccountsApi>,
  whirlpool: Account<Whirlpool>,
): Promise<Account<TickArrayFacade>[]> {
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

  const tickArrays: Account<TickArrayFacade>[] = [];

  for (let i = 0; i < maybeTickArrays.length; i++) {
    const maybeTickArray = maybeTickArrays[i];
    if (maybeTickArray.exists) {
      tickArrays.push(maybeTickArray);
    } else {
      tickArrays.push(
        createUninitializedTickArray(
          tickArrayAddresses[i],
          tickArrayIndexes[i],
          whirlpool.programAddress,
        ),
      );
    }
  }

  return tickArrays;
}

function getSwapQuote<T extends SwapParams>(
  params: T,
  whirlpool: Whirlpool,
  transferFeeA: TransferFee | undefined,
  transferFeeB: TransferFee | undefined,
  tickArrays: Account<TickArrayFacade>[],
  specifiedTokenA: boolean,
  slippageToleranceBps: number,
): SwapQuote<T> {
  if ("inputAmount" in params) {
    return swapQuoteByInputToken5(
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

  return swapQuoteByOutputToken5(
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

  const tickArrays = await fetchTickArrayOrDefault(rpc, whirlpool);

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
        { accountsType: AccountsType.SupplementalTickArrays, length: 2 },
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
