import * as anchor from "@coral-xyz/anchor";
import { MathUtil, PDA } from "@orca-so/common-sdk";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import {
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TOKEN_PROGRAM_ID,
  TickSpacing,
  ZERO_BN,
} from "..";
import {
  InitConfigParams,
  InitPoolV2Params,
  InitializeRewardV2Params,
  OpenPositionParams,
  PDAUtil,
  PriceMath,
  TickUtil,
  WhirlpoolContext,
  WhirlpoolIx,
  toTx
} from "../../../src";
import { PoolUtil } from "../../../src/utils/public/pool-utils";
import {
  TestWhirlpoolsConfigKeypairs,
  generateDefaultConfigParams,
} from "../test-builders";
import {
  initFeeTier,
  openPosition,
  initTickArrayRange,
} from "../init-utils";
import {
  createAndMintToAssociatedTokenAccountV2,
  createInOrderMintsV2,
  createMintV2,
  mintToDestinationV2
} from "./token-2022";


export interface TokenTrait {
  isToken2022: boolean;
  isNativeMint?: boolean;
  hasFreezeAuthority?: boolean;
  hasPermanentDelegate?: boolean;
  hasTransferFeeExtension?: boolean;
}

interface TestPoolV2Params {
  configInitInfo: InitConfigParams;
  configKeypairs: TestWhirlpoolsConfigKeypairs;
  poolInitInfo: InitPoolV2Params;
  feeTierParams: any;
}

interface InitTestPoolParams {
  mintIndices: [number, number];
  tickSpacing: number;
  feeTierIndex?: number;
  initSqrtPrice?: anchor.BN;
}

interface InitTestTickArrayRangeParams {
  poolIndex: number;
  startTickIndex: number;
  arrayCount: number;
  aToB: boolean;
}

interface InitTestPositionParams {
  poolIndex: number;
  fundParams: FundedPositionV2Params[];
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


const DEFAULT_FEE_RATE = 3000;
const DEFAULT_MINT_AMOUNT = new anchor.BN("15000000000");
const DEFAULT_SQRT_PRICE = MathUtil.toX64(new Decimal(5));

const DEFAULT_INIT_FEE_TIER = [{ tickSpacing: TickSpacing.Standard }];
const DEFAULT_INIT_MINT = [{}, {}];
const DEFAULT_INIT_TOKEN = [{ mintIndex: 0 }, { mintIndex: 1 }];
const DEFAULT_INIT_POOL: InitTestPoolParams[] = [
  { mintIndices: [0, 1], tickSpacing: TickSpacing.Standard },
];
const DEFAULT_INIT_TICK_ARR: InitTestTickArrayRangeParams[] = [];
const DEFAULT_INIT_POSITION: InitTestPositionParams[] = [];

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

  const { poolInitInfo, configInitInfo, configKeypairs, feeTierParams } = await initTestPoolV2(
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
    100_000_000_000_000
  );
  await ctx.connection.confirmTransaction({
    signature: airdropTx,
    ...(await ctx.connection.getLatestBlockhash("confirmed")),
  }, "confirmed");

  const tokenAccountA = await createAndMintToAssociatedTokenAccountV2(
    provider,
    tokenTraitA,
    tokenMintA,
    mintAmount
  );

  const tokenAccountB = await createAndMintToAssociatedTokenAccountV2(
    provider,
    tokenTraitB,
    tokenMintB,
    mintAmount
  );

  return {
    poolInitInfo,
    configInitInfo,
    configKeypairs,
    feeTierParams,
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
    false
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
    fundParams
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
) {
  const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
  await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo)).buildAndExecute();

  const { params: feeTierParams } = await initFeeTier(
    ctx,
    configInitInfo,
    configKeypairs.feeAuthorityKeypair,
    tickSpacing,
    defaultFeeRate
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
  return {
    configInitInfo,
    configKeypairs,
    poolInitInfo,
    feeTierParams,
  };
}

