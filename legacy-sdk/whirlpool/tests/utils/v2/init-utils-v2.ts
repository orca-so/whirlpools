import * as anchor from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import { MathUtil } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { ComputeBudgetProgram, Keypair } from "@solana/web3.js";
import type BN from "bn.js";
import Decimal from "decimal.js";
import {
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TOKEN_PROGRAM_ID,
  TickSpacing,
  ZERO_BN,
} from "..";
import type {
  AdaptiveFeeConstantsData,
  InitConfigParams,
  InitPoolV2Params,
  InitPoolWithAdaptiveFeeParams,
  InitializeAdaptiveFeeTierParams,
  InitializeRewardV2Params,
  OpenPositionParams,
  WhirlpoolContext,
} from "../../../src";
import {
  PDAUtil,
  PriceMath,
  TICK_ARRAY_SIZE,
  TickUtil,
  WhirlpoolIx,
  toTx,
} from "../../../src";
import { PoolUtil } from "../../../src/utils/public/pool-utils";
import type { TestWhirlpoolsConfigKeypairs } from "../test-builders";
import { generateDefaultConfigParams } from "../test-builders";
import { initFeeTier, openPosition, initTickArrayRange, initAdaptiveFeeTier } from "../init-utils";
import {
  calculateTransferFeeIncludedAmount,
  createAndMintToAssociatedTokenAccountV2,
  createInOrderMintsV2,
  createMintV2,
  mintToDestinationV2,
} from "./token-2022";
import type {
  InitConfigExtensionParams,
  SetTokenBadgeAuthorityParams,
} from "../../../src/instructions";
import { getExtraAccountMetasForTestTransferHookProgram } from "./test-transfer-hook-program";
import type { AccountState } from "@solana/spl-token";
import { getEpochFee, getMint, getTransferFeeConfig } from "@solana/spl-token";

export interface TokenTrait {
  isToken2022: boolean;
  isNativeMint?: boolean;
  hasFreezeAuthority?: boolean;
  hasPermanentDelegate?: boolean;
  hasTransferFeeExtension?: boolean;
  transferFeeInitialBps?: number;
  transferFeeInitialMax?: bigint; // u64
  hasTransferHookExtension?: boolean;
  hasConfidentialTransferExtension?: boolean;

  hasInterestBearingExtension?: boolean;
  interestBearingRate?: number; // u16
  hasMintCloseAuthorityExtension?: boolean;
  hasDefaultAccountStateExtension?: boolean;
  defaultAccountInitialState?: AccountState;
  hasNonTransferableExtension?: boolean;
  hasTokenMetadataExtension?: boolean;
  hasMetadataPointerExtension?: boolean;
  hasGroupExtension?: boolean;
  hasGroupPointerExtension?: boolean;
  hasGroupMemberExtension?: boolean;
  hasGroupMemberPointerExtension?: boolean;
}

interface TestPoolV2Params {
  configInitInfo: InitConfigParams;
  configKeypairs: TestWhirlpoolsConfigKeypairs;
  poolInitInfo: InitPoolV2Params;
  feeTierParams: { defaultFeeRate: number };
  configExtension: TestConfigExtensionParams;
}

export type FundedPositionV2Params = {
  tickLowerIndex: number;
  tickUpperIndex: number;
  liquidityAmount: anchor.BN;
};

export interface FundedPositionV2Info {
  initParams: OpenPositionParams;
  publicKey: PublicKey;
  tokenAccount: PublicKey;
  mintKeypair: Keypair;
  tickArrayLower: PublicKey;
  tickArrayUpper: PublicKey;
}

interface TestPoolWithAdaptiveFeeParams {
  configInitInfo: InitConfigParams;
  configKeypairs: TestWhirlpoolsConfigKeypairs;
  poolInitInfo: InitPoolWithAdaptiveFeeParams;
  feeTierParams: InitializeAdaptiveFeeTierParams;
  configExtension: TestConfigExtensionParams;
}

const DEFAULT_SQRT_PRICE = MathUtil.toX64(new Decimal(5));

/*

export function getTokenAccsForPools(
  pools: InitPoolParams[],
  tokenAccounts: { mint: PublicKey; account: PublicKey }[]
) {
  const mints = [];
  for (const pool of pools) {
    mints.push(pool.tokenMintA);
    mints.push(pool.tokenMintB);
  }
  return mints.map((mint) =>
    tokenAccounts.find((acc) => acc.mint.equals(mint))!.account
  );
}
*/

