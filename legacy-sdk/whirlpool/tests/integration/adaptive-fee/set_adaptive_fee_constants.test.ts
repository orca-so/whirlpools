import * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import * as assert from "assert";
import type { AdaptiveFeeConstantsData, WhirlpoolContext } from "../../../src";
import {
  IGNORE_CACHE,
  PDAUtil,
  PriceMath,
  toTx,
  WhirlpoolIx,
} from "../../../src";
import {
  initAdaptiveFeeTier,
  initializeConfigWithDefaultConfigParams,
} from "../../utils/init-utils";
import { initializeLiteSVMEnvironment } from "../../utils/litesvm";
import {
  createInOrderMints,
  getDefaultPresetAdaptiveFeeConstants,
} from "../../utils/test-builders";

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
        initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
        initializePoolAuthority: ctx.wallet.publicKey,
        funder: ctx.wallet.publicKey,
      }),
    ).buildAndExecute();

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
    const oracle = await fetcher.getOracle(oraclePda.publicKey, IGNORE_CACHE);
    assert.equal(oracle?.adaptiveFeeConstants.filterPeriod, 60);
    assert.equal(oracle?.adaptiveFeeConstants.decayPeriod, 1200);

    // Other constants should remain unchanged
    assert.equal(
      oracle?.adaptiveFeeConstants.reductionFactor,
      initialPresetAdaptiveFeeConstants.reductionFactor,
    );
    assert.equal(
      oracle?.adaptiveFeeConstants.adaptiveFeeControlFactor,
      initialPresetAdaptiveFeeConstants.adaptiveFeeControlFactor,
    );
    assert.equal(
      oracle?.adaptiveFeeConstants.maxVolatilityAccumulator,
      initialPresetAdaptiveFeeConstants.maxVolatilityAccumulator,
    );
    assert.equal(
      oracle?.adaptiveFeeConstants.tickGroupSize,
      initialPresetAdaptiveFeeConstants.tickGroupSize,
    );
    assert.equal(
      oracle?.adaptiveFeeConstants.majorSwapThresholdTicks,
      initialPresetAdaptiveFeeConstants.majorSwapThresholdTicks,
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
        initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
        initializePoolAuthority: ctx.wallet.publicKey,
        funder: ctx.wallet.publicKey,
      }),
    ).buildAndExecute();

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
    const oracle = await fetcher.getOracle(oraclePda.publicKey, IGNORE_CACHE);
    assert.equal(
      oracle?.adaptiveFeeConstants.filterPeriod,
      newConstants.filterPeriod,
    );
    assert.equal(
      oracle?.adaptiveFeeConstants.decayPeriod,
      newConstants.decayPeriod,
    );
    assert.equal(
      oracle?.adaptiveFeeConstants.reductionFactor,
      newConstants.reductionFactor,
    );
    assert.equal(
      oracle?.adaptiveFeeConstants.adaptiveFeeControlFactor,
      newConstants.adaptiveFeeControlFactor,
    );
    assert.equal(
      oracle?.adaptiveFeeConstants.maxVolatilityAccumulator,
      newConstants.maxVolatilityAccumulator,
    );
    assert.equal(
      oracle?.adaptiveFeeConstants.tickGroupSize,
      newConstants.tickGroupSize,
    );
    assert.equal(
      oracle?.adaptiveFeeConstants.majorSwapThresholdTicks,
      newConstants.majorSwapThresholdTicks,
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
