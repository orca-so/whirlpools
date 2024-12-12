import * as anchor from "@coral-xyz/anchor";
import type { PDA } from "@orca-so/common-sdk";
import { AddressUtil, MathUtil } from "@orca-so/common-sdk";
import {
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import type BN from "bn.js";
import Decimal from "decimal.js";
import {
  TickSpacing,
  ZERO_BN,
  createAndMintToAssociatedTokenAccount,
  createMint,
  mintToDestination,
} from ".";
import type {
  InitConfigParams,
  InitFeeTierParams,
  InitPoolParams,
  InitTickArrayParams,
  InitializeRewardParams,
  OpenPositionParams,
  WhirlpoolClient,
  WhirlpoolContext,
} from "../../src";
import {
  PDAUtil,
  PriceMath,
  TICK_ARRAY_SIZE,
  TickUtil,
  WhirlpoolIx,
  toTx,
} from "../../src";
import { IGNORE_CACHE } from "../../src/network/public/fetcher";
import { PoolUtil } from "../../src/utils/public/pool-utils";
import type {
  TestConfigParams,
  TestWhirlpoolsConfigKeypairs,
} from "./test-builders";
import {
  generateDefaultConfigParams,
  generateDefaultInitFeeTierParams,
  generateDefaultInitPoolParams,
  generateDefaultInitTickArrayParams,
  generateDefaultOpenBundledPositionParams,
  generateDefaultOpenPositionParams,
  generateDefaultOpenPositionWithTokenExtensionsParams,
} from "./test-builders";

interface TestPoolParams {
  configInitInfo: InitConfigParams;
  configKeypairs: TestWhirlpoolsConfigKeypairs;
  poolInitInfo: InitPoolParams;
  feeTierParams: { defaultFeeRate: number };
}

interface InitTestFeeTierParams {
  tickSpacing: number;
  feeRate?: number;
}

interface InitTestPoolParams {
  mintIndices: [number, number];
  tickSpacing: number;
  feeTierIndex?: number;
  initSqrtPrice?: anchor.BN;
}

interface InitTestMintParams {
  // Default false
  isNative?: boolean;
}

interface InitTestTokenAccParams {
  mintIndex: number;
  mintAmount?: anchor.BN;
}

interface InitTestTickArrayRangeParams {
  poolIndex: number;
  startTickIndex: number;
  arrayCount: number;
  aToB: boolean;
}

interface InitTestPositionParams {
  poolIndex: number;
  fundParams: FundedPositionParams[];
}

export interface InitAquariumParams {
  // Single-ton per aquarium
  configParams?: TestConfigParams;

  initFeeTierParams: InitTestFeeTierParams[];

  initMintParams: InitTestMintParams[];

  initTokenAccParams: InitTestTokenAccParams[];

  initPoolParams: InitTestPoolParams[];

  initTickArrayRangeParams: InitTestTickArrayRangeParams[];

  initPositionParams: InitTestPositionParams[];
}

export interface TestAquarium {
  configParams: TestConfigParams;
  feeTierParams: InitFeeTierParams[];
  mintKeys: PublicKey[];
  tokenAccounts: { mint: PublicKey; account: PublicKey }[];
  pools: InitPoolParams[];
  tickArrays: { params: InitTestTickArrayRangeParams; pdas: PDA[] }[];
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

export function getDefaultAquarium(): InitAquariumParams {
  return {
    initFeeTierParams: [...DEFAULT_INIT_FEE_TIER],
    initMintParams: [...DEFAULT_INIT_MINT],
    initTokenAccParams: [...DEFAULT_INIT_TOKEN],
    initPoolParams: [...DEFAULT_INIT_POOL],
    initTickArrayRangeParams: [...DEFAULT_INIT_TICK_ARR],
    initPositionParams: [...DEFAULT_INIT_POSITION],
  };
}

export async function buildTestAquariums(
  ctx: WhirlpoolContext,
  initParams: InitAquariumParams[],
): Promise<TestAquarium[]> {
  const aquariums: TestAquarium[] = [];
  // Airdrop SOL into provider wallet;
  await ctx.connection.requestAirdrop(
    ctx.provider.wallet.publicKey,
    100_000_000_000_000,
  );
  for (const initParam of initParams) {
    // Create configs
    let configParams = initParam.configParams;
    if (!configParams) {
      configParams = generateDefaultConfigParams(ctx);
    }
    // Could batch
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, configParams.configInitInfo),
    ).buildAndExecute();

    const {
      initFeeTierParams,
      initMintParams,
      initTokenAccParams,
      initPoolParams,
      initTickArrayRangeParams,
      initPositionParams,
    } = initParam;

    const feeTierParams: InitFeeTierParams[] = [];
    for (const initFeeTierParam of initFeeTierParams) {
      const { tickSpacing } = initFeeTierParam;
      const feeRate =
        initFeeTierParam.feeRate !== undefined
          ? initFeeTierParam.feeRate
          : DEFAULT_FEE_RATE;
      const { params } = await initFeeTier(
        ctx,
        configParams.configInitInfo,
        configParams.configKeypairs.feeAuthorityKeypair,
        tickSpacing,
        feeRate,
      );
      feeTierParams.push(params);
    }

    // TODO: Handle native vs sorted mint keys
    const mintKeys = (
      await Promise.all(
        initMintParams.map(({ isNative }) =>
          isNative ? NATIVE_MINT : createMint(ctx.provider),
        ),
      )
    ).sort(PoolUtil.compareMints);

    const tokenAccounts = await Promise.all(
      initTokenAccParams.map(async (initTokenAccParam) => {
        const { mintIndex, mintAmount = DEFAULT_MINT_AMOUNT } =
          initTokenAccParam;
        const mintKey = mintKeys[mintIndex];
        const account = await createAndMintToAssociatedTokenAccount(
          ctx.provider,
          mintKey,
          mintAmount,
        );
        return { mint: mintKey, account };
      }),
    );

    const pools = await Promise.all(
      initPoolParams.map(async (initPoolParam) => {
        const {
          tickSpacing,
          mintIndices,
          initSqrtPrice = DEFAULT_SQRT_PRICE,
          feeTierIndex = 0,
        } = initPoolParam;
        const [mintOne, mintTwo] = mintIndices.map((idx) => mintKeys[idx]);
        const [tokenMintA, tokenMintB] = PoolUtil.orderMints(
          mintOne,
          mintTwo,
        ).map(AddressUtil.toPubKey);

        const configKey =
          configParams!.configInitInfo.whirlpoolsConfigKeypair.publicKey;
        const whirlpoolPda = PDAUtil.getWhirlpool(
          ctx.program.programId,
          configKey,
          tokenMintA,
          tokenMintB,
          tickSpacing,
        );

        const poolParam = {
          initSqrtPrice,
          whirlpoolsConfig: configKey,
          tokenMintA,
          tokenMintB,
          whirlpoolPda,
          tokenVaultAKeypair: Keypair.generate(),
          tokenVaultBKeypair: Keypair.generate(),
          feeTierKey: feeTierParams[feeTierIndex].feeTierPda.publicKey,
          tickSpacing,
          // TODO: funder
          funder: ctx.wallet.publicKey,
        };

        const tx = toTx(
          ctx,
          WhirlpoolIx.initializePoolIx(ctx.program, poolParam),
        );
        await tx.buildAndExecute();
        return poolParam;
      }),
    );

    const tickArrays = await Promise.all(
      initTickArrayRangeParams.map(async (initTickArrayRangeParam) => {
        const { poolIndex, startTickIndex, arrayCount, aToB } =
          initTickArrayRangeParam;
        const pool = pools[poolIndex];
        const pdas = await initTickArrayRange(
          ctx,
          pool.whirlpoolPda.publicKey,
          startTickIndex,
          arrayCount,
          pool.tickSpacing,
          aToB,
        );
        return {
          params: initTickArrayRangeParam,
          pdas,
        };
      }),
    );

    await Promise.all(
      initPositionParams.map(async (initPositionParam) => {
        const { poolIndex, fundParams } = initPositionParam;
        const pool = pools[poolIndex];
        const tokenAccKeys = getTokenAccsForPools([pool], tokenAccounts);
        await fundPositions(
          ctx,
          pool,
          tokenAccKeys[0],
          tokenAccKeys[1],
          fundParams,
        );
      }),
    );

    aquariums.push({
      configParams,
      feeTierParams,
      mintKeys,
      tokenAccounts,
      pools,
      tickArrays,
    });
  }
  return aquariums;
}