export async function initTestPoolWithTokensV2(
  ctx: WhirlpoolContext,
  tokenTraitA: TokenTrait,
  tokenTraitB: TokenTrait,
  tickSpacing: number,
  initSqrtPrice = DEFAULT_SQRT_PRICE,
  mintAmount = new anchor.BN("15000000000"),
) {
  const provider = ctx.provider;

  const {
    poolInitInfo,
    configInitInfo,
    configKeypairs,
    feeTierParams,
    configExtension,
  } = await initTestPoolV2(
    ctx,
    tokenTraitA,
    tokenTraitB,
    tickSpacing,
    initSqrtPrice,
    undefined,
  );

  const { tokenMintA, tokenMintB, whirlpoolPda } = poolInitInfo;

  // Airdrop SOL into provider's wallet for SOL native token testing.
  const connection = ctx.provider.connection;
  const airdropTx = await connection.requestAirdrop(
    ctx.provider.wallet.publicKey,
    100_000_000_000_000,
  );
  await ctx.connection.confirmTransaction(
    {
      signature: airdropTx,
      ...(await ctx.connection.getLatestBlockhash("confirmed")),
    },
    "confirmed",
  );

  const tokenAccountA = await createAndMintToAssociatedTokenAccountV2(
    provider,
    tokenTraitA,
    tokenMintA,
    mintAmount,
  );

  const tokenAccountB = await createAndMintToAssociatedTokenAccountV2(
    provider,
    tokenTraitB,
    tokenMintB,
    mintAmount,
  );

  return {
    poolInitInfo,
    configInitInfo,
    configKeypairs,
    feeTierParams,
    configExtension,
    whirlpoolPda,
    tokenAccountA,
    tokenAccountB,
  };
}

export async function initTestPoolWithLiquidityV2(
  ctx: WhirlpoolContext,
  tokenTraitA: TokenTrait,
  tokenTraitB: TokenTrait,
  initSqrtPrice = DEFAULT_SQRT_PRICE,
  mintAmount = new anchor.BN("15000000000"),
) {
  const {
    poolInitInfo,
    configInitInfo,
    configKeypairs,
    feeTierParams,
    whirlpoolPda,
    tokenAccountA,
    tokenAccountB,
  } = await initTestPoolWithTokensV2(
    ctx,
    tokenTraitA,
    tokenTraitB,
    TickSpacing.Standard,
    initSqrtPrice,
    mintAmount,
  );

  const tickArrays = await initTickArrayRange(
    ctx,
    whirlpoolPda.publicKey,
    22528, // to 33792
    3,
    TickSpacing.Standard,
    false,
  );

  const fundParams: FundedPositionV2Params[] = [
    {
      liquidityAmount: new anchor.BN(100_000),
      tickLowerIndex: 27904,
      tickUpperIndex: 33408,
    },
  ];

  const positionInfos = await fundPositionsV2(
    ctx,
    poolInitInfo,
    tokenAccountA,
    tokenAccountB,
    fundParams,
  );

  return {
    poolInitInfo,
    configInitInfo,
    configKeypairs,
    positionInfo: positionInfos[0].initParams,
    tokenAccountA,
    tokenAccountB,
    tickArrays,
    feeTierParams,
  };
}

export async function initTestPoolV2(
  ctx: WhirlpoolContext,
  tokenTraitA: TokenTrait,
  tokenTraitB: TokenTrait,
  tickSpacing: number,
  initSqrtPrice = DEFAULT_SQRT_PRICE,
  funder?: Keypair,
) {
  const poolParams = await buildTestPoolV2Params(
    ctx,
    tokenTraitA,
    tokenTraitB,
    tickSpacing,
    3000,
    initSqrtPrice,
    funder?.publicKey,
  );

  return initTestPoolFromParamsV2(ctx, poolParams, funder);
}

