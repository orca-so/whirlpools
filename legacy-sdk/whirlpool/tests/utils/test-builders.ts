import type { AnchorProvider } from "@coral-xyz/anchor";
import type { PDA } from "@orca-so/common-sdk";
import { AddressUtil, MathUtil, Percentage } from "@orca-so/common-sdk";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import Decimal from "decimal.js";
import { createAndMintToAssociatedTokenAccount, createMint } from ".";
import type {
  InitConfigParams,
  InitFeeTierParams,
  InitPoolParams,
  InitTickArrayParams,
  OpenBundledPositionParams,
  OpenPositionParams,
  Whirlpool,
} from "../../src";
import {
  IGNORE_CACHE,
  PDAUtil,
  PoolUtil,
  PriceMath,
  increaseLiquidityQuoteByInputTokenUsingPriceSlippage,
} from "../../src";
import type { WhirlpoolContext } from "../../src/context";
import { TokenExtensionUtil } from "../../src/utils/public/token-extension-util";
import type { OpenPositionWithTokenExtensionsParams } from "../../src/instructions";

export interface TestWhirlpoolsConfigKeypairs {
  feeAuthorityKeypair: Keypair;
  collectProtocolFeesAuthorityKeypair: Keypair;
  rewardEmissionsSuperAuthorityKeypair: Keypair;
}

export interface TestConfigParams {
  configInitInfo: InitConfigParams;
  configKeypairs: TestWhirlpoolsConfigKeypairs;
}

export const generateDefaultConfigParams = (
  context: WhirlpoolContext,
  funder?: PublicKey,
): TestConfigParams => {
  const configKeypairs: TestWhirlpoolsConfigKeypairs = {
    feeAuthorityKeypair: Keypair.generate(),
    collectProtocolFeesAuthorityKeypair: Keypair.generate(),
    rewardEmissionsSuperAuthorityKeypair: Keypair.generate(),
  };
  const configInitInfo = {
    whirlpoolsConfigKeypair: Keypair.generate(),
    feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
    collectProtocolFeesAuthority:
      configKeypairs.collectProtocolFeesAuthorityKeypair.publicKey,
    rewardEmissionsSuperAuthority:
      configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
    defaultProtocolFeeRate: 300,
    funder: funder || context.wallet.publicKey,
  };
  return { configInitInfo, configKeypairs };
};

export const createInOrderMints = async (
  context: WhirlpoolContext,
  reuseTokenA?: PublicKey,
) => {
  const provider = context.provider;
  const tokenXMintPubKey = reuseTokenA ?? (await createMint(provider));

  // ensure reuseTokenA is the first mint if reuseTokenA is provided
  let ordered;
  do {
    const tokenYMintPubKey = await createMint(provider);
    ordered = PoolUtil.orderMints(tokenXMintPubKey, tokenYMintPubKey).map(
      AddressUtil.toPubKey,
    );
  } while (!!reuseTokenA && !ordered[0].equals(reuseTokenA));
  return ordered;
};

