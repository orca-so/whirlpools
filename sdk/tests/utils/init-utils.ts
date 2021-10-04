import * as anchor from "@project-serum/anchor";
import {
  InitTickArrayParams,
  OpenPositionParams,
  InitPoolParams,
  InitializeRewardParams,
  TICK_ARRAY_SIZE,
  tickIndexToSqrtPriceX64,
  getTokenAmountsFromLiquidity,
  toX64_BN,
  getTickArrayPda,
  getStartTickIndex,
  InitConfigParams,
} from "../../src";
import { WhirlpoolClient } from "../../src/client";
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
import { PDA } from "../../src/types/public/helper-types";

const defaultInitSqrtPrice = toX64_BN(new u64(5));

/**
 * Initialize a brand new WhirlpoolConfig account and construct a set of InitPoolParams
 * that can be used to initialize a pool with.
 * @param client - an instance of whirlpool client containing the program & provider
 * @param initSqrtPrice - the initial sqrt-price for this newly generated pool
 * @returns An object containing the params used to init the config account & the param that can be used to init the pool account.
 */
export async function buildTestPoolParams(
  client: WhirlpoolClient,
  tickSpacing: number,
  defaultFeeRate = 3000,
  initSqrtPrice = defaultInitSqrtPrice,
  funder?: PublicKey
) {
  const { configInitInfo, configKeypairs } = generateDefaultConfigParams(client.context);
  await client.initConfigTx(configInitInfo).buildAndExecute();

  const { params: feeTierParams } = await initFeeTier(
    client,
    configInitInfo,
    configKeypairs.feeAuthorityKeypair,
    tickSpacing,
    defaultFeeRate
  );
  const poolInitInfo = await generateDefaultInitPoolParams(
    client.context,
    configInitInfo.whirlpoolConfigKeypair.publicKey,
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
 * Initialize a brand new set of WhirlpoolConfig & Whirlpool account
 * @param client - an instance of whirlpool client containing the program & provider
 * @param initSqrtPrice - the initial sqrt-price for this newly generated pool
 * @returns An object containing the params used to initialize both accounts.
 */
export async function initTestPool(
  client: WhirlpoolClient,
  tickSpacing: number,
  initSqrtPrice = defaultInitSqrtPrice,
  funder?: Keypair
) {
  const { configInitInfo, poolInitInfo, configKeypairs, feeTierParams } = await buildTestPoolParams(
    client,
    tickSpacing,
    3000,
    initSqrtPrice,
    funder?.publicKey
  );

  const tx = client.initPoolTx(poolInitInfo);
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
  client: WhirlpoolClient,
  configInitInfo: InitConfigParams,
  feeAuthorityKeypair: Keypair,
  tickSpacing: number,
  defaultFeeRate: number,
  funder?: Keypair
) {
  const params = generateDefaultInitFeeTierParams(
    client.context,
    configInitInfo.whirlpoolConfigKeypair.publicKey,
    configInitInfo.feeAuthority,
    tickSpacing,
    defaultFeeRate,
    funder?.publicKey
  );

  const tx = client.initFeeTierTx(params).addSigner(feeAuthorityKeypair);
  if (funder) {
    tx.addSigner(funder);
  }

  return {
    txId: await tx.buildAndExecute(),
    params,
  };
}

export async function initializeReward(
  client: WhirlpoolClient,
  rewardAuthorityKeypair: anchor.web3.Keypair,
  whirlpool: PublicKey,
  rewardIndex: number,
  funder?: Keypair
): Promise<{ txId: string; params: InitializeRewardParams }> {
  const provider = client.context.provider;
  const rewardMint = await createMint(provider);
  const rewardVaultKeypair = anchor.web3.Keypair.generate();

  const params = {
    rewardAuthority: rewardAuthorityKeypair.publicKey,
    funder: funder?.publicKey || client.context.wallet.publicKey,
    whirlpool,
    rewardMint,
    rewardVaultKeypair,
    rewardIndex,
  };

  const tx = client.initializeRewardTx(params).addSigner(rewardAuthorityKeypair);
  if (funder) {
    tx.addSigner(funder);
  }

  return {
    txId: await tx.buildAndExecute(),
    params,
  };
}

export async function initRewardAndSetEmissions(
  client: WhirlpoolClient,
  rewardAuthorityKeypair: anchor.web3.Keypair,
  whirlpool: PublicKey,
  rewardIndex: number,
  vaultAmount: u64 | number,
  emissionsPerSecondX64: anchor.BN,
  funder?: Keypair
) {
  const {
    params: { rewardMint, rewardVaultKeypair },
  } = await initializeReward(client, rewardAuthorityKeypair, whirlpool, rewardIndex, funder);
  await mintToByAuthority(
    client.context.provider,
    rewardMint,
    rewardVaultKeypair.publicKey,
    vaultAmount
  );
  await client
    .setRewardEmissionsTx({
      rewardAuthority: rewardAuthorityKeypair.publicKey,
      whirlpool,
      rewardIndex,
      rewardVault: rewardVaultKeypair.publicKey,
      emissionsPerSecondX64,
    })
    .addSigner(rewardAuthorityKeypair)
    .buildAndExecute();
  return { rewardMint, rewardVaultKeypair };
}

export async function openPosition(
  client: WhirlpoolClient,
  whirlpool: PublicKey,
  tickLowerIndex: number,
  tickUpperIndex: number,
  owner: PublicKey = client.context.provider.wallet.publicKey,
  funder?: Keypair
) {
  return openPositionWithOptMetadata(
    client,
    whirlpool,
    tickLowerIndex,
    tickUpperIndex,
    false,
    owner,
    funder
  );
}

export async function openPositionWithMetadata(
  client: WhirlpoolClient,
  whirlpool: PublicKey,
  tickLowerIndex: number,
  tickUpperIndex: number,
  owner: PublicKey = client.context.provider.wallet.publicKey,
  funder?: Keypair
) {
  return openPositionWithOptMetadata(
    client,
    whirlpool,
    tickLowerIndex,
    tickUpperIndex,
    true,
    owner,
    funder
  );
}

async function openPositionWithOptMetadata(
  client: WhirlpoolClient,
  whirlpool: PublicKey,
  tickLowerIndex: number,
  tickUpperIndex: number,
  withMetadata: boolean = false,
  owner: PublicKey = client.context.provider.wallet.publicKey,
  funder?: Keypair
) {
  const { params, mint } = await generateDefaultOpenPositionParams(
    client.context,
    whirlpool,
    tickLowerIndex,
    tickUpperIndex,
    owner,
    funder?.publicKey || client.context.provider.wallet.publicKey
  );
  let tx = withMetadata ? client.openPositionWithMetadataTx(params) : client.openPositionTx(params);
  tx.addSigner(mint);
  if (funder) {
    tx.addSigner(funder);
  }
  const txId = await tx.buildAndExecute();
  return { txId, params, mint };
}

export async function initTickArray(
  client: WhirlpoolClient,
  whirlpool: PublicKey,
  startTickIndex: number,
  funder?: Keypair
): Promise<{ txId: string; params: InitTickArrayParams }> {
  const params = generateDefaultInitTickArrayParams(
    client.context,
    whirlpool,
    startTickIndex,
    funder?.publicKey
  );
  const tx = client.initTickArrayTx(params);
  if (funder) {
    tx.addSigner(funder);
  }
  return { txId: await tx.buildAndExecute(), params };
}

export async function initTestPoolWithTokens(
  client: WhirlpoolClient,
  tickSpacing: number,
  initSqrtPrice = defaultInitSqrtPrice
) {
  const provider = client.context.provider;

  const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
    client,
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
  client: WhirlpoolClient,
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
      client,
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
  client: WhirlpoolClient,
  positionInfos: FundedPositionInfo[],
  tokenOwnerAccountA: PublicKey,
  tokenOwnerAccountB: PublicKey
) {
  await Promise.all(
    positionInfos.map(async (info) => {
      const pool = await client.getPool(info.initParams.whirlpoolKey);
      const position = await client.getPosition(info.initParams.positionPda.publicKey);

      const priceLower = tickIndexToSqrtPriceX64(position.tickLowerIndex);
      const priceUpper = tickIndexToSqrtPriceX64(position.tickUpperIndex);

      const { tokenA, tokenB } = getTokenAmountsFromLiquidity(
        position.liquidity,
        pool.sqrtPrice,
        priceLower,
        priceUpper,
        false
      );

      const numTicksInTickArray = pool.tickSpacing * TICK_ARRAY_SIZE;
      const lowerStartTick =
        position.tickLowerIndex - (position.tickLowerIndex % numTicksInTickArray);
      const tickArrayLower = getTickArrayPda(
        client.context.program.programId,
        info.initParams.whirlpoolKey,
        lowerStartTick
      );
      const upperStartTick =
        position.tickUpperIndex - (position.tickUpperIndex % numTicksInTickArray);
      const tickArrayUpper = getTickArrayPda(
        client.context.program.programId,
        info.initParams.whirlpoolKey,
        upperStartTick
      );

      await client
        .decreaseLiquidityTx({
          liquidityAmount: position.liquidity,
          tokenMinA: tokenA,
          tokenMinB: tokenB,
          whirlpool: info.initParams.whirlpoolKey,
          positionAuthority: client.context.provider.wallet.publicKey,
          position: info.initParams.positionPda.publicKey,
          positionTokenAccount: info.initParams.positionTokenAccountAddress,
          tokenOwnerAccountA,
          tokenOwnerAccountB,
          tokenVaultA: pool.tokenVaultA,
          tokenVaultB: pool.tokenVaultB,
          tickArrayLower: tickArrayLower.publicKey,
          tickArrayUpper: tickArrayUpper.publicKey,
        })
        .buildAndExecute();

      await client
        .collectFeesTx({
          whirlpool: info.initParams.whirlpoolKey,
          positionAuthority: client.context.provider.wallet.publicKey,
          position: info.initParams.positionPda.publicKey,
          positionTokenAccount: info.initParams.positionTokenAccountAddress,
          tokenOwnerAccountA,
          tokenOwnerAccountB,
          tokenVaultA: pool.tokenVaultA,
          tokenVaultB: pool.tokenVaultB,
        })
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
  client: WhirlpoolClient,
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
        client,
        whirlpool,
        param.tickLowerIndex,
        param.tickUpperIndex
      );

      const tickArrayLower = getTickArrayPda(
        client.context.program.programId,
        whirlpool,
        getStartTickIndex(param.tickLowerIndex, tickSpacing)
      ).publicKey;

      const tickArrayUpper = getTickArrayPda(
        client.context.program.programId,
        whirlpool,
        getStartTickIndex(param.tickUpperIndex, tickSpacing)
      ).publicKey;

      if (param.liquidityAmount.gt(ZERO_BN)) {
        const { tokenA, tokenB } = getTokenAmountsFromLiquidity(
          param.liquidityAmount,
          initSqrtPrice,
          tickIndexToSqrtPriceX64(param.tickLowerIndex),
          tickIndexToSqrtPriceX64(param.tickUpperIndex),
          true
        );
        await client
          .increaseLiquidityTx({
            liquidityAmount: param.liquidityAmount,
            tokenMaxA: tokenA,
            tokenMaxB: tokenB,
            whirlpool: whirlpool,
            positionAuthority: client.context.provider.wallet.publicKey,
            position: positionInfo.positionPda.publicKey,
            positionTokenAccount: positionInfo.positionTokenAccountAddress,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: tokenVaultAKeypair.publicKey,
            tokenVaultB: tokenVaultBKeypair.publicKey,
            tickArrayLower,
            tickArrayUpper,
          })
          .buildAndExecute();
      }
      return {
        initParams: positionInfo,
        publicKey: positionInfo.positionPda.publicKey,
        tokenAccount: positionInfo.positionTokenAccountAddress,
        mintKeypair: mint,
        tickArrayLower,
        tickArrayUpper,
      };
    })
  );
}

export async function initTestPoolWithLiquidity(client: WhirlpoolClient) {
  const {
    poolInitInfo,
    configInitInfo,
    configKeypairs,
    whirlpoolPda,
    tokenAccountA,
    tokenAccountB,
  } = await initTestPoolWithTokens(client, TickSpacing.Standard);

  const tickArrays = await initTickArrayRange(
    client,
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
    client,
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