export async function buildTestPoolV2Params(
  ctx: WhirlpoolContext,
  tokenTraitA: TokenTrait,
  tokenTraitB: TokenTrait,
  tickSpacing: number,
  defaultFeeRate = 3000,
  initSqrtPrice = DEFAULT_SQRT_PRICE,
  funder?: PublicKey,
  createTokenBadgeIfNeededA: boolean = true,
  createTokenBadgeIfNeededB: boolean = true,
): Promise<TestPoolV2Params> {
  const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
  const {
    configExtensionInitInfo,
    configExtensionSetTokenBadgeAuthorityInfo,
    configExtensionKeypairs,
  } = generateDefaultConfigExtensionParams(
    ctx,
    configInitInfo.whirlpoolsConfigKeypair.publicKey,
    configKeypairs.feeAuthorityKeypair.publicKey,
  );

  await toTx(
    ctx,
    WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
  ).buildAndExecute();
  await toTx(
    ctx,
    WhirlpoolIx.initializeConfigExtensionIx(
      ctx.program,
      configExtensionInitInfo,
    ),
  )
    .addSigner(configKeypairs.feeAuthorityKeypair)
    .buildAndExecute();
  await toTx(
    ctx,
    WhirlpoolIx.setTokenBadgeAuthorityIx(
      ctx.program,
      configExtensionSetTokenBadgeAuthorityInfo,
    ),
  )
    .addSigner(configKeypairs.feeAuthorityKeypair)
    .buildAndExecute();

  const { params: feeTierParams } = await initFeeTier(
    ctx,
    configInitInfo,
    configKeypairs.feeAuthorityKeypair,
    tickSpacing,
    defaultFeeRate,
  );
  const poolInitInfo = await generateDefaultInitPoolV2Params(
    ctx,
    configInitInfo.whirlpoolsConfigKeypair.publicKey,
    feeTierParams.feeTierPda.publicKey,
    tokenTraitA,
    tokenTraitB,
    tickSpacing,
    initSqrtPrice,
    funder,
  );

  if (isTokenBadgeRequired(tokenTraitA) && createTokenBadgeIfNeededA) {
    await toTx(
      ctx,
      WhirlpoolIx.initializeTokenBadgeIx(ctx.program, {
        tokenMint: poolInitInfo.tokenMintA,
        tokenBadgeAuthority:
          configExtensionKeypairs.tokenBadgeAuthorityKeypair.publicKey,
        tokenBadgePda: {
          publicKey: poolInitInfo.tokenBadgeA,
          bump: 0 /* dummy */,
        },
        whirlpoolsConfig: poolInitInfo.whirlpoolsConfig,
        whirlpoolsConfigExtension:
          configExtensionInitInfo.whirlpoolsConfigExtensionPda.publicKey,
        funder: funder ?? ctx.wallet.publicKey,
      }),
    )
      .addSigner(configExtensionKeypairs.tokenBadgeAuthorityKeypair)
      .buildAndExecute();
  }

  if (isTokenBadgeRequired(tokenTraitB) && createTokenBadgeIfNeededB) {
    await toTx(
      ctx,
      WhirlpoolIx.initializeTokenBadgeIx(ctx.program, {
        tokenMint: poolInitInfo.tokenMintB,
        tokenBadgeAuthority:
          configExtensionKeypairs.tokenBadgeAuthorityKeypair.publicKey,
        tokenBadgePda: {
          publicKey: poolInitInfo.tokenBadgeB,
          bump: 0 /* dummy */,
        },
        whirlpoolsConfig: poolInitInfo.whirlpoolsConfig,
        whirlpoolsConfigExtension:
          configExtensionInitInfo.whirlpoolsConfigExtensionPda.publicKey,
        funder: funder ?? ctx.wallet.publicKey,
      }),
    )
      .addSigner(configExtensionKeypairs.tokenBadgeAuthorityKeypair)
      .buildAndExecute();
  }

  return {
    configInitInfo,
    configKeypairs,
    poolInitInfo,
    feeTierParams,
    configExtension: {
      configExtensionInitInfo,
      configExtensionSetTokenBadgeAuthorityInfo,
      configExtensionKeypairs,
    },
  };
}

export async function initTestPoolWithAdaptiveFee(
  ctx: WhirlpoolContext,
  tokenTraitA: TokenTrait,
  tokenTraitB: TokenTrait,
  feeTierIndex: number,
  tickSpacing: number,
  defaultBaseFeeRate = 3000,
  presetAdaptiveFeeConstants: AdaptiveFeeConstantsData,
  initializePoolAuthority: PublicKey = PublicKey.default,
  delegatedFeeAuthority: PublicKey = PublicKey.default,
  initSqrtPrice = DEFAULT_SQRT_PRICE,
  executeInitializePoolAuthority?: Keypair,
  funder?: Keypair,
) {
  const poolParams = await buildTestPoolWithAdaptiveFeeParams(
    ctx,
    tokenTraitA,
    tokenTraitB,
    feeTierIndex,
    tickSpacing,
    defaultBaseFeeRate,
    initSqrtPrice,
    presetAdaptiveFeeConstants,
    initializePoolAuthority,
    delegatedFeeAuthority,
    executeInitializePoolAuthority?.publicKey,
    funder?.publicKey,
  );

  return initTestPoolWithAdaptiveFeeFromParams(ctx, poolParams, executeInitializePoolAuthority, funder);
}

