import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionInstruction } from "@solana/web3.js";
import * as assert from "assert";
import {
  IGNORE_CACHE,
  PDAUtil,
  toTx,
  WhirlpoolContext,
  WhirlpoolIx
} from "../../../../src";
import { defaultConfirmOptions } from "../../../utils/const";
import { DeleteTokenBadgeParams, InitializeTokenBadgeParams } from "../../../../src/instructions";
import { createMintV2 } from "../../../utils/v2/token-2022";
import { TokenTrait } from "../../../utils/v2/init-utils-v2";

describe("delete_token_badge", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  const collectProtocolFeesAuthorityKeypair = Keypair.generate();
  const feeAuthorityKeypair = Keypair.generate();
  const rewardEmissionsSuperAuthorityKeypair = Keypair.generate();
  const initialTokenBadgeAuthorityKeypair = feeAuthorityKeypair;
  const updatedTokenBadgeAuthorityKeypair = Keypair.generate();

  async function createOtherWallet(): Promise<Keypair> {
    const keypair = Keypair.generate();
    const signature = await provider.connection.requestAirdrop(keypair.publicKey, 100 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(signature, "confirmed");
    return keypair;
  }

  async function initializeWhirlpoolsConfig(configKeypair: Keypair) {
    return toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, {
      collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
      feeAuthority: feeAuthorityKeypair.publicKey,
      rewardEmissionsSuperAuthority: rewardEmissionsSuperAuthorityKeypair.publicKey,
      defaultProtocolFeeRate: 300,
      funder: provider.wallet.publicKey,
      whirlpoolsConfigKeypair: configKeypair,
    })).addSigner(configKeypair).buildAndExecute();  
  }

  async function initializeWhirlpoolsConfigExtension(config: PublicKey) {
    const pda = PDAUtil.getConfigExtension(ctx.program.programId, config);
    return toTx(ctx, WhirlpoolIx.initializeConfigExtensionIx(ctx.program, {
      feeAuthority: feeAuthorityKeypair.publicKey,
      funder: provider.wallet.publicKey,
      whirlpoolsConfig: config,
      whirlpoolsConfigExtensionPda: pda,
    })).addSigner(feeAuthorityKeypair).buildAndExecute();
  }

  async function initializeTokenBadge(config: PublicKey, mint: PublicKey, overwrite: Partial<InitializeTokenBadgeParams>, signers: Keypair[] = [initialTokenBadgeAuthorityKeypair]) {
    const whirlpoolsConfigExtension = PDAUtil.getConfigExtension(ctx.program.programId, config).publicKey;
    const tokenBadgePda = PDAUtil.getTokenBadge(ctx.program.programId, config, mint);
    const tx = toTx(ctx, WhirlpoolIx.initializeTokenBadgeIx(ctx.program, {
      whirlpoolsConfig: config,
      whirlpoolsConfigExtension,
      funder: provider.wallet.publicKey,
      tokenBadgeAuthority: initialTokenBadgeAuthorityKeypair.publicKey,
      tokenBadgePda,
      tokenMint: mint,
      ...overwrite,
    }));
    signers.forEach((signer) => tx.addSigner(signer));
    return tx.buildAndExecute();    
  }

  async function updateTokenBadgeAuthority(config: PublicKey, authority: Keypair, newAuthority: PublicKey) {
    const whirlpoolsConfigExtension = PDAUtil.getConfigExtension(ctx.program.programId, config).publicKey;
    return toTx(ctx, WhirlpoolIx.setTokenBadgeAuthorityIx(ctx.program, {
      whirlpoolsConfig: config,
      whirlpoolsConfigExtension,
      tokenBadgeAuthority: authority.publicKey,
      newTokenBadgeAuthority: newAuthority,
    })).addSigner(authority).buildAndExecute();
  }

  async function deleteTokenBadge(config: PublicKey, mint: PublicKey, overwrite: Partial<DeleteTokenBadgeParams>, signers: Keypair[] = [initialTokenBadgeAuthorityKeypair]) {
    const whirlpoolsConfigExtension = PDAUtil.getConfigExtension(ctx.program.programId, config).publicKey;
    const tokenBadgePda = PDAUtil.getTokenBadge(ctx.program.programId, config, mint);
    const tx = toTx(ctx, WhirlpoolIx.deleteTokenBadgeIx(ctx.program, {
      whirlpoolsConfig: config,
      whirlpoolsConfigExtension,
      tokenBadgeAuthority: initialTokenBadgeAuthorityKeypair.publicKey,
      tokenMint: mint,
      tokenBadge: tokenBadgePda.publicKey,
      receiver: provider.wallet.publicKey,
      ...overwrite,
    }));
    signers.forEach((signer) => tx.addSigner(signer));
    return tx.buildAndExecute();    
  }
  
  describe("successfully delete token badge", () => {
    const tokenTraits: TokenTrait[] = [{isToken2022: true}, {isToken2022: false}];

    tokenTraits.forEach((tokenTrait) => {
      it(`Mint TokenProgram: ${tokenTrait.isToken2022 ? "Token-2022" : "Token"}`, async () => {
        const whirlpoolsConfigKeypair = Keypair.generate();
        await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
        await initializeWhirlpoolsConfigExtension(whirlpoolsConfigKeypair.publicKey);

        const mint = await createMintV2(provider, tokenTrait);
        await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

        const tokenBadgePda = PDAUtil.getTokenBadge(ctx.program.programId, whirlpoolsConfigKeypair.publicKey, mint);
        const tokenBadgeData = await fetcher.getTokenBadge(tokenBadgePda.publicKey, IGNORE_CACHE);
        assert.ok(tokenBadgeData!.whirlpoolsConfig.equals(whirlpoolsConfigKeypair.publicKey));
        assert.ok(tokenBadgeData!.tokenMint.equals(mint));

        const preBalance = await provider.connection.getBalance(provider.wallet.publicKey);

        await deleteTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});
        const tokenBadgeDataRemoved = await fetcher.getTokenBadge(tokenBadgePda.publicKey, IGNORE_CACHE);
        assert.ok(tokenBadgeDataRemoved === null);

        const postBalance = await provider.connection.getBalance(provider.wallet.publicKey);

        // wallet paid network fee, but receive rent. so balance should be increased.
        assert.ok(postBalance > preBalance);
      });
    });
  });

  it("successfully delete when receiver is different than account paying for transaction fee", async () => {
    const otherWallet = await createOtherWallet();

    const whirlpoolsConfigKeypair = Keypair.generate();
    await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
    await initializeWhirlpoolsConfigExtension(whirlpoolsConfigKeypair.publicKey);

    const mint = await createMintV2(provider, {isToken2022: true});
    await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

    const tokenBadgePda = PDAUtil.getTokenBadge(ctx.program.programId, whirlpoolsConfigKeypair.publicKey, mint);
    const tokenBadgeData = await fetcher.getTokenBadge(tokenBadgePda.publicKey, IGNORE_CACHE);
    assert.ok(tokenBadgeData!.whirlpoolsConfig.equals(whirlpoolsConfigKeypair.publicKey));
    assert.ok(tokenBadgeData!.tokenMint.equals(mint));

    const preBalance = await provider.connection.getBalance(otherWallet.publicKey);
    const rent = await provider.connection.getBalance(tokenBadgePda.publicKey);

    await deleteTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {
      receiver: otherWallet.publicKey,
    });
    const tokenBadgeDataRemoved = await fetcher.getTokenBadge(tokenBadgePda.publicKey, IGNORE_CACHE);
    assert.ok(tokenBadgeDataRemoved === null);

    const postBalance = await provider.connection.getBalance(otherWallet.publicKey);
    
    assert.equal(postBalance, preBalance + rent);
  });

  it("should be failed: already deleted", async () => {
    const whirlpoolsConfigKeypair = Keypair.generate();
    await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
    await initializeWhirlpoolsConfigExtension(whirlpoolsConfigKeypair.publicKey);

    const mint = await createMintV2(provider, {isToken2022: true});
    await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

    const tokenBadgePda = PDAUtil.getTokenBadge(ctx.program.programId, whirlpoolsConfigKeypair.publicKey, mint);
    const tokenBadgeData = await fetcher.getTokenBadge(tokenBadgePda.publicKey, IGNORE_CACHE);
    assert.ok(tokenBadgeData!.whirlpoolsConfig.equals(whirlpoolsConfigKeypair.publicKey));
    assert.ok(tokenBadgeData!.tokenMint.equals(mint));

    await deleteTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});
    const tokenBadgeDataRemoved = await fetcher.getTokenBadge(tokenBadgePda.publicKey, IGNORE_CACHE);
    assert.ok(tokenBadgeDataRemoved === null);

    // delete again
    await assert.rejects(
      deleteTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {}),
      /0xbc4/ // AccountNotInitialized
    );
  });

  describe("invalid input account", () => {
    it("should be failed: invalid whirlpools_config", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(whirlpoolsConfigKeypair.publicKey);
  
      const mint = await createMintV2(provider, {isToken2022: true});
      await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});
  
      // config not initialized
      const anotherWhirlpoolsConfigKeypair = Keypair.generate();
      await assert.rejects(
        deleteTokenBadge(
          whirlpoolsConfigKeypair.publicKey,
          mint, {
            whirlpoolsConfig: anotherWhirlpoolsConfigKeypair.publicKey,
          }
        ),
        /0xbc4/ // AccountNotInitialized
      );

      // config initialized, but not match to whirlpools_config_extension
      await initializeWhirlpoolsConfig(anotherWhirlpoolsConfigKeypair);
      await assert.rejects(
        deleteTokenBadge(
          whirlpoolsConfigKeypair.publicKey,
          mint, {
            whirlpoolsConfig: anotherWhirlpoolsConfigKeypair.publicKey,
          }
        ),
        /0x7d1/ // ConstraintHasOne
      );
    });

    it("should be failed: invalid whirlpools_config_extension", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(whirlpoolsConfigKeypair.publicKey);
  
      const mint = await createMintV2(provider, {isToken2022: true});
      await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});
  
      const anotherWhirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(anotherWhirlpoolsConfigKeypair);

      // config_extension not initialized
      await assert.rejects(
        deleteTokenBadge(
          whirlpoolsConfigKeypair.publicKey,
          mint, {
            whirlpoolsConfigExtension: PDAUtil.getConfigExtension(ctx.program.programId, anotherWhirlpoolsConfigKeypair.publicKey).publicKey,
          }
        ),
        /0xbc4/ // AccountNotInitialized
      );

      // initialized, but fake config_extension
      await initializeWhirlpoolsConfigExtension(anotherWhirlpoolsConfigKeypair.publicKey);
      await assert.rejects(
        deleteTokenBadge(
          whirlpoolsConfigKeypair.publicKey,
          mint, {
            whirlpoolsConfigExtension: PDAUtil.getConfigExtension(ctx.program.programId, anotherWhirlpoolsConfigKeypair.publicKey).publicKey,
          }
        ),
        /0x7d1/ // ConstraintHasOne
      );
    });

    it("should be failed: invalid token_badge_authority", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(whirlpoolsConfigKeypair.publicKey);
  
      const mint = await createMintV2(provider, {isToken2022: true});
      await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

      const fakeAuthority = Keypair.generate();
      await assert.rejects(
        deleteTokenBadge(
          whirlpoolsConfigKeypair.publicKey,
          mint, {
            tokenBadgeAuthority: fakeAuthority.publicKey,
          }, [
            fakeAuthority,
          ]
        ),
        /0x7dc/ // ConstraintAddress
      );
    });
      
    it("should be failed: token_badge_authority is not signer", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(whirlpoolsConfigKeypair.publicKey);
  
      const mint = await createMintV2(provider, {isToken2022: true});
      await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

      const whirlpoolsConfigExtension = PDAUtil.getConfigExtension(ctx.program.programId, whirlpoolsConfigKeypair.publicKey).publicKey;

      // update authority from provider.wallet
      await updateTokenBadgeAuthority(whirlpoolsConfigKeypair.publicKey, initialTokenBadgeAuthorityKeypair, updatedTokenBadgeAuthorityKeypair.publicKey);
      const extension = await fetcher.getConfigExtension(whirlpoolsConfigExtension, IGNORE_CACHE);
      assert.ok(extension?.tokenBadgeAuthority.equals(updatedTokenBadgeAuthorityKeypair.publicKey));

      const ix: TransactionInstruction = program.instruction.deleteTokenBadge({
        accounts: {
          whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
          whirlpoolsConfigExtension,
          tokenBadgeAuthority: updatedTokenBadgeAuthorityKeypair.publicKey,
          tokenMint: mint,
          tokenBadge: PDAUtil.getTokenBadge(ctx.program.programId, whirlpoolsConfigKeypair.publicKey, mint).publicKey,
          receiver: ctx.wallet.publicKey,
        },
      })

      assert.equal(ix.keys.length, 6);
      assert.ok(ix.keys[2].pubkey.equals(updatedTokenBadgeAuthorityKeypair.publicKey));

      // unset signer flag
      ix.keys[2].isSigner = false;

      const tx = toTx(ctx, {
        instructions: [ix],
        cleanupInstructions: [],
        signers: [], // no updatedTokenBadgeAuthorityKeypair
      })

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc2/ // AccountNotSigner
      ); 
    });

    it("should be failed: invalid token_mint", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(whirlpoolsConfigKeypair.publicKey);
  
      const mint = await createMintV2(provider, {isToken2022: true});
      await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

      // mint is not uninitialized
      const uninitializedMint = Keypair.generate().publicKey;
      await assert.rejects(
        deleteTokenBadge(
          whirlpoolsConfigKeypair.publicKey,
          uninitializedMint,
          {},
        ),
        /0xbc4/ // AccountNotInitialized
      );

      // different mint
      const anotherMint = await createMintV2(provider, {isToken2022: true});
      await assert.rejects(
        initializeTokenBadge(
          whirlpoolsConfigKeypair.publicKey,
          mint,
          {
            tokenMint: anotherMint,
          },
        ),
        /0x7d6/ // ConstraintSeeds (token_badge (PDA) is not valid)
      );
    });

    it("should be failed: invalid token_badge", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);
      await initializeWhirlpoolsConfigExtension(whirlpoolsConfigKeypair.publicKey);
  
      const mint = await createMintV2(provider, {isToken2022: true});
      await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, mint, {});

      // different mint (PDA not initialized)
      const anotherMint = await createMintV2(provider, {isToken2022: true});
      const pdaForAnotherMint = PDAUtil.getTokenBadge(
        ctx.program.programId,
        whirlpoolsConfigKeypair.publicKey,
        anotherMint,
      );
      await assert.rejects(
        deleteTokenBadge(
          whirlpoolsConfigKeypair.publicKey,
          mint,
          {
            tokenBadge: pdaForAnotherMint.publicKey,
          },
        ),
        /0xbc4/ // AccountNotInitialized
      );

      // different mint (PDA initialized)
      await initializeTokenBadge(whirlpoolsConfigKeypair.publicKey, anotherMint, {});
      await assert.rejects(
        deleteTokenBadge(
          whirlpoolsConfigKeypair.publicKey,
          mint,
          {
            tokenBadge: pdaForAnotherMint.publicKey,
          },
        ),
        /0x7d6/ // ConstraintSeeds (token_badge (PDA) is not valid)
      );
    });
  });
});