export async function initializeRewardV2(
  ctx: WhirlpoolContext,
  tokenTrait: TokenTrait,
  rewardAuthorityKeypair: anchor.web3.Keypair,
  whirlpool: PublicKey,
  rewardIndex: number,
  funder?: Keypair
): Promise<{ txId: string; params: InitializeRewardV2Params }> {
  const provider = ctx.provider;
  const rewardMint = await createMintV2(provider, tokenTrait);
  const rewardVaultKeypair = anchor.web3.Keypair.generate();

  const tokenProgram = tokenTrait.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID;

  const params: InitializeRewardV2Params = {
    rewardAuthority: rewardAuthorityKeypair.publicKey,
    funder: funder?.publicKey || ctx.wallet.publicKey,
    whirlpool,
    rewardMint,
    rewardVaultKeypair,
    rewardIndex,
    tokenProgram,
  };

  const tx = toTx(ctx, WhirlpoolIx.initializeRewardV2Ix(ctx.program, params)).addSigner(
    rewardAuthorityKeypair
  );
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
  whirlpool: PublicKey,
  rewardIndex: number,
  vaultAmount: BN | number,
  emissionsPerSecondX64: anchor.BN,
  funder?: Keypair
) {
  const {
    params: { rewardMint, rewardVaultKeypair, tokenProgram },
  } = await initializeRewardV2(ctx, tokenTrait, rewardAuthorityKeypair, whirlpool, rewardIndex, funder);

  await mintToDestinationV2(ctx.provider, tokenTrait, rewardMint, rewardVaultKeypair.publicKey, vaultAmount);

  await toTx(
    ctx,
    WhirlpoolIx.setRewardEmissionsV2Ix(ctx.program, {
      rewardAuthority: rewardAuthorityKeypair.publicKey,
      whirlpool,
      rewardIndex,
      rewardVaultKey: rewardVaultKeypair.publicKey,
      emissionsPerSecondX64,
    })
  )
  .addSigner(rewardAuthorityKeypair)
  .buildAndExecute();
  return { rewardMint, rewardVaultKeypair, tokenProgram };
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
  const [tokenAMintPubKey, tokenBMintPubKey] = await createInOrderMintsV2(context.provider, tokenTraitA, tokenTraitB);

  const whirlpoolPda = PDAUtil.getWhirlpool(
    context.program.programId,
    configKey,
    tokenAMintPubKey,
    tokenBMintPubKey,
    tickSpacing
  );

  return {
    initSqrtPrice,
    whirlpoolsConfig: configKey,
    tokenMintA: tokenAMintPubKey,
    tokenMintB: tokenBMintPubKey,
    tokenProgramA: tokenTraitA.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID,
    tokenProgramB: tokenTraitB.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID,
    whirlpoolPda,
    tokenVaultAKeypair: Keypair.generate(),
    tokenVaultBKeypair: Keypair.generate(),
    feeTierKey,
    tickSpacing,
    funder: funder || context.wallet.publicKey,
  };
};

async function initTestPoolFromParamsV2(
  ctx: WhirlpoolContext,
  poolParams: TestPoolV2Params,
  funder?: Keypair
) {
  const { configInitInfo, poolInitInfo, configKeypairs, feeTierParams } = poolParams;
  const tx = toTx(ctx, WhirlpoolIx.initializePoolV2Ix(ctx.program, poolInitInfo));
  if (funder) {
    tx.addSigner(funder);
  }

  return {
    txId: await tx.buildAndExecute(),
    configInitInfo,
    configKeypairs,
    poolInitInfo,
    feeTierParams,
  };
}


////////////////////////////////////////////////////////////////////////////////
// position related
////////////////////////////////////////////////////////////////////////////////
/*
export async function withdrawPositions(
  ctx: WhirlpoolContext,
  positionInfos: FundedPositionInfo[],
  tokenOwnerAccountA: PublicKey,
  tokenOwnerAccountB: PublicKey
) {
  const fetcher = ctx.fetcher;
  await Promise.all(
    positionInfos.map(async (info) => {
      const pool = await fetcher.getPool(info.initParams.whirlpool);
      const position = await fetcher.getPosition(info.initParams.positionPda.publicKey);

      if (!pool) {
        throw new Error(`Failed to fetch pool - ${info.initParams.whirlpool}`);
      }

      if (!position) {
        throw new Error(`Failed to fetch position - ${info.initParams.whirlpool}`);
      }

      const priceLower = PriceMath.tickIndexToSqrtPriceX64(position.tickLowerIndex);
      const priceUpper = PriceMath.tickIndexToSqrtPriceX64(position.tickUpperIndex);

      const { tokenA, tokenB } = PoolUtil.getTokenAmountsFromLiquidity(
        position.liquidity,
        pool.sqrtPrice,
        priceLower,
        priceUpper,
        false
      );

      const numTicksInTickArray = pool.tickSpacing * TICK_ARRAY_SIZE;
      const lowerStartTick =
        position.tickLowerIndex - (position.tickLowerIndex % numTicksInTickArray);
      const tickArrayLower = PDAUtil.getTickArray(
        ctx.program.programId,
        info.initParams.whirlpool,
        lowerStartTick
      );
      const upperStartTick =
        position.tickUpperIndex - (position.tickUpperIndex % numTicksInTickArray);
      const tickArrayUpper = PDAUtil.getTickArray(
        ctx.program.programId,
        info.initParams.whirlpool,
        upperStartTick
      );

      await toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount: position.liquidity,
          tokenMinA: tokenA,
          tokenMinB: tokenB,
          whirlpool: info.initParams.whirlpool,
          positionAuthority: ctx.provider.wallet.publicKey,
          position: info.initParams.positionPda.publicKey,
          positionTokenAccount: info.initParams.positionTokenAccount,
          tokenOwnerAccountA,
          tokenOwnerAccountB,
          tokenVaultA: pool.tokenVaultA,
          tokenVaultB: pool.tokenVaultB,
          tickArrayLower: tickArrayLower.publicKey,
          tickArrayUpper: tickArrayUpper.publicKey,
        })
      ).buildAndExecute();

      await toTx(
        ctx,
        WhirlpoolIx.collectFeesIx(ctx.program, {
          whirlpool: info.initParams.whirlpool,
          positionAuthority: ctx.provider.wallet.publicKey,
          position: info.initParams.positionPda.publicKey,
          positionTokenAccount: info.initParams.positionTokenAccount,
          tokenOwnerAccountA,
          tokenOwnerAccountB,
          tokenVaultA: pool.tokenVaultA,
          tokenVaultB: pool.tokenVaultB,
        })
      ).buildAndExecute();
    })
  );
}
*/


