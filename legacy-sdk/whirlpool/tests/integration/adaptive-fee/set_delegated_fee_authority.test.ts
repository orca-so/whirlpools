import * as assert from "assert";
import type { WhirlpoolContext } from "../../../src";
import { IGNORE_CACHE, PDAUtil, toTx, WhirlpoolIx } from "../../../src";
import { dropIsSignerFlag } from "../../utils";
import { initializeLiteSVMEnvironment, pollForCondition } from "../../utils/litesvm";
import {
  initAdaptiveFeeTier,
  initializeConfigWithDefaultConfigParams,
} from "../../utils/init-utils";
import { getDefaultPresetAdaptiveFeeConstants } from "../../utils/test-builders";
import { Keypair, PublicKey } from "@solana/web3.js";

describe("set_delegated_fee_authority", () => {
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  const tickSpacing = 64;
  const feeTierIndex = 1024 + tickSpacing;

  it("successfully set_delegated_fee_authority (not delegated to delegated)", async () => {
    const initialDelegatedFeeAuthority = PublicKey.default;
    const newDelegatedFeeAuthority = Keypair.generate().publicKey;

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

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

    const postAdaptiveFeeTierAccount = await pollForCondition(
      async () =>
        (await fetcher.getAdaptiveFeeTier(
          adaptiveFeeTierPda.publicKey,
          IGNORE_CACHE,
        ))!,
      (aft) => aft.delegatedFeeAuthority.equals(newDelegatedFeeAuthority),
      { maxRetries: 50, delayMs: 10 },
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

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

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

    const postAdaptiveFeeTierAccount = await pollForCondition(
      async () =>
        (await fetcher.getAdaptiveFeeTier(
          adaptiveFeeTierPda.publicKey,
          IGNORE_CACHE,
        ))!,
      (aft) => aft.delegatedFeeAuthority.equals(newDelegatedFeeAuthority),
      { maxRetries: 50, delayMs: 10 },
    );
    assert.ok(postAdaptiveFeeTierAccount);
    assert.ok(
      postAdaptiveFeeTierAccount.delegatedFeeAuthority.equals(
        newDelegatedFeeAuthority,
      ),
    );
  });

  it("fails when adaptive fee tier account has not been initialized", async () => {
    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

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
    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

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
    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

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
