import type * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import * as assert from "assert";
import type { WhirlpoolContext } from "../../../src";
import { IGNORE_CACHE, PDAUtil, toTx, WhirlpoolIx } from "../../../src";
import type { InitializeTokenBadgeParams } from "../../..//dist/instructions";
import { createMintV2 } from "../../utils/v2/token-2022";
import type { TokenTrait } from "../../utils/v2/init-utils-v2";
import { getLocalnetAdminKeypair0 } from "../../utils";
import { initializeLiteSVMEnvironment } from "../../utils/litesvm";

describe("initialize_token_badge", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  const collectProtocolFeesAuthorityKeypair = Keypair.generate();
  const feeAuthorityKeypair = Keypair.generate();
  const rewardEmissionsSuperAuthorityKeypair = Keypair.generate();
  const initialConfigExtensionAuthorityKeypair = feeAuthorityKeypair;
  const initialTokenBadgeAuthorityKeypair = feeAuthorityKeypair;
  const updatedTokenBadgeAuthorityKeypair = Keypair.generate();

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    program = env.program;
    fetcher = ctx.fetcher;
  });

  async function createOtherWallet(): Promise<Keypair> {
    const keypair = Keypair.generate();
    const signature = await provider.connection.requestAirdrop(
      keypair.publicKey,
      100 * LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(signature, "confirmed");
    return keypair;
  }

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

  describe("successfully initialize token badge and verify initialized account contents", () => {
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
      });
    });
  });

  it("successfully initialize when funder is different than account paying for transaction fee", async () => {
    const whirlpoolsConfigKeypair = Keypair.generate();
    await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
    await initializeWhirlpoolsConfigExtension(
      whirlpoolsConfigKeypair.publicKey,
    );

    const mint = await createMintV2(provider, { isToken2022: true });

    const preBalance = await ctx.connection.getBalance(ctx.wallet.publicKey);
    const otherWallet = await createOtherWallet();

    await initializeTokenBadge(
      whirlpoolsConfigKeypair.publicKey,
      mint,
      {
        funder: otherWallet.publicKey,
      },
      [initialTokenBadgeAuthorityKeypair, otherWallet],
    );

    const postBalance = await ctx.connection.getBalance(ctx.wallet.publicKey);
    const diffBalance = preBalance - postBalance;
    const minRent = await ctx.connection.getMinimumBalanceForRentExemption(0);
    assert.ok(diffBalance < minRent); // ctx.wallet didn't pay any rent

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

  it("TokenBadge account has reserved space", async () => {
    const tokenBadgeAccountSizeIncludingReserve = 8 + 32 + 32 + 1 + 127;

    const whirlpoolsConfigKeypair = Keypair.generate();
    await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
    await initializeWhirlpoolsConfigExtension(
      whirlpoolsConfigKeypair.publicKey,
    );

    const mint = await createMintV2(provider, { isToken2022: true });
    await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

    const tokenBadgePda = PDAUtil.getTokenBadge(
      ctx.program.programId,
      whirlpoolsConfigKeypair.publicKey,
      mint,
    );

    const account = await ctx.connection.getAccountInfo(
      tokenBadgePda.publicKey,
      "confirmed",
    );
    assert.equal(account!.data.length, tokenBadgeAccountSizeIncludingReserve);
  });

  it("should be failed: already initialized", async () => {
    const whirlpoolsConfigKeypair = Keypair.generate();
    await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
    await initializeWhirlpoolsConfigExtension(
      whirlpoolsConfigKeypair.publicKey,
    );

    const mint = await createMintV2(provider, { isToken2022: true });

    // initialized
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
    assert.ok(tokenBadgeData !== null);

    // re-initialize
    await assert.rejects(
      initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {}),
      (err: Error) => {
        return err.message.includes("already in use");
      },
    );
  });

  it("should be failed: TokenBadge feature is not enabled", async () => {
    const admin = await getLocalnetAdminKeypair0(ctx);
    const whirlpoolsConfigKeypair = Keypair.generate();

    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, {
        collectProtocolFeesAuthority:
          collectProtocolFeesAuthorityKeypair.publicKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        rewardEmissionsSuperAuthority:
          rewardEmissionsSuperAuthorityKeypair.publicKey,
        defaultProtocolFeeRate: 300,
        funder: admin.publicKey,
        whirlpoolsConfigKeypair,
      }),
    )
      .addSigner(admin)
      .addSigner(whirlpoolsConfigKeypair)
      .buildAndExecute();

    await initializeWhirlpoolsConfigExtension(
      whirlpoolsConfigKeypair.publicKey,
    );

    const mint = await createMintV2(provider, { isToken2022: true });
    const tokenBadgePda = PDAUtil.getTokenBadge(
      ctx.program.programId,
      whirlpoolsConfigKeypair.publicKey,
      mint,
    );

    // should be failed: feature is not enabled
    await assert.rejects(
      initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {}),
      /0x17b2/, // FeatureIsNotEnabled
    );

    const tokenBadgeData = await fetcher.getTokenBadge(
      tokenBadgePda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(tokenBadgeData === null);

    // enable feature
    await toTx(
      ctx,
      WhirlpoolIx.setConfigFeatureFlagIx(ctx.program, {
        whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
        authority: admin.publicKey,
        featureFlag: {
          tokenBadge: [true],
        },
      }),
    )
      .addSigner(admin)
      .buildAndExecute();

    // should be success: now feature is enabled
    await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

    const tokenBadgeDataAgain = await fetcher.getTokenBadge(
      tokenBadgePda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(tokenBadgeDataAgain !== null);
  });

  describe("invalid input account", () => {
    it("should be failed: invalid whirlpools_config", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );

      const mint = await createMintV2(provider, { isToken2022: true });

      // config not initialized
      const anotherWhirlpoolsConfigKeypair = Keypair.generate();
      await assert.rejects(
        initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {
          whirlpoolsConfig: anotherWhirlpoolsConfigKeypair.publicKey,
        }),
        /0xbc4/, // AccountNotInitialized
      );

      // config initialized, but not match to whirlpools_config_extension
      await initializeWhirlpoolsConfig(anotherWhirlpoolsConfigKeypair);
      await assert.rejects(
        initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {
          whirlpoolsConfig: anotherWhirlpoolsConfigKeypair.publicKey,
        }),
        /0x7d6/, // ConstraintSeeds (token_badge (PDA) is not valid)
      );

      // with fake PDA
      await assert.rejects(
        initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {
          whirlpoolsConfig: anotherWhirlpoolsConfigKeypair.publicKey,
          tokenBadgePda: PDAUtil.getTokenBadge(
            ctx.program.programId,
            anotherWhirlpoolsConfigKeypair.publicKey,
            mint,
          ),
        }),
        /0x7d1/, // ConstraintHasOne
      );
    });

    it("should be failed: invalid whirlpools_config_extension", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      const mint = await createMintV2(provider, { isToken2022: true });

      // config_extension not initialized
      await assert.rejects(
        initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {
          whirlpoolsConfigExtension: PDAUtil.getConfigExtension(
            ctx.program.programId,
            whirlpoolsConfigKeypair.publicKey,
          ).publicKey,
        }),
        /0xbc4/, // AccountNotInitialized
      );

      // initialized, but fake config_extension
      const anotherWhirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(anotherWhirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(
        anotherWhirlpoolsConfigKeypair.publicKey,
      );
      await assert.rejects(
        initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {
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
      const mint = await createMintV2(provider, { isToken2022: true });

      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );

      const fakeAuthority = Keypair.generate();
      await assert.rejects(
        initializeTokenBadge(
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
      const mint = await createMintV2(provider, { isToken2022: true });

      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );
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
        program.instruction.initializeTokenBadge({
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
            funder: ctx.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          },
        });

      assert.equal(ix.keys.length, 7);
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
        initializeTokenBadge(
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

    it("should be failed: invalid token_mint", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );

      // mint is not uninitialized
      const uninitializedMint = Keypair.generate().publicKey;
      await assert.rejects(
        initializeTokenBadge(
          whirlpoolsConfigKeypair.publicKey,
          uninitializedMint,
          {},
        ),
        /0xbc4/, // AccountNotInitialized
      );

      // different mint
      const mintA = await createMintV2(provider, { isToken2022: true });
      const mintB = await createMintV2(provider, { isToken2022: true });
      await assert.rejects(
        initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mintA, {
          tokenMint: mintB,
        }),
        /0x7d6/, // ConstraintSeeds (token_badge (PDA) is not valid)
      );
    });

    it("should be failed: invalid token_badge", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
      );

      // different mint
      const mintA = await createMintV2(provider, { isToken2022: true });
      const mintB = await createMintV2(provider, { isToken2022: true });
      const pdaForMintB = PDAUtil.getTokenBadge(
        ctx.program.programId,
        whirlpoolsConfigKeypair.publicKey,
        mintB,
      );
      await assert.rejects(
        initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mintA, {
          tokenBadgePda: pdaForMintB,
        }),
        /0x7d6/, // ConstraintSeeds (token_badge (PDA) is not valid)
      );
    });

    it("should be failed: funder is not signer", async () => {
      const otherWallet = await createOtherWallet();

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

      const ix: TransactionInstruction =
        program.instruction.initializeTokenBadge({
          accounts: {
            whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
            whirlpoolsConfigExtension,
            tokenBadgeAuthority: initialTokenBadgeAuthorityKeypair.publicKey,
            tokenMint: mint,
            tokenBadge: PDAUtil.getTokenBadge(
              ctx.program.programId,
              whirlpoolsConfigKeypair.publicKey,
              mint,
            ).publicKey,
            funder: otherWallet.publicKey,
            systemProgram: SystemProgram.programId,
          },
        });

      assert.equal(ix.keys.length, 7);
      assert.ok(ix.keys[5].pubkey.equals(otherWallet.publicKey));

      // unset signer flag
      ix.keys[5].isSigner = false;

      const tx = toTx(ctx, {
        instructions: [ix],
        cleanupInstructions: [],
        signers: [initialTokenBadgeAuthorityKeypair], // no otherWallet
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc2/, // AccountNotSigner
      );
    });

    it("should be failed: invalid system program", async () => {
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

      const invalidSystemProgram = TOKEN_PROGRAM_ID;
      const ix: TransactionInstruction =
        program.instruction.initializeTokenBadge({
          accounts: {
            whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
            whirlpoolsConfigExtension,
            tokenBadgeAuthority: initialTokenBadgeAuthorityKeypair.publicKey,
            tokenMint: mint,
            tokenBadge: PDAUtil.getTokenBadge(
              ctx.program.programId,
              whirlpoolsConfigKeypair.publicKey,
              mint,
            ).publicKey,
            funder: ctx.wallet.publicKey,
            systemProgram: invalidSystemProgram,
          },
        });

      const tx = toTx(ctx, {
        instructions: [ix],
        cleanupInstructions: [],
        signers: [initialTokenBadgeAuthorityKeypair],
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc0/, // InvalidProgramId
      );
    });
  });
});
