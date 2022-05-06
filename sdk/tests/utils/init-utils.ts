import * as anchor from "@project-serum/anchor";
import {
  InitTickArrayParams,
  OpenPositionParams,
  InitPoolParams,
  InitializeRewardParams,
  TICK_ARRAY_SIZE,
  WhirlpoolContext,
  AccountFetcher,
  InitConfigParams,
  TickUtil,
  PriceMath,
  WhirlpoolIx,
  PDAUtil,
} from "../../src";
import {
  generateDefaultConfigParams,
  generateDefaultInitFeeTierParams,
  generateDefaultInitPoolParams,
  generateDefaultInitTickArrayParams,
  generateDefaultOpenPositionParams,
} from "./test-builders";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  createAndMintToTokenAccount,
  createMint,
  mintToByAuthority,
  TickSpacing,
  ZERO_BN,
} from ".";
import { u64 } from "@solana/spl-token";
import { PoolUtil } from "../../src/utils/public/pool-utils";
import { MathUtil, PDA } from "@orca-so/common-sdk";

const defaultInitSqrtPrice = MathUtil.toX64_BN(new u64(5));

/**
 * Initialize a brand new WhirlpoolsConfig account and construct a set of InitPoolParams
 * that can be used to initialize a pool with.
 * @param client - an instance of whirlpool client containing the program & provider
 * @param initSqrtPrice - the initial sqrt-price for this newly generated pool
 * @returns An object containing the params used to init the config account & the param that can be used to init the pool account.
 */
export async function buildTestPoolParams(
  ctx: WhirlpoolContext,
  tickSpacing: number,
  defaultFeeRate = 3000,
  initSqrtPrice = defaultInitSqrtPrice,
  funder?: PublicKey
) {
  const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
  await WhirlpoolIx.initializeConfigIx(ctx, configInitInfo).toTx().buildAndExecute();

  const { params: feeTierParams } = await initFeeTier(
    ctx,
    configInitInfo,
    configKeypairs.feeAuthorityKeypair,
    tickSpacing,
    defaultFeeRate
  );
  const poolInitInfo = await generateDefaultInitPoolParams(
    ctx,
    configInitInfo.whirlpoolsConfigKeypair.publicKey,
    feeTierParams.feeTierPda.publicKey,
    tickSpacing,
    initSqrtPrice,
    funder
  );
  return {
    configInitInfo,
    configKeypairs,
    poolInitInfo,
    feeTierParams,
  };
}

/**
 * Initialize a brand new set of WhirlpoolsConfig & Whirlpool account
 * @param client - an instance of whirlpool client containing the program & provider
 * @param initSqrtPrice - the initial sqrt-price for this newly generated pool
 * @returns An object containing the params used to initialize both accounts.
 */
