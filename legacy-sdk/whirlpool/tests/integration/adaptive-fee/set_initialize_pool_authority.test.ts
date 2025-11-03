import * as assert from "assert";
import type { WhirlpoolContext } from "../../../src";
import { IGNORE_CACHE, PDAUtil, toTx, WhirlpoolIx } from "../../../src";
import { dropIsSignerFlag, initializeLiteSVMEnvironment } from "../../utils";
import { pollForCondition } from "../../utils/litesvm";
import {
  initAdaptiveFeeTier,
  initializeConfigWithDefaultConfigParams,
} from "../../utils/init-utils";
import { getDefaultPresetAdaptiveFeeConstants } from "../../utils/test-builders";
import { Keypair, PublicKey } from "@solana/web3.js";

describe("set_initialize_pool_authority", () => {
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  const tickSpacing = 64;
  const feeTierIndex = 1024 + tickSpacing;

  it("successfully set_initialize_pool_authority (permission-less to permissioned)", async () => {
    const initialInitializePoolAuthority = PublicKey.default;
    const newInitializePoolAuthority = Keypair.generate().publicKey;

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
      initialInitializePoolAuthority,
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    const preAdaptiveFeeTierAccount = await fetcher.getAdaptiveFeeTier(
      adaptiveFeeTierPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(preAdaptiveFeeTierAccount);
    assert.ok(
      preAdaptiveFeeTierAccount.initializePoolAuthority.equals(
        initialInitializePoolAuthority,
      ),
    );

    await toTx(
      ctx,
      WhirlpoolIx.setInitializePoolAuthorityIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
        feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
        newInitializePoolAuthority,
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
      (aft) => aft.initializePoolAuthority.equals(newInitializePoolAuthority),
      { maxRetries: 50, delayMs: 10 },
    );
    assert.ok(postAdaptiveFeeTierAccount);
    assert.ok(
      postAdaptiveFeeTierAccount.initializePoolAuthority.equals(
        newInitializePoolAuthority,
      ),
    );
  });

  it("successfully set_initialize_pool_authority (permissioned to permission-less)", async () => {
    const initialInitializePoolAuthority = Keypair.generate().publicKey;
    const newInitializePoolAuthority = PublicKey.default;

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
      initialInitializePoolAuthority,
    );
    const adaptiveFeeTierPda = params.feeTierPda;

    const preAdaptiveFeeTierAccount = await fetcher.getAdaptiveFeeTier(
      adaptiveFeeTierPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(preAdaptiveFeeTierAccount);
    assert.ok(
      preAdaptiveFeeTierAccount.initializePoolAuthority.equals(
        initialInitializePoolAuthority,
      ),
    );

    await toTx(
      ctx,
      WhirlpoolIx.setInitializePoolAuthorityIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
        feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
        newInitializePoolAuthority,
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
      (aft) => aft.initializePoolAuthority.equals(newInitializePoolAuthority),
      { maxRetries: 50, delayMs: 10 },
    );
    assert.ok(postAdaptiveFeeTierAccount);
    assert.ok(
      postAdaptiveFeeTierAccount.initializePoolAuthority.equals(
        newInitializePoolAuthority,
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
        WhirlpoolIx.setInitializePoolAuthorityIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
          feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
          newInitializePoolAuthority: Keypair.generate().publicKey,
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

    const ix = WhirlpoolIx.setInitializePoolAuthorityIx(ctx.program, {
      whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
      adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
      feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
      newInitializePoolAuthority: Keypair.generate().publicKey,
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
        WhirlpoolIx.setInitializePoolAuthorityIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          adaptiveFeeTier: adaptiveFeeTierPda.publicKey,
          feeAuthority: fakeFeeAuthorityKeypair.publicKey,
          newInitializePoolAuthority: Keypair.generate().publicKey,
        }),
      )
        .addSigner(fakeFeeAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/, // ConstraintAddress
    );
  });
});