export async function buildTestPoolWithAdaptiveFeeParams(
  ctx: WhirlpoolContext,
  tokenTraitA: TokenTrait,
  tokenTraitB: TokenTrait,
  feeTierIndex: number,
  tickSpacing: number,
  defaultBaseFeeRate = 3000,
  initSqrtPrice = DEFAULT_SQRT_PRICE,
  presetAdaptiveFeeConstants: AdaptiveFeeConstantsData,
  initializePoolAuthority: PublicKey,
  delegatedFeeAuthority: PublicKey,
  executeInitializePoolAuthority?: PublicKey,
  funder?: PublicKey,
  createTokenBadgeIfNeededA: boolean = true,
  createTokenBadgeIfNeededB: boolean = true,
): Promise<TestPoolWithAdaptiveFeeParams> {
  const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
  const {
    configExtensionInitInfo,
    configExtensionSetTokenBadgeAuthorityInfo,
    configExtensionKeypairs,
  } = generateDefaultConfigExtensionParams(
    ctx,
    configInitInfo.whirlpoolsConfigKeypair.publicKey,
    configKeypairs.feeAuthorityKeypair.publicKey,
  );

  await toTx(
    ctx,
    WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
  ).buildAndExecute();
  await toTx(
    ctx,
    WhirlpoolIx.initializeConfigExtensionIx(
      ctx.program,
      configExtensionInitInfo,
    ),
  )
    .addSigner(configKeypairs.feeAuthorityKeypair)
    .buildAndExecute();
  await toTx(
    ctx,
    WhirlpoolIx.setTokenBadgeAuthorityIx(
      ctx.program,
      configExtensionSetTokenBadgeAuthorityInfo,
    ),
  )
    .addSigner(configKeypairs.feeAuthorityKeypair)
    .buildAndExecute();

  const { params: feeTierParams } = await initAdaptiveFeeTier(
    ctx,
    configInitInfo,
    configKeypairs.feeAuthorityKeypair,
    feeTierIndex,
    tickSpacing,
    defaultBaseFeeRate,
    presetAdaptiveFeeConstants,
    initializePoolAuthority,
    delegatedFeeAuthority,
  );
  const poolInitInfo = await generateDefaultInitPoolWithAdaptiveFeeParams(
    ctx,
    configInitInfo.whirlpoolsConfigKeypair.publicKey,
    feeTierParams.feeTierPda.publicKey,
    tokenTraitA,
    tokenTraitB,
    feeTierIndex,
    initSqrtPrice,
    executeInitializePoolAuthority,
    funder,
  );

  if (isTokenBadgeRequired(tokenTraitA) && createTokenBadgeIfNeededA) {
    await toTx(
      ctx,
      WhirlpoolIx.initializeTokenBadgeIx(ctx.program, {
        tokenMint: poolInitInfo.tokenMintA,
        tokenBadgeAuthority:
          configExtensionKeypairs.tokenBadgeAuthorityKeypair.publicKey,
        tokenBadgePda: {
          publicKey: poolInitInfo.tokenBadgeA,
          bump: 0 /* dummy */,
        },
        whirlpoolsConfig: poolInitInfo.whirlpoolsConfig,
        whirlpoolsConfigExtension:
          configExtensionInitInfo.whirlpoolsConfigExtensionPda.publicKey,
        funder: funder ?? ctx.wallet.publicKey,
      }),
    )
      .addSigner(configExtensionKeypairs.tokenBadgeAuthorityKeypair)
      .buildAndExecute();
  }

  if (isTokenBadgeRequired(tokenTraitB) && createTokenBadgeIfNeededB) {
    await toTx(
      ctx,
      WhirlpoolIx.initializeTokenBadgeIx(ctx.program, {
        tokenMint: poolInitInfo.tokenMintB,
        tokenBadgeAuthority:
          configExtensionKeypairs.tokenBadgeAuthorityKeypair.publicKey,
        tokenBadgePda: {
          publicKey: poolInitInfo.tokenBadgeB,
          bump: 0 /* dummy */,
        },
        whirlpoolsConfig: poolInitInfo.whirlpoolsConfig,
        whirlpoolsConfigExtension:
          configExtensionInitInfo.whirlpoolsConfigExtensionPda.publicKey,
        funder: funder ?? ctx.wallet.publicKey,
      }),
    )
      .addSigner(configExtensionKeypairs.tokenBadgeAuthorityKeypair)
      .buildAndExecute();
  }

  return {
    configInitInfo,
    configKeypairs,
    poolInitInfo,
    feeTierParams,
    configExtension: {
      configExtensionInitInfo,
      configExtensionSetTokenBadgeAuthorityInfo,
      configExtensionKeypairs,
    },
  };
}