export async function initTestPool(
  ctx: WhirlpoolContext,
  tickSpacing: number,
  initSqrtPrice = defaultInitSqrtPrice,
  funder?: Keypair
) {
  const { configInitInfo, poolInitInfo, configKeypairs, feeTierParams } = await buildTestPoolParams(
    ctx,
    tickSpacing,
    3000,
    initSqrtPrice,
    funder?.publicKey
  );

  const tx = WhirlpoolIx.initializePoolIx(ctx, poolInitInfo).toTx();
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

export async function initFeeTier(
  ctx: WhirlpoolContext,
  configInitInfo: InitConfigParams,
  feeAuthorityKeypair: Keypair,
  tickSpacing: number,
  defaultFeeRate: number,
  funder?: Keypair
) {
  const params = generateDefaultInitFeeTierParams(
    ctx,
    configInitInfo.whirlpoolsConfigKeypair.publicKey,
    configInitInfo.feeAuthority,
    tickSpacing,
    defaultFeeRate,
    funder?.publicKey
  );

  const tx = WhirlpoolIx.initializeFeeTierIx(ctx, params).toTx().addSigner(feeAuthorityKeypair);
  if (funder) {
    tx.addSigner(funder);
  }

  return {
    txId: await tx.buildAndExecute(),
    params,
  };
}

export async function initializeReward(
  ctx: WhirlpoolContext,
  rewardAuthorityKeypair: anchor.web3.Keypair,
  whirlpool: PublicKey,
  rewardIndex: number,
  funder?: Keypair
): Promise<{ txId: string; params: InitializeRewardParams }> {
  const provider = ctx.provider;
  const rewardMint = await createMint(provider);
  const rewardVaultKeypair = anchor.web3.Keypair.generate();

  const params = {
    rewardAuthority: rewardAuthorityKeypair.publicKey,
    funder: funder?.publicKey || ctx.wallet.publicKey,
    whirlpool,
    rewardMint,
    rewardVaultKeypair,
    rewardIndex,
  };

  const tx = WhirlpoolIx.initializeRewardIx(ctx, params).toTx().addSigner(rewardAuthorityKeypair);
  if (funder) {
    tx.addSigner(funder);
  }

  return {
    txId: await tx.buildAndExecute(),
    params,
  };
}

export async function initRewardAndSetEmissions(
  ctx: WhirlpoolContext,
  rewardAuthorityKeypair: anchor.web3.Keypair,
  whirlpool: PublicKey,
  rewardIndex: number,
  vaultAmount: u64 | number,
  emissionsPerSecondX64: anchor.BN,
  funder?: Keypair
) {
  const {
    params: { rewardMint, rewardVaultKeypair },
  } = await initializeReward(ctx, rewardAuthorityKeypair, whirlpool, rewardIndex, funder);
  await mintToByAuthority(ctx.provider, rewardMint, rewardVaultKeypair.publicKey, vaultAmount);
  await WhirlpoolIx.setRewardEmissionsIx(ctx, {
    rewardAuthority: rewardAuthorityKeypair.publicKey,
    whirlpool,
    rewardIndex,
    rewardVaultKey: rewardVaultKeypair.publicKey,
    emissionsPerSecondX64,
  })
    .toTx()
    .addSigner(rewardAuthorityKeypair)
    .buildAndExecute();
  return { rewardMint, rewardVaultKeypair };
}

export async function openPosition(
  ctx: WhirlpoolContext,
  whirlpool: PublicKey,
  tickLowerIndex: number,
  tickUpperIndex: number,
  owner: PublicKey = ctx.provider.wallet.publicKey,
  funder?: Keypair
) {
  return openPositionWithOptMetadata(
    ctx,
    whirlpool,
    tickLowerIndex,
    tickUpperIndex,
    false,
    owner,
    funder
  );
}

export async function openPositionWithMetadata(
  ctx: WhirlpoolContext,
  whirlpool: PublicKey,
  tickLowerIndex: number,
  tickUpperIndex: number,
  owner: PublicKey = ctx.provider.wallet.publicKey,
  funder?: Keypair
) {
  return openPositionWithOptMetadata(
    ctx,
    whirlpool,
    tickLowerIndex,
    tickUpperIndex,
    true,
    owner,
    funder
  );
}

async function openPositionWithOptMetadata(
  ctx: WhirlpoolContext,
  whirlpool: PublicKey,
  tickLowerIndex: number,
  tickUpperIndex: number,
  withMetadata: boolean = false,
  owner: PublicKey = ctx.provider.wallet.publicKey,
  funder?: Keypair
) {
  const { params, mint } = await generateDefaultOpenPositionParams(
    ctx,
    whirlpool,
    tickLowerIndex,
    tickUpperIndex,
    owner,
    funder?.publicKey || ctx.provider.wallet.publicKey
  );
  let tx = withMetadata
    ? WhirlpoolIx.openPositionWithMetadataIx(ctx, params).toTx()
    : WhirlpoolIx.openPositionIx(ctx, params).toTx();
  tx.addSigner(mint);
  if (funder) {
    tx.addSigner(funder);
  }
  const txId = await tx.buildAndExecute();
  return { txId, params, mint };
}

export async function initTickArray(
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
  const tx = WhirlpoolIx.initTickArrayIx(ctx, params).toTx();
  if (funder) {
    tx.addSigner(funder);
  }
  return { txId: await tx.buildAndExecute(), params };
}

export async function initTestPoolWithTokens(
  ctx: WhirlpoolContext,
  tickSpacing: number,
  initSqrtPrice = defaultInitSqrtPrice
) {
  const provider = ctx.provider;

  const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
    ctx,
    tickSpacing,
    initSqrtPrice
  );

  const { tokenMintA, tokenMintB, whirlpoolPda } = poolInitInfo;
  const tokenAccountA = await createAndMintToTokenAccount(provider, tokenMintA, 15_000_000);
  const tokenAccountB = await createAndMintToTokenAccount(provider, tokenMintB, 15_000_000);
  return {
    poolInitInfo,
    configInitInfo,
    configKeypairs,
    whirlpoolPda,
    tokenAccountA,
    tokenAccountB,
  };
}