export function getTokenAccsForPools(
  pools: InitPoolParams[],
  tokenAccounts: { mint: PublicKey; account: PublicKey }[],
) {
  const mints: PublicKey[] = [];
  for (const pool of pools) {
    mints.push(pool.tokenMintA);
    mints.push(pool.tokenMintB);
  }
  return mints.map(
    (mint) => tokenAccounts.find((acc) => acc.mint.equals(mint))!.account,
  );
}

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
  initSqrtPrice = DEFAULT_SQRT_PRICE,
  funder?: PublicKey,
  reuseTokenA?: PublicKey,
) {
  const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
  await toTx(
    ctx,
    WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
  ).buildAndExecute();

  const { params: feeTierParams } = await initFeeTier(
    ctx,
    configInitInfo,
    configKeypairs.feeAuthorityKeypair,
    tickSpacing,
    defaultFeeRate,
  );
  const poolInitInfo = await generateDefaultInitPoolParams(
    ctx,
    configInitInfo.whirlpoolsConfigKeypair.publicKey,
    feeTierParams.feeTierPda.publicKey,
    tickSpacing,
    initSqrtPrice,
    funder,
    reuseTokenA,
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
  initSqrtPrice = DEFAULT_SQRT_PRICE,
  funder?: Keypair,
  reuseTokenA?: PublicKey,
) {
  const poolParams = await buildTestPoolParams(
    ctx,
    tickSpacing,
    3000,
    initSqrtPrice,
    funder?.publicKey,
    reuseTokenA,
  );

  return initTestPoolFromParams(ctx, poolParams, funder);
}

export async function initTestPoolFromParams(
  ctx: WhirlpoolContext,
  poolParams: TestPoolParams,
  funder?: Keypair,
) {
  const { configInitInfo, poolInitInfo, configKeypairs, feeTierParams } =
    poolParams;
  const tx = toTx(ctx, WhirlpoolIx.initializePoolIx(ctx.program, poolInitInfo));
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
  funder?: Keypair,
) {
  const params = generateDefaultInitFeeTierParams(
    ctx,
    configInitInfo.whirlpoolsConfigKeypair.publicKey,
    configInitInfo.feeAuthority,
    tickSpacing,
    defaultFeeRate,
    funder?.publicKey,
  );

  const tx = toTx(
    ctx,
    WhirlpoolIx.initializeFeeTierIx(ctx.program, params),
  ).addSigner(feeAuthorityKeypair);
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
  funder?: Keypair,
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

  const tx = toTx(
    ctx,
    WhirlpoolIx.initializeRewardIx(ctx.program, params),
  ).addSigner(rewardAuthorityKeypair);
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
  vaultAmount: BN | number,
  emissionsPerSecondX64: anchor.BN,
  funder?: Keypair,
) {
  const {
    params: { rewardMint, rewardVaultKeypair },
  } = await initializeReward(
    ctx,
    rewardAuthorityKeypair,
    whirlpool,
    rewardIndex,
    funder,
  );

  await mintToDestination(
    ctx.provider,
    rewardMint,
    rewardVaultKeypair.publicKey,
    vaultAmount,
  );

  await toTx(
    ctx,
    WhirlpoolIx.setRewardEmissionsIx(ctx.program, {
      rewardAuthority: rewardAuthorityKeypair.publicKey,
      whirlpool,
      rewardIndex,
      rewardVaultKey: rewardVaultKeypair.publicKey,
      emissionsPerSecondX64,
    }),
  )
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
  funder?: Keypair,
  withTokenExtensions: boolean = false,
): ReturnType<typeof openPositionWithOptMetadata> {
  if (withTokenExtensions) {
    const result = await openPositionWithTokenExtensions(
      ctx,
      whirlpool,
      tickLowerIndex,
      tickUpperIndex,
      false,
      owner,
      funder,
    );

    // adjust return type for compatibility
    return {
      mint: result.mint,
      txId: result.txId,
      params: {
        ...result.params,
        // rename
        positionMintAddress: result.params.positionMint,
        // add metadata
        metadataPda: PDAUtil.getPositionMetadata(result.params.positionMint),
      },
    };
  }

  return openPositionWithOptMetadata(
    ctx,
    whirlpool,
    tickLowerIndex,
    tickUpperIndex,
    false,
    owner,
    funder,
  );
}

export async function openPositionWithMetadata(
  ctx: WhirlpoolContext,
  whirlpool: PublicKey,
  tickLowerIndex: number,
  tickUpperIndex: number,
  owner: PublicKey = ctx.provider.wallet.publicKey,
  funder?: Keypair,
) {
  return openPositionWithOptMetadata(
    ctx,
    whirlpool,
    tickLowerIndex,
    tickUpperIndex,
    true,
    owner,
    funder,
  );
}

async function openPositionWithOptMetadata(
  ctx: WhirlpoolContext,
  whirlpool: PublicKey,
  tickLowerIndex: number,
  tickUpperIndex: number,
  withMetadata: boolean = false,
  owner: PublicKey = ctx.provider.wallet.publicKey,
  funder?: Keypair,
) {
  const { params, mint } = await generateDefaultOpenPositionParams(
    ctx,
    whirlpool,
    tickLowerIndex,
    tickUpperIndex,
    owner,
    funder?.publicKey || ctx.provider.wallet.publicKey,
  );
  let tx = withMetadata
    ? toTx(ctx, WhirlpoolIx.openPositionWithMetadataIx(ctx.program, params))
    : toTx(ctx, WhirlpoolIx.openPositionIx(ctx.program, params));
  tx.addSigner(mint);
  if (funder) {
    tx.addSigner(funder);
  }
  const txId = await tx.buildAndExecute();
  return { txId, params, mint };
}

async function openPositionWithTokenExtensions(
  ctx: WhirlpoolContext,
  whirlpool: PublicKey,
  tickLowerIndex: number,
  tickUpperIndex: number,
  withMetadata: boolean = false,
  owner: PublicKey = ctx.provider.wallet.publicKey,
  funder?: Keypair,
) {
  const { params, mint } =
    await generateDefaultOpenPositionWithTokenExtensionsParams(
      ctx,
      whirlpool,
      withMetadata,
      tickLowerIndex,
      tickUpperIndex,
      owner,
      funder?.publicKey || ctx.provider.wallet.publicKey,
    );
  let tx = toTx(
    ctx,
    WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
  );
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
  funder?: Keypair,
): Promise<{ txId: string; params: InitTickArrayParams }> {
  const params = generateDefaultInitTickArrayParams(
    ctx,
    whirlpool,
    startTickIndex,
    funder?.publicKey,
  );
  const tx = toTx(ctx, WhirlpoolIx.initTickArrayIx(ctx.program, params));
  if (funder) {
    tx.addSigner(funder);
  }
  return { txId: await tx.buildAndExecute(), params };
}

export async function initTestPoolWithTokens(
  ctx: WhirlpoolContext,
  tickSpacing: number,
  initSqrtPrice = DEFAULT_SQRT_PRICE,
  mintAmount = new anchor.BN("15000000000"),
  reuseTokenA?: PublicKey,
) {
  const provider = ctx.provider;

  const { poolInitInfo, configInitInfo, configKeypairs, feeTierParams } =
    await initTestPool(ctx, tickSpacing, initSqrtPrice, undefined, reuseTokenA);

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

  const tokenAccountA = await createAndMintToAssociatedTokenAccount(
    provider,
    tokenMintA,
    mintAmount,
  );

  const tokenAccountB = await createAndMintToAssociatedTokenAccount(
    provider,
    tokenMintB,
    mintAmount,
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

export async function initTickArrayRange(
  ctx: WhirlpoolContext,
  whirlpool: PublicKey,
  startTickIndex: number,
  arrayCount: number,
  tickSpacing: number,
  aToB: boolean,
): Promise<PDA[]> {
  const ticksInArray = tickSpacing * TICK_ARRAY_SIZE;
  const direction = aToB ? -1 : 1;
  const result: PDA[] = [];

  for (let i = 0; i < arrayCount; i++) {
    const { params } = await initTickArray(
      ctx,
      whirlpool,
      startTickIndex + direction * ticksInArray * i,
    );
    result.push(params.tickArrayPda);
  }

  return result;
}

export type FundedPositionParams = {
  tickLowerIndex: number;
  tickUpperIndex: number;
  liquidityAmount: anchor.BN;
  isTokenExtensionsBasedPosition?: boolean;
};

export async function withdrawPositions(
  ctx: WhirlpoolContext,
  positionInfos: FundedPositionInfo[],
  tokenOwnerAccountA: PublicKey,
  tokenOwnerAccountB: PublicKey,
) {
  const fetcher = ctx.fetcher;
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
        }),
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
        }),
      ).buildAndExecute();
    }),
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