export async function initializeRewardV2(
  ctx: WhirlpoolContext,
  tokenTrait: TokenTrait,
  whirlpoolsConfig: PublicKey,
  rewardAuthorityKeypair: anchor.web3.Keypair,
  whirlpool: PublicKey,
  rewardIndex: number,
  tokenBadgeAuthorityKeypair: anchor.web3.Keypair,
  funder?: Keypair,
): Promise<{ txId: string; params: InitializeRewardV2Params }> {
  const provider = ctx.provider;
  const rewardMint = await createMintV2(provider, tokenTrait);
  const rewardVaultKeypair = anchor.web3.Keypair.generate();

  const rewardTokenBadgePda = PDAUtil.getTokenBadge(
    ctx.program.programId,
    whirlpoolsConfig,
    rewardMint,
  );

  if (isTokenBadgeRequired(tokenTrait)) {
    const configExtensionPda = PDAUtil.getConfigExtension(
      ctx.program.programId,
      whirlpoolsConfig,
    );
    await toTx(
      ctx,
      WhirlpoolIx.initializeTokenBadgeIx(ctx.program, {
        tokenMint: rewardMint,
        tokenBadgeAuthority: tokenBadgeAuthorityKeypair.publicKey,
        tokenBadgePda: rewardTokenBadgePda,
        whirlpoolsConfig: whirlpoolsConfig,
        whirlpoolsConfigExtension: configExtensionPda.publicKey,
        funder: funder?.publicKey ?? ctx.wallet.publicKey,
      }),
    )
      .addSigner(tokenBadgeAuthorityKeypair)
      .buildAndExecute();
  }

  const tokenProgram = tokenTrait.isToken2022
    ? TEST_TOKEN_2022_PROGRAM_ID
    : TEST_TOKEN_PROGRAM_ID;

  const params: InitializeRewardV2Params = {
    rewardAuthority: rewardAuthorityKeypair.publicKey,
    funder: funder?.publicKey || ctx.wallet.publicKey,
    whirlpool,
    rewardMint,
    rewardTokenBadge: rewardTokenBadgePda.publicKey,
    rewardVaultKeypair,
    rewardIndex,
    rewardTokenProgram: tokenProgram,
  };

  const tx = toTx(
    ctx,
    WhirlpoolIx.initializeRewardV2Ix(ctx.program, params),
  ).addSigner(rewardAuthorityKeypair);
  if (funder) {
    tx.addSigner(funder);
  }

  return {
    txId: await tx.buildAndExecute(),
    params,
  };
}

export async function initRewardAndSetEmissionsV2(
  ctx: WhirlpoolContext,
  tokenTrait: TokenTrait,
  rewardAuthorityKeypair: anchor.web3.Keypair,
  whirlpoolsConfig: PublicKey,
  whirlpool: PublicKey,
  rewardIndex: number,
  vaultAmount: BN | number,
  emissionsPerSecondX64: anchor.BN,
  tokenBadgeAuthorityKeypair: anchor.web3.Keypair,
  funder?: Keypair,
) {
  const {
    params: { rewardMint, rewardVaultKeypair, rewardTokenProgram },
  } = await initializeRewardV2(
    ctx,
    tokenTrait,
    whirlpoolsConfig,
    rewardAuthorityKeypair,
    whirlpool,
    rewardIndex,
    tokenBadgeAuthorityKeypair,
    funder,
  );

  await mintToDestinationV2(
    ctx.provider,
    tokenTrait,
    rewardMint,
    rewardVaultKeypair.publicKey,
    vaultAmount,
  );

  await toTx(
    ctx,
    WhirlpoolIx.setRewardEmissionsV2Ix(ctx.program, {
      rewardAuthority: rewardAuthorityKeypair.publicKey,
      whirlpool,
      rewardIndex,
      rewardVaultKey: rewardVaultKeypair.publicKey,
      emissionsPerSecondX64,
    }),
  )
    .addSigner(rewardAuthorityKeypair)
    .buildAndExecute();
  return { rewardMint, rewardVaultKeypair, tokenProgram: rewardTokenProgram };
}

////////////////////////////////////////////////////////////////////////////////
// private
////////////////////////////////////////////////////////////////////////////////
async function generateDefaultInitPoolV2Params(
  context: WhirlpoolContext,
  configKey: PublicKey,
  feeTierKey: PublicKey,
  tokenTraitA: TokenTrait,
  tokenTraitB: TokenTrait,
  tickSpacing: number,
  initSqrtPrice = MathUtil.toX64(new Decimal(5)),
  funder?: PublicKey,
): Promise<InitPoolV2Params> {
  const [tokenAMintPubKey, tokenBMintPubKey] = await createInOrderMintsV2(
    context.provider,
    tokenTraitA,
    tokenTraitB,
  );

  const whirlpoolPda = PDAUtil.getWhirlpool(
    context.program.programId,
    configKey,
    tokenAMintPubKey,
    tokenBMintPubKey,
    tickSpacing,
  );

  const tokenBadgeAPda = PDAUtil.getTokenBadge(
    context.program.programId,
    configKey,
    tokenAMintPubKey,
  );
  const tokenBadgeBPda = PDAUtil.getTokenBadge(
    context.program.programId,
    configKey,
    tokenBMintPubKey,
  );

  return {
    initSqrtPrice,
    whirlpoolsConfig: configKey,
    tokenMintA: tokenAMintPubKey,
    tokenMintB: tokenBMintPubKey,
    tokenBadgeA: tokenBadgeAPda.publicKey,
    tokenBadgeB: tokenBadgeBPda.publicKey,
    tokenProgramA: tokenTraitA.isToken2022
      ? TEST_TOKEN_2022_PROGRAM_ID
      : TEST_TOKEN_PROGRAM_ID,
    tokenProgramB: tokenTraitB.isToken2022
      ? TEST_TOKEN_2022_PROGRAM_ID
      : TEST_TOKEN_PROGRAM_ID,
    whirlpoolPda,
    tokenVaultAKeypair: Keypair.generate(),
    tokenVaultBKeypair: Keypair.generate(),
    feeTierKey,
    tickSpacing,
    funder: funder || context.wallet.publicKey,
  };
}

