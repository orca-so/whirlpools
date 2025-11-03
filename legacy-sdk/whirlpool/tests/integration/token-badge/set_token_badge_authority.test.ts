import type * as anchor from "@coral-xyz/anchor";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import * as assert from "assert";
import type { WhirlpoolContext } from "../../../src";
import { IGNORE_CACHE, PDAUtil, toTx, WhirlpoolIx } from "../../../src";
import type { InitializeTokenBadgeParams } from "../../../dist/instructions";
import { createMintV2 } from "../../utils/v2/token-2022";
import { getLocalnetAdminKeypair0 } from "../../utils";
import {
  initializeLiteSVMEnvironment,
  pollForCondition,
} from "../../utils/litesvm";

describe("set_token_badge_authority", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    program = env.program;
    fetcher = env.fetcher;
  });

  const collectProtocolFeesAuthorityKeypair = Keypair.generate();
  const feeAuthorityKeypair = Keypair.generate();
  const rewardEmissionsSuperAuthorityKeypair = Keypair.generate();
  const initialConfigExtensionAuthorityKeypair = feeAuthorityKeypair;
  const initialTokenBadgeAuthorityKeypair = feeAuthorityKeypair;
  const updatedTokenBadgeAuthorityKeypair = Keypair.generate();

  async function initializeWhirlpoolsConfig(configKeypair: Keypair) {
    const admin = await getLocalnetAdminKeypair0(ctx);
    const initConfigTx = toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, {
        collectProtocolFeesAuthority:
          collectProtocolFeesAuthorityKeypair.publicKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        rewardEmissionsSuperAuthority:
          rewardEmissionsSuperAuthorityKeypair.publicKey,
        defaultProtocolFeeRate: 300,
        funder: admin.publicKey,
        whirlpoolsConfigKeypair: configKeypair,
      }),
    );
    initConfigTx.addInstruction(
      WhirlpoolIx.setConfigFeatureFlagIx(ctx.program, {
        whirlpoolsConfig: configKeypair.publicKey,
        authority: admin.publicKey,
        featureFlag: {
          tokenBadge: [true],
        },
      }),
    );

    return initConfigTx
      .addSigner(admin)
      .addSigner(configKeypair)
      .buildAndExecute();
  }

  async function initializeWhirlpoolsConfigExtension(config: PublicKey) {
    const pda = PDAUtil.getConfigExtension(ctx.program.programId, config);
    return toTx(
      ctx,
      WhirlpoolIx.initializeConfigExtensionIx(ctx.program, {
        feeAuthority: feeAuthorityKeypair.publicKey,
        funder: provider.wallet.publicKey,
        whirlpoolsConfig: config,
        whirlpoolsConfigExtensionPda: pda,
      }),
    )
      .addSigner(feeAuthorityKeypair)
      .buildAndExecute();
  }

  async function initializeTokenBadge(
    config: PublicKey,
    mint: PublicKey,
    overwrite: Partial<InitializeTokenBadgeParams>,
    signers: Keypair[] = [initialTokenBadgeAuthorityKeypair],
  ) {
    const whirlpoolsConfigExtension = PDAUtil.getConfigExtension(
      ctx.program.programId,
      config,
    ).publicKey;
    const tokenBadgePda = PDAUtil.getTokenBadge(
      ctx.program.programId,
      config,
      mint,
    );
    const tx = toTx(
      ctx,
      WhirlpoolIx.initializeTokenBadgeIx(ctx.program, {
        whirlpoolsConfig: config,
        whirlpoolsConfigExtension,
        funder: provider.wallet.publicKey,
        tokenBadgeAuthority: initialTokenBadgeAuthorityKeypair.publicKey,
        tokenBadgePda,
        tokenMint: mint,
        ...overwrite,
      }),
    );
    signers.forEach((signer) => tx.addSigner(signer));
    return tx.buildAndExecute();
  }

  async function setTokenBadgeAuthority(
    config: PublicKey,
    configExtensionAuthority: Keypair,
    newAuthority: PublicKey,
  ) {
    const whirlpoolsConfigExtension = PDAUtil.getConfigExtension(
      ctx.program.programId,
      config,
    ).publicKey;
    return toTx(
      ctx,
      WhirlpoolIx.setTokenBadgeAuthorityIx(ctx.program, {
        whirlpoolsConfig: config,
        whirlpoolsConfigExtension,
        configExtensionAuthority: configExtensionAuthority.publicKey,
        newTokenBadgeAuthority: newAuthority,
      }),
    )
      .addSigner(configExtensionAuthority)
      .buildAndExecute();
  }

  it("successfully set token badge authority and verify updated account contents", async () => {
    const whirlpoolsConfigKeypair = Keypair.generate();
    await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
    await initializeWhirlpoolsConfigExtension(
      whirlpoolsConfigKeypair.publicKey,
    );

    const whirlpoolsConfigExtension = PDAUtil.getConfigExtension(
      ctx.program.programId,
      whirlpoolsConfigKeypair.publicKey,
    ).publicKey;
    const extensionData = await fetcher.getConfigExtension(
      whirlpoolsConfigExtension,
      IGNORE_CACHE,
    );
    assert.ok(
      extensionData!.tokenBadgeAuthority.equals(
        initialTokenBadgeAuthorityKeypair.publicKey,
      ),
    );

    assert.ok(
      !initialTokenBadgeAuthorityKeypair.publicKey.equals(
        updatedTokenBadgeAuthorityKeypair.publicKey,
      ),
    );
    await setTokenBadgeAuthority(
      whirlpoolsConfigKeypair.publicKey,
      initialConfigExtensionAuthorityKeypair,
      updatedTokenBadgeAuthorityKeypair.publicKey,
    );

    const updatedExtensionData = await pollForCondition(
      () => fetcher.getConfigExtension(whirlpoolsConfigExtension, IGNORE_CACHE),
      (ext) =>
        !!ext &&
        ext.tokenBadgeAuthority.equals(
          updatedTokenBadgeAuthorityKeypair.publicKey,
        ),
      {
        accountToReload: whirlpoolsConfigExtension,
        connection: ctx.connection,
      },
    );
    assert.ok(
      updatedExtensionData!.tokenBadgeAuthority.equals(
        updatedTokenBadgeAuthorityKeypair.publicKey,
      ),
    );

    // initialize TokenBadge with updated authority
    const mint = await createMintV2(provider, { isToken2022: true });
    await initializeTokenBadge(
      whirlpoolsConfigKeypair.publicKey,
      mint,
      {
        tokenBadgeAuthority: updatedTokenBadgeAuthorityKeypair.publicKey,
      },
      [updatedTokenBadgeAuthorityKeypair],
    );

    const tokenBadgePda = PDAUtil.getTokenBadge(
      ctx.program.programId,
      whirlpoolsConfigKeypair.publicKey,
      mint,
    );
    const tokenBadgeData = await fetcher.getTokenBadge(
      tokenBadgePda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(
      tokenBadgeData!.whirlpoolsConfig.equals(
        whirlpoolsConfigKeypair.publicKey,
      ),
    );
    assert.ok(tokenBadgeData!.tokenMint.equals(mint));
  });

  describe("invalid input account", () => {
    it("should be failed: invalid whirlpools_config", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );
      const whirlpoolsConfigExtension = PDAUtil.getConfigExtension(
        ctx.program.programId,
        whirlpoolsConfigKeypair.publicKey,
      ).publicKey;

      // config not initialized
      const anotherWhirlpoolsConfigKeypair = Keypair.generate();
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.setTokenBadgeAuthorityIx(ctx.program, {
            whirlpoolsConfig: anotherWhirlpoolsConfigKeypair.publicKey,
            whirlpoolsConfigExtension,
            configExtensionAuthority:
              initialConfigExtensionAuthorityKeypair.publicKey,
            newTokenBadgeAuthority: updatedTokenBadgeAuthorityKeypair.publicKey,
          }),
        )
          .addSigner(initialTokenBadgeAuthorityKeypair)
          .buildAndExecute(),
        /0xbc4/, // AccountNotInitialized
      );

      // config initialized, but not match to whirlpools_config_extension
      await initializeWhirlpoolsConfig(anotherWhirlpoolsConfigKeypair);
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.setTokenBadgeAuthorityIx(ctx.program, {
            whirlpoolsConfig: anotherWhirlpoolsConfigKeypair.publicKey,
            whirlpoolsConfigExtension,
            configExtensionAuthority:
              initialConfigExtensionAuthorityKeypair.publicKey,
            newTokenBadgeAuthority: updatedTokenBadgeAuthorityKeypair.publicKey,
          }),
        )
          .addSigner(initialTokenBadgeAuthorityKeypair)
          .buildAndExecute(),
        /0x7d1/, // ConstraintHasOne
      );
    });

    it("should be failed: invalid whirlpools_config_extension", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);

      // config_extension not initialized
      const whirlpoolsConfigExtension = PDAUtil.getConfigExtension(
        ctx.program.programId,
        whirlpoolsConfigKeypair.publicKey,
      ).publicKey;
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.setTokenBadgeAuthorityIx(ctx.program, {
            whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
            whirlpoolsConfigExtension,
            configExtensionAuthority:
              initialConfigExtensionAuthorityKeypair.publicKey,
            newTokenBadgeAuthority: updatedTokenBadgeAuthorityKeypair.publicKey,
          }),
        )
          .addSigner(initialTokenBadgeAuthorityKeypair)
          .buildAndExecute(),
        /0xbc4/, // AccountNotInitialized
      );

      // initialized, but fake config_extension
      const anotherWhirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(anotherWhirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(
        anotherWhirlpoolsConfigKeypair.publicKey,
      );
      const anotherWhirlpoolsConfigExtension = PDAUtil.getConfigExtension(
        ctx.program.programId,
        anotherWhirlpoolsConfigKeypair.publicKey,
      ).publicKey;
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.setTokenBadgeAuthorityIx(ctx.program, {
            whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
            whirlpoolsConfigExtension: anotherWhirlpoolsConfigExtension,
            configExtensionAuthority:
              initialConfigExtensionAuthorityKeypair.publicKey,
            newTokenBadgeAuthority: updatedTokenBadgeAuthorityKeypair.publicKey,
          }),
        )
          .addSigner(initialTokenBadgeAuthorityKeypair)
          .buildAndExecute(),
        /0x7d1/, // ConstraintHasOne
      );
    });

    it("should be failed: invalid config_extension_authority", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);

      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );
      const whirlpoolsConfigExtension = PDAUtil.getConfigExtension(
        ctx.program.programId,
        whirlpoolsConfigKeypair.publicKey,
      ).publicKey;

      const fakeAuthority = Keypair.generate();
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.setTokenBadgeAuthorityIx(ctx.program, {
            whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
            whirlpoolsConfigExtension,
            configExtensionAuthority: fakeAuthority.publicKey,
            newTokenBadgeAuthority: updatedTokenBadgeAuthorityKeypair.publicKey,
          }),
        )
          .addSigner(fakeAuthority)
          .buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("should be failed: token_badge_authority != config_extension_authority", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );

      const whirlpoolsConfigExtension = PDAUtil.getConfigExtension(
        ctx.program.programId,
        whirlpoolsConfigKeypair.publicKey,
      ).publicKey;
      const extensionData = await fetcher.getConfigExtension(
        whirlpoolsConfigExtension,
        IGNORE_CACHE,
      );
      assert.ok(
        extensionData!.tokenBadgeAuthority.equals(
          initialTokenBadgeAuthorityKeypair.publicKey,
        ),
      );

      assert.ok(
        !initialTokenBadgeAuthorityKeypair.publicKey.equals(
          updatedTokenBadgeAuthorityKeypair.publicKey,
        ),
      );
      await setTokenBadgeAuthority(
        whirlpoolsConfigKeypair.publicKey,
        initialConfigExtensionAuthorityKeypair,
        updatedTokenBadgeAuthorityKeypair.publicKey,
      );

      const updatedExtensionData = await pollForCondition(
        () =>
          fetcher.getConfigExtension(whirlpoolsConfigExtension, IGNORE_CACHE),
        (ext) =>
          ext!.tokenBadgeAuthority.equals(
            updatedTokenBadgeAuthorityKeypair.publicKey,
          ),
        {
          accountToReload: whirlpoolsConfigExtension,
          connection: ctx.connection,
        },
      );
      assert.ok(
        updatedExtensionData!.tokenBadgeAuthority.equals(
          updatedTokenBadgeAuthorityKeypair.publicKey,
        ),
      );

      assert.ok(
        !updatedTokenBadgeAuthorityKeypair.publicKey.equals(
          initialConfigExtensionAuthorityKeypair.publicKey,
        ),
      );
      await assert.rejects(
        setTokenBadgeAuthority(
          whirlpoolsConfigKeypair.publicKey,
          updatedTokenBadgeAuthorityKeypair,
          Keypair.generate().publicKey,
        ),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("should be failed: config_extension_authority is not signer", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);

      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );
      const whirlpoolsConfigExtension = PDAUtil.getConfigExtension(
        ctx.program.programId,
        whirlpoolsConfigKeypair.publicKey,
      ).publicKey;

      // update authority from provider.wallet
      await setTokenBadgeAuthority(
        whirlpoolsConfigKeypair.publicKey,
        initialTokenBadgeAuthorityKeypair,
        updatedTokenBadgeAuthorityKeypair.publicKey,
      );
      const extension = await fetcher.getConfigExtension(
        whirlpoolsConfigExtension,
        IGNORE_CACHE,
      );
      assert.ok(
        extension?.tokenBadgeAuthority.equals(
          updatedTokenBadgeAuthorityKeypair.publicKey,
        ),
      );

      const ix: TransactionInstruction =
        program.instruction.setTokenBadgeAuthority({
          accounts: {
            whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
            whirlpoolsConfigExtension,
            configExtensionAuthority:
              updatedTokenBadgeAuthorityKeypair.publicKey,
            newTokenBadgeAuthority: Keypair.generate().publicKey,
          },
        });

      assert.equal(ix.keys.length, 4);
      assert.ok(
        ix.keys[2].pubkey.equals(updatedTokenBadgeAuthorityKeypair.publicKey),
      );

      // unset signer flag
      ix.keys[2].isSigner = false;

      const tx = toTx(ctx, {
        instructions: [ix],
        cleanupInstructions: [],
        signers: [], // no updatedTokenBadgeAuthorityKeypair
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc2/, // AccountNotSigner
      );
    });
  });
});