export const generateDefaultInitPoolParams = async (
  context: WhirlpoolContext,
  configKey: PublicKey,
  feeTierKey: PublicKey,
  tickSpacing: number,
  initSqrtPrice = MathUtil.toX64(new Decimal(5)),
  funder?: PublicKey,
  reuseTokenA?: PublicKey,
): Promise<InitPoolParams> => {
  const [tokenAMintPubKey, tokenBMintPubKey] = await createInOrderMints(
    context,
    reuseTokenA,
  );

  const whirlpoolPda = PDAUtil.getWhirlpool(
    context.program.programId,
    configKey,
    tokenAMintPubKey,
    tokenBMintPubKey,
    tickSpacing,
  );

  return {
    initSqrtPrice,
    whirlpoolsConfig: configKey,
    tokenMintA: tokenAMintPubKey,
    tokenMintB: tokenBMintPubKey,
    whirlpoolPda,
    tokenVaultAKeypair: Keypair.generate(),
    tokenVaultBKeypair: Keypair.generate(),
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
  funder?: PublicKey,
): InitFeeTierParams => {
  const feeTierPda = PDAUtil.getFeeTier(
    context.program.programId,
    whirlpoolsConfigKey,
    tickSpacing,
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
  funder?: PublicKey,
): InitTickArrayParams => {
  const tickArrayPda = PDAUtil.getTickArray(
    context.program.programId,
    whirlpool,
    startTick,
  );

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
  funder?: PublicKey,
): Promise<{
  params: Required<OpenPositionParams & { metadataPda: PDA }>;
  mint: Keypair;
}> {
  const positionMintKeypair = Keypair.generate();
  const positionPda = PDAUtil.getPosition(
    context.program.programId,
    positionMintKeypair.publicKey,
  );

  const metadataPda = PDAUtil.getPositionMetadata(
    positionMintKeypair.publicKey,
  );

  const positionTokenAccountAddress = getAssociatedTokenAddressSync(
    positionMintKeypair.publicKey,
    owner,
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

export async function generateDefaultOpenPositionWithTokenExtensionsParams(
  context: WhirlpoolContext,
  whirlpool: PublicKey,
  withTokenMetadataExtension: boolean,
  tickLowerIndex: number,
  tickUpperIndex: number,
  owner: PublicKey,
  funder?: PublicKey,
): Promise<{
  params: OpenPositionWithTokenExtensionsParams;
  mint: Keypair;
}> {
  const positionMintKeypair = Keypair.generate();
  const positionPda = PDAUtil.getPosition(
    context.program.programId,
    positionMintKeypair.publicKey,
  );

  // Mint is based on Token-2022, so TokenAccount is also based on Token-2022.
  const positionTokenAccount2022Address = getAssociatedTokenAddressSync(
    positionMintKeypair.publicKey,
    owner,
    true,
    TOKEN_2022_PROGRAM_ID, // token program id
  );

  return {
    params: {
      funder: funder || context.wallet.publicKey,
      owner: owner,
      positionPda,
      positionMint: positionMintKeypair.publicKey,
      positionTokenAccount: positionTokenAccount2022Address,
      whirlpool: whirlpool,
      tickLowerIndex,
      tickUpperIndex,
      withTokenMetadataExtension,
    },
    mint: positionMintKeypair,
  };
}

export async function mintTokensToTestAccount(
  provider: AnchorProvider,
  tokenAMint: PublicKey,
  tokenMintForA: number,
  tokenBMint: PublicKey,
  tokenMintForB: number,
  destinationWallet?: PublicKey,
) {
  const userTokenAAccount = await createAndMintToAssociatedTokenAccount(
    provider,
    tokenAMint,
    tokenMintForA,
    destinationWallet,
  );
  const userTokenBAccount = await createAndMintToAssociatedTokenAccount(
    provider,
    tokenBMint,
    tokenMintForB,
    destinationWallet,
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
  sourceWallet?: Keypair,
  withTokenExtensions: boolean = false,
) {
  const sourceWalletKey = sourceWallet
    ? sourceWallet.publicKey
    : ctx.wallet.publicKey;
  const tokenADecimal = pool.getTokenAInfo().decimals;
  const tokenBDecimal = pool.getTokenBInfo().decimals;
  const tickSpacing = pool.getData().tickSpacing;
  const lowerTick = PriceMath.priceToInitializableTickIndex(
    lowerPrice,
    tokenADecimal,
    tokenBDecimal,
    tickSpacing,
  );
  const upperTick = PriceMath.priceToInitializableTickIndex(
    upperPrice,
    tokenADecimal,
    tokenBDecimal,
    tickSpacing,
  );
  const quote = await increaseLiquidityQuoteByInputTokenUsingPriceSlippage(
    inputTokenMint,
    new Decimal(inputTokenAmount),
    lowerTick,
    upperTick,
    Percentage.fromFraction(1, 100),
    pool,
    await TokenExtensionUtil.buildTokenExtensionContext(
      ctx.fetcher,
      pool.getData(),
      IGNORE_CACHE,
    ),
  );

  // [Action] Open Position (and increase L)
  const { positionMint, tx } = await pool.openPosition(
    lowerTick,
    upperTick,
    quote,
    sourceWalletKey,
    ctx.wallet.publicKey,
    undefined,
    withTokenExtensions ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
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

export async function generateDefaultOpenBundledPositionParams(
  context: WhirlpoolContext,
  whirlpool: PublicKey,
  positionBundleMint: PublicKey,
  bundleIndex: number,
  tickLowerIndex: number,
  tickUpperIndex: number,
  owner: PublicKey,
  funder?: PublicKey,
): Promise<{ params: Required<OpenBundledPositionParams> }> {
  const bundledPositionPda = PDAUtil.getBundledPosition(
    context.program.programId,
    positionBundleMint,
    bundleIndex,
  );
  const positionBundle = PDAUtil.getPositionBundle(
    context.program.programId,
    positionBundleMint,
  ).publicKey;

  const positionBundleTokenAccount = getAssociatedTokenAddressSync(
    positionBundleMint,
    owner,
  );

  const params: Required<OpenBundledPositionParams> = {
    bundleIndex,
    bundledPositionPda,
    positionBundle,
    positionBundleAuthority: owner,
    funder: funder || owner,
    positionBundleTokenAccount,
    whirlpool: whirlpool,
    tickLowerIndex,
    tickUpperIndex,
  };
  return {
    params,
  };
}
