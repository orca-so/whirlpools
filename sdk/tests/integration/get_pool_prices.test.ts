import * as anchor from "@project-serum/anchor";
import {
  calculatePoolPrices,
  fetchDecimalsForMints,
  fetchPoolsForMints,
  fetchTickArraysForPools,
  PriceMath,
  WhirlpoolContext,
} from "../../src";
import { TickSpacing } from "../utils";
import {
  buildTestAquariums,
  FundedPositionParams,
  getDefaultAquarium,
  initTestPoolWithLiquidity,
} from "../utils/init-utils";
import * as assert from "assert";
import { u64 } from "@solana/spl-token";
import Decimal from "decimal.js";
import { MathUtil } from "@orca-so/common-sdk";

describe.only("get_pool_prices", () => {
  const provider = anchor.AnchorProvider.env();
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);

  it("successfully calculates the price for one token with a single pool", async () => {
    // Initialize pool
    const { poolInitInfo, configInitInfo } = await initTestPoolWithLiquidity(context);

    const config = {
      quoteTokens: [poolInitInfo.tokenMintB.toBase58()],
      tickSpacings: [TickSpacing.Standard],
      programId: program.programId,
      whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
    };

    const thresholdConfig = {
      amountThreshold: new u64(100),
      priceImpactThreshold: 1.05,
    };

    const mints = [poolInitInfo.tokenMintA, poolInitInfo.tokenMintB];

    // fetch PoolMap
    const poolMap = await fetchPoolsForMints(context, mints, config);

    // fetch TickArrayMap
    const tickArrayMap = await fetchTickArraysForPools(context, poolMap);

    const decimalsMap = await fetchDecimalsForMints(context, mints);

    assert.equal(Object.keys(poolMap).length, 1);
    assert.equal(Object.keys(tickArrayMap).length, 3);

    const priceMap = calculatePoolPrices(
      mints,
      poolMap,
      tickArrayMap,
      decimalsMap,
      config,
      thresholdConfig
    );

    assert.equal(Object.keys(priceMap).length, 2);
  });

  it("successfully calculates the price for two tokens against a third quote token", async () => {
    const aqConfig = getDefaultAquarium();
    // Add a third token and account and a second pool
    aqConfig.initMintParams.push({});
    aqConfig.initTokenAccParams.push({ mintIndex: 2 });
    aqConfig.initPoolParams.push({ mintIndices: [1, 2], tickSpacing: TickSpacing.Standard });

    // Add tick arrays and positions
    const aToB = false;
    aqConfig.initTickArrayRangeParams.push({
      poolIndex: 0,
      startTickIndex: 22528,
      arrayCount: 3,
      aToB,
    });
    aqConfig.initTickArrayRangeParams.push({
      poolIndex: 1,
      startTickIndex: 22528,
      arrayCount: 3,
      aToB,
    });
    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];
    aqConfig.initPositionParams.push({ poolIndex: 0, fundParams });
    aqConfig.initPositionParams.push({ poolIndex: 1, fundParams });

    const aquarium = (await buildTestAquariums(context, [aqConfig]))[0];
    const { mintKeys, configParams } = aquarium;

    const config = {
      quoteTokens: [mintKeys[1].toBase58()],
      tickSpacings: [TickSpacing.Standard],
      programId: program.programId,
      whirlpoolsConfig: configParams.configInitInfo.whirlpoolsConfigKeypair.publicKey,
    };

    const thresholdConfig = {
      amountThreshold: new u64(100),
      priceImpactThreshold: 1.05,
    };

    const mints = [mintKeys[0], mintKeys[1], mintKeys[2]];

    // fetch PoolMap
    const poolMap = await fetchPoolsForMints(context, mints, config);

    // fetch TickArrayMap
    const tickArrayMap = await fetchTickArraysForPools(context, poolMap);

    const decimalsMap = await fetchDecimalsForMints(context, mints);

    assert.equal(Object.keys(poolMap).length, 2);
    assert.equal(Object.keys(tickArrayMap).length, 6);

    const priceMap = calculatePoolPrices(
      mints,
      poolMap,
      tickArrayMap,
      decimalsMap,
      config,
      thresholdConfig
    );

    assert.equal(Object.keys(priceMap).length, 3);
  });

  it("successfully calculates the price for one token with multiple pools against a quote token", async () => {
    const aqConfig = getDefaultAquarium();
    // Add a third token and account and a second pool
    aqConfig.initPoolParams.push({
      mintIndices: [0, 1],
      tickSpacing: TickSpacing.SixtyFour,
      initSqrtPrice: MathUtil.toX64(new Decimal(5.2)),
    });

    // Add tick arrays and positions
    const aToB = false;

    // TODO: Adjust tick indices for 64 tick spacing
    aqConfig.initTickArrayRangeParams.push({
      poolIndex: 0,
      startTickIndex: 22528,
      arrayCount: 3,
      aToB,
    });
    aqConfig.initTickArrayRangeParams.push({
      poolIndex: 1,
      startTickIndex: 22528,
      arrayCount: 3,
      aToB,
    });
    const fundParams0: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];
    const fundParams1: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(50_000_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];
    aqConfig.initPositionParams.push({ poolIndex: 0, fundParams: fundParams0 });
    aqConfig.initPositionParams.push({ poolIndex: 1, fundParams: fundParams1 });

    const aquarium = (await buildTestAquariums(context, [aqConfig]))[0];
    const { mintKeys, configParams } = aquarium;

    const config = {
      quoteTokens: [mintKeys[1].toBase58()],
      tickSpacings: [TickSpacing.Standard, TickSpacing.SixtyFour],
      programId: program.programId,
      whirlpoolsConfig: configParams.configInitInfo.whirlpoolsConfigKeypair.publicKey,
    };

    const thresholdConfig = {
      amountThreshold: new u64(100),
      priceImpactThreshold: 1.05,
    };

    const mints = [mintKeys[0], mintKeys[1]];

    // fetch PoolMap
    const poolMap = await fetchPoolsForMints(context, mints, config);

    // fetch TickArrayMap
    const tickArrayMap = await fetchTickArraysForPools(context, poolMap);

    const decimalsMap = await fetchDecimalsForMints(context, mints);

    assert.equal(Object.keys(poolMap).length, 2);

    const priceMap = calculatePoolPrices(
      mints,
      poolMap,
      tickArrayMap,
      decimalsMap,
      config,
      thresholdConfig
    );

    assert.equal(Object.keys(priceMap).length, 2);
  });

  it(
    "successfully calculates the price for one token which requires an indirect pool to calculate price"
  );

  it(
    "successfully calculates the price for two tokens which each require a different indirect pool to calculate price"
  );

  it("fails if missing mint accounts");

  it("does not return a price if insufficient liquidity");

  it("does not return a price if no pools");

  it("does not return a price if missing tick arrays, but provide warning?");
});