async function initTestPoolFromParamsV2(
  ctx: WhirlpoolContext,
  poolParams: TestPoolV2Params,
  funder?: Keypair,
) {
  const {
    configInitInfo,
    poolInitInfo,
    configKeypairs,
    feeTierParams,
    configExtension,
  } = poolParams;
  const tx = toTx(
    ctx,
    WhirlpoolIx.initializePoolV2Ix(ctx.program, poolInitInfo),
  );
  if (funder) {
    tx.addSigner(funder);
  }

  return {
    txId: await tx.buildAndExecute(),
    configInitInfo,
    configKeypairs,
    poolInitInfo,
    feeTierParams,
    configExtension,
  };
}

async function generateDefaultInitPoolWithAdaptiveFeeParams(
  context: WhirlpoolContext,
  configKey: PublicKey,
  adaptiveFeeTierKey: PublicKey,
  tokenTraitA: TokenTrait,
  tokenTraitB: TokenTrait,
  feeTierIndex: number,
  initSqrtPrice = MathUtil.toX64(new Decimal(5)),
  initializePoolAuthority: PublicKey = context.wallet.publicKey,
  funder?: PublicKey,
): Promise<InitPoolWithAdaptiveFeeParams> {
  const [tokenAMintPubKey, tokenBMintPubKey] = await createInOrderMintsV2(
    context.provider,
    tokenTraitA,
    tokenTraitB,
  );

  const whirlpoolPda = PDAUtil.getWhirlpool(
    context.program.programId,
    configKey,
    tokenAMintPubKey,
    tokenBMintPubKey,
    feeTierIndex,
  );

  const oraclePda = PDAUtil.getOracle(
    context.program.programId,
    whirlpoolPda.publicKey
  );

  const tokenBadgeAPda = PDAUtil.getTokenBadge(
    context.program.programId,
    configKey,
    tokenAMintPubKey,
  );
  const tokenBadgeBPda = PDAUtil.getTokenBadge(
    context.program.programId,
    configKey,
    tokenBMintPubKey,
  );

  return {
    initSqrtPrice,
    whirlpoolsConfig: configKey,
    tokenMintA: tokenAMintPubKey,
    tokenMintB: tokenBMintPubKey,
    tokenBadgeA: tokenBadgeAPda.publicKey,
    tokenBadgeB: tokenBadgeBPda.publicKey,
    tokenProgramA: tokenTraitA.isToken2022
      ? TEST_TOKEN_2022_PROGRAM_ID
      : TEST_TOKEN_PROGRAM_ID,
    tokenProgramB: tokenTraitB.isToken2022
      ? TEST_TOKEN_2022_PROGRAM_ID
      : TEST_TOKEN_PROGRAM_ID,
    whirlpoolPda,
    tokenVaultAKeypair: Keypair.generate(),
    tokenVaultBKeypair: Keypair.generate(),
    adaptiveFeeTierKey,
    initializePoolAuthority,
    oraclePda,
    funder: funder || context.wallet.publicKey,
  };
}

async function initTestPoolWithAdaptiveFeeFromParams(
  ctx: WhirlpoolContext,
  poolParams: TestPoolWithAdaptiveFeeParams,
  executeInitializePoolAuthority?: Keypair,
  funder?: Keypair,
) {
  const {
    configInitInfo,
    poolInitInfo,
    configKeypairs,
    feeTierParams,
    configExtension,
  } = poolParams;
  const tx = toTx(
    ctx,
    WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, poolInitInfo),
  );
  if (executeInitializePoolAuthority) {
    tx.addSigner(executeInitializePoolAuthority);
  }
  if (funder) {
    tx.addSigner(funder);
  }

  return {
    txId: await tx.buildAndExecute(),
    configInitInfo,
    configKeypairs,
    poolInitInfo,
    feeTierParams,
    configExtension,
  };
}


////////////////////////////////////////////////////////////////////////////////
// position related
////////////////////////////////////////////////////////////////////////////////

