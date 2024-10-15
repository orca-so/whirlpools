import type { Whirlpool } from "@orca-so/whirlpools-client";
import {
  fetchAllTickArray,
  fetchPosition,
  fetchWhirlpool,
  getClosePositionInstruction,
  getClosePositionWithTokenExtensionsInstruction,
  getCollectFeesV2Instruction,
  getCollectRewardV2Instruction,
  getDecreaseLiquidityV2Instruction,
  getPositionAddress,
  getTickArrayAddress,
} from "@orca-so/whirlpools-client";
import type {
  CollectFeesQuote,
  CollectRewardsQuote,
  DecreaseLiquidityQuote,
  TickRange,
  TransferFee,
} from "@orca-so/whirlpools-core";
import {
  _MAX_TICK_INDEX,
  _MIN_TICK_INDEX,
  getTickArrayStartTickIndex,
  decreaseLiquidityQuote,
  decreaseLiquidityQuoteA,
  decreaseLiquidityQuoteB,
  collectFeesQuote,
  collectRewardsQuote,
  getTickIndexInArray,
} from "@orca-so/whirlpools-core";
import type {
  Address,
  GetAccountInfoApi,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  IInstruction,
  Rpc,
  TransactionPartialSigner,
} from "@solana/web3.js";
import {
  DEFAULT_ADDRESS,
  DEFAULT_FUNDER,
  DEFAULT_SLIPPAGE_TOLERANCE_BPS,
} from "./config";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  getCurrentTransferFee,
  prepareTokenAccountsInstructions,
} from "./token";
import {
  fetchAllMint,
  fetchAllMaybeMint,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import assert from "assert";

// TODO: allow specify number as well as bigint
// TODO: transfer hook

/**
 * @typedef {Object} DecreaseLiquidityQuoteParam
 * You must choose only one of the properties (`liquidity`, `tokenA`, or `tokenB`). The SDK will compute the other two based on the input provided.
 * 
 * @property {bigint} liquidity - The amount of liquidity to decrease. The SDK will calculate the corresponding amounts of Token A and Token B.
 * @property {bigint} tokenA - The amount of Token A to withdraw. The SDK will calculate the corresponding liquidity decrease and Token B amount.
 * @property {bigint} tokenB - The amount of Token B to withdraw. The SDK will calculate the corresponding liquidity decrease and Token A amount.
 */
export type DecreaseLiquidityQuoteParam =
  | {
      liquidity: bigint;
    }
  | {
      tokenA: bigint;
    }
  | {
      tokenB: bigint;
    };

/**
 * Represents the instructions and quote for decreasing liquidity in a position.
 *
 * @property {DecreaseLiquidityQuote} quote - The quote details for decreasing liquidity.
 * @property {IInstruction[]} instructions - The list of instructions required to decrease liquidity.
 */
export type DecreaseLiquidityInstructions = {
  quote: DecreaseLiquidityQuote;
  instructions: IInstruction[];
};

function getDecreaseLiquidityQuote(
  param: DecreaseLiquidityQuoteParam,
  pool: Whirlpool,
  tickRange: TickRange,
  slippageToleranceBps: number,
  transferFeeA: TransferFee | undefined,
  transferFeeB: TransferFee | undefined,
): DecreaseLiquidityQuote {
  if ("liquidity" in param) {
    return decreaseLiquidityQuote(
      param.liquidity,
      slippageToleranceBps,
      pool.sqrtPrice,
      tickRange.tickLowerIndex,
      tickRange.tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  } else if ("tokenA" in param) {
    return decreaseLiquidityQuoteA(
      param.tokenA,
      slippageToleranceBps,
      pool.sqrtPrice,
      tickRange.tickLowerIndex,
      tickRange.tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  } else {
    return decreaseLiquidityQuoteB(
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

/**
 * Generates instructions to decrease liquidity from an existing position in an Orca Whirlpool.
 *
 * @param {Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi>} rpc - A Solana RPC client for fetching necessary accounts and pool data.
 * @param {Address} positionMintAddress - The mint address of the NFT that represents ownership of the position from which liquidity will be removed.
 * @param {DecreaseLiquidityQuoteParam} param - Defines the liquidity removal method (liquidity, tokenA, or tokenB).
 * @param {number} [slippageToleranceBps=DEFAULT_SLIPPAGE_TOLERANCE_BPS] - The acceptable slippage tolerance in basis points.
 * @param {TransactionPartialSigner} [authority=DEFAULT_FUNDER] - The account authorizing the liquidity removal.
 *
 * @returns {Promise<DecreaseLiquidityInstructions>} A promise resolving to an object containing the decrease liquidity quote and instructions.
 *
 * @example
 * const { quote, instructions } = await decreaseLiquidityInstructions(
 *   connection,
 *   positionMintAddress,
 *   { liquidity: 500_000n },
 *   0.01,
 *   wallet
 * );
 * console.log("Liquidity Decrease Quote:", quote);
 * console.log("Liquidity Decrease Instructions:", instructions);
 */
export async function decreaseLiquidityInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi
  >,
  positionMintAddress: Address,
  param: DecreaseLiquidityQuoteParam,
  slippageToleranceBps: number = DEFAULT_SLIPPAGE_TOLERANCE_BPS,
  authority: TransactionPartialSigner = DEFAULT_FUNDER,
): Promise<DecreaseLiquidityInstructions> {
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

  const quote = getDecreaseLiquidityQuote(
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
    await prepareTokenAccountsInstructions(rpc, authority, [
      whirlpool.data.tokenMintA,
      whirlpool.data.tokenMintB,
    ]);

  instructions.push(...createInstructions);

  instructions.push(
    getDecreaseLiquidityV2Instruction({
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
      memoProgram: MEMO_PROGRAM_ADDRESS,
      tickArrayLower,
      tickArrayUpper,
      liquidityAmount: quote.liquidityDelta,
      tokenMinA: quote.tokenMinA,
      tokenMinB: quote.tokenMinB,
      remainingAccountsInfo: null,
    }),
  );

  instructions.push(...cleanupInstructions);

  return { quote, instructions };
}

/**
 * Represents the instructions and quotes for closing a liquidity position in an Orca Whirlpool.
 *
 * Extends `DecreaseLiquidityInstructions` and adds:
 * @property {CollectFeesQuote} feesQuote - The fees collected from the position.
 * @property {CollectRewardsQuote} rewardsQuote - The rewards collected from the position.
 */
export type ClosePositionInstructions = DecreaseLiquidityInstructions & {
  feesQuote: CollectFeesQuote;
  rewardsQuote: CollectRewardsQuote;
};


/**
 * Generates instructions to close a liquidity position in an Orca Whirlpool. This includes collecting all fees,
 * rewards, removing any remaining liquidity, and closing the position.
 *
 * @param {Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi>} rpc - A Solana RPC client for fetching accounts and pool data.
 * @param {Address} positionMintAddress - The mint address of the NFT that represents ownership of the position to be closed.
 * @param {DecreaseLiquidityQuoteParam} param - The parameters for removing liquidity (liquidity, tokenA, or tokenB).
 * @param {number} [slippageToleranceBps=DEFAULT_SLIPPAGE_TOLERANCE_BPS] - The acceptable slippage tolerance in basis points.
 * @param {TransactionPartialSigner} [authority=DEFAULT_FUNDER] - The account authorizing the transaction.
 *
 * @returns {Promise<ClosePositionInstructions>} A promise resolving to an object containing instructions, fees quote, rewards quote, and the liquidity quote for the closed position.
 *
 * @example
 * const { instructions, quote, feesQuote, rewardsQuote } = await closePositionInstructions(
 *   connection,
 *   positionMintAddress,
 *   { liquidity: 500_000n },
 *   0.01,
 *   wallet
 * );
 * console.log("Fees Collected:", feesQuote);
 * console.log("Rewards Collected:", rewardsQuote);
 * console.log("Liquidity Removed:", quote);
 * console.log("Close Position Instructions:", instructions);
 */
export async function closePositionInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi
  >,
  positionMintAddress: Address,
  param: DecreaseLiquidityQuoteParam,
  slippageToleranceBps: number = DEFAULT_SLIPPAGE_TOLERANCE_BPS,
  authority: TransactionPartialSigner = DEFAULT_FUNDER,
): Promise<ClosePositionInstructions> {
  assert(
    authority.address !== DEFAULT_ADDRESS,
    "Either supply an authority or set the default funder",
  );

  const positionAddress = await getPositionAddress(positionMintAddress);
  const position = await fetchPosition(rpc, positionAddress[0]);
  const whirlpool = await fetchWhirlpool(rpc, position.data.whirlpool);

  const currentEpoch = await rpc.getEpochInfo().send();
  const [mintA, mintB, positionMint, ...rewardMints] = await fetchAllMaybeMint(
    rpc,
    [
      whirlpool.data.tokenMintA,
      whirlpool.data.tokenMintB,
      positionMintAddress,
      ...whirlpool.data.rewardInfos.map((x) => x.mint),
    ],
  );

  assert(mintA.exists, "Token A not found");
  assert(mintB.exists, "Token B not found");
  assert(positionMint.exists, "Position mint not found");

  const transferFeeA = getCurrentTransferFee(mintA.data, currentEpoch.epoch);
  const transferFeeB = getCurrentTransferFee(mintB.data, currentEpoch.epoch);

  const quote = getDecreaseLiquidityQuote(
    param,
    whirlpool.data,
    position.data,
    slippageToleranceBps,
    transferFeeA,
    transferFeeB,
  );

  const lowerTickArrayStartIndex = getTickArrayStartTickIndex(
    position.data.tickLowerIndex,
    whirlpool.data.tickSpacing,
  );
  const upperTickArrayStartIndex = getTickArrayStartTickIndex(
    position.data.tickUpperIndex,
    whirlpool.data.tickSpacing,
  );

  const [positionTokenAccount, lowerTickArrayAddress, upperTickArrayAddress] =
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

  const [lowerTickArray, upperTickArray] = await fetchAllTickArray(rpc, [
    lowerTickArrayAddress,
    upperTickArrayAddress,
  ]);

  const lowerTick =
    lowerTickArray.data.ticks[
      getTickIndexInArray(
        position.data.tickLowerIndex,
        lowerTickArrayStartIndex,
        whirlpool.data.tickSpacing,
      )
    ];
  const upperTick =
    upperTickArray.data.ticks[
      getTickIndexInArray(
        position.data.tickUpperIndex,
        upperTickArrayStartIndex,
        whirlpool.data.tickSpacing,
      )
    ];

  const feesQuote = collectFeesQuote(
    whirlpool.data,
    position.data,
    lowerTick,
    upperTick,
  );
  const currentUnixTimestamp = BigInt(Math.floor(Date.now() / 1000));
  const rewardsQuote = collectRewardsQuote(
    whirlpool.data,
    position.data,
    lowerTick,
    upperTick,
    currentUnixTimestamp,
  );

  const requiredMints: Address[] = [];
  if (quote.liquidityDelta > 0n || feesQuote.feeOwedA > 0n) {
    requiredMints.push(whirlpool.data.tokenMintA);
  }
  if (quote.liquidityDelta > 0n || feesQuote.feeOwedB > 0n) {
    requiredMints.push(whirlpool.data.tokenMintB);
  }
  if (rewardsQuote.rewardOwed1 > 0n) {
    requiredMints.push(whirlpool.data.rewardInfos[0].mint);
  }
  if (rewardsQuote.rewardOwed2 > 0n) {
    requiredMints.push(whirlpool.data.rewardInfos[1].mint);
  }
  if (rewardsQuote.rewardOwed3 > 0n) {
    requiredMints.push(whirlpool.data.rewardInfos[2].mint);
  }

  // FIXME: this creates the accounts even if they are not actually needed
  // (no rewards, fees, to decrease liquidity, etc.)
  const { createInstructions, cleanupInstructions, tokenAccountAddresses } =
    await prepareTokenAccountsInstructions(rpc, authority, requiredMints);

  const instructions: IInstruction[] = [];
  instructions.push(...createInstructions);

  if (quote.liquidityDelta > 0n) {
    instructions.push(
      getDecreaseLiquidityV2Instruction({
        whirlpool: whirlpool.address,
        positionAuthority: authority,
        position: positionAddress[0],
        positionTokenAccount,
        tokenOwnerAccountA: tokenAccountAddresses[whirlpool.data.tokenMintA],
        tokenOwnerAccountB: tokenAccountAddresses[whirlpool.data.tokenMintB],
        tokenVaultA: whirlpool.data.tokenVaultA,
        tokenVaultB: whirlpool.data.tokenVaultB,
        tickArrayLower: lowerTickArrayAddress,
        tickArrayUpper: upperTickArrayAddress,
        liquidityAmount: quote.liquidityDelta,
        tokenMinA: quote.tokenMinA,
        tokenMinB: quote.tokenMinB,
        tokenMintA: whirlpool.data.tokenMintA,
        tokenMintB: whirlpool.data.tokenMintB,
        tokenProgramA: mintA.programAddress,
        tokenProgramB: mintB.programAddress,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        remainingAccountsInfo: null,
      }),
    );
  }

  if (feesQuote.feeOwedA > 0n || feesQuote.feeOwedB > 0n) {
    instructions.push(
      getCollectFeesV2Instruction({
        whirlpool: whirlpool.address,
        positionAuthority: authority,
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
        memoProgram: MEMO_PROGRAM_ADDRESS,
        remainingAccountsInfo: null,
      }),
    );
  }

  if (rewardsQuote.rewardOwed1 > 0n) {
    assert(rewardMints[0].exists, "Reward mint 0 not found");
    instructions.push(
      getCollectRewardV2Instruction({
        whirlpool: whirlpool.address,
        positionAuthority: authority,
        position: positionAddress[0],
        positionTokenAccount,
        rewardOwnerAccount: tokenAccountAddresses[rewardMints[0].address],
        rewardVault: whirlpool.data.rewardInfos[0].vault,
        rewardIndex: 0,
        rewardMint: rewardMints[0].address,
        rewardTokenProgram: rewardMints[0].programAddress,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        remainingAccountsInfo: null,
      }),
    );
  }

  if (rewardsQuote.rewardOwed2 > 0n) {
    assert(rewardMints[1].exists, "Reward mint 1 not found");
    instructions.push(
      getCollectRewardV2Instruction({
        whirlpool: whirlpool.address,
        positionAuthority: authority,
        position: positionAddress[0],
        positionTokenAccount,
        rewardOwnerAccount: tokenAccountAddresses[rewardMints[1].address],
        rewardVault: whirlpool.data.rewardInfos[1].vault,
        rewardIndex: 1,
        rewardMint: rewardMints[1].address,
        rewardTokenProgram: rewardMints[1].programAddress,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        remainingAccountsInfo: null,
      }),
    );
  }

  if (rewardsQuote.rewardOwed3 > 0n) {
    assert(rewardMints[2].exists, "Reward mint 2 not found");
    instructions.push(
      getCollectRewardV2Instruction({
        whirlpool: whirlpool.address,
        positionAuthority: authority,
        position: positionAddress[0],
        positionTokenAccount,
        rewardOwnerAccount: tokenAccountAddresses[rewardMints[2].address],
        rewardVault: whirlpool.data.rewardInfos[2].vault,
        rewardIndex: 2,
        rewardMint: rewardMints[2].address,
        rewardTokenProgram: rewardMints[2].programAddress,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        remainingAccountsInfo: null,
      }),
    );
  }

  switch (positionMint.programAddress) {
    case TOKEN_PROGRAM_ADDRESS:
      instructions.push(
        getClosePositionInstruction({
          positionAuthority: authority,
          position: positionAddress[0],
          positionTokenAccount,
          positionMint: positionMintAddress,
          receiver: authority.address,
        }),
      );
      break;
    case TOKEN_2022_PROGRAM_ADDRESS:
      instructions.push(
        getClosePositionWithTokenExtensionsInstruction({
          positionAuthority: authority,
          position: positionAddress[0],
          positionTokenAccount,
          positionMint: positionMintAddress,
          receiver: authority.address,
          token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
        }),
      );
      break;
    default:
      throw new Error("Invalid token program");
  }

  instructions.push(...cleanupInstructions);

  return {
    instructions,
    quote,
    feesQuote,
    rewardsQuote,
  };
}