export async function fundPositionsWithClient(
  client: WhirlpoolClient,
  whirlpoolKey: PublicKey,
  fundParams: FundedPositionParams[],
) {
  const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
  const whirlpoolData = whirlpool.getData();
  await Promise.all(
    fundParams.map(async (param) => {
      const { tokenA, tokenB } = PoolUtil.getTokenAmountsFromLiquidity(
        param.liquidityAmount,
        whirlpoolData.sqrtPrice,
        PriceMath.tickIndexToSqrtPriceX64(param.tickLowerIndex),
        PriceMath.tickIndexToSqrtPriceX64(param.tickUpperIndex),
        true,
      );

      const tokenProgramId =
        (param.isTokenExtensionsBasedPosition ?? false)
          ? TOKEN_2022_PROGRAM_ID
          : TOKEN_PROGRAM_ID;

      const { tx } = await whirlpool.openPosition(
        param.tickLowerIndex,
        param.tickUpperIndex,
        {
          liquidityAmount: param.liquidityAmount,
          tokenMaxA: tokenA,
          tokenMaxB: tokenB,
        },
        undefined,
        undefined,
        undefined,
        tokenProgramId,
      );
      await tx.buildAndExecute();
    }),
  );
}

export async function fundPositions(
  ctx: WhirlpoolContext,
  poolInitInfo: InitPoolParams,
  tokenAccountA: PublicKey,
  tokenAccountB: PublicKey,
  fundParams: FundedPositionParams[],
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
        param.tickUpperIndex,
        undefined,
        undefined,
        param.isTokenExtensionsBasedPosition ?? false,
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
        await toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityIx(ctx.program, {
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
          }),
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
    }),
  );
}

