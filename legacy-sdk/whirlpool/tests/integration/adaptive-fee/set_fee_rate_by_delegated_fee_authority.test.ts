import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import { PDAUtil, toTx, WhirlpoolContext, WhirlpoolIx } from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { dropIsSignerFlag, TickSpacing } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { getDefaultPresetAdaptiveFeeConstants } from "../../utils/test-builders";
import { initTestPoolWithAdaptiveFee } from "../../utils/v2/init-utils-v2";
import { MathUtil } from "@orca-so/common-sdk";
import Decimal from "decimal.js";
import { Keypair, PublicKey } from "@solana/web3.js";

describe("set_fee_rate_by_delegated_fee_authority", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  const delegatedFeeAuthorityKeypair = Keypair.generate();

  const defaultBaseFeeRate = 10_000;

  const price = MathUtil.toX64(new Decimal(5));
  const tickSpacing = TickSpacing.Standard;
  const feeTierIndex = 1024 + tickSpacing;

  it("successfully sets_fee_rate_by_delegated_fee_authority", async () => {
    const newFeeRate = 20_000;

    const { poolInitInfo, feeTierParams } = await initTestPoolWithAdaptiveFee(
      ctx,
      { isToken2022: true },
      { isToken2022: false },
      feeTierIndex,
      tickSpacing,
      defaultBaseFeeRate,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
      undefined,
      delegatedFeeAuthorityKeypair.publicKey,
      price,
    );

    let adaptiveFeeTierData = await fetcher.getAdaptiveFeeTier(
      feeTierParams.feeTierPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(adaptiveFeeTierData);
    assert.ok(adaptiveFeeTierData.defaultBaseFeeRate === defaultBaseFeeRate);
    assert.ok(
      adaptiveFeeTierData.delegatedFeeAuthority.equals(
        delegatedFeeAuthorityKeypair.publicKey,
      ),
    );

    let preWhirlpoolData = await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(preWhirlpoolData);
    assert.equal(preWhirlpoolData.feeRate, defaultBaseFeeRate);

    await toTx(
      ctx,
      WhirlpoolIx.setFeeRateByDelegatedFeeAuthorityIx(program, {
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        adaptiveFeeTier: feeTierParams.feeTierPda.publicKey,
        delegatedFeeAuthority: delegatedFeeAuthorityKeypair.publicKey,
        feeRate: newFeeRate,
      }),
    )
      .addSigner(delegatedFeeAuthorityKeypair)
      .buildAndExecute();

    let postWhirlpoolData = await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(postWhirlpoolData);
    assert.equal(postWhirlpoolData.feeRate, newFeeRate);
  });

  it("successfully sets_fee_rate_by_delegated_fee_authority max", async () => {
    const newFeeRate = 60_000;

    const { poolInitInfo, feeTierParams } = await initTestPoolWithAdaptiveFee(
      ctx,
      { isToken2022: true },
      { isToken2022: false },
      feeTierIndex,
      tickSpacing,
      defaultBaseFeeRate,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
      undefined,
      delegatedFeeAuthorityKeypair.publicKey,
      price,
    );

    let adaptiveFeeTierData = await fetcher.getAdaptiveFeeTier(
      feeTierParams.feeTierPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(adaptiveFeeTierData);
    assert.ok(adaptiveFeeTierData.defaultBaseFeeRate === defaultBaseFeeRate);
    assert.ok(
      adaptiveFeeTierData.delegatedFeeAuthority.equals(
        delegatedFeeAuthorityKeypair.publicKey,
      ),
    );

    let preWhirlpoolData = await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(preWhirlpoolData);
    assert.equal(preWhirlpoolData.feeRate, defaultBaseFeeRate);

    await toTx(
      ctx,
      WhirlpoolIx.setFeeRateByDelegatedFeeAuthorityIx(program, {
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        adaptiveFeeTier: feeTierParams.feeTierPda.publicKey,
        delegatedFeeAuthority: delegatedFeeAuthorityKeypair.publicKey,
        feeRate: newFeeRate,
      }),
    )
      .addSigner(delegatedFeeAuthorityKeypair)
      .buildAndExecute();

    let postWhirlpoolData = await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(postWhirlpoolData);
    assert.equal(postWhirlpoolData.feeRate, newFeeRate);
  });

  it("fails when fee rate exceeds max", async () => {
    const newFeeRate = 60_000 + 1;

    const { poolInitInfo, feeTierParams } = await initTestPoolWithAdaptiveFee(
      ctx,
      { isToken2022: true },
      { isToken2022: false },
      feeTierIndex,
      tickSpacing,
      defaultBaseFeeRate,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
      undefined,
      delegatedFeeAuthorityKeypair.publicKey,
      price,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setFeeRateByDelegatedFeeAuthorityIx(program, {
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          adaptiveFeeTier: feeTierParams.feeTierPda.publicKey,
          delegatedFeeAuthority: delegatedFeeAuthorityKeypair.publicKey,
          feeRate: newFeeRate,
        }),
      )
        .addSigner(delegatedFeeAuthorityKeypair)
        .buildAndExecute(),
      /0x178c/, // FeeRateMaxExceeded
    );
  });

  it("fails when delegated fee authority is not signer", async () => {
    const newFeeRate = 20_000;

    const { poolInitInfo, feeTierParams } = await initTestPoolWithAdaptiveFee(
      ctx,
      { isToken2022: true },
      { isToken2022: false },
      feeTierIndex,
      tickSpacing,
      defaultBaseFeeRate,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
      undefined,
      delegatedFeeAuthorityKeypair.publicKey,
      price,
    );

    const ix = WhirlpoolIx.setFeeRateByDelegatedFeeAuthorityIx(program, {
      whirlpool: poolInitInfo.whirlpoolPda.publicKey,
      adaptiveFeeTier: feeTierParams.feeTierPda.publicKey,
      delegatedFeeAuthority: delegatedFeeAuthorityKeypair.publicKey,
      feeRate: newFeeRate,
    });
    const ixWithoutSigner = dropIsSignerFlag(
      ix.instructions[0],
      delegatedFeeAuthorityKeypair.publicKey,
    );

    await assert.rejects(
      toTx(ctx, {
        instructions: [ixWithoutSigner],
        cleanupInstructions: [],
        signers: [],
      }).buildAndExecute(),
      /0xbc2/, // AccountNotSigner
    );
  });

  it("fails when delegated fee authority is invalid", async () => {
    const newFeeRate = 20_000;

    const { poolInitInfo, feeTierParams } = await initTestPoolWithAdaptiveFee(
      ctx,
      { isToken2022: true },
      { isToken2022: false },
      feeTierIndex,
      tickSpacing,
      defaultBaseFeeRate,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
      undefined,
      delegatedFeeAuthorityKeypair.publicKey,
      price,
    );

    const fakeDelegatedFeeAuthorityKeypair = Keypair.generate();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setFeeRateByDelegatedFeeAuthorityIx(program, {
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          adaptiveFeeTier: feeTierParams.feeTierPda.publicKey,
          delegatedFeeAuthority: fakeDelegatedFeeAuthorityKeypair.publicKey,
          feeRate: newFeeRate,
        }),
      )
        .addSigner(fakeDelegatedFeeAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/, // ConstraintAddress
    );
  });

  it("fails when delegated fee authority is not set", async () => {
    const newFeeRate = 20_000;

    const notDelegated = PublicKey.default;

    const { poolInitInfo, feeTierParams } = await initTestPoolWithAdaptiveFee(
      ctx,
      { isToken2022: true },
      { isToken2022: false },
      feeTierIndex,
      tickSpacing,
      defaultBaseFeeRate,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
      undefined,
      notDelegated,
      price,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setFeeRateByDelegatedFeeAuthorityIx(program, {
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          adaptiveFeeTier: feeTierParams.feeTierPda.publicKey,
          delegatedFeeAuthority: delegatedFeeAuthorityKeypair.publicKey,
          feeRate: newFeeRate,
        }),
      )
        .addSigner(delegatedFeeAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/, // ConstraintAddress
    );
  });

  it("fails when AdaptiveFeeTier is invalid (whirlpools config don't match)", async () => {
    const newFeeRate = 20_000;

    const { poolInitInfo } = await initTestPoolWithAdaptiveFee(
      ctx,
      { isToken2022: true },
      { isToken2022: false },
      feeTierIndex,
      tickSpacing,
      defaultBaseFeeRate,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
      undefined,
      delegatedFeeAuthorityKeypair.publicKey,
      price,
    );

    const { feeTierParams: anotherFeeTierParams } =
      await initTestPoolWithAdaptiveFee(
        ctx,
        { isToken2022: true },
        { isToken2022: false },
        feeTierIndex,
        tickSpacing,
        defaultBaseFeeRate,
        getDefaultPresetAdaptiveFeeConstants(tickSpacing),
        undefined,
        delegatedFeeAuthorityKeypair.publicKey,
        price,
      );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setFeeRateByDelegatedFeeAuthorityIx(program, {
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          adaptiveFeeTier: anotherFeeTierParams.feeTierPda.publicKey, // unmatch (whirlpool.whirlpools_config != adaptive_fee_tier.whirlpools_config)
          delegatedFeeAuthority: delegatedFeeAuthorityKeypair.publicKey,
          feeRate: newFeeRate,
        }),
      )
        .addSigner(delegatedFeeAuthorityKeypair)
        .buildAndExecute(),
      /0x7d3/, // ConstraintRaw
    );
  });

  it("fails when AdaptiveFeeTier is invalid (fee tier index don't match)", async () => {
    const newFeeRate = 20_000;

    const constants = getDefaultPresetAdaptiveFeeConstants(tickSpacing);
    const { poolInitInfo, configKeypairs } = await initTestPoolWithAdaptiveFee(
      ctx,
      { isToken2022: true },
      { isToken2022: false },
      feeTierIndex,
      tickSpacing,
      defaultBaseFeeRate,
      constants,
      undefined,
      delegatedFeeAuthorityKeypair.publicKey,
      price,
    );

    const anotherFeeTierIndex = feeTierIndex + 1;
    const anotherAdaptiveFeeTierPda = PDAUtil.getFeeTier(
      program.programId,
      poolInitInfo.whirlpoolsConfig,
      anotherFeeTierIndex,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initializeAdaptiveFeeTierIx(program, {
        whirlpoolsConfig: poolInitInfo.whirlpoolsConfig,
        feeTierPda: anotherAdaptiveFeeTierPda,
        funder: ctx.wallet.publicKey,
        feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
        feeTierIndex: anotherFeeTierIndex,
        tickSpacing: tickSpacing,
        defaultBaseFeeRate: defaultBaseFeeRate,
        presetFilterPeriod: constants.filterPeriod,
        presetDecayPeriod: constants.decayPeriod,
        presetReductionFactor: constants.reductionFactor,
        presetAdaptiveFeeControlFactor: constants.adaptiveFeeControlFactor,
        presetMaxVolatilityAccumulator: constants.maxVolatilityAccumulator,
        presetTickGroupSize: constants.tickGroupSize,
      }),
    )
      .addSigner(configKeypairs.feeAuthorityKeypair)
      .buildAndExecute();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setFeeRateByDelegatedFeeAuthorityIx(program, {
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          adaptiveFeeTier: anotherAdaptiveFeeTierPda.publicKey, // unmatch (whirlpool.fee_tier_index() != adaptive_fee_tier.fee_tier_index)
          delegatedFeeAuthority: delegatedFeeAuthorityKeypair.publicKey,
          feeRate: newFeeRate,
        }),
      )
        .addSigner(delegatedFeeAuthorityKeypair)
        .buildAndExecute(),
      /0x7d3/, // ConstraintRaw
    );
  });

  it("fails when Whirlpool is not initialized with adaptive fee", async () => {
    const newFeeRate = 20_000;

    const constants = getDefaultPresetAdaptiveFeeConstants(tickSpacing);
    const { poolInitInfo, configKeypairs, feeTierParams } =
      await initTestPoolWithAdaptiveFee(
        ctx,
        { isToken2022: false },
        { isToken2022: false },
        feeTierIndex,
        tickSpacing,
        defaultBaseFeeRate,
        constants,
        undefined,
        delegatedFeeAuthorityKeypair.publicKey,
        price,
      );

    const anotherTickSpacing = 256;
    const anotherFeeTierIndex = 256;
    const anotherAdaptiveFeeTierPda = PDAUtil.getFeeTier(
      program.programId,
      poolInitInfo.whirlpoolsConfig,
      anotherFeeTierIndex,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initializeFeeTierIx(program, {
        whirlpoolsConfig: poolInitInfo.whirlpoolsConfig,
        feeTierPda: anotherAdaptiveFeeTierPda,
        funder: ctx.wallet.publicKey,
        feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
        tickSpacing: anotherTickSpacing,
        defaultFeeRate: defaultBaseFeeRate,
      }),
    )
      .addSigner(configKeypairs.feeAuthorityKeypair)
      .buildAndExecute();

    const anotherWhirlpoolPda = PDAUtil.getWhirlpool(
      program.programId,
      poolInitInfo.whirlpoolsConfig,
      poolInitInfo.tokenMintA,
      poolInitInfo.tokenMintB,
      anotherFeeTierIndex,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initializePoolIx(program, {
        whirlpoolsConfig: poolInitInfo.whirlpoolsConfig,
        feeTierKey: anotherAdaptiveFeeTierPda.publicKey,
        funder: ctx.wallet.publicKey,
        initSqrtPrice: price,
        tickSpacing: anotherTickSpacing,
        tokenMintA: poolInitInfo.tokenMintA,
        tokenMintB: poolInitInfo.tokenMintB,
        tokenVaultAKeypair: Keypair.generate(),
        tokenVaultBKeypair: Keypair.generate(),
        whirlpoolPda: anotherWhirlpoolPda,
      }),
    ).buildAndExecute();

    const anotherWhirlpool = await fetcher.getPool(
      anotherWhirlpoolPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(anotherWhirlpool);
    assert.ok(
      anotherWhirlpool.feeTierIndexSeed[0] +
        anotherWhirlpool.feeTierIndexSeed[1] * 256 ===
        anotherFeeTierIndex,
    );
    assert.ok(
      anotherWhirlpool.feeTierIndexSeed[0] +
        anotherWhirlpool.feeTierIndexSeed[1] * 256 ===
        anotherTickSpacing,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setFeeRateByDelegatedFeeAuthorityIx(program, {
          whirlpool: anotherWhirlpoolPda.publicKey, // Whirlpool without adaptive fee
          adaptiveFeeTier: feeTierParams.feeTierPda.publicKey,
          delegatedFeeAuthority: delegatedFeeAuthorityKeypair.publicKey,
          feeRate: newFeeRate,
        }),
      )
        .addSigner(delegatedFeeAuthorityKeypair)
        .buildAndExecute(),
      /0x7d3/, // ConstraintRaw
    );
  });
});