export async function withdrawPositionsV2(
  ctx: WhirlpoolContext,
  tokenTraitA: TokenTrait,
  tokenTraitB: TokenTrait,
  positionInfos: FundedPositionV2Info[],
  tokenOwnerAccountA: PublicKey,
  tokenOwnerAccountB: PublicKey,
) {
  const fetcher = ctx.fetcher;

  const tokenProgramA = tokenTraitA.isToken2022
    ? TEST_TOKEN_2022_PROGRAM_ID
    : TEST_TOKEN_PROGRAM_ID;
  const tokenProgramB = tokenTraitB.isToken2022
    ? TEST_TOKEN_2022_PROGRAM_ID
    : TEST_TOKEN_PROGRAM_ID;

  await Promise.all(
    positionInfos.map(async (info) => {
      const pool = await fetcher.getPool(info.initParams.whirlpool);
      const position = await fetcher.getPosition(
        info.initParams.positionPda.publicKey,
      );

      if (!pool) {
        throw new Error(`Failed to fetch pool - ${info.initParams.whirlpool}`);
      }

      if (!position) {
        throw new Error(
          `Failed to fetch position - ${info.initParams.whirlpool}`,
        );
      }

      const priceLower = PriceMath.tickIndexToSqrtPriceX64(
        position.tickLowerIndex,
      );
      const priceUpper = PriceMath.tickIndexToSqrtPriceX64(
        position.tickUpperIndex,
      );

      const { tokenA, tokenB } = PoolUtil.getTokenAmountsFromLiquidity(
        position.liquidity,
        pool.sqrtPrice,
        priceLower,
        priceUpper,
        false,
      );

      const numTicksInTickArray = pool.tickSpacing * TICK_ARRAY_SIZE;
      const lowerStartTick =
        position.tickLowerIndex -
        (position.tickLowerIndex % numTicksInTickArray);
      const tickArrayLower = PDAUtil.getTickArray(
        ctx.program.programId,
        info.initParams.whirlpool,
        lowerStartTick,
      );
      const upperStartTick =
        position.tickUpperIndex -
        (position.tickUpperIndex % numTicksInTickArray);
      const tickArrayUpper = PDAUtil.getTickArray(
        ctx.program.programId,
        info.initParams.whirlpool,
        upperStartTick,
      );

      await toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
          liquidityAmount: position.liquidity,
          tokenMinA: tokenA,
          tokenMinB: tokenB,
          whirlpool: info.initParams.whirlpool,
          positionAuthority: ctx.provider.wallet.publicKey,
          position: info.initParams.positionPda.publicKey,
          positionTokenAccount: info.initParams.positionTokenAccount,
          tokenMintA: pool.tokenMintA,
          tokenMintB: pool.tokenMintB,
          tokenProgramA,
          tokenProgramB,
          tokenOwnerAccountA,
          tokenOwnerAccountB,
          tokenVaultA: pool.tokenVaultA,
          tokenVaultB: pool.tokenVaultB,
          tickArrayLower: tickArrayLower.publicKey,
          tickArrayUpper: tickArrayUpper.publicKey,
        }),
      ).buildAndExecute();

      await toTx(
        ctx,
        WhirlpoolIx.collectFeesV2Ix(ctx.program, {
          whirlpool: info.initParams.whirlpool,
          positionAuthority: ctx.provider.wallet.publicKey,
          position: info.initParams.positionPda.publicKey,
          positionTokenAccount: info.initParams.positionTokenAccount,
          tokenMintA: pool.tokenMintA,
          tokenMintB: pool.tokenMintB,
          tokenProgramA,
          tokenProgramB,
          tokenOwnerAccountA,
          tokenOwnerAccountB,
          tokenVaultA: pool.tokenVaultA,
          tokenVaultB: pool.tokenVaultB,
        }),
      ).buildAndExecute();
    }),
  );
}