export async function initTestPoolWithLiquidity(
  ctx: WhirlpoolContext,
  initSqrtPrice = DEFAULT_SQRT_PRICE,
  mintAmount = new anchor.BN("15000000000"),
  reuseTokenA?: PublicKey,
) {
  const {
    poolInitInfo,
    configInitInfo,
    configKeypairs,
    feeTierParams,
    whirlpoolPda,
    tokenAccountA,
    tokenAccountB,
  } = await initTestPoolWithTokens(
    ctx,
    TickSpacing.Standard,
    initSqrtPrice,
    mintAmount,
    reuseTokenA,
  );

  const tickArrays = await initTickArrayRange(
    ctx,
    whirlpoolPda.publicKey,
    22528, // to 33792
    3,
    TickSpacing.Standard,
    false,
  );

  const fundParams: FundedPositionParams[] = [
    {
      liquidityAmount: new anchor.BN(100_000),
      tickLowerIndex: 27904,
      tickUpperIndex: 33408,
    },
  ];

  const positionInfos = await fundPositions(
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

export async function initializePositionBundleWithMetadata(
  ctx: WhirlpoolContext,
  owner: PublicKey = ctx.provider.wallet.publicKey,
  funder?: Keypair,
) {
  const positionBundleMintKeypair = Keypair.generate();
  const positionBundlePda = PDAUtil.getPositionBundle(
    ctx.program.programId,
    positionBundleMintKeypair.publicKey,
  );
  const positionBundleMetadataPda = PDAUtil.getPositionBundleMetadata(
    positionBundleMintKeypair.publicKey,
  );
  const positionBundleTokenAccount = getAssociatedTokenAddressSync(
    positionBundleMintKeypair.publicKey,
    owner,
  );

  const tx = toTx(
    ctx,
    WhirlpoolIx.initializePositionBundleWithMetadataIx(ctx.program, {
      positionBundleMintKeypair,
      positionBundlePda,
      positionBundleMetadataPda,
      owner,
      positionBundleTokenAccount,
      funder: !!funder ? funder.publicKey : owner,
    }),
  );
  if (funder) {
    tx.addSigner(funder);
  }

  const txId = await tx.buildAndExecute();

  return {
    txId,
    positionBundleMintKeypair,
    positionBundlePda,
    positionBundleMetadataPda,
    positionBundleTokenAccount,
  };
}

export async function initializePositionBundle(
  ctx: WhirlpoolContext,
  owner: PublicKey = ctx.provider.wallet.publicKey,
  funder?: Keypair,
) {
  const positionBundleMintKeypair = Keypair.generate();
  const positionBundlePda = PDAUtil.getPositionBundle(
    ctx.program.programId,
    positionBundleMintKeypair.publicKey,
  );
  const positionBundleTokenAccount = getAssociatedTokenAddressSync(
    positionBundleMintKeypair.publicKey,
    owner,
  );

  const tx = toTx(
    ctx,
    WhirlpoolIx.initializePositionBundleIx(ctx.program, {
      positionBundleMintKeypair,
      positionBundlePda,
      owner,
      positionBundleTokenAccount,
      funder: !!funder ? funder.publicKey : owner,
    }),
  );
  if (funder) {
    tx.addSigner(funder);
  }

  const txId = await tx.buildAndExecute();

  return {
    txId,
    positionBundleMintKeypair,
    positionBundlePda,
    positionBundleTokenAccount,
  };
}

export async function openBundledPosition(
  ctx: WhirlpoolContext,
  whirlpool: PublicKey,
  positionBundleMint: PublicKey,
  bundleIndex: number,
  tickLowerIndex: number,
  tickUpperIndex: number,
  owner: PublicKey = ctx.provider.wallet.publicKey,
  funder?: Keypair,
) {
  const { params } = await generateDefaultOpenBundledPositionParams(
    ctx,
    whirlpool,
    positionBundleMint,
    bundleIndex,
    tickLowerIndex,
    tickUpperIndex,
    owner,
    funder?.publicKey || owner,
  );

  const tx = toTx(ctx, WhirlpoolIx.openBundledPositionIx(ctx.program, params));
  if (funder) {
    tx.addSigner(funder);
  }
  const txId = await tx.buildAndExecute();
  return { txId, params };
}
