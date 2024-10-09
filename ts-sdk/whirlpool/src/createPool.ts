import {
  getFeeTierAddress,
  getInitializePoolV2Instruction,
  getInitializeTickArrayInstruction,
  getTickArrayAddress,
  getTickArraySize,
  getTokenBadgeAddress,
  getWhirlpoolAddress,
  getWhirlpoolSize,
} from "@orca-so/whirlpools-client";
import type {
  Address,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  IInstruction,
  LamportsUnsafeBeyond2Pow53Minus1,
  Rpc,
  TransactionPartialSigner,
} from "@solana/web3.js";
import { generateKeyPairSigner } from "@solana/web3.js";
import {
  DEFAULT_ADDRESS,
  DEFAULT_FUNDER,
  SPLASH_POOL_TICK_SPACING,
  WHIRLPOOLS_CONFIG_ADDRESS,
} from "./config";
import invariant from "tiny-invariant";
import {
  getFullRangeTickIndexes,
  getTickArrayStartTickIndex,
  priceToSqrtPrice,
  sqrtPriceToTickIndex,
} from "@orca-so/whirlpools-core";
import { fetchAllMint, getTokenSize } from "@solana-program/token";

type CreatePoolInstructions = {
  instructions: IInstruction[];
  initializationCost: LamportsUnsafeBeyond2Pow53Minus1;
  poolAddress: Address;
};

export function createSplashPoolInstructions(
  rpc: Rpc<GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi>,
  tokenMintOne: Address,
  tokenMintTwo: Address,
  initialPrice: number = 1,
  funder: TransactionPartialSigner = DEFAULT_FUNDER,
): Promise<CreatePoolInstructions> {
  return createPoolInstructions(
    rpc,
    tokenMintOne,
    tokenMintTwo,
    SPLASH_POOL_TICK_SPACING,
    initialPrice,
    funder,
  );
}

export async function createPoolInstructions(
  rpc: Rpc<GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi>,
  tokenMintOne: Address,
  tokenMintTwo: Address,
  tickSpacing: number,
  initialPrice: number = 1,
  funder: TransactionPartialSigner = DEFAULT_FUNDER,
): Promise<CreatePoolInstructions> {
  invariant(
    funder.address !== DEFAULT_ADDRESS,
    "Either supply a funder or set the default funder",
  );
  const [tokenMintA, tokenMintB] =
    Buffer.from(tokenMintOne) < Buffer.from(tokenMintTwo)
      ? [tokenMintOne, tokenMintTwo]
      : [tokenMintTwo, tokenMintOne];
  const instructions: IInstruction[] = [];
  let stateSpace = 0;

  // Since TE mint data is an extension of T mint data, we can use the same fetch function
  const [mintA, mintB] = await fetchAllMint(rpc, [tokenMintA, tokenMintB]);
  const decimalsA = mintA.data.decimals;
  const decimalsB = mintB.data.decimals;
  const tokenProgramA = mintA.programAddress;
  const tokenProgramB = mintB.programAddress;

  const initialSqrtPrice = priceToSqrtPrice(initialPrice, decimalsA, decimalsB);

  const [
    poolAddress,
    feeTier,
    tokenBadgeA,
    tokenBadgeB,
    tokenVaultA,
    tokenVaultB,
  ] = await Promise.all([
    getWhirlpoolAddress(
      WHIRLPOOLS_CONFIG_ADDRESS,
      tokenMintA,
      tokenMintB,
      tickSpacing,
    ).then((x) => x[0]),
    getFeeTierAddress(WHIRLPOOLS_CONFIG_ADDRESS, tickSpacing).then((x) => x[0]),
    getTokenBadgeAddress(WHIRLPOOLS_CONFIG_ADDRESS, tokenMintA).then(
      (x) => x[0],
    ),
    getTokenBadgeAddress(WHIRLPOOLS_CONFIG_ADDRESS, tokenMintB).then(
      (x) => x[0],
    ),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  instructions.push(
    getInitializePoolV2Instruction({
      whirlpoolsConfig: WHIRLPOOLS_CONFIG_ADDRESS,
      tokenMintA,
      tokenMintB,
      tokenBadgeA,
      tokenBadgeB,
      funder,
      whirlpool: poolAddress,
      tokenVaultA,
      tokenVaultB,
      tokenProgramA,
      tokenProgramB,
      feeTier,
      tickSpacing,
      initialSqrtPrice,
    }),
  );

  stateSpace += getTokenSize() * 2;
  stateSpace += getWhirlpoolSize();

  const fullRange = getFullRangeTickIndexes(tickSpacing);
  const lowerTickIndex = getTickArrayStartTickIndex(
    fullRange.tickLowerIndex,
    tickSpacing,
  );
  const upperTickIndex = getTickArrayStartTickIndex(
    fullRange.tickUpperIndex,
    tickSpacing,
  );
  const initialTickIndex = sqrtPriceToTickIndex(initialSqrtPrice);
  const currentTickIndex = getTickArrayStartTickIndex(
    initialTickIndex,
    tickSpacing,
  );

  const [
    lowerTickArrayAddress,
    upperTickArrayAddress,
    currentTickArrayAddress,
  ] = await Promise.all([
    getTickArrayAddress(poolAddress, lowerTickIndex).then((x) => x[0]),
    getTickArrayAddress(poolAddress, upperTickIndex).then((x) => x[0]),
    getTickArrayAddress(poolAddress, currentTickIndex).then((x) => x[0]),
  ]);

  instructions.push(
    getInitializeTickArrayInstruction({
      whirlpool: poolAddress,
      funder,
      tickArray: lowerTickArrayAddress,
      startTickIndex: lowerTickIndex,
    }),
  );

  instructions.push(
    getInitializeTickArrayInstruction({
      whirlpool: poolAddress,
      funder,
      tickArray: upperTickArrayAddress,
      startTickIndex: upperTickIndex,
    }),
  );

  stateSpace += getTickArraySize() * 2;

  if (
    currentTickIndex !== lowerTickIndex &&
    currentTickIndex !== upperTickIndex
  ) {
    instructions.push(
      getInitializeTickArrayInstruction({
        whirlpool: poolAddress,
        funder,
        tickArray: currentTickArrayAddress,
        startTickIndex: currentTickIndex,
      }),
    );
    stateSpace += getTickArraySize();
  }

  const nonRefundableRent = await rpc
    .getMinimumBalanceForRentExemption(BigInt(stateSpace))
    .send();

  return {
    instructions,
    poolAddress,
    initializationCost: nonRefundableRent,
  };
}
