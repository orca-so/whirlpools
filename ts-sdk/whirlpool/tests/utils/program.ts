import {
  fetchAllMaybeTickArray,
  fetchWhirlpool,
  getFeeTierAddress,
  getInitializeConfigInstruction,
  getInitializeFeeTierInstruction,
  getInitializePoolV2Instruction,
  getInitializeTickArrayInstruction,
  getOpenPositionInstruction,
  getOpenPositionWithTokenExtensionsInstruction,
  getPositionAddress,
  getTickArrayAddress,
  getTokenBadgeAddress,
  getWhirlpoolAddress,
} from "@orca-so/whirlpools-client";
import { address, type Address, type IInstruction } from "@solana/web3.js";
import { rpc, sendTransaction, signer } from "./mockRpc";
import {
  SPLASH_POOL_TICK_SPACING,
  WHIRLPOOLS_CONFIG_ADDRESS,
} from "../../src/config";
import {
  getInitializableTickIndex,
  getTickArrayStartTickIndex,
  tickIndexToSqrtPrice,
} from "@orca-so/whirlpools-core";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  fetchMint,
  findAssociatedTokenPda,
} from "@solana-program/token-2022";
import { getNextKeypair } from "./keypair";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

export async function setupConfigAndFeeTiers(): Promise<Address> {
  const keypair = getNextKeypair();
  const instructions: IInstruction[] = [];

  instructions.push(
    getInitializeConfigInstruction({
      config: keypair,
      funder: signer,
      feeAuthority: signer.address,
      collectProtocolFeesAuthority: signer.address,
      rewardEmissionsSuperAuthority: signer.address,
      defaultProtocolFeeRate: 100,
    }),
  );

  const defaultFeeTierPda = await getFeeTierAddress(keypair.address, 128);
  instructions.push(
    getInitializeFeeTierInstruction({
      config: keypair.address,
      feeTier: defaultFeeTierPda[0],
      funder: signer,
      feeAuthority: signer,
      tickSpacing: 128,
      defaultFeeRate: 1000,
    }),
  );

  const concentratedFeeTierPda = await getFeeTierAddress(keypair.address, 64);
  instructions.push(
    getInitializeFeeTierInstruction({
      config: keypair.address,
      feeTier: concentratedFeeTierPda[0],
      funder: signer,
      feeAuthority: signer,
      tickSpacing: 64,
      defaultFeeRate: 300,
    }),
  );

  const splashFeeTierPda = await getFeeTierAddress(
    keypair.address,
    SPLASH_POOL_TICK_SPACING,
  );
  instructions.push(
    getInitializeFeeTierInstruction({
      config: keypair.address,
      feeTier: splashFeeTierPda[0],
      funder: signer,
      feeAuthority: signer,
      tickSpacing: SPLASH_POOL_TICK_SPACING,
      defaultFeeRate: 1000,
    }),
  );

  await sendTransaction(instructions);
  return keypair.address;
}

export async function setupWhirlpool(
  tokenA: Address,
  tokenB: Address,
  tickSpacing: number,
  config: { initialSqrtPrice?: bigint } = {},
): Promise<Address> {
  const feeTierAddress = await getFeeTierAddress(
    WHIRLPOOLS_CONFIG_ADDRESS,
    tickSpacing,
  );
  const whirlpoolAddress = await getWhirlpoolAddress(
    WHIRLPOOLS_CONFIG_ADDRESS,
    tokenA,
    tokenB,
    tickSpacing,
  );
  const vaultA = getNextKeypair();
  const vaultB = getNextKeypair();
  const badgeA = await getTokenBadgeAddress(WHIRLPOOLS_CONFIG_ADDRESS, tokenA);
  const badgeB = await getTokenBadgeAddress(WHIRLPOOLS_CONFIG_ADDRESS, tokenB);
  const mintA = await fetchMint(rpc, tokenA);
  const mintB = await fetchMint(rpc, tokenB);
  const programA = mintA.programAddress;
  const programB = mintB.programAddress;

  const sqrtPrice = config.initialSqrtPrice ?? tickIndexToSqrtPrice(0);

  const instructions: IInstruction[] = [];

  instructions.push(
    getInitializePoolV2Instruction({
      whirlpool: whirlpoolAddress[0],
      feeTier: feeTierAddress[0],
      tokenMintA: tokenA,
      tokenMintB: tokenB,
      tickSpacing,
      whirlpoolsConfig: WHIRLPOOLS_CONFIG_ADDRESS,
      funder: signer,
      tokenVaultA: vaultA,
      tokenVaultB: vaultB,
      tokenBadgeA: badgeA[0],
      tokenBadgeB: badgeB[0],
      tokenProgramA: programA,
      tokenProgramB: programB,
      initialSqrtPrice: sqrtPrice,
    }),
  );

  await sendTransaction(instructions);
  return whirlpoolAddress[0];
}