export async function fundPositionsV2(
  ctx: WhirlpoolContext,
  poolInitInfo: InitPoolV2Params,
  tokenAccountA: PublicKey,
  tokenAccountB: PublicKey,
  fundParams: FundedPositionV2Params[]
): Promise<FundedPositionV2Info[]> {
  const {
    whirlpoolPda: { publicKey: whirlpool },
    tickSpacing,
    tokenVaultAKeypair,
    tokenVaultBKeypair,
    initSqrtPrice,
  } = poolInitInfo;

  return await Promise.all(
    fundParams.map(async (param): Promise<FundedPositionV2Info> => {
      const { params: positionInfo, mint } = await openPosition(
        ctx,
        whirlpool,
        param.tickLowerIndex,
        param.tickUpperIndex
      );

      const tickArrayLower = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpool,
        TickUtil.getStartTickIndex(param.tickLowerIndex, tickSpacing)
      ).publicKey;

      const tickArrayUpper = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpool,
        TickUtil.getStartTickIndex(param.tickUpperIndex, tickSpacing)
      ).publicKey;

      if (param.liquidityAmount.gt(ZERO_BN)) {
        const { tokenA, tokenB } = PoolUtil.getTokenAmountsFromLiquidity(
          param.liquidityAmount,
          initSqrtPrice,
          PriceMath.tickIndexToSqrtPriceX64(param.tickLowerIndex),
          PriceMath.tickIndexToSqrtPriceX64(param.tickUpperIndex),
          true
        );
        await toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
            liquidityAmount: param.liquidityAmount,
            tokenMaxA: tokenA,
            tokenMaxB: tokenB,
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
          })
        ).buildAndExecute();
      }
      return {
        initParams: positionInfo,
        publicKey: positionInfo.positionPda.publicKey,
        tokenAccount: positionInfo.positionTokenAccount,
        mintKeypair: mint,
        tickArrayLower,
        tickArrayUpper,
      };
    })
  );
}
/*
////////////////////////////////////////////////////////////////////////////////
// tickarray related
////////////////////////////////////////////////////////////////////////////////
async function initTickArrayRange(
  ctx: WhirlpoolContext,
  whirlpool: PublicKey,
  startTickIndex: number,
  arrayCount: number,
  tickSpacing: number,
  aToB: boolean
): Promise<PDA[]> {
  const ticksInArray = tickSpacing * TICK_ARRAY_SIZE;
  const direction = aToB ? -1 : 1;
  const result: PDA[] = [];

  for (let i = 0; i < arrayCount; i++) {
    const { params } = await initTickArray(
      ctx,
      whirlpool,
      startTickIndex + direction * ticksInArray * i
    );
    result.push(params.tickArrayPda);
  }

  return result;
}

async function initTickArray(
  ctx: WhirlpoolContext,
  whirlpool: PublicKey,
  startTickIndex: number,
  funder?: Keypair
): Promise<{ txId: string; params: InitTickArrayParams }> {
  const params = generateDefaultInitTickArrayParams(
    ctx,
    whirlpool,
    startTickIndex,
    funder?.publicKey
  );
  const tx = toTx(ctx, WhirlpoolIx.initTickArrayIx(ctx.program, params));
  if (funder) {
    tx.addSigner(funder);
  }
  return { txId: await tx.buildAndExecute(), params };
}
*/