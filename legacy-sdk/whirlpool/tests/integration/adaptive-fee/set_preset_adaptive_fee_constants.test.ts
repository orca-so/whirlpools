import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { AdaptiveFeeConstantsData, InitPoolWithAdaptiveFeeParams } from "../../../src";
import { IGNORE_CACHE, PDAUtil, PriceMath, toTx, WhirlpoolContext, WhirlpoolIx } from "../../../src";
import { dropIsSignerFlag } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { initAdaptiveFeeTier } from "../../utils/init-utils";
import {
  createInOrderMints,
  generateDefaultConfigParams,
  getDefaultPresetAdaptiveFeeConstants,
} from "../../utils/test-builders";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";

describe("set_preset_adaptive_fee_constants", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  const tickSpacing = 64;
  const feeTierIndex = 1024 + tickSpacing;

  it("successfully set_preset_adaptive_fee_constants", async () => {
    const initialPresetAdaptiveFeeConstants: AdaptiveFeeConstantsData = {
      filterPeriod: 30,
      decayPeriod: 600,
      reductionFactor: 500,
      adaptiveFeeControlFactor: 4_000,
      maxVolatilityAccumulator: 350_000,
      tickGroupSize: 64,
    };
    const newPresetAdaptiveFeeConstants: AdaptiveFeeConstantsData = {
      filterPeriod: 2**16 - 2, // must be < decayPeriod
      decayPeriod: 2**16 - 1, // u16::MAX
      reductionFactor: 9999,
      adaptiveFeeControlFactor: 99999,
      maxVolatilityAccumulator: Math.floor(2**32 / tickSpacing) - 1,
      tickGroupSize: 32,
    };

    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
    ).buildAndExecute();

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      5000,
      initialPresetAdaptiveFeeConstants,
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    const preAdaptiveFeeTierAccount = await fetcher.getAdaptiveFeeTier(
      adaptiveFeeTierPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(preAdaptiveFeeTierAccount);
    assert.ok(preAdaptiveFeeTierAccount.filterPeriod === initialPresetAdaptiveFeeConstants.filterPeriod);
    assert.ok(preAdaptiveFeeTierAccount.decayPeriod === initialPresetAdaptiveFeeConstants.decayPeriod);
    assert.ok(preAdaptiveFeeTierAccount.reductionFactor === initialPresetAdaptiveFeeConstants.reductionFactor);
    assert.ok(preAdaptiveFeeTierAccount.adaptiveFeeControlFactor === initialPresetAdaptiveFeeConstants.adaptiveFeeControlFactor);
    assert.ok(preAdaptiveFeeTierAccount.maxVolatilityAccumulator === initialPresetAdaptiveFeeConstants.maxVolatilityAccumulator);
    assert.ok(preAdaptiveFeeTierAccount.tickGroupSize === initialPresetAdaptiveFeeConstants.tickGroupSize);

    await toTx(
      ctx,
      WhirlpoolIx.setPresetAdaptiveFeeConstantsIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
        feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
        presetFilterPeriod: newPresetAdaptiveFeeConstants.filterPeriod,
        presetDecayPeriod: newPresetAdaptiveFeeConstants.decayPeriod,
        presetReductionFactor: newPresetAdaptiveFeeConstants.reductionFactor,
        presetAdaptiveFeeControlFactor: newPresetAdaptiveFeeConstants.adaptiveFeeControlFactor,
        presetMaxVolatilityAccumulator: newPresetAdaptiveFeeConstants.maxVolatilityAccumulator,
        presetTickGroupSize: newPresetAdaptiveFeeConstants.tickGroupSize,
      }),
    )
    .addSigner(configKeypairs.feeAuthorityKeypair)
    .buildAndExecute();

    const postAdaptiveFeeTierAccount = await fetcher.getAdaptiveFeeTier(
      adaptiveFeeTierPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(postAdaptiveFeeTierAccount);
    assert.ok(postAdaptiveFeeTierAccount.filterPeriod === newPresetAdaptiveFeeConstants.filterPeriod);
    assert.ok(postAdaptiveFeeTierAccount.decayPeriod === newPresetAdaptiveFeeConstants.decayPeriod);
    assert.ok(postAdaptiveFeeTierAccount.reductionFactor === newPresetAdaptiveFeeConstants.reductionFactor);
    assert.ok(postAdaptiveFeeTierAccount.adaptiveFeeControlFactor === newPresetAdaptiveFeeConstants.adaptiveFeeControlFactor);
    assert.ok(postAdaptiveFeeTierAccount.maxVolatilityAccumulator === newPresetAdaptiveFeeConstants.maxVolatilityAccumulator);
    assert.ok(postAdaptiveFeeTierAccount.tickGroupSize === newPresetAdaptiveFeeConstants.tickGroupSize);

    // Newly initialized whirlpools have new adaptive fee constants in its Oracle account
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

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    const newPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
      whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
      adaptiveFeeTierKey: adaptiveFeeTierPda.publicKey,
      tokenMintA,
      tokenMintB,
      tokenProgramA: TOKEN_PROGRAM_ID,
      tokenProgramB: TOKEN_PROGRAM_ID,
      tokenBadgeA: PDAUtil.getTokenBadge(ctx.program.programId, configInitInfo.whirlpoolsConfigKeypair.publicKey, tokenMintA).publicKey,
      tokenBadgeB: PDAUtil.getTokenBadge(ctx.program.programId, configInitInfo.whirlpoolsConfigKeypair.publicKey, tokenMintB).publicKey,
      whirlpoolPda,
      oraclePda,
      tokenVaultAKeypair,
      tokenVaultBKeypair,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
      initializePoolAuthority: ctx.wallet.publicKey,
      funder: ctx.wallet.publicKey,
    };
    await toTx(
      ctx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, newPoolInitInfo),
    ).buildAndExecute();

    const whirlpool = await fetcher.getPool(whirlpoolPda.publicKey, IGNORE_CACHE);
    assert.ok(whirlpool);
    const oracle = await fetcher.getOracle(oraclePda.publicKey, IGNORE_CACHE);
    assert.ok(oracle);
    assert.ok(oracle.adaptiveFeeConstants.filterPeriod === newPresetAdaptiveFeeConstants.filterPeriod);
    assert.ok(oracle.adaptiveFeeConstants.decayPeriod === newPresetAdaptiveFeeConstants.decayPeriod);
    assert.ok(oracle.adaptiveFeeConstants.reductionFactor === newPresetAdaptiveFeeConstants.reductionFactor);
    assert.ok(oracle.adaptiveFeeConstants.adaptiveFeeControlFactor === newPresetAdaptiveFeeConstants.adaptiveFeeControlFactor);
    assert.ok(oracle.adaptiveFeeConstants.maxVolatilityAccumulator === newPresetAdaptiveFeeConstants.maxVolatilityAccumulator);
    assert.ok(oracle.adaptiveFeeConstants.tickGroupSize === newPresetAdaptiveFeeConstants.tickGroupSize);
  });

  it("fails when adaptive fee tier account has not been initialized", async () => {
    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
    ).buildAndExecute();

    const adaptiveFeeTierPda = PDAUtil.getFeeTier(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      feeTierIndex,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setPresetAdaptiveFeeConstantsIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
          feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
          presetFilterPeriod: 50,
          presetDecayPeriod: 6000,
          presetReductionFactor: 0,
          presetAdaptiveFeeControlFactor: 100,
          presetMaxVolatilityAccumulator: 50_000,
          presetTickGroupSize: 16,
        }),
      )
        .addSigner(configKeypairs.feeAuthorityKeypair)
        .buildAndExecute(),
      /0xbc4/, // AccountNotInitialized
    );
  });

  it("fails when fee authority is not a signer", async () => {
    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
    ).buildAndExecute();

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      5_000,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    const ix = WhirlpoolIx.setPresetAdaptiveFeeConstantsIx(ctx.program, {
      whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
      adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
      feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
      presetFilterPeriod: 50,
      presetDecayPeriod: 6000,
      presetReductionFactor: 0,
      presetAdaptiveFeeControlFactor: 100,
      presetMaxVolatilityAccumulator: 50_000,
      presetTickGroupSize: 16,
    });
    const ixWithoutSigner = dropIsSignerFlag(ix.instructions[0], configKeypairs.feeAuthorityKeypair.publicKey);
    
    await assert.rejects(
      toTx(
        ctx,
        { instructions: [ixWithoutSigner], cleanupInstructions: [], signers: [] },
      )
      // no fee authority sign
      .buildAndExecute(),
      /0xbc2/, // AccountNotSigner
    );
  });

  it("fails when invalid fee authority provided", async () => {
    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
    ).buildAndExecute();

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      5_000,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
    );
    const adaptiveFeeTierPda = params.feeTierPda;
    
    const fakeFeeAuthorityKeypair = Keypair.generate();
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setPresetAdaptiveFeeConstantsIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
          feeAuthority: fakeFeeAuthorityKeypair.publicKey,
          presetFilterPeriod: 50,
          presetDecayPeriod: 6000,
          presetReductionFactor: 0,
          presetAdaptiveFeeControlFactor: 100,
          presetMaxVolatilityAccumulator: 50_000,
          presetTickGroupSize: 16,
        })
            )
      .addSigner(fakeFeeAuthorityKeypair)
      .buildAndExecute(),
      /0x7dc/, // ConstraintAddress
    );
  });

  describe("fails when adaptive fee constants are invalid", () => {
    const tickSpacing = 128;
    const feeTierIndex = 1024 + tickSpacing;

    let whirlpoolsConfigKey: PublicKey;
    let adaptiveFeeTierKey: PublicKey;
    let feeAuthorityKeypair: Keypair;

    const presetAdaptiveFeeConstants = getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    beforeAll(async () => {
      const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
      await toTx(
        ctx,
        WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
      ).buildAndExecute();
  
      const { params } = await initAdaptiveFeeTier(
        ctx,
        configInitInfo,
        configKeypairs.feeAuthorityKeypair,
        feeTierIndex,
        tickSpacing,
        5_000,
        presetAdaptiveFeeConstants,
      );
      
      whirlpoolsConfigKey = configInitInfo.whirlpoolsConfigKeypair.publicKey;
      adaptiveFeeTierKey = params.feeTierPda.publicKey;
      feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

      // presetAdaptiveFeeConstants should be accepted
      const constants = presetAdaptiveFeeConstants;
      await toTx(
        ctx,
        WhirlpoolIx.setPresetAdaptiveFeeConstantsIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKey,
          adaptiveFeeTier: adaptiveFeeTierKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          presetFilterPeriod: constants.filterPeriod,
          presetDecayPeriod: constants.decayPeriod,
          presetReductionFactor: constants.reductionFactor,
          presetAdaptiveFeeControlFactor: constants.adaptiveFeeControlFactor,
          presetMaxVolatilityAccumulator: constants.maxVolatilityAccumulator,
          presetTickGroupSize: constants.tickGroupSize,
        })
            )
      .addSigner(feeAuthorityKeypair)
      .buildAndExecute();
  });

    async function shouldFail(constants: AdaptiveFeeConstantsData) {
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.setPresetAdaptiveFeeConstantsIx(ctx.program, {
            whirlpoolsConfig: whirlpoolsConfigKey,
            adaptiveFeeTier: adaptiveFeeTierKey,
            feeAuthority: feeAuthorityKeypair.publicKey,
            presetFilterPeriod: constants.filterPeriod,
            presetDecayPeriod: constants.decayPeriod,
            presetReductionFactor: constants.reductionFactor,
            presetAdaptiveFeeControlFactor: constants.adaptiveFeeControlFactor,
            presetMaxVolatilityAccumulator: constants.maxVolatilityAccumulator,
            presetTickGroupSize: constants.tickGroupSize,
          })
              )
        .addSigner(feeAuthorityKeypair)
        .buildAndExecute(),
            /0x17aa/, // InvalidAdaptiveFeeConstants
      );
    }

    it("filter_period == 0", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        filterPeriod: 0,
      })
    });

    it("decay_period == 0", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        decayPeriod: 0,
      })
    });

    it("decay_period <= filter_period", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        decayPeriod: presetAdaptiveFeeConstants.filterPeriod,
      })
    });

    it("reduction_factor >= MAX_REDUCTION_FACTOR", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        reductionFactor: 10_000,
      })
    });

    it("adaptive_fee_control_factor >= ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        adaptiveFeeControlFactor: 100_000,
      })
    });

    it("tick_group_size == 0", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        tickGroupSize: 0,
      })
    });

    it("tick_group_size > tick_spacing", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        tickGroupSize: tickSpacing + 1,
      })
    });

    it("tick_group_size is not factor of tick_spacing", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        tickGroupSize: 33,
      })
    });

    it("max_volatility_accumulator * tick_group_size > u32::MAX", async () => {
      const tickGroupSize = presetAdaptiveFeeConstants.tickGroupSize;
      const maxVolatilityAccumulator = Math.floor(2**32 / tickGroupSize);
      console.log("maxVolatilityAccumulator", maxVolatilityAccumulator);
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        maxVolatilityAccumulator,
      })
    });
  });
});
