import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type {
  AdaptiveFeeConstantsData,
  AdaptiveFeeTierData,
} from "../../../src";
import {
  AccountName,
  getAccountSize,
  PDAUtil,
  TICK_ARRAY_SIZE,
  toTx,
  WhirlpoolContext,
  WhirlpoolIx,
} from "../../../src";
import {
  dropIsSignerFlag,
  ONE_SOL,
  rewritePubkey,
  systemTransferTx,
} from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import {
  initAdaptiveFeeTier,
  initFeeTier,
  initializeConfigWithDefaultConfigParams,
} from "../../utils/init-utils";
import { getDefaultPresetAdaptiveFeeConstants } from "../../utils/test-builders";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("initialize_adaptive_fee_tier", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  function equalsAdaptiveFeeConstants(
    aft: AdaptiveFeeTierData,
    constants: AdaptiveFeeConstantsData,
  ): boolean {
    return (
      aft.filterPeriod == constants.filterPeriod &&
      aft.decayPeriod == constants.decayPeriod &&
      aft.reductionFactor == constants.reductionFactor &&
      aft.adaptiveFeeControlFactor == constants.adaptiveFeeControlFactor &&
      aft.maxVolatilityAccumulator == constants.maxVolatilityAccumulator &&
      aft.tickGroupSize == constants.tickGroupSize &&
      aft.majorSwapThresholdTicks == constants.majorSwapThresholdTicks
    );
  }

  async function tryInitializeAdaptiveFeeTier(
    tickSpacing: number,
    feeTierIndex: number,
    defaultBaseFeeRate: number,
    initializePoolAuthority: PublicKey,
    delegatedFeeAuthority: PublicKey,
    presetAdaptiveFeeConstants: AdaptiveFeeConstantsData,
    funder?: Keypair,
  ) {
    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const result = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      defaultBaseFeeRate,
      presetAdaptiveFeeConstants,
      initializePoolAuthority,
      delegatedFeeAuthority,
      funder,
    );

    const generatedPda = PDAUtil.getFeeTier(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      feeTierIndex,
    );

    const adaptiveFeeTierAccount = await fetcher.getAdaptiveFeeTier(
      generatedPda.publicKey,
    );

    assert.ok(adaptiveFeeTierAccount);
    assert.ok(
      adaptiveFeeTierAccount.whirlpoolsConfig.equals(
        configInitInfo.whirlpoolsConfigKeypair.publicKey,
      ),
    );
    assert.ok(adaptiveFeeTierAccount.feeTierIndex == feeTierIndex);
    assert.ok(adaptiveFeeTierAccount.tickSpacing == tickSpacing);
    assert.ok(
      adaptiveFeeTierAccount.initializePoolAuthority.equals(
        initializePoolAuthority,
      ),
    );
    assert.ok(
      adaptiveFeeTierAccount.delegatedFeeAuthority.equals(
        delegatedFeeAuthority,
      ),
    );
    assert.ok(adaptiveFeeTierAccount.defaultBaseFeeRate == defaultBaseFeeRate);
    assert.ok(
      equalsAdaptiveFeeConstants(
        adaptiveFeeTierAccount,
        presetAdaptiveFeeConstants,
      ),
    );

    return result;
  }

  it("successfully init an adaptive fee tier account with normal base fee rate", async () => {
    const tickSpacing = 64;
    const feeTierIndex = 1024 + 64;
    const defaultBaseFeeRate = 3000;
    const initializePoolAuthority = PublicKey.default;
    const delegatedFeeAuthority = PublicKey.default;
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    await tryInitializeAdaptiveFeeTier(
      tickSpacing,
      feeTierIndex,
      defaultBaseFeeRate,
      initializePoolAuthority,
      delegatedFeeAuthority,
      presetAdaptiveFeeConstants,
    );
  });

  it("successfully init an adaptive fee tier account with max base fee rate", async () => {
    const tickSpacing = 128;
    const feeTierIndex = 1024 + 128;
    const defaultBaseFeeRate = 60_000;
    const initializePoolAuthority = PublicKey.default;
    const delegatedFeeAuthority = PublicKey.default;
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    await tryInitializeAdaptiveFeeTier(
      tickSpacing,
      feeTierIndex,
      defaultBaseFeeRate,
      initializePoolAuthority,
      delegatedFeeAuthority,
      presetAdaptiveFeeConstants,
    );
  });

  it("successfully init an adaptive fee tier account with optional authorities", async () => {
    const tickSpacing = 64;
    const feeTierIndex = 1024 + 64;
    const defaultBaseFeeRate = 3000;
    const initializePoolAuthority = Keypair.generate().publicKey;
    const delegatedFeeAuthority = Keypair.generate().publicKey;
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    await tryInitializeAdaptiveFeeTier(
      tickSpacing,
      feeTierIndex,
      defaultBaseFeeRate,
      initializePoolAuthority,
      delegatedFeeAuthority,
      presetAdaptiveFeeConstants,
    );
  });

  it("successfully init an adaptive fee tier with another funder wallet", async () => {
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(
      provider,
      funderKeypair.publicKey,
      ONE_SOL,
    ).buildAndExecute();

    const tickSpacing = 64;
    const feeTierIndex = 1024 + 64;
    const defaultBaseFeeRate = 3000;
    const initializePoolAuthority = Keypair.generate().publicKey;
    const delegatedFeeAuthority = Keypair.generate().publicKey;
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const preBalance = await provider.connection.getBalance(
      funderKeypair.publicKey,
    );
    const requiredRent =
      await provider.connection.getMinimumBalanceForRentExemption(
        getAccountSize(AccountName.AdaptiveFeeTier),
      );

    await tryInitializeAdaptiveFeeTier(
      tickSpacing,
      feeTierIndex,
      defaultBaseFeeRate,
      initializePoolAuthority,
      delegatedFeeAuthority,
      presetAdaptiveFeeConstants,
      funderKeypair,
    );

    const postBalance = await provider.connection.getBalance(
      funderKeypair.publicKey,
    );
    assert.ok(preBalance - postBalance == requiredRent);
  });

  it("successfully init an adaptive fee tier account with maximal adaptive fee constants", async () => {
    const tickSpacing = 64;
    const feeTierIndex = 1024 + 64;
    const defaultBaseFeeRate = 3000;
    const initializePoolAuthority = PublicKey.default;
    const delegatedFeeAuthority = PublicKey.default;
    const presetAdaptiveFeeConstants: AdaptiveFeeConstantsData = {
      filterPeriod: 2 ** 16 - 2, // must be < decayPeriod
      decayPeriod: 2 ** 16 - 1, // u16::MAX
      reductionFactor: 9999,
      adaptiveFeeControlFactor: 99999,
      maxVolatilityAccumulator: Math.floor(2 ** 32 / tickSpacing) - 1,
      tickGroupSize: tickSpacing,
      majorSwapThresholdTicks: tickSpacing,
    };

    await tryInitializeAdaptiveFeeTier(
      tickSpacing,
      feeTierIndex,
      defaultBaseFeeRate,
      initializePoolAuthority,
      delegatedFeeAuthority,
      presetAdaptiveFeeConstants,
    );
  });

  it("fails when default base fee rate exceeds max", async () => {
    const tickSpacing = 128;
    const feeTierIndex = 1024 + 128;
    const defaultBaseFeeRate = 60_000 + 1;
    const initializePoolAuthority = PublicKey.default;
    const delegatedFeeAuthority = PublicKey.default;
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    await assert.rejects(
      tryInitializeAdaptiveFeeTier(
        tickSpacing,
        feeTierIndex,
        defaultBaseFeeRate,
        initializePoolAuthority,
        delegatedFeeAuthority,
        presetAdaptiveFeeConstants,
      ),
      /0x178c/, // FeeRateMaxExceeded
    );
  });

  it("fails when feeTierIndex == tickSpacing", async () => {
    const tickSpacing = 128;
    const feeTierIndex = tickSpacing;
    const defaultBaseFeeRate = 3000;
    const initializePoolAuthority = PublicKey.default;
    const delegatedFeeAuthority = PublicKey.default;
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    await assert.rejects(
      tryInitializeAdaptiveFeeTier(
        tickSpacing,
        feeTierIndex,
        defaultBaseFeeRate,
        initializePoolAuthority,
        delegatedFeeAuthority,
        presetAdaptiveFeeConstants,
      ),
      /0x17ae/, // InvalidFeeTierIndex
    );
  });

  it("fails when tick_spacing is zero", async () => {
    // invalid
    const tickSpacing = 0;

    const feeTierIndex = 1024 + 128;
    const defaultBaseFeeRate = 60_000 + 1;
    const initializePoolAuthority = PublicKey.default;
    const delegatedFeeAuthority = PublicKey.default;
    // tick_group_size will be zero, but tick_spacing check is first
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    await assert.rejects(
      tryInitializeAdaptiveFeeTier(
        tickSpacing,
        feeTierIndex,
        defaultBaseFeeRate,
        initializePoolAuthority,
        delegatedFeeAuthority,
        presetAdaptiveFeeConstants,
      ),
      /0x1774/, // InvalidTickSpacing
    );
  });

  it("fails when whirlpools_config is not valid for AdaptiveFeeTier PDA", async () => {
    const tickSpacing = 64;
    const feeTierIndex = 1024 + 64;
    const defaultBaseFeeRate = 3000;
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const { configInitInfo } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const {
      configInitInfo: anotherConfigInitInfo,
      configKeypairs: anotherConfigKeypairs,
    } = await initializeConfigWithDefaultConfigParams(ctx);

    const feeTierPda = PDAUtil.getFeeTier(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      feeTierIndex,
    );

    const feeAuthorityKeypair = anotherConfigKeypairs.feeAuthorityKeypair;
    const tx = toTx(
      ctx,
      WhirlpoolIx.initializeAdaptiveFeeTierIx(ctx.program, {
        whirlpoolsConfig:
          anotherConfigInitInfo.whirlpoolsConfigKeypair.publicKey, // invalid
        feeTierIndex,
        tickSpacing,
        feeTierPda,
        funder: ctx.wallet.publicKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        defaultBaseFeeRate,
        presetFilterPeriod: presetAdaptiveFeeConstants.filterPeriod,
        presetDecayPeriod: presetAdaptiveFeeConstants.decayPeriod,
        presetReductionFactor: presetAdaptiveFeeConstants.reductionFactor,
        presetAdaptiveFeeControlFactor:
          presetAdaptiveFeeConstants.adaptiveFeeControlFactor,
        presetMaxVolatilityAccumulator:
          presetAdaptiveFeeConstants.maxVolatilityAccumulator,
        presetTickGroupSize: presetAdaptiveFeeConstants.tickGroupSize,
        presetMajorSwapThresholdTicks:
          presetAdaptiveFeeConstants.majorSwapThresholdTicks,
      }),
    ).addSigner(feeAuthorityKeypair);

    await assert.rejects(
      tx.buildAndExecute(),
      /0x7d6/, // ConstraintSeeds (seed constraint was violated)
    );
  });

  it("fails when fee_tier_index is not valid for AdaptiveFeeTier PDA", async () => {
    const tickSpacing = 64;
    const feeTierIndex = 1024 + 64;
    const invalidFeeTierIndex = feeTierIndex + 1;
    const defaultBaseFeeRate = 3000;
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const feeTierPda = PDAUtil.getFeeTier(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      feeTierIndex,
    );

    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;
    const tx = toTx(
      ctx,
      WhirlpoolIx.initializeAdaptiveFeeTierIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        feeTierIndex: invalidFeeTierIndex, // invalid
        tickSpacing,
        feeTierPda,
        funder: ctx.wallet.publicKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        defaultBaseFeeRate,
        presetFilterPeriod: presetAdaptiveFeeConstants.filterPeriod,
        presetDecayPeriod: presetAdaptiveFeeConstants.decayPeriod,
        presetReductionFactor: presetAdaptiveFeeConstants.reductionFactor,
        presetAdaptiveFeeControlFactor:
          presetAdaptiveFeeConstants.adaptiveFeeControlFactor,
        presetMaxVolatilityAccumulator:
          presetAdaptiveFeeConstants.maxVolatilityAccumulator,
        presetTickGroupSize: presetAdaptiveFeeConstants.tickGroupSize,
        presetMajorSwapThresholdTicks:
          presetAdaptiveFeeConstants.majorSwapThresholdTicks,
      }),
    ).addSigner(feeAuthorityKeypair);

    await assert.rejects(
      tx.buildAndExecute(),
      /0x7d6/, // ConstraintSeeds (seed constraint was violated)
    );
  });

  it("fails when fee_authority is invalid", async () => {
    const tickSpacing = 64;
    const feeTierIndex = 1024 + 64;
    const defaultBaseFeeRate = 3000;
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const { configInitInfo } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const feeTierPda = PDAUtil.getFeeTier(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      feeTierIndex,
    );

    const fakeFeeAuthorityKeypair = Keypair.generate();
    const tx = toTx(
      ctx,
      WhirlpoolIx.initializeAdaptiveFeeTierIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        feeTierIndex,
        tickSpacing,
        feeTierPda,
        funder: ctx.wallet.publicKey,
        feeAuthority: fakeFeeAuthorityKeypair.publicKey, // invalid
        defaultBaseFeeRate,
        presetFilterPeriod: presetAdaptiveFeeConstants.filterPeriod,
        presetDecayPeriod: presetAdaptiveFeeConstants.decayPeriod,
        presetReductionFactor: presetAdaptiveFeeConstants.reductionFactor,
        presetAdaptiveFeeControlFactor:
          presetAdaptiveFeeConstants.adaptiveFeeControlFactor,
        presetMaxVolatilityAccumulator:
          presetAdaptiveFeeConstants.maxVolatilityAccumulator,
        presetTickGroupSize: presetAdaptiveFeeConstants.tickGroupSize,
        presetMajorSwapThresholdTicks:
          presetAdaptiveFeeConstants.majorSwapThresholdTicks,
      }),
    ).addSigner(fakeFeeAuthorityKeypair);

    await assert.rejects(
      tx.buildAndExecute(),
      /0x7dc/, // ConstraintAddress
    );
  });

  it("fails when fee_authority is not a signer", async () => {
    const tickSpacing = 64;
    const feeTierIndex = 1024 + 64;
    const defaultBaseFeeRate = 3000;
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const feeTierPda = PDAUtil.getFeeTier(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      feeTierIndex,
    );

    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;
    const ix = WhirlpoolIx.initializeAdaptiveFeeTierIx(ctx.program, {
      whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
      feeTierIndex,
      tickSpacing,
      feeTierPda,
      funder: ctx.wallet.publicKey,
      feeAuthority: feeAuthorityKeypair.publicKey,
      defaultBaseFeeRate,
      presetFilterPeriod: presetAdaptiveFeeConstants.filterPeriod,
      presetDecayPeriod: presetAdaptiveFeeConstants.decayPeriod,
      presetReductionFactor: presetAdaptiveFeeConstants.reductionFactor,
      presetAdaptiveFeeControlFactor:
        presetAdaptiveFeeConstants.adaptiveFeeControlFactor,
      presetMaxVolatilityAccumulator:
        presetAdaptiveFeeConstants.maxVolatilityAccumulator,
      presetTickGroupSize: presetAdaptiveFeeConstants.tickGroupSize,
      presetMajorSwapThresholdTicks:
        presetAdaptiveFeeConstants.majorSwapThresholdTicks,
    });

    const ixWithoutSigner = dropIsSignerFlag(
      ix.instructions[0],
      feeAuthorityKeypair.publicKey,
    );

    const tx = toTx(ctx, {
      instructions: [ixWithoutSigner],
      cleanupInstructions: [],
      signers: [],
    });
    // not adding feeAuthorityKeypair as a signer

    await assert.rejects(
      tx.buildAndExecute(),
      /0xbc2/, // AccountNotSigner
    );
  });

  it("fails when funder is not a signer", async () => {
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(
      provider,
      funderKeypair.publicKey,
      ONE_SOL,
    ).buildAndExecute();

    const tickSpacing = 64;
    const feeTierIndex = 1024 + 64;
    const defaultBaseFeeRate = 3000;
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const feeTierPda = PDAUtil.getFeeTier(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      feeTierIndex,
    );

    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;
    const ix = WhirlpoolIx.initializeAdaptiveFeeTierIx(ctx.program, {
      whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
      feeTierIndex,
      tickSpacing,
      feeTierPda,
      funder: funderKeypair.publicKey,
      feeAuthority: feeAuthorityKeypair.publicKey,
      defaultBaseFeeRate,
      presetFilterPeriod: presetAdaptiveFeeConstants.filterPeriod,
      presetDecayPeriod: presetAdaptiveFeeConstants.decayPeriod,
      presetReductionFactor: presetAdaptiveFeeConstants.reductionFactor,
      presetAdaptiveFeeControlFactor:
        presetAdaptiveFeeConstants.adaptiveFeeControlFactor,
      presetMaxVolatilityAccumulator:
        presetAdaptiveFeeConstants.maxVolatilityAccumulator,
      presetTickGroupSize: presetAdaptiveFeeConstants.tickGroupSize,
      presetMajorSwapThresholdTicks:
        presetAdaptiveFeeConstants.majorSwapThresholdTicks,
    });

    const ixWithoutSigner = dropIsSignerFlag(
      ix.instructions[0],
      funderKeypair.publicKey,
    );

    const tx = toTx(ctx, {
      instructions: [ixWithoutSigner],
      cleanupInstructions: [],
      signers: [],
    }).addSigner(feeAuthorityKeypair);
    // not adding funderKeypair as a signer

    await assert.rejects(
      tx.buildAndExecute(),
      /0xbc2/, // AccountNotSigner
    );
  });

  it("fails when FeeTier has been initialized", async () => {
    const tickSpacing = 64;
    const feeTierIndex = 1024 + 64;
    const defaultBaseFeeRate = 3000;
    const initializePoolAuthority = PublicKey.default;
    const delegatedFeeAuthority = PublicKey.default;
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const feeTierPda = PDAUtil.getFeeTier(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      feeTierIndex,
    );

    await initFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      defaultBaseFeeRate,
    );

    const feeTier = await fetcher.getFeeTier(feeTierPda.publicKey);
    assert.ok(feeTier);

    await assert.rejects(
      initAdaptiveFeeTier(
        ctx,
        configInitInfo,
        configKeypairs.feeAuthorityKeypair,
        feeTierIndex,
        tickSpacing,
        defaultBaseFeeRate,
        presetAdaptiveFeeConstants,
        initializePoolAuthority,
        delegatedFeeAuthority,
      ),
      (err) => {
        return JSON.stringify(err).includes("already in use");
      },
    );
  });

  it("fails when system_program is invalid", async () => {
    const tickSpacing = 64;
    const feeTierIndex = 1024 + 64;
    const defaultBaseFeeRate = 3000;
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const feeTierPda = PDAUtil.getFeeTier(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      feeTierIndex,
    );

    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;
    const ix = WhirlpoolIx.initializeAdaptiveFeeTierIx(ctx.program, {
      whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
      feeTierIndex,
      tickSpacing,
      feeTierPda,
      funder: ctx.wallet.publicKey,
      feeAuthority: feeAuthorityKeypair.publicKey,
      defaultBaseFeeRate,
      presetFilterPeriod: presetAdaptiveFeeConstants.filterPeriod,
      presetDecayPeriod: presetAdaptiveFeeConstants.decayPeriod,
      presetReductionFactor: presetAdaptiveFeeConstants.reductionFactor,
      presetAdaptiveFeeControlFactor:
        presetAdaptiveFeeConstants.adaptiveFeeControlFactor,
      presetMaxVolatilityAccumulator:
        presetAdaptiveFeeConstants.maxVolatilityAccumulator,
      presetTickGroupSize: presetAdaptiveFeeConstants.tickGroupSize,
      presetMajorSwapThresholdTicks:
        presetAdaptiveFeeConstants.majorSwapThresholdTicks,
    });

    const ixWithWrongAccount = rewritePubkey(
      ix.instructions[0],
      SystemProgram.programId,
      TOKEN_PROGRAM_ID,
    );

    const tx = toTx(ctx, {
      instructions: [ixWithWrongAccount],
      cleanupInstructions: [],
      signers: [],
    }).addSigner(feeAuthorityKeypair);

    await assert.rejects(
      tx.buildAndExecute(),
      /0xbc0/, // InvalidProgramId
    );
  });

  describe("fails when adaptive fee constants are invalid", () => {
    const tickSpacing = 128;
    const feeTierIndex = 1024 + tickSpacing;
    const defaultBaseFeeRate = 3000;
    const initializePoolAuthority = PublicKey.default;
    const delegatedFeeAuthority = PublicKey.default;
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    async function shouldFail(constants: AdaptiveFeeConstantsData) {
      await assert.rejects(
        tryInitializeAdaptiveFeeTier(
          tickSpacing,
          feeTierIndex,
          defaultBaseFeeRate,
          initializePoolAuthority,
          delegatedFeeAuthority,
          constants,
        ),
        /0x17ad/, // InvalidAdaptiveFeeConstants
      );
    }

    it("filter_period == 0", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        filterPeriod: 0,
      });
    });

    it("decay_period == 0", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        decayPeriod: 0,
      });
    });

    it("decay_period <= filter_period", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        decayPeriod: presetAdaptiveFeeConstants.filterPeriod,
      });
    });

    it("reduction_factor >= MAX_REDUCTION_FACTOR", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        reductionFactor: 10_000,
      });
    });

    it("adaptive_fee_control_factor >= ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        adaptiveFeeControlFactor: 100_000,
      });
    });

    it("tick_group_size == 0", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        tickGroupSize: 0,
      });
    });

    it("tick_group_size > tick_spacing", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        tickGroupSize: tickSpacing + 1,
      });
    });

    it("tick_group_size is not factor of tick_spacing", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        tickGroupSize: 33,
      });
    });

    it("max_volatility_accumulator * tick_group_size > u32::MAX", async () => {
      const tickGroupSize = presetAdaptiveFeeConstants.tickGroupSize;
      const maxVolatilityAccumulator = Math.floor(2 ** 32 / tickGroupSize);
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        maxVolatilityAccumulator,
      });
    });

    it("major_swap_threshold_ticks == 0", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        majorSwapThresholdTicks: 0,
      });
    });

    it("major_swap_threshold_ticks > tick_spacing * TICK_ARRAY_SIZE", async () => {
      await shouldFail({
        ...presetAdaptiveFeeConstants,
        majorSwapThresholdTicks: tickSpacing * TICK_ARRAY_SIZE + 1,
      });
    });
  });
});