export async function fundPositionsV2(
  ctx: WhirlpoolContext,
  poolInitInfo: InitPoolV2Params,
  tokenAccountA: PublicKey,
  tokenAccountB: PublicKey,
  fundParams: FundedPositionV2Params[],
): Promise<FundedPositionV2Info[]> {
  const {
    whirlpoolPda: { publicKey: whirlpool },
    tickSpacing,
    tokenVaultAKeypair,
    tokenVaultBKeypair,
    initSqrtPrice,
  } = poolInitInfo;

  const mintA = await getMint(
    ctx.provider.connection,
    poolInitInfo.tokenMintA,
    "confirmed",
    poolInitInfo.tokenProgramA,
  );
  const mintB = await getMint(
    ctx.provider.connection,
    poolInitInfo.tokenMintB,
    "confirmed",
    poolInitInfo.tokenProgramB,
  );
  const feeConfigA = getTransferFeeConfig(mintA);
  const feeConfigB = getTransferFeeConfig(mintB);
  const epoch = await ctx.provider.connection.getEpochInfo("confirmed");

  return await Promise.all(
    fundParams.map(async (param): Promise<FundedPositionV2Info> => {
      const { params: positionInfo, mint } = await openPosition(
        ctx,
        whirlpool,
        param.tickLowerIndex,
        param.tickUpperIndex,
      );

      const tickArrayLower = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpool,
        TickUtil.getStartTickIndex(param.tickLowerIndex, tickSpacing),
      ).publicKey;

      const tickArrayUpper = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpool,
        TickUtil.getStartTickIndex(param.tickUpperIndex, tickSpacing),
      ).publicKey;

      if (param.liquidityAmount.gt(ZERO_BN)) {
        const { tokenA, tokenB } = PoolUtil.getTokenAmountsFromLiquidity(
          param.liquidityAmount,
          initSqrtPrice,
          PriceMath.tickIndexToSqrtPriceX64(param.tickLowerIndex),
          PriceMath.tickIndexToSqrtPriceX64(param.tickUpperIndex),
          true,
        );

        // transfer fee
        const transferFeeA = !feeConfigA
          ? ZERO_BN
          : calculateTransferFeeIncludedAmount(
              getEpochFee(feeConfigA, BigInt(epoch.epoch)),
              tokenA,
            ).fee;
        const transferFeeB = !feeConfigB
          ? ZERO_BN
          : calculateTransferFeeIncludedAmount(
              getEpochFee(feeConfigB, BigInt(epoch.epoch)),
              tokenB,
            ).fee;

        //console.info("transfer feeA", transferFeeA.toString(), "/", tokenA.toString());
        //console.info("transfer feeB", transferFeeB.toString(), "/", tokenB.toString());

        // transfer hook
        const tokenTransferHookAccountsA =
          await getExtraAccountMetasForTestTransferHookProgram(
            ctx.provider,
            poolInitInfo.tokenMintA,
            tokenAccountA,
            tokenVaultAKeypair.publicKey,
            ctx.provider.wallet.publicKey,
          );
        const tokenTransferHookAccountsB =
          await getExtraAccountMetasForTestTransferHookProgram(
            ctx.provider,
            poolInitInfo.tokenMintB,
            tokenAccountB,
            tokenVaultBKeypair.publicKey,
            ctx.provider.wallet.publicKey,
          );

        await toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
            liquidityAmount: param.liquidityAmount,
            tokenMaxA: tokenA.add(transferFeeA),
            tokenMaxB: tokenB.add(transferFeeB),
            whirlpool: whirlpool,
            positionAuthority: ctx.provider.wallet.publicKey,
            position: positionInfo.positionPda.publicKey,
            positionTokenAccount: positionInfo.positionTokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: tokenVaultAKeypair.publicKey,
            tokenVaultB: tokenVaultBKeypair.publicKey,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tickArrayLower,
            tickArrayUpper,
            tokenTransferHookAccountsA,
            tokenTransferHookAccountsB,
          }),
        )
          .prependInstruction(useMaxCU())
          .buildAndExecute();
      }
      return {
        initParams: positionInfo,
        publicKey: positionInfo.positionPda.publicKey,
        tokenAccount: positionInfo.positionTokenAccount,
        mintKeypair: mint,
        tickArrayLower,
        tickArrayUpper,
      };
    }),
  );
}

export interface TestWhirlpoolsConfigExtensionKeypairs {
  tokenBadgeAuthorityKeypair: Keypair;
}

export interface TestConfigExtensionParams {
  configExtensionInitInfo: InitConfigExtensionParams;
  configExtensionSetTokenBadgeAuthorityInfo: SetTokenBadgeAuthorityParams;
  configExtensionKeypairs: TestWhirlpoolsConfigExtensionKeypairs;
}

export const generateDefaultConfigExtensionParams = (
  context: WhirlpoolContext,
  whirlpoolsConfig: PublicKey,
  feeAuthority: PublicKey,
  funder?: PublicKey,
): TestConfigExtensionParams => {
  const configExtensionKeypairs: TestWhirlpoolsConfigExtensionKeypairs = {
    tokenBadgeAuthorityKeypair: Keypair.generate(),
  };
  const configExtensionInitInfo: InitConfigExtensionParams = {
    whirlpoolsConfig,
    feeAuthority,
    whirlpoolsConfigExtensionPda: PDAUtil.getConfigExtension(
      context.program.programId,
      whirlpoolsConfig,
    ),
    funder: funder || context.wallet.publicKey,
  };
  const configExtensionSetTokenBadgeAuthorityInfo: SetTokenBadgeAuthorityParams =
    {
      whirlpoolsConfig,
      whirlpoolsConfigExtension:
        configExtensionInitInfo.whirlpoolsConfigExtensionPda.publicKey,
      configExtensionAuthority: feeAuthority,
      newTokenBadgeAuthority:
        configExtensionKeypairs.tokenBadgeAuthorityKeypair.publicKey,
    };
  return {
    configExtensionInitInfo,
    configExtensionKeypairs,
    configExtensionSetTokenBadgeAuthorityInfo,
  };
};

export function isTokenBadgeRequired(tokenTrait: TokenTrait): boolean {
  if (tokenTrait.hasFreezeAuthority) return true;
  if (tokenTrait.hasPermanentDelegate) return true;
  if (tokenTrait.hasTransferHookExtension) return true;
  return false;
}

export function useCU(cu: number): Instruction {
  return {
    cleanupInstructions: [],
    signers: [],
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({
        units: cu,
      }),
    ],
  };
}

export function useMaxCU(): Instruction {
  return useCU(1_400_000);
}
