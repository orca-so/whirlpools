import type * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import * as assert from "assert";
import type { WhirlpoolContext } from "../../../src";
import { PDAUtil, toTx, WhirlpoolIx } from "../../../src";
import type { InitConfigExtensionParams } from "../../../dist/instructions";
import { getLocalnetAdminKeypair0 } from "../../utils";
import { initializeLiteSVMEnvironment } from "../../utils/litesvm";

describe("initialize_config_extension", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    program = env.program;
    fetcher = ctx.fetcher;
  });

  const collectProtocolFeesAuthorityKeypair = Keypair.generate();
  const feeAuthorityKeypair = Keypair.generate();
  const rewardEmissionsSuperAuthorityKeypair = Keypair.generate();

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

  async function initializeWhirlpoolsConfigExtension(
    config: PublicKey,
    overwrite: Partial<InitConfigExtensionParams>,
    signers: Keypair[] = [feeAuthorityKeypair],
  ) {
    const pda = PDAUtil.getConfigExtension(ctx.program.programId, config);
    const tx = toTx(
      ctx,
      WhirlpoolIx.initializeConfigExtensionIx(ctx.program, {
        feeAuthority: feeAuthorityKeypair.publicKey,
        funder: provider.wallet.publicKey,
        whirlpoolsConfig: config,
        whirlpoolsConfigExtensionPda: pda,
        ...overwrite,
      }),
    );
    signers.forEach((signer) => tx.addSigner(signer));
    return tx.buildAndExecute();
  }

  it("successfully initialize config extension and verify initialized account contents", async () => {
    const whirlpoolsConfigKeypair = Keypair.generate();
    await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);

    const configExtensionPubkey = PDAUtil.getConfigExtension(
      ctx.program.programId,
      whirlpoolsConfigKeypair.publicKey,
    ).publicKey;
    await initializeWhirlpoolsConfigExtension(
      whirlpoolsConfigKeypair.publicKey,
      {},
    );

    const configExtension = await fetcher.getConfigExtension(
      configExtensionPubkey,
    );

    assert.ok(
      configExtension!.whirlpoolsConfig.equals(
        whirlpoolsConfigKeypair.publicKey,
      ),
    );
    assert.ok(
      configExtension!.configExtensionAuthority.equals(
        feeAuthorityKeypair.publicKey,
      ),
    );
    assert.ok(
      configExtension!.tokenBadgeAuthority.equals(
        feeAuthorityKeypair.publicKey,
      ),
    );
  });

  it("successfully initialize when funder is different than account paying for transaction fee", async () => {
    const whirlpoolsConfigKeypair = Keypair.generate();
    await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);

    const preBalance = await ctx.connection.getBalance(ctx.wallet.publicKey);
    const otherWallet = await createOtherWallet();

    const configExtensionPubkey = PDAUtil.getConfigExtension(
      ctx.program.programId,
      whirlpoolsConfigKeypair.publicKey,
    ).publicKey;
    await initializeWhirlpoolsConfigExtension(
      whirlpoolsConfigKeypair.publicKey,
      {
        funder: otherWallet.publicKey,
      },
      [feeAuthorityKeypair, otherWallet],
    );

    const postBalance = await ctx.connection.getBalance(ctx.wallet.publicKey);
    const diffBalance = preBalance - postBalance;
    const minRent = await ctx.connection.getMinimumBalanceForRentExemption(0);
    assert.ok(diffBalance < minRent); // ctx.wallet didn't pay any rent

    const configExtension = await fetcher.getConfigExtension(
      configExtensionPubkey,
    );

    assert.ok(
      configExtension!.whirlpoolsConfig.equals(
        whirlpoolsConfigKeypair.publicKey,
      ),
    );
    assert.ok(
      configExtension!.configExtensionAuthority.equals(
        feeAuthorityKeypair.publicKey,
      ),
    );
    assert.ok(
      configExtension!.tokenBadgeAuthority.equals(
        feeAuthorityKeypair.publicKey,
      ),
    );
  });

  it("WhirlpoolsConfigExtension account has reserved space", async () => {
    const whirlpoolsConfigExtensionAccountSizeIncludingReserve =
      8 + 32 + 32 + 32 + 512;

    const whirlpoolsConfigKeypair = Keypair.generate();
    await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);

    const configExtensionPubkey = PDAUtil.getConfigExtension(
      ctx.program.programId,
      whirlpoolsConfigKeypair.publicKey,
    ).publicKey;
    await initializeWhirlpoolsConfigExtension(
      whirlpoolsConfigKeypair.publicKey,
      {},
    );

    const account = await ctx.connection.getAccountInfo(
      configExtensionPubkey,
      "confirmed",
    );
    assert.equal(
      account!.data.length,
      whirlpoolsConfigExtensionAccountSizeIncludingReserve,
    );
  });

  it("should be failed: already initialized", async () => {
    const whirlpoolsConfigKeypair = Keypair.generate();
    await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);

    const configExtensionPubkey = PDAUtil.getConfigExtension(
      ctx.program.programId,
      whirlpoolsConfigKeypair.publicKey,
    ).publicKey;
    await initializeWhirlpoolsConfigExtension(
      whirlpoolsConfigKeypair.publicKey,
      {},
    );

    // initialized
    const configExtension = await fetcher.getConfigExtension(
      configExtensionPubkey,
    );
    assert.ok(
      configExtension!.whirlpoolsConfig.equals(
        whirlpoolsConfigKeypair.publicKey,
      ),
    );

    // re-initialize
    await assert.rejects(
      initializeWhirlpoolsConfigExtension(
        whirlpoolsConfigKeypair.publicKey,
        {},
      ),
      (err: Error) => {
        return err.message.includes("already in use");
      },
    );
  });

  describe("invalid input account", () => {
    it("should be failed: invalid config", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();

      // config not initialized

      await assert.rejects(
        initializeWhirlpoolsConfigExtension(
          whirlpoolsConfigKeypair.publicKey,
          {},
        ),
        /0xbc4/, // AccountNotInitialized
      );
    });

    it("should be failed: invalid config_extension address", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);

      const invalidPda = PDAUtil.getFeeTier(
        ctx.program.programId,
        whirlpoolsConfigKeypair.publicKey,
        64,
      );
      await assert.rejects(
        initializeWhirlpoolsConfigExtension(whirlpoolsConfigKeypair.publicKey, {
          whirlpoolsConfigExtensionPda: invalidPda,
        }),
        /0x7d6/, // ConstraintSeeds
      );
    });

    it("should be failed: funder is not signer", async () => {
      const otherWallet = await createOtherWallet();

      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);

      const whirlpoolsConfigExtensionPda = PDAUtil.getConfigExtension(
        ctx.program.programId,
        whirlpoolsConfigKeypair.publicKey,
      );
      const ix: TransactionInstruction =
        program.instruction.initializeConfigExtension({
          accounts: {
            config: whirlpoolsConfigKeypair.publicKey,
            configExtension: whirlpoolsConfigExtensionPda.publicKey,
            funder: otherWallet.publicKey,
            feeAuthority: feeAuthorityKeypair.publicKey,
            systemProgram: SystemProgram.programId,
          },
        });

      assert.equal(ix.keys.length, 5);
      assert.ok(ix.keys[2].pubkey.equals(otherWallet.publicKey));

      // unset signer flag
      ix.keys[2].isSigner = false;

      const tx = toTx(ctx, {
        instructions: [ix],
        cleanupInstructions: [],
        signers: [feeAuthorityKeypair], // no otherWallet
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc2/, // AccountNotSigner
      );
    });

    it("should be failed: invalid fee_authority", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);

      const invalidAuthorityKeypair = Keypair.generate();
      await assert.rejects(
        initializeWhirlpoolsConfigExtension(
          whirlpoolsConfigKeypair.publicKey,
          {
            feeAuthority: invalidAuthorityKeypair.publicKey,
          },
          [invalidAuthorityKeypair],
        ),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("should be failed: invalid system program", async () => {
      const whirlpoolsConfigKeypair = Keypair.generate();
      await initializeWhirlpoolsConfig(whirlpoolsConfigKeypair);

      const invalidSystemProgram = TOKEN_PROGRAM_ID;

      const whirlpoolsConfigExtensionPda = PDAUtil.getConfigExtension(
        ctx.program.programId,
        whirlpoolsConfigKeypair.publicKey,
      );
      const ix: TransactionInstruction =
        program.instruction.initializeConfigExtension({
          accounts: {
            config: whirlpoolsConfigKeypair.publicKey,
            configExtension: whirlpoolsConfigExtensionPda.publicKey,
            funder: ctx.wallet.publicKey,
            feeAuthority: feeAuthorityKeypair.publicKey,
            systemProgram: invalidSystemProgram,
          },
        });

      const tx = toTx(ctx, {
        instructions: [ix],
        cleanupInstructions: [],
        signers: [feeAuthorityKeypair],
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc0/, // InvalidProgramId
      );
    });
  });
});
