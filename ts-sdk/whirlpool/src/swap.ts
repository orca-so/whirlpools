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
import { FUNDER, SLIPPAGE_TOLERANCE_BPS } from "./config";
import type {
  ExactInSwapQuote,
  ExactOutSwapQuote,
  TickArrayFacade,
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

/**
 * Parameters for an exact input swap.
 */
export type ExactInParams = {
  /** The exact amount of input tokens to be swapped. */
  inputAmount: bigint;
};

/**
 * Parameters for an exact output swap.
 */
export type ExactOutParams = {
  /** The exact amount of output tokens to be received from the swap. */
  outputAmount: bigint;
};

/**
 * Swap parameters, either for an exact input or exact output swap.
 */
export type SwapParams = (ExactInParams | ExactOutParams) & {
  /** The mint address of the token being swapped. */
  mint: Address;
};

/**
 * Swap quote that corresponds to the type of swap being executed (either input or output swap).
 *
 * @template T - The type of swap (input or output).
 */
export type SwapQuote<T extends SwapParams> = T extends ExactInParams
  ? ExactInSwapQuote
  : ExactOutSwapQuote;

/**
 * Instructions and quote for executing a swap.
 *
 * @template T - The type of swap (input or output).
 */
export type SwapInstructions<T extends SwapParams> = {
  /** The list of instructions needed to perform the swap. */
  instructions: IInstruction[];

  /** The swap quote, which includes information about the amounts involved in the swap. */
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
  tickArrays: TickArrayFacade[],
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

/**
 * Generates the instructions necessary to execute a token swap in an Orca Whirlpool.
 * It handles both exact input and exact output swaps, fetching the required accounts, tick arrays, and determining the swap quote.
 *
 * @template T - The type of swap (exact input or output).
 * @param {SolanaRpc} rpc - The Solana RPC client.
 * @param {T} params - The swap parameters, specifying either the input or output amount and the mint address of the token being swapped.
 * @param {Address} poolAddress - The address of the Whirlpool against which the swap will be made.
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The maximum acceptable slippage tolerance for the swap, in basis points (BPS).
 * @param {TransactionPartialSigner} [signer=FUNDER] - The wallet or signer executing the swap.
 * @returns {Promise<SwapInstructions<T>>} - A promise that resolves to an object containing the swap instructions and the swap quote.
 *
 * @example
 * import { swapInstructions } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet } from '@solana/web3.js';
 *
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner();
 * await devnetRpc.requestAirdrop(wallet.address, lamports(1000000000n)).send();
 *
 * const poolAddress = "POOL_ADDRESS";
 * const mintAddress = "TOKEN_MINT";
 * const inputAmount = 1_000_000n;
 *
 * const { instructions, quote } = await swapInstructions(
 *   devnetRpc,
 *   { inputAmount, mint: mintAddress },
 *   poolAddress,
 *   100,
 *   wallet
 * );
 */
export async function swapInstructions<T extends SwapParams>(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi
  >,
  params: T,
  poolAddress: Address,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  signer: TransactionPartialSigner = FUNDER,
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
    tickArrays.map((x) => x.data),
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
