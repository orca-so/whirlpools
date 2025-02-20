import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import {
  IGNORE_CACHE,
  PDAUtil,
  toTx,
  WhirlpoolContext,
  WhirlpoolIx,
} from "../../../src";
import { dropIsSignerFlag } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { initAdaptiveFeeTier } from "../../utils/init-utils";
import {
  generateDefaultConfigParams,
  getDefaultPresetAdaptiveFeeConstants,
} from "../../utils/test-builders";
import { Keypair, PublicKey } from "@solana/web3.js";

describe("set_delegated_fee_authority", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  const tickSpacing = 64;
  const feeTierIndex = 1024 + tickSpacing;

  it("successfully set_delegated_fee_authority (not delegated to delegated)", async () => {
    const initialDelegatedFeeAuthority = PublicKey.default;
    const newDelegatedFeeAuthority = Keypair.generate().publicKey;

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
      3000,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
      undefined,
      initialDelegatedFeeAuthority,
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    const preAdaptiveFeeTierAccount = await fetcher.getAdaptiveFeeTier(
      adaptiveFeeTierPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(preAdaptiveFeeTierAccount);
    assert.ok(
      preAdaptiveFeeTierAccount.delegatedFeeAuthority.equals(
        initialDelegatedFeeAuthority,
      ),
    );

    await toTx(
      ctx,
      WhirlpoolIx.setDelegatedFeeAuthorityIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
        feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
        newDelegatedFeeAuthority: newDelegatedFeeAuthority,
      }),
    )
      .addSigner(configKeypairs.feeAuthorityKeypair)
      .buildAndExecute();

    const postAdaptiveFeeTierAccount = await fetcher.getAdaptiveFeeTier(
      adaptiveFeeTierPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(postAdaptiveFeeTierAccount);
    assert.ok(
      postAdaptiveFeeTierAccount.delegatedFeeAuthority.equals(
        newDelegatedFeeAuthority,
      ),
    );
  });

  it("successfully set_delegated_fee_authority (delegated to not delegated)", async () => {
    const initialDelegatedFeeAuthority = Keypair.generate().publicKey;
    const newDelegatedFeeAuthority = PublicKey.default;

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
      3000,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
      undefined,
      initialDelegatedFeeAuthority,
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    const preAdaptiveFeeTierAccount = await fetcher.getAdaptiveFeeTier(
      adaptiveFeeTierPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(preAdaptiveFeeTierAccount);
    assert.ok(
      preAdaptiveFeeTierAccount.delegatedFeeAuthority.equals(
        initialDelegatedFeeAuthority,
      ),
    );

    await toTx(
      ctx,
      WhirlpoolIx.setDelegatedFeeAuthorityIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
        feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
        newDelegatedFeeAuthority: newDelegatedFeeAuthority,
      }),
    )
      .addSigner(configKeypairs.feeAuthorityKeypair)
      .buildAndExecute();

    const postAdaptiveFeeTierAccount = await fetcher.getAdaptiveFeeTier(
      adaptiveFeeTierPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(postAdaptiveFeeTierAccount);
    assert.ok(
      postAdaptiveFeeTierAccount.delegatedFeeAuthority.equals(
        newDelegatedFeeAuthority,
      ),
    );
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
        WhirlpoolIx.setDelegatedFeeAuthorityIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
          feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
          newDelegatedFeeAuthority: Keypair.generate().publicKey,
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
      3000,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    const ix = WhirlpoolIx.setDelegatedFeeAuthorityIx(ctx.program, {
      whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
      adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
      feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
      newDelegatedFeeAuthority: Keypair.generate().publicKey,
    });
    const ixWithoutSigner = dropIsSignerFlag(
      ix.instructions[0],
      configKeypairs.feeAuthorityKeypair.publicKey,
    );

    await assert.rejects(
      toTx(ctx, {
        instructions: [ixWithoutSigner],
        cleanupInstructions: [],
        signers: [],
      })
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
      3000,
      getDefaultPresetAdaptiveFeeConstants(tickSpacing),
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    const fakeFeeAuthorityKeypair = Keypair.generate();
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setDelegatedFeeAuthorityIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
          feeAuthority: fakeFeeAuthorityKeypair.publicKey,
          newDelegatedFeeAuthority: Keypair.generate().publicKey,
        }),
      )
        .addSigner(fakeFeeAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/, // ConstraintAddress
    );
  });
});
