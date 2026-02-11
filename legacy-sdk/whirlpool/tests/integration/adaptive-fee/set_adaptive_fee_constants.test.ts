import * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import * as assert from "assert";
import { Percentage } from "@orca-so/common-sdk";
import type { AdaptiveFeeConstantsData, WhirlpoolContext } from "../../../src";
import {
  IGNORE_CACHE,
  PDAUtil,
  PriceMath,
  TickUtil,
  buildWhirlpoolClient,
  increaseLiquidityQuoteByLiquidityWithParams,
  swapQuoteByInputToken,
  toTx,
  WhirlpoolIx,
} from "../../../src";
import { NO_TOKEN_EXTENSION_CONTEXT } from "../../../src/utils/public/token-extension-util";
import {
  initAdaptiveFeeTier,
  initializeConfigWithDefaultConfigParams,
} from "../../utils/init-utils";
import { createAndMintToAssociatedTokenAccount } from "../../utils";
import { initializeLiteSVMEnvironment } from "../../utils/litesvm";
import {
  createInOrderMints,
  getDefaultPresetAdaptiveFeeConstants,
} from "../../utils/test-builders";
import BN from "bn.js";

describe("set_adaptive_fee_constants", () => {
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  const tickSpacing = 64;
  const feeTierIndex = 1024 + tickSpacing;
  const priceDeviation = Percentage.fromFraction(1, 10_000);

  it("sets specific constants", async () => {
    const initialPresetAdaptiveFeeConstants: AdaptiveFeeConstantsData = {
      filterPeriod: 30,
      decayPeriod: 600,
      reductionFactor: 500,
      adaptiveFeeControlFactor: 4_000,
      maxVolatilityAccumulator: 350_000,
      tickGroupSize: 64,
      majorSwapThresholdTicks: 32,
    };

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      5000,
      initialPresetAdaptiveFeeConstants,
      undefined, // initializePoolAuthority
      ctx.wallet.publicKey, // delegatedFeeAuthority
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    // Initialize pool
    const [tokenMintA, tokenMintB] = await createInOrderMints(ctx);
    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      tokenMintA,
      tokenMintB,
      feeTierIndex,
    );
    const tokenVaultAKeypair = anchor.web3.Keypair.generate();
    const tokenVaultBKeypair = anchor.web3.Keypair.generate();
    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTierKey: adaptiveFeeTierPda.publicKey,
        tokenMintA,
        tokenMintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
        tokenBadgeA: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintA,
        ).publicKey,
        tokenBadgeB: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintB,
        ).publicKey,
        whirlpoolPda,
        oraclePda,
        tokenVaultAKeypair,
        tokenVaultBKeypair,
        initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(192),
        initializePoolAuthority: ctx.wallet.publicKey,
        funder: ctx.wallet.publicKey,
      }),
    ).buildAndExecute();

    // Create token accounts first (needed for liquidity deposit)
    const tokenAccountA = await createAndMintToAssociatedTokenAccount(
      ctx.provider,
      tokenMintA,
      new BN(1_000_000_000),
    );
    const tokenAccountB = await createAndMintToAssociatedTokenAccount(
      ctx.provider,
      tokenMintB,
      new BN(1_000_000_000),
    );

    // Initialize tick arrays and add liquidity
    const client = buildWhirlpoolClient(ctx);
    const pool = await client.getPool(whirlpoolPda.publicKey, IGNORE_CACHE);
    await (await pool.initTickArrayForTicks(
      TickUtil.getFullRangeTickIndex(tickSpacing),
    ))!.buildAndExecute();

    const fullRange = TickUtil.getFullRangeTickIndex(tickSpacing);
    const liquidityAmount = new BN(1_000_000);
    const depositQuote = increaseLiquidityQuoteByLiquidityWithParams({
      liquidity: liquidityAmount,
      slippageTolerance: Percentage.fromFraction(0, 100),
      sqrtPrice: pool.getData().sqrtPrice,
      tickCurrentIndex: pool.getData().tickCurrentIndex,
      tickLowerIndex: fullRange[0],
      tickUpperIndex: fullRange[1],
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
    });
    const { lowerBound, upperBound } = PriceMath.getSlippageBoundForSqrtPrice(
      pool.getData().sqrtPrice,
      priceDeviation,
    );

    const { tx: openPositionTx } = await pool.openPosition(
      fullRange[0],
      fullRange[1],
      {
        ...depositQuote,
        minSqrtPrice: lowerBound[0],
        maxSqrtPrice: upperBound[0],
      },
    );
    await openPositionTx.buildAndExecute();

    // Perform a swap to update oracle variables
    const swapAmount = new BN(10_000);
    const swapQuote = await swapQuoteByInputToken(
      pool,
      tokenMintA,
      swapAmount,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
    );

    await toTx(
      ctx,
      WhirlpoolIx.swapV2Ix(ctx.program, {
        whirlpool: whirlpoolPda.publicKey,
        tokenMintA,
        tokenMintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: pool.getData().tokenVaultA,
        tokenVaultB: pool.getData().tokenVaultB,
        oracle: oraclePda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        amount: swapAmount,
        otherAmountThreshold: swapQuote.otherAmountThreshold,
        sqrtPriceLimit: swapQuote.sqrtPriceLimit,
        amountSpecifiedIsInput: true,
        aToB: true,
        tickArray0: swapQuote.tickArray0,
        tickArray1: swapQuote.tickArray1,
        tickArray2: swapQuote.tickArray2,
      }),
    ).buildAndExecute();

    // Verify oracle variables are non-default after swap
    const oracleAfterSwap = await fetcher.getOracle(
      oraclePda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(
      !oracleAfterSwap?.adaptiveFeeVariables.lastReferenceUpdateTimestamp.isZero(),
    );
    assert.ok(
      !oracleAfterSwap?.adaptiveFeeVariables.lastMajorSwapTimestamp.isZero(),
    );
    assert.notEqual(
      oracleAfterSwap?.adaptiveFeeVariables.tickGroupIndexReference,
      0,
    );
    assert.notEqual(
      oracleAfterSwap?.adaptiveFeeVariables.volatilityAccumulator,
      0,
    );

    // Update only filter_period and decay_period
    await toTx(
      ctx,
      WhirlpoolIx.setAdaptiveFeeConstantsIx(ctx.program, {
        whirlpool: whirlpoolPda.publicKey,
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        oracle: oraclePda.publicKey,
        feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
        filterPeriod: 60,
        decayPeriod: 1200,
      }),
    )
      .addSigner(configKeypairs.feeAuthorityKeypair)
      .buildAndExecute();

    // Verify only specified constants were updated
    const oracleAfterUpdate = await fetcher.getOracle(
      oraclePda.publicKey,
      IGNORE_CACHE,
    );
    assert.equal(oracleAfterUpdate?.adaptiveFeeConstants.filterPeriod, 60);
    assert.equal(oracleAfterUpdate?.adaptiveFeeConstants.decayPeriod, 1200);

    // Other constants should remain unchanged
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeConstants.reductionFactor,
      initialPresetAdaptiveFeeConstants.reductionFactor,
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeConstants.adaptiveFeeControlFactor,
      initialPresetAdaptiveFeeConstants.adaptiveFeeControlFactor,
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeConstants.maxVolatilityAccumulator,
      initialPresetAdaptiveFeeConstants.maxVolatilityAccumulator,
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeConstants.tickGroupSize,
      initialPresetAdaptiveFeeConstants.tickGroupSize,
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeConstants.majorSwapThresholdTicks,
      initialPresetAdaptiveFeeConstants.majorSwapThresholdTicks,
    );

    // Verify adaptive fee variables were reset to default values
    assert.ok(
      oracleAfterUpdate?.adaptiveFeeVariables.lastReferenceUpdateTimestamp.isZero(),
    );
    assert.ok(
      oracleAfterUpdate?.adaptiveFeeVariables.lastMajorSwapTimestamp.isZero(),
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeVariables.volatilityReference,
      0,
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeVariables.tickGroupIndexReference,
      0,
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeVariables.volatilityAccumulator,
      0,
    );
  });

  it("sets all constants", async () => {
    const initialPresetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      5000,
      initialPresetAdaptiveFeeConstants,
      undefined, // initializePoolAuthority
      ctx.wallet.publicKey, // delegatedFeeAuthority
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    // Initialize pool
    const [tokenMintA, tokenMintB] = await createInOrderMints(ctx);
    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      tokenMintA,
      tokenMintB,
      feeTierIndex,
    );
    const tokenVaultAKeypair = anchor.web3.Keypair.generate();
    const tokenVaultBKeypair = anchor.web3.Keypair.generate();
    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTierKey: adaptiveFeeTierPda.publicKey,
        tokenMintA,
        tokenMintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
        tokenBadgeA: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintA,
        ).publicKey,
        tokenBadgeB: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintB,
        ).publicKey,
        whirlpoolPda,
        oraclePda,
        tokenVaultAKeypair,
        tokenVaultBKeypair,
        initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(192),
        initializePoolAuthority: ctx.wallet.publicKey,
        funder: ctx.wallet.publicKey,
      }),
    ).buildAndExecute();

    // Create token accounts first (needed for liquidity deposit)
    const tokenAccountA = await createAndMintToAssociatedTokenAccount(
      ctx.provider,
      tokenMintA,
      new BN(1_000_000_000),
    );
    const tokenAccountB = await createAndMintToAssociatedTokenAccount(
      ctx.provider,
      tokenMintB,
      new BN(1_000_000_000),
    );

    // Initialize tick arrays and add liquidity
    const client = buildWhirlpoolClient(ctx);
    const pool = await client.getPool(whirlpoolPda.publicKey, IGNORE_CACHE);
    await (await pool.initTickArrayForTicks(
      TickUtil.getFullRangeTickIndex(tickSpacing),
    ))!.buildAndExecute();

    const fullRange = TickUtil.getFullRangeTickIndex(tickSpacing);
    const liquidityAmount = new BN(1_000_000);
    const depositQuote = increaseLiquidityQuoteByLiquidityWithParams({
      liquidity: liquidityAmount,
      slippageTolerance: Percentage.fromFraction(0, 100),
      sqrtPrice: pool.getData().sqrtPrice,
      tickCurrentIndex: pool.getData().tickCurrentIndex,
      tickLowerIndex: fullRange[0],
      tickUpperIndex: fullRange[1],
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
    });
    const { lowerBound, upperBound } = PriceMath.getSlippageBoundForSqrtPrice(
      pool.getData().sqrtPrice,
      priceDeviation,
    );

    const { tx: openPositionTx } = await pool.openPosition(
      fullRange[0],
      fullRange[1],
      {
        ...depositQuote,
        minSqrtPrice: lowerBound[0],
        maxSqrtPrice: upperBound[0],
      },
    );
    await openPositionTx.buildAndExecute();

    // Perform a swap to update oracle variables
    const swapAmount = new BN(10_000);
    const swapQuote = await swapQuoteByInputToken(
      pool,
      tokenMintA,
      swapAmount,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
    );

    await toTx(
      ctx,
      WhirlpoolIx.swapV2Ix(ctx.program, {
        whirlpool: whirlpoolPda.publicKey,
        tokenMintA,
        tokenMintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: pool.getData().tokenVaultA,
        tokenVaultB: pool.getData().tokenVaultB,
        oracle: oraclePda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        amount: swapAmount,
        otherAmountThreshold: swapQuote.otherAmountThreshold,
        sqrtPriceLimit: swapQuote.sqrtPriceLimit,
        amountSpecifiedIsInput: true,
        aToB: true,
        tickArray0: swapQuote.tickArray0,
        tickArray1: swapQuote.tickArray1,
        tickArray2: swapQuote.tickArray2,
      }),
    ).buildAndExecute();

    // Verify oracle variables are non-default after swap
    const oracleAfterSwap = await fetcher.getOracle(
      oraclePda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(
      !oracleAfterSwap?.adaptiveFeeVariables.lastReferenceUpdateTimestamp.isZero(),
    );
    assert.ok(
      !oracleAfterSwap?.adaptiveFeeVariables.lastMajorSwapTimestamp.isZero(),
    );
    assert.notEqual(
      oracleAfterSwap?.adaptiveFeeVariables.tickGroupIndexReference,
      0,
    );
    assert.notEqual(
      oracleAfterSwap?.adaptiveFeeVariables.volatilityAccumulator,
      0,
    );

    // Update all constants
    const newConstants = {
      filterPeriod: 60,
      decayPeriod: 1200,
      reductionFactor: 1000,
      adaptiveFeeControlFactor: 8_000,
      maxVolatilityAccumulator: 500_000,
      tickGroupSize: 32,
      majorSwapThresholdTicks: 16,
    };

    await toTx(
      ctx,
      WhirlpoolIx.setAdaptiveFeeConstantsIx(ctx.program, {
        whirlpool: whirlpoolPda.publicKey,
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        oracle: oraclePda.publicKey,
        feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
        ...newConstants,
      }),
    )
      .addSigner(configKeypairs.feeAuthorityKeypair)
      .buildAndExecute();

    // Verify all constants were updated
    const oracleAfterUpdate = await fetcher.getOracle(
      oraclePda.publicKey,
      IGNORE_CACHE,
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeConstants.filterPeriod,
      newConstants.filterPeriod,
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeConstants.decayPeriod,
      newConstants.decayPeriod,
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeConstants.reductionFactor,
      newConstants.reductionFactor,
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeConstants.adaptiveFeeControlFactor,
      newConstants.adaptiveFeeControlFactor,
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeConstants.maxVolatilityAccumulator,
      newConstants.maxVolatilityAccumulator,
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeConstants.tickGroupSize,
      newConstants.tickGroupSize,
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeConstants.majorSwapThresholdTicks,
      newConstants.majorSwapThresholdTicks,
    );

    // Verify adaptive fee variables were reset to default values
    assert.ok(
      oracleAfterUpdate?.adaptiveFeeVariables.lastReferenceUpdateTimestamp.isZero(),
    );
    assert.ok(
      oracleAfterUpdate?.adaptiveFeeVariables.lastMajorSwapTimestamp.isZero(),
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeVariables.volatilityReference,
      0,
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeVariables.tickGroupIndexReference,
      0,
    );
    assert.equal(
      oracleAfterUpdate?.adaptiveFeeVariables.volatilityAccumulator,
      0,
    );
  });

  it("fails when all constants are null", async () => {
    const initialPresetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      5000,
      initialPresetAdaptiveFeeConstants,
      undefined,
      ctx.wallet.publicKey,
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    // Initialize pool
    const [tokenMintA, tokenMintB] = await createInOrderMints(ctx);
    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      tokenMintA,
      tokenMintB,
      feeTierIndex,
    );
    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTierKey: adaptiveFeeTierPda.publicKey,
        tokenMintA,
        tokenMintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
        tokenBadgeA: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintA,
        ).publicKey,
        tokenBadgeB: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintB,
        ).publicKey,
        whirlpoolPda,
        oraclePda,
        tokenVaultAKeypair: anchor.web3.Keypair.generate(),
        tokenVaultBKeypair: anchor.web3.Keypair.generate(),
        initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
        initializePoolAuthority: ctx.wallet.publicKey,
        funder: ctx.wallet.publicKey,
      }),
    ).buildAndExecute();

    // Try to update with tick_group_size that doesn't divide evenly into tick_spacing
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setAdaptiveFeeConstantsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          oracle: oraclePda.publicKey,
          feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
        }),
      )
        .addSigner(configKeypairs.feeAuthorityKeypair)
        .buildAndExecute(),
      /0x17b4/, // AdaptiveFeeConstantsUnchanged
    );
  });

  it("fails when new constants match existing constants", async () => {
    const initialPresetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      5000,
      initialPresetAdaptiveFeeConstants,
      undefined,
      ctx.wallet.publicKey,
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    // Initialize pool
    const [tokenMintA, tokenMintB] = await createInOrderMints(ctx);
    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      tokenMintA,
      tokenMintB,
      feeTierIndex,
    );
    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTierKey: adaptiveFeeTierPda.publicKey,
        tokenMintA,
        tokenMintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
        tokenBadgeA: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintA,
        ).publicKey,
        tokenBadgeB: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintB,
        ).publicKey,
        whirlpoolPda,
        oraclePda,
        tokenVaultAKeypair: anchor.web3.Keypair.generate(),
        tokenVaultBKeypair: anchor.web3.Keypair.generate(),
        initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
        initializePoolAuthority: ctx.wallet.publicKey,
        funder: ctx.wallet.publicKey,
      }),
    ).buildAndExecute();

    // Try to update with tick_group_size that doesn't divide evenly into tick_spacing
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setAdaptiveFeeConstantsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          oracle: oraclePda.publicKey,
          feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
          ...initialPresetAdaptiveFeeConstants,
        }),
      )
        .addSigner(configKeypairs.feeAuthorityKeypair)
        .buildAndExecute(),
      /0x17b4/, // AdaptiveFeeConstantsUnchanged
    );
  });

  it("fails when constants would be invalid for tick_spacing", async () => {
    const initialPresetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      5000,
      initialPresetAdaptiveFeeConstants,
      undefined,
      ctx.wallet.publicKey,
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    // Initialize pool
    const [tokenMintA, tokenMintB] = await createInOrderMints(ctx);
    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      tokenMintA,
      tokenMintB,
      feeTierIndex,
    );
    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTierKey: adaptiveFeeTierPda.publicKey,
        tokenMintA,
        tokenMintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
        tokenBadgeA: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintA,
        ).publicKey,
        tokenBadgeB: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintB,
        ).publicKey,
        whirlpoolPda,
        oraclePda,
        tokenVaultAKeypair: anchor.web3.Keypair.generate(),
        tokenVaultBKeypair: anchor.web3.Keypair.generate(),
        initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
        initializePoolAuthority: ctx.wallet.publicKey,
        funder: ctx.wallet.publicKey,
      }),
    ).buildAndExecute();

    // Try to update with tick_group_size that doesn't divide evenly into tick_spacing
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setAdaptiveFeeConstantsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          oracle: oraclePda.publicKey,
          feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
          tickGroupSize: 63, // 64 % 63 != 0
        }),
      )
        .addSigner(configKeypairs.feeAuthorityKeypair)
        .buildAndExecute(),
      /0x17ad/, // InvalidAdaptiveFeeConstants
    );
  });

  it("fails when invalid fee authority provided", async () => {
    const initialPresetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      5000,
      initialPresetAdaptiveFeeConstants,
      undefined,
      ctx.wallet.publicKey,
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    // Initialize pool
    const [tokenMintA, tokenMintB] = await createInOrderMints(ctx);
    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      tokenMintA,
      tokenMintB,
      feeTierIndex,
    );
    const tokenVaultAKeypair = anchor.web3.Keypair.generate();
    const tokenVaultBKeypair = anchor.web3.Keypair.generate();
    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTierKey: adaptiveFeeTierPda.publicKey,
        tokenMintA,
        tokenMintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
        tokenBadgeA: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintA,
        ).publicKey,
        tokenBadgeB: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintB,
        ).publicKey,
        whirlpoolPda,
        oraclePda,
        tokenVaultAKeypair,
        tokenVaultBKeypair,
        initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
        initializePoolAuthority: ctx.wallet.publicKey,
        funder: ctx.wallet.publicKey,
      }),
    ).buildAndExecute();

    // Try to update with wrong fee authority
    const wrongAuthority = Keypair.generate();
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setAdaptiveFeeConstantsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          oracle: oraclePda.publicKey,
          feeAuthority: wrongAuthority.publicKey,
          filterPeriod: 60,
        }),
      )
        .addSigner(wrongAuthority)
        .buildAndExecute(),
      /0x7dc/, // ConstraintAddress
    );
  });

  it("fails when whirlpool has mismatched whirlpools_config", async () => {
    const initialPresetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    // Create first config and tier
    const { configInitInfo: configInitInfo1, configKeypairs: configKeypairs1 } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo1,
      configKeypairs1.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      5000,
      initialPresetAdaptiveFeeConstants,
      undefined,
      ctx.wallet.publicKey,
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    // Initialize pool with first config
    const [tokenMintA, tokenMintB] = await createInOrderMints(ctx);
    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      configInitInfo1.whirlpoolsConfigKeypair.publicKey,
      tokenMintA,
      tokenMintB,
      feeTierIndex,
    );
    const tokenVaultAKeypair = anchor.web3.Keypair.generate();
    const tokenVaultBKeypair = anchor.web3.Keypair.generate();
    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
        whirlpoolsConfig: configInitInfo1.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTierKey: adaptiveFeeTierPda.publicKey,
        tokenMintA,
        tokenMintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
        tokenBadgeA: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo1.whirlpoolsConfigKeypair.publicKey,
          tokenMintA,
        ).publicKey,
        tokenBadgeB: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo1.whirlpoolsConfigKeypair.publicKey,
          tokenMintB,
        ).publicKey,
        whirlpoolPda,
        oraclePda,
        tokenVaultAKeypair,
        tokenVaultBKeypair,
        initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
        initializePoolAuthority: ctx.wallet.publicKey,
        funder: ctx.wallet.publicKey,
      }),
    ).buildAndExecute();

    // Create second config
    const { configInitInfo: configInitInfo2 } =
      await initializeConfigWithDefaultConfigParams(ctx);

    // Try to update with wrong config
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setAdaptiveFeeConstantsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          whirlpoolsConfig: configInitInfo2.whirlpoolsConfigKeypair.publicKey,
          oracle: oraclePda.publicKey,
          feeAuthority: configKeypairs1.feeAuthorityKeypair.publicKey,
          filterPeriod: 60,
        }),
      )
        .addSigner(configKeypairs1.feeAuthorityKeypair)
        .buildAndExecute(),
      /0x7d1/, // ConstraintHasOne
    );
  });

  it("fails when oracle has mismatched whirlpool", async () => {
    const initialPresetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      5000,
      initialPresetAdaptiveFeeConstants,
      undefined,
      ctx.wallet.publicKey,
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    // Initialize two pools
    const [tokenMintA1, tokenMintB1] = await createInOrderMints(ctx);
    const whirlpoolPda1 = PDAUtil.getWhirlpool(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      tokenMintA1,
      tokenMintB1,
      feeTierIndex,
    );
    const oraclePda1 = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda1.publicKey,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTierKey: adaptiveFeeTierPda.publicKey,
        tokenMintA: tokenMintA1,
        tokenMintB: tokenMintB1,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
        tokenBadgeA: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintA1,
        ).publicKey,
        tokenBadgeB: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintB1,
        ).publicKey,
        whirlpoolPda: whirlpoolPda1,
        oraclePda: oraclePda1,
        tokenVaultAKeypair: anchor.web3.Keypair.generate(),
        tokenVaultBKeypair: anchor.web3.Keypair.generate(),
        initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
        initializePoolAuthority: ctx.wallet.publicKey,
        funder: ctx.wallet.publicKey,
      }),
    ).buildAndExecute();

    const [tokenMintA2, tokenMintB2] = await createInOrderMints(ctx);
    const whirlpoolPda2 = PDAUtil.getWhirlpool(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      tokenMintA2,
      tokenMintB2,
      feeTierIndex,
    );
    const oraclePda2 = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda2.publicKey,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTierKey: adaptiveFeeTierPda.publicKey,
        tokenMintA: tokenMintA2,
        tokenMintB: tokenMintB2,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
        tokenBadgeA: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintA2,
        ).publicKey,
        tokenBadgeB: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintB2,
        ).publicKey,
        whirlpoolPda: whirlpoolPda2,
        oraclePda: oraclePda2,
        tokenVaultAKeypair: anchor.web3.Keypair.generate(),
        tokenVaultBKeypair: anchor.web3.Keypair.generate(),
        initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
        initializePoolAuthority: ctx.wallet.publicKey,
        funder: ctx.wallet.publicKey,
      }),
    ).buildAndExecute();

    // Try to update pool1 with oracle2 (mismatched)
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setAdaptiveFeeConstantsIx(ctx.program, {
          whirlpool: whirlpoolPda1.publicKey,
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          oracle: oraclePda2.publicKey,
          feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
          filterPeriod: 60,
        }),
      )
        .addSigner(configKeypairs.feeAuthorityKeypair)
        .buildAndExecute(),
      /0x7d1/, // ConstraintHasOne
    );
  });

  it("fails when delegated_fee_authority tries to update constants", async () => {
    const initialPresetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

    // Create a separate delegated fee authority
    const delegatedAuthority = Keypair.generate();

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      5000,
      initialPresetAdaptiveFeeConstants,
      undefined, // initializePoolAuthority
      delegatedAuthority.publicKey, // delegatedFeeAuthority
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    // Initialize pool
    const [tokenMintA, tokenMintB] = await createInOrderMints(ctx);
    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      tokenMintA,
      tokenMintB,
      feeTierIndex,
    );
    const tokenVaultAKeypair = anchor.web3.Keypair.generate();
    const tokenVaultBKeypair = anchor.web3.Keypair.generate();
    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTierKey: adaptiveFeeTierPda.publicKey,
        tokenMintA,
        tokenMintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
        tokenBadgeA: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintA,
        ).publicKey,
        tokenBadgeB: PDAUtil.getTokenBadge(
          ctx.program.programId,
          configInitInfo.whirlpoolsConfigKeypair.publicKey,
          tokenMintB,
        ).publicKey,
        whirlpoolPda,
        oraclePda,
        tokenVaultAKeypair,
        tokenVaultBKeypair,
        initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
        initializePoolAuthority: ctx.wallet.publicKey,
        funder: ctx.wallet.publicKey,
      }),
    ).buildAndExecute();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setAdaptiveFeeConstantsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          oracle: oraclePda.publicKey,
          feeAuthority: delegatedAuthority.publicKey,
          filterPeriod: 60,
        }),
      )
        .addSigner(delegatedAuthority)
        .buildAndExecute(),
      /0x7dc/, // ConstraintAddress
    );
  });
});
