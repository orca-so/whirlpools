import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import { createMint } from ".";
import {
  getFeeTierPda,
  getPositionMetadataPda,
  getPositionPda,
  getTickArrayPda,
  getWhirlpoolPda,
  InitConfigParams,
  InitFeeTierParams,
  InitPoolParams,
  InitTickArrayParams,
  OpenPositionParams,
  toX64,
} from "../../src";
import { WhirlpoolContext } from "../../src/context";

export interface TestWhirlpoolsConfigKeypairs {
  feeAuthorityKeypair: Keypair;
  collectProtocolFeesAuthorityKeypair: Keypair;
  rewardEmissionsSuperAuthorityKeypair: Keypair;
}

export const generateDefaultConfigParams = (
  context: WhirlpoolContext,
  funder?: PublicKey
): {
  configInitInfo: InitConfigParams;
  configKeypairs: TestWhirlpoolsConfigKeypairs;
} => {
  const configKeypairs: TestWhirlpoolsConfigKeypairs = {
    feeAuthorityKeypair: Keypair.generate(),
    collectProtocolFeesAuthorityKeypair: Keypair.generate(),
    rewardEmissionsSuperAuthorityKeypair: Keypair.generate(),
  };
  const configInitInfo = {
    whirlpoolConfigKeypair: Keypair.generate(),
    feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
    collectProtocolFeesAuthority: configKeypairs.collectProtocolFeesAuthorityKeypair.publicKey,
    rewardEmissionsSuperAuthority: configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
    defaultProtocolFeeRate: 300,
    funder: funder || context.wallet.publicKey,
  };
  return { configInitInfo, configKeypairs };
};

export const createInOrderMints = async (context: WhirlpoolContext) => {
  const provider = context.provider;
  const tokenXMintPubKey = await createMint(provider);
  const tokenYMintPubKey = await createMint(provider);

  let tokenAMintPubKey, tokenBMintPubKey;
  if (Buffer.compare(tokenXMintPubKey.toBuffer(), tokenYMintPubKey.toBuffer()) < 0) {
    tokenAMintPubKey = tokenXMintPubKey;
    tokenBMintPubKey = tokenYMintPubKey;
  } else {
    tokenAMintPubKey = tokenYMintPubKey;
    tokenBMintPubKey = tokenXMintPubKey;
  }

  return [tokenAMintPubKey, tokenBMintPubKey];
};

export const generateDefaultInitPoolParams = async (
  context: WhirlpoolContext,
  configKey: PublicKey,
  feeTierKey: PublicKey,
  tickSpacing: number,
  initSqrtPrice = toX64(new Decimal(5)),
  funder?: PublicKey
): Promise<InitPoolParams> => {
  const [tokenAMintPubKey, tokenBMintPubKey] = await createInOrderMints(context);

  const whirlpoolPda = getWhirlpoolPda(
    context.program.programId,
    configKey,
    tokenAMintPubKey,
    tokenBMintPubKey,
    tickSpacing
  );
  const tokenVaultAKeypair = Keypair.generate();
  const tokenVaultBKeypair = Keypair.generate();

  return {
    initSqrtPrice,
    whirlpoolConfigKey: configKey,
    tokenMintA: tokenAMintPubKey,
    tokenMintB: tokenBMintPubKey,
    whirlpoolPda,
    tokenVaultAKeypair,
    tokenVaultBKeypair,
    feeTierKey,
    tickSpacing,
    funder: funder || context.wallet.publicKey,
  };
};

export const generateDefaultInitFeeTierParams = (
  context: WhirlpoolContext,
  whirlpoolConfigKey: PublicKey,
  whirlpoolFeeAuthority: PublicKey,
  tickSpacing: number,
  defaultFeeRate: number,
  funder?: PublicKey
): InitFeeTierParams => {
  const feeTierPda = getFeeTierPda(context.program.programId, whirlpoolConfigKey, tickSpacing);
  return {
    feeTierPda,
    whirlpoolConfigKey,
    tickSpacing,
    defaultFeeRate,
    feeAuthority: whirlpoolFeeAuthority,
    funder: funder || context.wallet.publicKey,
  };
};

export const generateDefaultInitTickArrayParams = (
  context: WhirlpoolContext,
  whirlpool: PublicKey,
  startTick: number,
  funder?: PublicKey
): InitTickArrayParams => {
  const tickArrayPda = getTickArrayPda(context.program.programId, whirlpool, startTick);

  return {
    whirlpool,
    tickArrayPda: tickArrayPda,
    startTick,
    funder: funder || context.wallet.publicKey,
  };
};

export async function generateDefaultOpenPositionParams(
  context: WhirlpoolContext,
  whirlpool: PublicKey,
  tickLowerIndex: number,
  tickUpperIndex: number,
  owner: PublicKey,
  funder?: PublicKey
): Promise<{ params: Required<OpenPositionParams>; mint: Keypair }> {
  const positionMintKeypair = Keypair.generate();
  const positionPda = getPositionPda(context.program.programId, positionMintKeypair.publicKey);

  const metadataPda = getPositionMetadataPda(positionMintKeypair.publicKey);

  const positionTokenAccountAddress = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    positionMintKeypair.publicKey,
    owner
  );

  const params: Required<OpenPositionParams> = {
    funder: funder || context.wallet.publicKey,
    ownerKey: owner,
    positionPda,
    metadataPda,
    positionMintAddress: positionMintKeypair.publicKey,
    positionTokenAccountAddress: positionTokenAccountAddress,
    whirlpoolKey: whirlpool,
    tickLowerIndex,
    tickUpperIndex,
  };
  return {
    params,
    mint: positionMintKeypair,
  };
}
