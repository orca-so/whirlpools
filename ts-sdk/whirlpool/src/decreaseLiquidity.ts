import type { Whirlpool } from "@orca-so/whirlpools-client";
import {
  fetchAllTickArray,
  fetchPosition,
  fetchWhirlpool,
  getClosePositionInstruction,
  getClosePositionWithTokenExtensionsInstruction,
  getCollectFeesInstruction,
  getCollectFeesV2Instruction,
  getCollectRewardInstruction,
  getCollectRewardV2Instruction,
  getDecreaseLiquidityInstruction,
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
import invariant from "tiny-invariant";
import { getCurrentTransferFee, prepareTokenAccountsInstructions } from "./token";
import { fetchAllMint, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";

// TODO: allow specify number as well as bigint
// TODO: transfer hook

type DecreaseLiquidityQuoteParam =
  | {
      liquidity: bigint;
    }
  | {
      tokenA: bigint;
    }
  | {
      tokenB: bigint;
    };

type DecreaseLiquidityInstructions = {
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
  invariant(
    authority.address !== DEFAULT_ADDRESS,
    "Either supply the authority or set the default funder",
  );

  const positionAddress = await getPositionAddress(positionMintAddress);
  const position = await fetchPosition(rpc, positionAddress[0]);
  const whirlpool = await fetchWhirlpool(rpc, position.data.whirlpool);

  const currentEpoch = await rpc.getEpochInfo().send();
  const [mintA, mintB, positionMint] = await fetchAllMint(rpc, [whirlpool.data.tokenMintA, whirlpool.data.tokenMintB, positionMintAddress]);
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

type ClosePositionInstructions = DecreaseLiquidityInstructions & {
  feesQuote: CollectFeesQuote;
  rewardsQuote: CollectRewardsQuote;
};

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
  invariant(
    authority.address !== DEFAULT_ADDRESS,
    "Either supply an authority or set the default funder",
  );
  const instructions: IInstruction[] = [];

  const positionAddress = await getPositionAddress(positionMintAddress);
  const position = await fetchPosition(rpc, positionAddress[0]);
  const whirlpool = await fetchWhirlpool(rpc, position.data.whirlpool);

  const currentEpoch = await rpc.getEpochInfo().send();
  const [mintA, mintB, positionMint] = await fetchAllMint(rpc, [whirlpool.data.tokenMintA, whirlpool.data.tokenMintB, positionMintAddress]);
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

  const lowerTick = lowerTickArray.data.ticks[getTickIndexInArray(position.data.tickLowerIndex, lowerTickArrayStartIndex, whirlpool.data.tickSpacing)];
  const upperTick = upperTickArray.data.ticks[getTickIndexInArray(position.data.tickUpperIndex, upperTickArrayStartIndex, whirlpool.data.tickSpacing)];

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

  // FIXME: this creates the accounts even if they are not actually needed
  // (no rewards, fees, to decrease liquidity, etc.)
  const { createInstructions, cleanupInstructions, tokenAccountAddresses } =
    await prepareTokenAccountsInstructions(rpc, authority, [
      whirlpool.data.tokenMintA,
      whirlpool.data.tokenMintB,
      whirlpool.data.rewardInfos[0].mint,
      whirlpool.data.rewardInfos[1].mint,
      whirlpool.data.rewardInfos[2].mint,
    ].filter(x => x !== DEFAULT_ADDRESS));

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
    instructions.push(
      getCollectRewardV2Instruction({
        whirlpool: whirlpool.address,
        positionAuthority: authority,
        position: positionAddress[0],
        positionTokenAccount,
        rewardOwnerAccount:
          tokenAccountAddresses[whirlpool.data.rewardInfos[0].mint],
        rewardVault: whirlpool.data.rewardInfos[0].vault,
        rewardIndex: 0,
        rewardMint: whirlpool.data.rewardInfos[0].mint,
        rewardTokenProgram: whirlpool.data.rewardInfos[0].programAddress,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        remainingAccountsInfo: null,
      }),
    );
  }

  if (rewardsQuote.rewardOwed2 > 0n) {
    instructions.push(
      getCollectRewardV2Instruction({
        whirlpool: whirlpool.address,
        positionAuthority: authority,
        position: positionAddress[0],
        positionTokenAccount,
        rewardOwnerAccount:
          tokenAccountAddresses[whirlpool.data.rewardInfos[1].mint],
        rewardVault: whirlpool.data.rewardInfos[1].vault,
        rewardIndex: 1,
        rewardMint: whirlpool.data.rewardInfos[1].mint,
        rewardTokenProgram: whirlpool.data.rewardInfos[1].programAddress,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        remainingAccountsInfo: null,
      }),
    );
  }

  if (rewardsQuote.rewardOwed3 > 0n) {
    instructions.push(
      getCollectRewardV2Instruction({
        whirlpool: whirlpool.address,
        positionAuthority: authority,
        position: positionAddress[0],
        positionTokenAccount,
        rewardOwnerAccount:
          tokenAccountAddresses[whirlpool.data.rewardInfos[2].mint],
        rewardVault: whirlpool.data.rewardInfos[2].vault,
        rewardIndex: 2,
        rewardMint: whirlpool.data.rewardInfos[2].mint,
        rewardTokenProgram: whirlpool.data.rewardInfos[2].programAddress,
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
          positionMint:positionMintAddress,
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
