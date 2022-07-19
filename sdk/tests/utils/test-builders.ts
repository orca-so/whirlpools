import { MathUtil, PDA, Percentage } from "@orca-so/common-sdk";
import { AnchorProvider } from "@project-serum/anchor";
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import { createAndMintToAssociatedTokenAccount, createMint } from ".";
import {
  increaseLiquidityQuoteByInputToken,
  InitConfigParams,
  InitFeeTierParams,
  InitPoolParams,
  InitTickArrayParams,
  OpenPositionParams,
  PDAUtil,
  PriceMath,
  Whirlpool,
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
    whirlpoolsConfigKeypair: Keypair.generate(),
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
  initSqrtPrice = MathUtil.toX64(new Decimal(5)),
  funder?: PublicKey
): Promise<InitPoolParams> => {
  const [tokenAMintPubKey, tokenBMintPubKey] = await createInOrderMints(context);

  const whirlpoolPda = PDAUtil.getWhirlpool(
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
    whirlpoolsConfig: configKey,
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
  whirlpoolsConfigKey: PublicKey,
  whirlpoolFeeAuthority: PublicKey,
  tickSpacing: number,
  defaultFeeRate: number,
  funder?: PublicKey
): InitFeeTierParams => {
  const feeTierPda = PDAUtil.getFeeTier(
    context.program.programId,
    whirlpoolsConfigKey,
    tickSpacing
  );
  return {
    feeTierPda,
    whirlpoolsConfig: whirlpoolsConfigKey,
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
  const tickArrayPda = PDAUtil.getTickArray(context.program.programId, whirlpool, startTick);

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
): Promise<{ params: Required<OpenPositionParams & { metadataPda: PDA }>; mint: Keypair }> {
  const positionMintKeypair = Keypair.generate();
  const positionPda = PDAUtil.getPosition(context.program.programId, positionMintKeypair.publicKey);

  const metadataPda = PDAUtil.getPositionMetadata(positionMintKeypair.publicKey);

  const positionTokenAccountAddress = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    positionMintKeypair.publicKey,
    owner
  );

  const params: Required<OpenPositionParams & { metadataPda: PDA }> = {
    funder: funder || context.wallet.publicKey,
    owner: owner,
    positionPda,
    metadataPda,
    positionMintAddress: positionMintKeypair.publicKey,
    positionTokenAccount: positionTokenAccountAddress,
    whirlpool: whirlpool,
    tickLowerIndex,
    tickUpperIndex,
  };
  return {
    params,
    mint: positionMintKeypair,
  };
}

export async function mintTokensToTestAccount(
  provider: AnchorProvider,
  tokenAMint: PublicKey,
  tokenMintForA: number,
  tokenBMint: PublicKey,
  tokenMintForB: number,
  destinationWallet?: PublicKey
) {
  const userTokenAAccount = await createAndMintToAssociatedTokenAccount(
    provider,
    tokenAMint,
    tokenMintForA,
    destinationWallet
  );
  const userTokenBAccount = await createAndMintToAssociatedTokenAccount(
    provider,
    tokenBMint,
    tokenMintForB,
    destinationWallet
  );

  return [userTokenAAccount, userTokenBAccount];
}

export async function initPosition(
  ctx: WhirlpoolContext,
  pool: Whirlpool,
  lowerPrice: Decimal,
  upperPrice: Decimal,
  inputTokenMint: PublicKey,
  inputTokenAmount: number,
  sourceWallet?: Keypair
) {
  const sourceWalletKey = sourceWallet ? sourceWallet.publicKey : ctx.wallet.publicKey;
  const tokenADecimal = pool.getTokenAInfo().decimals;
  const tokenBDecimal = pool.getTokenBInfo().decimals;
  const tickSpacing = pool.getData().tickSpacing;
  const lowerTick = PriceMath.priceToInitializableTickIndex(
    lowerPrice,
    tokenADecimal,
    tokenBDecimal,
    tickSpacing
  );
  const upperTick = PriceMath.priceToInitializableTickIndex(
    upperPrice,
    tokenADecimal,
    tokenBDecimal,
    tickSpacing
  );
  const quote = await increaseLiquidityQuoteByInputToken(
    inputTokenMint,
    new Decimal(inputTokenAmount),
    lowerTick,
    upperTick,
    Percentage.fromFraction(1, 100),
    pool
  );

  // [Action] Open Position (and increase L)
  const { positionMint, tx } = await pool.openPosition(
    lowerTick,
    upperTick,
    quote,
    sourceWalletKey,
    ctx.wallet.publicKey
  );

  if (sourceWallet) {
    tx.addSigner(sourceWallet);
  }

  await tx.buildAndExecute();

  return {
    positionMint,
    positionAddress: PDAUtil.getPosition(ctx.program.programId, positionMint),
  };
}
