import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { InitPoolParams, InitPoolWithAdaptiveFeeParams, WhirlpoolData } from "../../../src";
import { IGNORE_CACHE, PDAUtil, PriceMath, toTx, WhirlpoolContext, WhirlpoolIx } from "../../../src";
import { dropIsSignerFlag, TickSpacing } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { initAdaptiveFeeTier, initTestPool } from "../../utils/init-utils";
import {
  createInOrderMints,
  generateDefaultConfigParams,
  getDefaultPresetAdaptiveFeeConstants,
} from "../../utils/test-builders";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { C } from "vitest/dist/chunks/reporters.6vxQttCV";
import { Keypair } from "@solana/web3.js";

describe("set_default_base_fee_rate", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  it("successfully set_default_base_fee_rate", async () => {
    const initialDefaultBaseFeeRate = 5_000;
    const newDefaultBaseFeeRate = 10_000;

    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
    ).buildAndExecute();

    const tickSpacing = 64;
    const feeTierIndex = 1024 + tickSpacing;

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      initialDefaultBaseFeeRate,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    const preAdaptiveFeeTierAccount = await fetcher.getAdaptiveFeeTier(
      adaptiveFeeTierPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(preAdaptiveFeeTierAccount);
    assert.ok(preAdaptiveFeeTierAccount.defaultBaseFeeRate === initialDefaultBaseFeeRate);

    await toTx(
      ctx,
      WhirlpoolIx.setDefaultBaseFeeRateIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
        feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
        defaultBaseFeeRate: newDefaultBaseFeeRate,
      }),
    )
    .addSigner(configKeypairs.feeAuthorityKeypair)
    .buildAndExecute();

    const postAdaptiveFeeTierAccount = await fetcher.getAdaptiveFeeTier(
      adaptiveFeeTierPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(postAdaptiveFeeTierAccount);
    assert.ok(postAdaptiveFeeTierAccount.defaultBaseFeeRate === newDefaultBaseFeeRate);

    // Newly initialized whirlpools have new default base fee rate
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
      oraclePda: PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey),
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
    assert.ok(whirlpool.feeRate === newDefaultBaseFeeRate);
  });

  it("successfully set_default_base_fee_rate max", async () => {
    const initialDefaultBaseFeeRate = 5_000;
    const newDefaultBaseFeeRate = 60_000;

    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
    ).buildAndExecute();

    const tickSpacing = 64;
    const feeTierIndex = 1024 + tickSpacing;

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      initialDefaultBaseFeeRate,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    const preAdaptiveFeeTierAccount = await fetcher.getAdaptiveFeeTier(
      adaptiveFeeTierPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(preAdaptiveFeeTierAccount);
    assert.ok(preAdaptiveFeeTierAccount.defaultBaseFeeRate === initialDefaultBaseFeeRate);

    await toTx(
      ctx,
      WhirlpoolIx.setDefaultBaseFeeRateIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
        feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
        defaultBaseFeeRate: newDefaultBaseFeeRate,
      }),
    )
    .addSigner(configKeypairs.feeAuthorityKeypair)
    .buildAndExecute();

    const postAdaptiveFeeTierAccount = await fetcher.getAdaptiveFeeTier(
      adaptiveFeeTierPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(postAdaptiveFeeTierAccount);
    assert.ok(postAdaptiveFeeTierAccount.defaultBaseFeeRate === newDefaultBaseFeeRate);
  });

  it("fails when default base fee rate exceeds max", async () => {
    const initialDefaultBaseFeeRate = 5_000;
    const newDefaultBaseFeeRate = 60_000 + 1;

    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
    ).buildAndExecute();

    const tickSpacing = 64;
    const feeTierIndex = 1024 + tickSpacing;

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      initialDefaultBaseFeeRate,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setDefaultBaseFeeRateIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
          feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
          defaultBaseFeeRate: newDefaultBaseFeeRate,
        }),
      )
      .addSigner(configKeypairs.feeAuthorityKeypair)
      .buildAndExecute(),
        /0x178c/, // FeeRateMaxExceeded
    );
  });

  it("fails when adaptive fee tier account has not been initialized", async () => {
    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
    ).buildAndExecute();

    const feeTierIndex = 1024 + 64;
    const adaptiveFeeTierPda = PDAUtil.getFeeTier(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      feeTierIndex,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setDefaultBaseFeeRateIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
          feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
          defaultBaseFeeRate: 500,
        }),
      )
        .addSigner(configKeypairs.feeAuthorityKeypair)
        .buildAndExecute(),
      /0xbc4/, // AccountNotInitialized
    );
  });

  it("fails when fee authority is not a signer", async () => {
    const initialDefaultBaseFeeRate = 5_000;
    const newDefaultBaseFeeRate = 10_000;

    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
    ).buildAndExecute();

    const tickSpacing = 64;
    const feeTierIndex = 1024 + tickSpacing;

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      initialDefaultBaseFeeRate,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    const ix =       WhirlpoolIx.setDefaultBaseFeeRateIx(ctx.program, {
      whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
      adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
      feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
      defaultBaseFeeRate: newDefaultBaseFeeRate,
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
    const initialDefaultBaseFeeRate = 5_000;
    const newDefaultBaseFeeRate = 10_000;

    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(ctx);
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo),
    ).buildAndExecute();

    const tickSpacing = 64;
    const feeTierIndex = 1024 + tickSpacing;

    const { params } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      initialDefaultBaseFeeRate,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
    );
    const adaptiveFeeTierPda = params.feeTierPda;
    
    const fakeFeeAuthorityKeypair = Keypair.generate();
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setDefaultBaseFeeRateIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
          feeAuthority: fakeFeeAuthorityKeypair.publicKey,
          defaultBaseFeeRate: newDefaultBaseFeeRate,
        })
            )
      .addSigner(fakeFeeAuthorityKeypair)
      .buildAndExecute(),
      /0x7dc/, // ConstraintAddress
    );
  });
});
