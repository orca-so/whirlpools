import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { AdaptiveFeeConstantsData, AdaptiveFeeTierData, FeeTierData } from "../../../src";
import { AccountName, getAccountSize, PDAUtil, toTx, WhirlpoolContext, WhirlpoolIx } from "../../../src";
import { ONE_SOL, systemTransferTx, TickSpacing } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { initAdaptiveFeeTier, initFeeTier } from "../../utils/init-utils";
import {
  generateDefaultConfigParams,
  generateDefaultInitFeeTierParams,
  getDefaultPresetAdaptiveFeeConstants,
} from "../../utils/test-builders";
import { Keypair, PublicKey } from "@solana/web3.js";

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
      aft.tickGroupSize == constants.tickGroupSize
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
    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
    ).buildAndExecute();

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
    assert.ok(adaptiveFeeTierAccount.whirlpoolsConfig.equals(configInitInfo.whirlpoolsConfigKeypair.publicKey));
    assert.ok(adaptiveFeeTierAccount.feeTierIndex == feeTierIndex);
    assert.ok(adaptiveFeeTierAccount.tickSpacing == tickSpacing);
    assert.ok(adaptiveFeeTierAccount.initializePoolAuthority.equals(initializePoolAuthority));
    assert.ok(adaptiveFeeTierAccount.delegatedFeeAuthority.equals(delegatedFeeAuthority));
    assert.ok(adaptiveFeeTierAccount.defaultBaseFeeRate == defaultBaseFeeRate);
    assert.ok(equalsAdaptiveFeeConstants(adaptiveFeeTierAccount, presetAdaptiveFeeConstants));

    return result;
  }

  it("successfully init an adaptive fee tier account with normal base fee rate", async () => {
    const tickSpacing = 64;
    const feeTierIndex = 1024 + 64;
    const defaultBaseFeeRate = 3000;
    const initializePoolAuthority = PublicKey.default;
    const delegatedFeeAuthority = PublicKey.default;
    const presetAdaptiveFeeConstants = getDefaultPresetAdaptiveFeeConstants(tickSpacing);

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
    const presetAdaptiveFeeConstants = getDefaultPresetAdaptiveFeeConstants(tickSpacing);

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
    const presetAdaptiveFeeConstants = getDefaultPresetAdaptiveFeeConstants(tickSpacing);

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
    const presetAdaptiveFeeConstants = getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const preBalance = await provider.connection.getBalance(funderKeypair.publicKey);
    const requiredRent = await provider.connection.getMinimumBalanceForRentExemption(
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

    const postBalance = await provider.connection.getBalance(funderKeypair.publicKey);
    assert.ok(preBalance - postBalance == requiredRent);
  });

  it("fails when default base fee rate exceeds max", async () => {
    const tickSpacing = 128;
    const feeTierIndex = 1024 + 128;
    const defaultBaseFeeRate = 60_000 + 1;
    const initializePoolAuthority = PublicKey.default;
    const delegatedFeeAuthority = PublicKey.default;
    const presetAdaptiveFeeConstants = getDefaultPresetAdaptiveFeeConstants(tickSpacing);

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

  // failure case

  // whirlpools_config が異なる (PDA不一致)
  // fee_tier_index が異なる (PDA不一致)
  // fee_tier_index == tick_spacing
  // default_base_fee_rate が max を超える
  // constants が不正
  // すでに FeeTier が存在する
  // fee_authority が config にないもの
  // fee_authority が署名なし
  // funder が署名なし
  // system_program 誤り

/*

  it("fails when fee authority is not a signer", async () => {
    const { configInitInfo } = generateDefaultConfigParams(ctx);
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
    ).buildAndExecute();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.initializeFeeTierIx(
          ctx.program,
          generateDefaultInitFeeTierParams(
            ctx,
            configInitInfo.whirlpoolsConfigKeypair.publicKey,
            configInitInfo.feeAuthority,
            TickSpacing.Stable,
            3000,
          ),
        ),
      ).buildAndExecute(),
      /signature verification fail/i,
    );
  });

  it("fails when invalid fee authority provided", async () => {
    const { configInitInfo } = generateDefaultConfigParams(ctx);
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
    ).buildAndExecute();
    const fakeFeeAuthorityKeypair = anchor.web3.Keypair.generate();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.initializeFeeTierIx(
          ctx.program,
          generateDefaultInitFeeTierParams(
            ctx,
            configInitInfo.whirlpoolsConfigKeypair.publicKey,
            fakeFeeAuthorityKeypair.publicKey,
            TickSpacing.Stable,
            3000,
          ),
        ),
      )
        .addSigner(fakeFeeAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/, // ConstraintAddress
    );
  });
  */
});