export async function setupPosition(
  whirlpool: Address,
  config: { tickLower?: number; tickUpper?: number; liquidity?: bigint } = {},
): Promise<Address> {
  const positionMint = getNextKeypair();
  const whirlpoolAccount = await fetchWhirlpool(rpc, whirlpool);
  const tickLower = config.tickLower ?? -100;
  const tickUpper = config.tickLower ?? 100;

  const initializableLowerTickIndex = getInitializableTickIndex(
    tickLower,
    whirlpoolAccount.data.tickSpacing,
    false,
  );
  const initializableUpperTickIndex = getInitializableTickIndex(
    tickUpper,
    whirlpoolAccount.data.tickSpacing,
    true,
  );

  const lowerTickArrayIndex = getTickArrayStartTickIndex(
    initializableLowerTickIndex,
    whirlpoolAccount.data.tickSpacing,
  );
  const upperTickArrayIndex = getTickArrayStartTickIndex(
    initializableUpperTickIndex,
    whirlpoolAccount.data.tickSpacing,
  );

  const [
    positionAddress,
    positionTokenAccount,
    lowerTickArrayAddress,
    upperTickArrayAddress,
  ] = await Promise.all([
    getPositionAddress(positionMint.address),
    findAssociatedTokenPda({
      owner: signer.address,
      mint: positionMint.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }).then((x) => x[0]),
    getTickArrayAddress(whirlpool, lowerTickArrayIndex).then((x) => x[0]),
    getTickArrayAddress(whirlpool, upperTickArrayIndex).then((x) => x[0]),
  ]);

  const [lowerTickArray, upperTickArray] = await fetchAllMaybeTickArray(rpc, [
    lowerTickArrayAddress,
    upperTickArrayAddress,
  ]);

  const instructions: IInstruction[] = [];

  if (!lowerTickArray.exists) {
    instructions.push(
      getInitializeTickArrayInstruction({
        whirlpool: whirlpool,
        funder: signer,
        tickArray: lowerTickArrayAddress,
        startTickIndex: lowerTickArrayIndex,
      }),
    );
  }

  if (!upperTickArray.exists && lowerTickArrayIndex !== upperTickArrayIndex) {
    instructions.push(
      getInitializeTickArrayInstruction({
        whirlpool: whirlpool,
        funder: signer,
        tickArray: upperTickArrayAddress,
        startTickIndex: upperTickArrayIndex,
      }),
    );
  }

  instructions.push(
    getOpenPositionInstruction({
      funder: signer,
      owner: signer.address,
      position: positionAddress[0],
      positionMint: positionMint,
      positionTokenAccount: positionTokenAccount,
      whirlpool: whirlpool,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      tickLowerIndex: initializableLowerTickIndex,
      tickUpperIndex: initializableUpperTickIndex,
      positionBump: positionAddress[1],
    }),
  );

  await sendTransaction(instructions);

  return positionMint.address;
}

export async function setupTEPosition(
  whirlpool: Address,
  config: { tickLower?: number; tickUpper?: number; liquidity?: bigint } = {},
): Promise<Address> {
  const metadataUpdateAuth = address(
    "3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr",
  );
  const positionMint = getNextKeypair();
  const whirlpoolAccount = await fetchWhirlpool(rpc, whirlpool);
  const tickLower = config.tickLower ?? -100;
  const tickUpper = config.tickLower ?? 100;

  const initializableLowerTickIndex = getInitializableTickIndex(
    tickLower,
    whirlpoolAccount.data.tickSpacing,
    false,
  );
  const initializableUpperTickIndex = getInitializableTickIndex(
    tickUpper,
    whirlpoolAccount.data.tickSpacing,
    true,
  );

  const lowerTickArrayIndex = getTickArrayStartTickIndex(
    initializableLowerTickIndex,
    whirlpoolAccount.data.tickSpacing,
  );
  const upperTickArrayIndex = getTickArrayStartTickIndex(
    initializableUpperTickIndex,
    whirlpoolAccount.data.tickSpacing,
  );

  const [
    positionAddress,
    positionTokenAccount,
    lowerTickArrayAddress,
    upperTickArrayAddress,
  ] = await Promise.all([
    getPositionAddress(positionMint.address),
    findAssociatedTokenPda({
      owner: signer.address,
      mint: positionMint.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }).then((x) => x[0]),
    getTickArrayAddress(whirlpool, lowerTickArrayIndex).then((x) => x[0]),
    getTickArrayAddress(whirlpool, upperTickArrayIndex).then((x) => x[0]),
  ]);

  const [lowerTickArray, upperTickArray] = await fetchAllMaybeTickArray(rpc, [
    lowerTickArrayAddress,
    upperTickArrayAddress,
  ]);

  const instructions: IInstruction[] = [];

  if (!lowerTickArray.exists) {
    instructions.push(
      getInitializeTickArrayInstruction({
        whirlpool: whirlpool,
        funder: signer,
        tickArray: lowerTickArrayAddress,
        startTickIndex: lowerTickArrayIndex,
      }),
    );
  }

  if (!upperTickArray.exists && lowerTickArrayIndex !== upperTickArrayIndex) {
    instructions.push(
      getInitializeTickArrayInstruction({
        whirlpool: whirlpool,
        funder: signer,
        tickArray: upperTickArrayAddress,
        startTickIndex: upperTickArrayIndex,
      }),
    );
  }

  instructions.push(
    getOpenPositionWithTokenExtensionsInstruction({
      funder: signer,
      owner: signer.address,
      position: positionAddress[0],
      positionMint: positionMint,
      positionTokenAccount: positionTokenAccount,
      whirlpool: whirlpool,
      token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      metadataUpdateAuth: metadataUpdateAuth,
      tickLowerIndex: initializableLowerTickIndex,
      tickUpperIndex: initializableUpperTickIndex,
      withTokenMetadataExtension: true,
    }),
  );

  await sendTransaction(instructions);

  return positionMint.address;
}

export async function setupPositionBundle(
  whirlpool: Address,
  config: { tickLower?: number; tickUpper?: number; liquidity?: bigint }[] = [],
): Promise<Address> {
  // TODO: implement when solana-bankrun supports gpa
  const _ = config;
  return whirlpool;
}
