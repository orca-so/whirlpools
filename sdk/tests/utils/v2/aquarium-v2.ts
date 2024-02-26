import * as anchor from "@coral-xyz/anchor";
import { AddressUtil, MathUtil, PDA } from "@orca-so/common-sdk";
import { Keypair, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import {
  TickSpacing,
} from "..";
import {
  InitFeeTierParams,
  InitPoolV2Params,
  PDAUtil,
  WhirlpoolContext,
  WhirlpoolIx,
  toTx
} from "../../../src";
import { PoolUtil } from "../../../src/utils/public/pool-utils";
import {
  TestConfigParams,
  generateDefaultConfigParams,
} from "../test-builders";
import { FundedPositionV2Params, TokenTrait, fundPositionsV2 } from "./init-utils-v2";
import { initFeeTier, initTickArrayRange } from "../init-utils";
import { createAndMintToAssociatedTokenAccountV2, createMintV2 } from "./token-2022";
import invariant from "tiny-invariant";

interface InitTestFeeTierV2Params {
  tickSpacing: number;
  feeRate?: number;
}

interface InitTestPoolV2Params {
  mintIndices: [number, number];
  tickSpacing: number;
  feeTierIndex?: number;
  initSqrtPrice?: anchor.BN;
}

interface InitTestMintV2Params {
  tokenTrait: TokenTrait;
}

interface InitTestTokenAccV2Params {
  mintIndex: number;
  mintAmount?: anchor.BN;
}

interface InitTestTickArrayRangeV2Params {
  poolIndex: number;
  startTickIndex: number;
  arrayCount: number;
  aToB: boolean;
}

interface InitTestPositionV2Params {
  poolIndex: number;
  fundParams: FundedPositionV2Params[];
}

export interface InitAquariumV2Params {
  // Single-ton per aquarium
  configParams?: TestConfigParams;

  initFeeTierParams: InitTestFeeTierV2Params[];

  initMintParams: InitTestMintV2Params[];

  initTokenAccParams: InitTestTokenAccV2Params[];

  initPoolParams: InitTestPoolV2Params[];

  initTickArrayRangeParams: InitTestTickArrayRangeV2Params[];

  initPositionParams: InitTestPositionV2Params[];
}

export interface TestAquarium {
  configParams: TestConfigParams;
  feeTierParams: InitFeeTierParams[];
  mintKeys: PublicKey[];
  tokenAccounts: { mint: PublicKey; account: PublicKey, tokenTrait: TokenTrait }[];
  pools: InitPoolV2Params[];
  tickArrays: { params: InitTestTickArrayRangeV2Params; pdas: PDA[] }[];
}

const DEFAULT_FEE_RATE = 3000;
const DEFAULT_MINT_AMOUNT = new anchor.BN("15000000000");
const DEFAULT_SQRT_PRICE = MathUtil.toX64(new Decimal(5));

const DEFAULT_INIT_FEE_TIER = [{ tickSpacing: TickSpacing.Standard }];
const DEFAULT_INIT_MINT: InitTestMintV2Params[] = [{ tokenTrait: {isToken2022: true} }, { tokenTrait: {isToken2022: true} }];
const DEFAULT_INIT_TOKEN = [{ mintIndex: 0 }, { mintIndex: 1 }];
const DEFAULT_INIT_POOL: InitTestPoolV2Params[] = [
  { mintIndices: [0, 1], tickSpacing: TickSpacing.Standard },
];
const DEFAULT_INIT_TICK_ARR: InitTestTickArrayRangeV2Params[] = [];
const DEFAULT_INIT_POSITION: InitTestPositionV2Params[] = [];

export function getDefaultAquariumV2(): InitAquariumV2Params {
  return {
    initFeeTierParams: [...DEFAULT_INIT_FEE_TIER],
    initMintParams: [...DEFAULT_INIT_MINT],
    initTokenAccParams: [...DEFAULT_INIT_TOKEN],
    initPoolParams: [...DEFAULT_INIT_POOL],
    initTickArrayRangeParams: [...DEFAULT_INIT_TICK_ARR],
    initPositionParams: [...DEFAULT_INIT_POSITION],
  };
}

export async function buildTestAquariumsV2(
  ctx: WhirlpoolContext,
  initParams: InitAquariumV2Params[]
): Promise<TestAquarium[]> {
  const aquariums = [];
  // Airdrop SOL into provider wallet;
  await ctx.connection.requestAirdrop(ctx.provider.wallet.publicKey, 100_000_000_000_000);
  for (const initParam of initParams) {
    // Create configs
    let configParams = initParam.configParams;
    if (!configParams) {
      configParams = generateDefaultConfigParams(ctx);
    }
    // Could batch
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, configParams.configInitInfo)
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
        initFeeTierParam.feeRate !== undefined ? initFeeTierParam.feeRate : DEFAULT_FEE_RATE;
      const { params } = await initFeeTier(
        ctx,
        configParams.configInitInfo,
        configParams.configKeypairs.feeAuthorityKeypair,
        tickSpacing,
        feeRate
      );
      feeTierParams.push(params);
    }

    // TODO: handle nativeMint
    initMintParams.forEach((initMintParam) => {
      invariant(!initMintParam.tokenTrait.isNativeMint, "Native mint not supported");
    });

    const mintKeypairs = initMintParams
      .map(() => Keypair.generate())
      .sort((a, b) => PoolUtil.compareMints(a.publicKey, b.publicKey));
    const mintKeys = (
      await Promise.all(
        initMintParams.map(({ tokenTrait }, i) => createMintV2(ctx.provider, tokenTrait, undefined, mintKeypairs[i]))
      )
    );

    const tokenAccounts = await Promise.all(
      initTokenAccParams.map(async (initTokenAccParam) => {
        const { mintIndex, mintAmount = DEFAULT_MINT_AMOUNT } = initTokenAccParam;
        const mintKey = mintKeys[mintIndex];
        const tokenTrait = initMintParams[mintIndex].tokenTrait;
        const account = await createAndMintToAssociatedTokenAccountV2(
          ctx.provider,
          tokenTrait,
          mintKey,
          mintAmount
        );
        return { mint: mintKey, account, tokenTrait };
      })
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
        const [tokenMintA, tokenMintB] = PoolUtil.orderMints(mintOne, mintTwo).map(
          AddressUtil.toPubKey
        );

        const isInverted = mintOne.equals(tokenMintB);
        invariant(!isInverted, "should not be inverted");

        const configKey = configParams!.configInitInfo.whirlpoolsConfigKeypair.publicKey;
        const whirlpoolPda = PDAUtil.getWhirlpool(
          ctx.program.programId,
          configKey,
          tokenMintA,
          tokenMintB,
          tickSpacing
        );

        const tokenProgramA = (await ctx.connection.getAccountInfo(tokenMintA))!.owner;
        const tokenProgramB = (await ctx.connection.getAccountInfo(tokenMintB))!.owner;

        const poolParam: InitPoolV2Params = {
          initSqrtPrice,
          whirlpoolsConfig: configKey,
          tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
          whirlpoolPda,
          tokenVaultAKeypair: Keypair.generate(),
          tokenVaultBKeypair: Keypair.generate(),
          feeTierKey: feeTierParams[feeTierIndex].feeTierPda.publicKey,
          tickSpacing,
          // TODO: funder
          funder: ctx.wallet.publicKey,
        };

        const tx = toTx(ctx, WhirlpoolIx.initializePoolV2Ix(ctx.program, poolParam));
        await tx.buildAndExecute();
        return poolParam;
      })
    );

    const tickArrays = await Promise.all(
      initTickArrayRangeParams.map(async (initTickArrayRangeParam) => {
        const { poolIndex, startTickIndex, arrayCount, aToB } = initTickArrayRangeParam;
        const pool = pools[poolIndex];
        const pdas = await initTickArrayRange(
          ctx,
          pool.whirlpoolPda.publicKey,
          startTickIndex,
          arrayCount,
          pool.tickSpacing,
          aToB
        );
        return {
          params: initTickArrayRangeParam,
          pdas,
        };
      })
    );

    await Promise.all(
      initPositionParams.map(async (initPositionParam) => {
        const { poolIndex, fundParams } = initPositionParam;
        const pool = pools[poolIndex];
        const tokenAccKeys = getTokenAccsForPoolsV2([pool], tokenAccounts);
        await fundPositionsV2(ctx, pool, tokenAccKeys[0], tokenAccKeys[1], fundParams);
      })
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

export function getTokenAccsForPoolsV2(
  pools: InitPoolV2Params[],
  tokenAccounts: { mint: PublicKey; account: PublicKey, tokenTrait: TokenTrait }[]
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
