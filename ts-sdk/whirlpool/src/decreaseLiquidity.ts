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
  getUpdateFeesAndRewardsInstruction,
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
  GetEpochInfoApi,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  IInstruction,
  Rpc,
  TransactionSigner,
} from "@solana/web3.js";
import { DEFAULT_ADDRESS, FUNDER, SLIPPAGE_TOLERANCE_BPS } from "./config";
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
 * Represents the parameters for decreasing liquidity.
 * You must choose only one of the properties (`liquidity`, `tokenA`, or `tokenB`).
 * The SDK will compute the other two based on the input provided.
 */
export type DecreaseLiquidityQuoteParam =
  | {
      /** The amount of liquidity to decrease.*/
      liquidity: bigint;
    }
  | {
      /** The amount of Token A to withdraw.*/
      tokenA: bigint;
    }
  | {
      /** The amount of Token B to withdraw.*/
      tokenB: bigint;
    };

/**
 * Represents the instructions and quote for decreasing liquidity in a position.
 */
export type DecreaseLiquidityInstructions = {
  /** The quote details for decreasing liquidity, including the liquidity delta, estimated tokens, and minimum token amounts based on slippage tolerance. */
  quote: DecreaseLiquidityQuote;

  /** The list of instructions required to decrease liquidity. */
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
 * @param {SolanaRpc} rpc - A Solana RPC client for fetching necessary accounts and pool data.
 * @param {Address} positionMintAddress - The mint address of the NFT that represents ownership of the position from which liquidity will be removed.
 * @param {DecreaseLiquidityQuoteParam} param - Defines the liquidity removal method (liquidity, tokenA, or tokenB).
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The acceptable slippage tolerance in basis points.
 * @param {TransactionSigner} [authority=FUNDER] - The account authorizing the liquidity removal.
 *
 * @returns {Promise<DecreaseLiquidityInstructions>} A promise resolving to an object containing the decrease liquidity quote and instructions.
 *
 * @example
 * import { decreaseLiquidityInstructions, setWhirlpoolsConfig } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet, address } from '@solana/web3.js';
 *
 * await setWhirlpoolsConfig('solanaDevnet');
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 *
 * const positionMint = address("POSITION_MINT");
 *
 * const param = { liquidity: 500_000n };
 *
 * const { quote, instructions } = await decreaseLiquidityInstructions(
 *   devnetRpc,
 *   positionMint,
 *   param,
 *   100,
 * );
 */
export async function decreaseLiquidityInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi &
      GetEpochInfoApi
  >,
  positionMintAddress: Address,
  param: DecreaseLiquidityQuoteParam,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  authority: TransactionSigner = FUNDER,
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
  const transferFeeA = getCurrentTransferFee(mintA, currentEpoch.epoch);
  const transferFeeB = getCurrentTransferFee(mintB, currentEpoch.epoch);

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
 * Extends `DecreaseLiquidityInstructions` and adds additional fee and reward details.
 */
export type ClosePositionInstructions = DecreaseLiquidityInstructions & {
  /** The fees collected from the position, including the amounts for token A (`fee_owed_a`) and token B (`fee_owed_b`). */
  feesQuote: CollectFeesQuote;

  /** The rewards collected from the position, including up to three reward tokens (`reward_owed_1`, `reward_owed_2`, and `reward_owed_3`). */
  rewardsQuote: CollectRewardsQuote;
};

/**
 * Generates instructions to close a liquidity position in an Orca Whirlpool. This includes collecting all fees,
 * rewards, removing any remaining liquidity, and closing the position.
 *
 * @param {SolanaRpc} rpc - A Solana RPC client for fetching accounts and pool data.
 * @param {Address} positionMintAddress - The mint address of the NFT that represents ownership of the position to be closed.
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The acceptable slippage tolerance in basis points.
 * @param {TransactionSigner} [authority=FUNDER] - The account authorizing the transaction.
 *
 * @returns {Promise<ClosePositionInstructions>} A promise resolving to an object containing instructions, fees quote, rewards quote, and the liquidity quote for the closed position.
 *
 * @example
 * import { closePositionInstructions, setWhirlpoolsConfig } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet, address } from '@solana/web3.js';
 *
 * await setWhirlpoolsConfig('solanaDevnet');
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 *
 * const positionMint = address("POSITION_MINT");
 *
 * const { instructions, quote, feesQuote, rewardsQuote } = await closePositionInstructions(
 *   devnetRpc,
 *   positionMint,
 *   100,
 * );
 */
export async function closePositionInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi &
      GetEpochInfoApi
  >,
  positionMintAddress: Address,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  authority: TransactionSigner = FUNDER,
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
      ...whirlpool.data.rewardInfos
        .map((x) => x.mint)
        .filter((x) => x !== DEFAULT_ADDRESS),
    ],
  );

  assert(mintA.exists, "Token A not found");
  assert(mintB.exists, "Token B not found");
  assert(positionMint.exists, "Position mint not found");

  const transferFeeA = getCurrentTransferFee(mintA, currentEpoch.epoch);
  const transferFeeB = getCurrentTransferFee(mintB, currentEpoch.epoch);

  const quote = getDecreaseLiquidityQuote(
    { liquidity: position.data.liquidity },
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
    transferFeeA,
    transferFeeB,
  );
  const currentUnixTimestamp = BigInt(Math.floor(Date.now() / 1000));
  const rewardsQuote = collectRewardsQuote(
    whirlpool.data,
    position.data,
    lowerTick,
    upperTick,
    currentUnixTimestamp,
    getCurrentTransferFee(rewardMints[0], currentEpoch.epoch),
    getCurrentTransferFee(rewardMints[1], currentEpoch.epoch),
    getCurrentTransferFee(rewardMints[2], currentEpoch.epoch),
  );

  const requiredMints: Address[] = [];
  if (
    quote.liquidityDelta > 0n ||
    feesQuote.feeOwedA > 0n ||
    feesQuote.feeOwedB > 0n
  ) {
    requiredMints.push(whirlpool.data.tokenMintA);
    requiredMints.push(whirlpool.data.tokenMintB);
  }

  for (let i = 0; i < rewardsQuote.rewards.length; i++) {
    if (rewardsQuote.rewards[i].rewardsOwed > 0n) {
      requiredMints.push(whirlpool.data.rewardInfos[i].mint);
    }
  }

  const { createInstructions, cleanupInstructions, tokenAccountAddresses } =
    await prepareTokenAccountsInstructions(rpc, authority, requiredMints);

  const instructions: IInstruction[] = [];
  instructions.push(...createInstructions);

  if (position.data.liquidity > 0n) {
    instructions.push(
      getUpdateFeesAndRewardsInstruction({
        whirlpool: whirlpool.address,
        position: positionAddress[0],
        tickArrayLower: lowerTickArrayAddress,
        tickArrayUpper: upperTickArrayAddress,
      }),
    );
  }

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

  for (let i = 0; i < rewardsQuote.rewards.length; i++) {
    if (rewardsQuote.rewards[i].rewardsOwed === 0n) {
      continue;
    }
    const rewardMint = rewardMints[i];
    assert(rewardMint.exists, `Reward mint ${i} not found`);
    instructions.push(
      getCollectRewardV2Instruction({
        whirlpool: whirlpool.address,
        positionAuthority: authority,
        position: positionAddress[0],
        positionTokenAccount,
        rewardOwnerAccount: tokenAccountAddresses[rewardMint.address],
        rewardVault: whirlpool.data.rewardInfos[i].vault,
        rewardIndex: i,
        rewardMint: rewardMint.address,
        rewardTokenProgram: rewardMint.programAddress,
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
