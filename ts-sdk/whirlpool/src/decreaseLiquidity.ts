import type {
  Whirlpool,
  WhirlpoolDeployment,
} from "@orca-so/whirlpools-client";
import {
  DEFAULT_WHIRLPOOL_DEPLOYMENT,
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
  Instruction,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
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
import { executeWithCallback } from "./actionHelpers";
// TODO: allow specify number as well as bigint
// TODO: transfer hook

/**
 * Represents the parameters for decreasing liquidity.
 * You must choose only one of the properties (`liquidity`, `tokenA`, or `tokenB`).
 * The SDK will compute the other two based on the input provided.
 */
export type DecreaseLiquidityQuoteParam =
  | { liquidity: bigint }
  | { tokenA: bigint }
  | { tokenB: bigint };

/** Represents the instructions and quote for decreasing liquidity in a position. */
export type DecreaseLiquidityInstructions = {
  quote: DecreaseLiquidityQuote;
  instructions: Instruction[];
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
 * Options for {@link decreaseLiquidityInstructions}.
 */
export type DecreaseLiquidityConfig = {
  slippageToleranceBps?: number;
  authority?: TransactionSigner<string>;
  whirlpoolDeployment?: WhirlpoolDeployment;
};

/**
 * Generates instructions to decrease liquidity from an existing position in an Orca Whirlpool.
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
  config: DecreaseLiquidityConfig = {},
): Promise<DecreaseLiquidityInstructions> {
  const slippageToleranceBps =
    config.slippageToleranceBps ?? SLIPPAGE_TOLERANCE_BPS;
  const authority = config.authority ?? FUNDER;
  const whirlpoolDeployment =
    config.whirlpoolDeployment ?? DEFAULT_WHIRLPOOL_DEPLOYMENT;

  assert(
    authority.address !== DEFAULT_ADDRESS,
    "Either supply the authority or set the default funder",
  );

  const positionAddress = await getPositionAddress(
    positionMintAddress,
    whirlpoolDeployment.programId,
  );
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
  const instructions: Instruction[] = [];

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
      getTickArrayAddress(
        whirlpool.address,
        lowerTickArrayStartIndex,
        whirlpoolDeployment.programId,
      ).then((x) => x[0]),
      getTickArrayAddress(
        whirlpool.address,
        upperTickArrayStartIndex,
        whirlpoolDeployment.programId,
      ).then((x) => x[0]),
    ]);

  const { createInstructions, cleanupInstructions, tokenAccountAddresses } =
    await prepareTokenAccountsInstructions(rpc, authority, [
      whirlpool.data.tokenMintA,
      whirlpool.data.tokenMintB,
    ]);

  instructions.push(...createInstructions);

  instructions.push(
    getDecreaseLiquidityV2Instruction(
      {
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
      },
      { programAddress: whirlpoolDeployment.programId },
    ),
  );

  instructions.push(...cleanupInstructions);

  return { quote, instructions };
}

/**
 * Represents the instructions and quotes for closing a liquidity position in an Orca Whirlpool.
 */
export type ClosePositionInstructions = DecreaseLiquidityInstructions & {
  feesQuote: CollectFeesQuote;
  rewardsQuote: CollectRewardsQuote;
};

/**
 * Options for {@link closePositionInstructions}.
 */
export type ClosePositionConfig = {
  slippageToleranceBps?: number;
  authority?: TransactionSigner<string>;
  whirlpoolDeployment?: WhirlpoolDeployment;
};

/**
 * Generates instructions to close a liquidity position in an Orca Whirlpool.
 */
export async function closePositionInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi &
      GetEpochInfoApi
  >,
  positionMintAddress: Address,
  config: ClosePositionConfig = {},
): Promise<ClosePositionInstructions> {
  const slippageToleranceBps =
    config.slippageToleranceBps ?? SLIPPAGE_TOLERANCE_BPS;
  const authority = config.authority ?? FUNDER;
  const whirlpoolDeployment =
    config.whirlpoolDeployment ?? DEFAULT_WHIRLPOOL_DEPLOYMENT;

  assert(
    authority.address !== DEFAULT_ADDRESS,
    "Either supply an authority or set the default funder",
  );

  const positionAddress = await getPositionAddress(
    positionMintAddress,
    whirlpoolDeployment.programId,
  );
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
      getTickArrayAddress(
        whirlpool.address,
        lowerTickArrayStartIndex,
        whirlpoolDeployment.programId,
      ).then((x) => x[0]),
      getTickArrayAddress(
        whirlpool.address,
        upperTickArrayStartIndex,
        whirlpoolDeployment.programId,
      ).then((x) => x[0]),
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

  const requiredMints: Set<Address> = new Set();
  if (
    quote.liquidityDelta > 0n ||
    feesQuote.feeOwedA > 0n ||
    feesQuote.feeOwedB > 0n
  ) {
    requiredMints.add(whirlpool.data.tokenMintA);
    requiredMints.add(whirlpool.data.tokenMintB);
  }

  for (let i = 0; i < rewardsQuote.rewards.length; i++) {
    if (rewardsQuote.rewards[i].rewardsOwed > 0n) {
      requiredMints.add(whirlpool.data.rewardInfos[i].mint);
    }
  }

  const { createInstructions, cleanupInstructions, tokenAccountAddresses } =
    await prepareTokenAccountsInstructions(
      rpc,
      authority,
      Array.from(requiredMints),
    );

  const instructions: Instruction[] = [];
  instructions.push(...createInstructions);

  if (quote.liquidityDelta > 0n) {
    instructions.push(
      getDecreaseLiquidityV2Instruction(
        {
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
        },
        { programAddress: whirlpoolDeployment.programId },
      ),
    );
  }

  if (feesQuote.feeOwedA > 0n || feesQuote.feeOwedB > 0n) {
    instructions.push(
      getCollectFeesV2Instruction(
        {
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
        },
        { programAddress: whirlpoolDeployment.programId },
      ),
    );
  }

  for (let i = 0; i < rewardsQuote.rewards.length; i++) {
    if (rewardsQuote.rewards[i].rewardsOwed === 0n) {
      continue;
    }
    const rewardMint = rewardMints[i];
    assert(rewardMint.exists, `Reward mint ${i} not found`);
    instructions.push(
      getCollectRewardV2Instruction(
        {
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
        },
        { programAddress: whirlpoolDeployment.programId },
      ),
    );
  }

  switch (positionMint.programAddress) {
    case TOKEN_PROGRAM_ADDRESS:
      instructions.push(
        getClosePositionInstruction(
          {
            positionAuthority: authority,
            position: positionAddress[0],
            positionTokenAccount,
            positionMint: positionMintAddress,
            receiver: authority.address,
          },
          { programAddress: whirlpoolDeployment.programId },
        ),
      );
      break;
    case TOKEN_2022_PROGRAM_ADDRESS:
      instructions.push(
        getClosePositionWithTokenExtensionsInstruction(
          {
            positionAuthority: authority,
            position: positionAddress[0],
            positionTokenAccount,
            positionMint: positionMintAddress,
            receiver: authority.address,
            token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
          },
          { programAddress: whirlpoolDeployment.programId },
        ),
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

// -------- ACTIONS --------

export function closePosition(
  positionMintAddress: Address,
  config?: Omit<ClosePositionConfig, "authority">,
) {
  return executeWithCallback((rpc, owner) =>
    closePositionInstructions(rpc, positionMintAddress, {
      ...config,
      authority: owner,
    }),
  );
}

export function decreaseLiquidity(
  positionMintAddress: Address,
  param: DecreaseLiquidityQuoteParam,
  config?: Omit<DecreaseLiquidityConfig, "authority">,
) {
  return executeWithCallback((rpc, owner) =>
    decreaseLiquidityInstructions(rpc, positionMintAddress, param, {
      ...config,
      authority: owner,
    }),
  );
}
