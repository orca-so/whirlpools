import * as anchor from "@coral-xyz/anchor";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import * as assert from "assert";
import {
  IGNORE_CACHE,
  PDAUtil,
  toTx,
  WhirlpoolContext,
  WhirlpoolIx,
} from "../../../../src";
import { defaultConfirmOptions } from "../../../utils/const";
import type {
  InitializeTokenBadgeParams,
  SetTokenBadgeAttributeParams,
} from "../../../../src/instructions";
import { createMintV2 } from "../../../utils/v2/token-2022";
import type { TokenTrait } from "../../../utils/v2/init-utils-v2";
import { getLocalnetAdminKeypair0 } from "../../../utils";

describe("set_token_badge_attribute", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

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

  async function updateTokenBadgeAuthority(
    config: PublicKey,
    authority: Keypair,
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
        configExtensionAuthority: authority.publicKey,
        newTokenBadgeAuthority: newAuthority,
      }),
    )
      .addSigner(authority)
      .buildAndExecute();
  }

  async function setTokenBadgeAttribute(
    config: PublicKey,
    mint: PublicKey,
    overwrite: Partial<SetTokenBadgeAttributeParams>,
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
      WhirlpoolIx.setTokenBadgeAttributeIx(ctx.program, {
        whirlpoolsConfig: config,
        whirlpoolsConfigExtension,
        tokenBadgeAuthority: initialTokenBadgeAuthorityKeypair.publicKey,
        tokenMint: mint,
        tokenBadge: tokenBadgePda.publicKey,
        attribute: {
          requireNonTransferablePosition: [true],
        },
        ...overwrite,
      }),
    );
    signers.forEach((signer) => tx.addSigner(signer));
    return tx.buildAndExecute();
  }

  describe("successfully set token badge attribute", () => {
    const tokenTraits: TokenTrait[] = [
      { isToken2022: true },
      { isToken2022: false },
    ];

    tokenTraits.forEach((tokenTrait) => {
      it(`Mint TokenProgram: ${tokenTrait.isToken2022 ? "Token-2022" : "Token"}`, async () => {
        const whirlpoolsConfigKeypair = Keypair.generate();
        await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
        await initializeWhirlpoolsConfigExtension(
          whirlpoolsConfigKeypair.publicKey,
        );

        const mint = await createMintV2(provider, tokenTrait);
        await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

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

        // false
        assert.ok(!tokenBadgeData!.attributeRequireNonTransferablePosition);

        await setTokenBadgeAttribute(whirlpoolsConfigKeypair.publicKey, mint, {
          attribute: {
            requireNonTransferablePosition: [true],
          },
        });

        // true
        const updatedTokenBadgeData = await fetcher.getTokenBadge(
          tokenBadgePda.publicKey,
          IGNORE_CACHE,
        );
        assert.ok(
          updatedTokenBadgeData!.attributeRequireNonTransferablePosition,
        );

        await setTokenBadgeAttribute(whirlpoolsConfigKeypair.publicKey, mint, {
          attribute: {
            requireNonTransferablePosition: [false],
          },
        });

        // false
        const revertedTokenBadgeData = await fetcher.getTokenBadge(
          tokenBadgePda.publicKey,
          IGNORE_CACHE,
        );
        assert.ok(
          !revertedTokenBadgeData!.attributeRequireNonTransferablePosition,
        );
      });
    });
  });

  it("should be failed: TokenBadge feature is not enabled", async () => {
    const admin = await getLocalnetAdminKeypair0(ctx);

    const whirlpoolsConfigKeypair = Keypair.generate();
    await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
    await initializeWhirlpoolsConfigExtension(
      whirlpoolsConfigKeypair.publicKey,
    );

    const mint = await createMintV2(provider, { isToken2022: true });
    await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

    // disable TokenBadge feature
    await toTx(
      ctx,
      WhirlpoolIx.setConfigFeatureFlagIx(ctx.program, {
        whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
        authority: admin.publicKey,
        featureFlag: {
          tokenBadge: [false],
        },
      }),
    )
      .addSigner(admin)
      .buildAndExecute();

    await assert.rejects(
      setTokenBadgeAttribute(whirlpoolsConfigKeypair.publicKey, mint, {
        whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
      }),
      /0x17b2/, // FeatureIsNotEnabled
    );
  });

  describe("invalid input account", () => {
    it("should be failed: invalid whirlpools_config", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );

      const mint = await createMintV2(provider, { isToken2022: true });
      await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

      // config not initialized
      const anotherWhirlpoolsConfigKeypair = Keypair.generate();
      await assert.rejects(
        setTokenBadgeAttribute(whirlpoolsConfigKeypair.publicKey, mint, {
          whirlpoolsConfig: anotherWhirlpoolsConfigKeypair.publicKey,
        }),
        /0xbc4/, // AccountNotInitialized
      );

      // config initialized, but not match to whirlpools_config_extension
      await initializeWhirlpoolsConfig(anotherWhirlpoolsConfigKeypair);
      await assert.rejects(
        setTokenBadgeAttribute(whirlpoolsConfigKeypair.publicKey, mint, {
          whirlpoolsConfig: anotherWhirlpoolsConfigKeypair.publicKey,
        }),
        /0x7d1/, // ConstraintHasOne
      );
    });

    it("should be failed: invalid whirlpools_config_extension", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );

      const mint = await createMintV2(provider, { isToken2022: true });
      await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

      const anotherWhirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(anotherWhirlpoolsConfigKeypair);

      // config_extension not initialized
      await assert.rejects(
        setTokenBadgeAttribute(whirlpoolsConfigKeypair.publicKey, mint, {
          whirlpoolsConfigExtension: PDAUtil.getConfigExtension(
            ctx.program.programId,
            anotherWhirlpoolsConfigKeypair.publicKey,
          ).publicKey,
        }),
        /0xbc4/, // AccountNotInitialized
      );

      // initialized, but fake config_extension
      await initializeWhirlpoolsConfigExtension(
        anotherWhirlpoolsConfigKeypair.publicKey,
      );
      await assert.rejects(
        setTokenBadgeAttribute(whirlpoolsConfigKeypair.publicKey, mint, {
          whirlpoolsConfigExtension: PDAUtil.getConfigExtension(
            ctx.program.programId,
            anotherWhirlpoolsConfigKeypair.publicKey,
          ).publicKey,
        }),
        /0x7d1/, // ConstraintHasOne
      );
    });

    it("should be failed: invalid token_badge_authority", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );

      const mint = await createMintV2(provider, { isToken2022: true });
      await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

      const fakeAuthority = Keypair.generate();
      await assert.rejects(
        setTokenBadgeAttribute(
          whirlpoolsConfigKeypair.publicKey,
          mint,
          {
            tokenBadgeAuthority: fakeAuthority.publicKey,
          },
          [fakeAuthority],
        ),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("should be failed: config_extension_authority is passed as token_badge_authority", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      const mint = await createMintV2(provider, { isToken2022: true });

      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );
      const whirlpoolsConfigExtension = PDAUtil.getConfigExtension(
        ctx.program.programId,
        whirlpoolsConfigKeypair.publicKey,
      ).publicKey;

      await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

      // update authority from provider.wallet
      await updateTokenBadgeAuthority(
        whirlpoolsConfigKeypair.publicKey,
        initialConfigExtensionAuthorityKeypair,
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

      const fakeAuthority = initialConfigExtensionAuthorityKeypair;
      await assert.rejects(
        setTokenBadgeAttribute(
          whirlpoolsConfigKeypair.publicKey,
          mint,
          {
            tokenBadgeAuthority: fakeAuthority.publicKey,
          },
          [fakeAuthority],
        ),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("should be failed: token_badge_authority is not signer", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );

      const mint = await createMintV2(provider, { isToken2022: true });
      await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

      const whirlpoolsConfigExtension = PDAUtil.getConfigExtension(
        ctx.program.programId,
        whirlpoolsConfigKeypair.publicKey,
      ).publicKey;

      // update authority from provider.wallet
      await updateTokenBadgeAuthority(
        whirlpoolsConfigKeypair.publicKey,
        initialConfigExtensionAuthorityKeypair,
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
        program.instruction.setTokenBadgeAttribute(
          { requireNonTransferablePosition: [true] },
          {
            accounts: {
              whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
              whirlpoolsConfigExtension,
              tokenBadgeAuthority: updatedTokenBadgeAuthorityKeypair.publicKey,
              tokenMint: mint,
              tokenBadge: PDAUtil.getTokenBadge(
                ctx.program.programId,
                whirlpoolsConfigKeypair.publicKey,
                mint,
              ).publicKey,
            },
          },
        );

      assert.equal(ix.keys.length, 5);
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

    it("should be failed: invalid token_mint", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );

      const mint = await createMintV2(provider, { isToken2022: true });
      await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

      // mint is not uninitialized
      const uninitializedMint = Keypair.generate().publicKey;
      await assert.rejects(
        setTokenBadgeAttribute(
          whirlpoolsConfigKeypair.publicKey,
          uninitializedMint,
          {},
        ),
        /0xbc4/, // AccountNotInitialized
      );
    });

    it("should be failed: invalid token_badge", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );

      const mint = await createMintV2(provider, { isToken2022: true });
      await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

      // different mint (PDA not initialized)
      const anotherMint = await createMintV2(provider, { isToken2022: true });
      const pdaForAnotherMint = PDAUtil.getTokenBadge(
        ctx.program.programId,
        whirlpoolsConfigKeypair.publicKey,
        anotherMint,
      );
      await assert.rejects(
        setTokenBadgeAttribute(whirlpoolsConfigKeypair.publicKey, mint, {
          tokenBadge: pdaForAnotherMint.publicKey,
        }),
        /0xbc4/, // AccountNotInitialized
      );

      // different mint (PDA initialized)
      await initializeTokenBadge(
        whirlpoolsConfigKeypair.publicKey,
        anotherMint,
        {},
      );
      await assert.rejects(
        setTokenBadgeAttribute(whirlpoolsConfigKeypair.publicKey, mint, {
          tokenBadge: pdaForAnotherMint.publicKey,
        }),
        /0x7d1/, // ConstraintHasOne
      );
    });
  });
});