export async function initTickArrayRange(
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

export type FundedPositionParams = {
  tickLowerIndex: number;
  tickUpperIndex: number;
  liquidityAmount: anchor.BN;
};

export async function withdrawPositions(
  ctx: WhirlpoolContext,
  positionInfos: FundedPositionInfo[],
  tokenOwnerAccountA: PublicKey,
  tokenOwnerAccountB: PublicKey
) {
  const fetcher = new AccountFetcher(ctx.connection);
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

      await WhirlpoolIx.decreaseLiquidityIx(ctx, {
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
        .toTx()
        .buildAndExecute();

      await WhirlpoolIx.collectFeesIx(ctx, {
        whirlpool: info.initParams.whirlpool,
        positionAuthority: ctx.provider.wallet.publicKey,
        position: info.initParams.positionPda.publicKey,
        positionTokenAccount: info.initParams.positionTokenAccount,
        tokenOwnerAccountA,
        tokenOwnerAccountB,
        tokenVaultA: pool.tokenVaultA,
        tokenVaultB: pool.tokenVaultB,
      })
        .toTx()
        .buildAndExecute();
    })
  );
}

export interface FundedPositionInfo {
  initParams: OpenPositionParams;
  publicKey: PublicKey;
  tokenAccount: PublicKey;
  mintKeypair: Keypair;
  tickArrayLower: PublicKey;
  tickArrayUpper: PublicKey;
}

export async function fundPositions(
  ctx: WhirlpoolContext,
  poolInitInfo: InitPoolParams,
  tokenAccountA: PublicKey,
  tokenAccountB: PublicKey,
  fundParams: FundedPositionParams[]
): Promise<FundedPositionInfo[]> {
  const {
    whirlpoolPda: { publicKey: whirlpool },
    tickSpacing,
    tokenVaultAKeypair,
    tokenVaultBKeypair,
    initSqrtPrice,
  } = poolInitInfo;

  return await Promise.all(
    fundParams.map(async (param): Promise<FundedPositionInfo> => {
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
        await WhirlpoolIx.increaseLiquidityIx(ctx, {
          liquidityAmount: param.liquidityAmount,
          tokenMaxA: tokenA,
          tokenMaxB: tokenB,
          whirlpool: whirlpool,
          positionAuthority: ctx.provider.wallet.publicKey,
          position: positionInfo.positionPda.publicKey,
          positionTokenAccount: positionInfo.positionTokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tickArrayLower,
          tickArrayUpper,
        })
          .toTx()
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
    })
  );
}

export async function initTestPoolWithLiquidity(ctx: WhirlpoolContext) {
  const {
    poolInitInfo,
    configInitInfo,
    configKeypairs,
    whirlpoolPda,
    tokenAccountA,
    tokenAccountB,
  } = await initTestPoolWithTokens(ctx, TickSpacing.Standard);

  const tickArrays = await initTickArrayRange(
    ctx,
    whirlpoolPda.publicKey,
    22528, // to 33792
    3,
    TickSpacing.Standard,
    false
  );

  const fundParams: FundedPositionParams[] = [
    {
      liquidityAmount: new u64(100_000),
      tickLowerIndex: 27904,
      tickUpperIndex: 33408,
    },
  ];

  const positionInfos = await fundPositions(
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
  };
}
