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

describe("set_config_extension_authority", () => {
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
  const updatedConfigExtensionAuthorityKeypair = Keypair.generate();

  async function initializeWhirlpoolsConfig(configKeypair: Keypair) {
    return toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, {
        collectProtocolFeesAuthority:
          collectProtocolFeesAuthorityKeypair.publicKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        rewardEmissionsSuperAuthority:
          rewardEmissionsSuperAuthorityKeypair.publicKey,
        defaultProtocolFeeRate: 300,
        funder: provider.wallet.publicKey,
        whirlpoolsConfigKeypair: configKeypair,
      }),
    )
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

  async function setConfigExtensionAuthority(
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
      WhirlpoolIx.setConfigExtensionAuthorityIx(ctx.program, {
        whirlpoolsConfig: config,
        whirlpoolsConfigExtension,
        configExtensionAuthority: configExtensionAuthority.publicKey,
        newConfigExtensionAuthority: newAuthority,
      }),
    )
      .addSigner(configExtensionAuthority)
      .buildAndExecute();
  }

  it("successfully set config extension authority and verify updated account contents", async () => {
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
      extensionData!.configExtensionAuthority.equals(
        initialConfigExtensionAuthorityKeypair.publicKey,
      ),
    );
    assert.ok(
      extensionData!.tokenBadgeAuthority.equals(
        initialTokenBadgeAuthorityKeypair.publicKey,
      ),
    );

    assert.ok(
      !initialConfigExtensionAuthorityKeypair.publicKey.equals(
        updatedConfigExtensionAuthorityKeypair.publicKey,
      ),
    );
    await setConfigExtensionAuthority(
      whirlpoolsConfigKeypair.publicKey,
      initialConfigExtensionAuthorityKeypair,
      updatedConfigExtensionAuthorityKeypair.publicKey,
    );

    const updatedExtensionData = await fetcher.getConfigExtension(
      whirlpoolsConfigExtension,
      IGNORE_CACHE,
    );
    assert.ok(
      updatedExtensionData!.configExtensionAuthority.equals(
        updatedConfigExtensionAuthorityKeypair.publicKey,
      ),
    );
    assert.ok(
      updatedExtensionData!.tokenBadgeAuthority.equals(
        initialTokenBadgeAuthorityKeypair.publicKey,
      ),
    );

    // set back to initialConfigExtension with updateConfigExtensionAuthority
    await setConfigExtensionAuthority(
      whirlpoolsConfigKeypair.publicKey,
      updatedConfigExtensionAuthorityKeypair,
      initialConfigExtensionAuthorityKeypair.publicKey,
    );

    const backExtensionData = await fetcher.getConfigExtension(
      whirlpoolsConfigExtension,
      IGNORE_CACHE,
    );
    assert.ok(
      backExtensionData!.configExtensionAuthority.equals(
        initialConfigExtensionAuthorityKeypair.publicKey,
      ),
    );
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
          WhirlpoolIx.setConfigExtensionAuthorityIx(ctx.program, {
            whirlpoolsConfig: anotherWhirlpoolsConfigKeypair.publicKey,
            whirlpoolsConfigExtension,
            configExtensionAuthority:
              initialConfigExtensionAuthorityKeypair.publicKey,
            newConfigExtensionAuthority:
              updatedConfigExtensionAuthorityKeypair.publicKey,
          }),
        )
          .addSigner(initialConfigExtensionAuthorityKeypair)
          .buildAndExecute(),
        /0xbc4/, // AccountNotInitialized
      );

      // config initialized, but not match to whirlpools_config_extension
      await initializeWhirlpoolsConfig(anotherWhirlpoolsConfigKeypair);
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.setConfigExtensionAuthorityIx(ctx.program, {
            whirlpoolsConfig: anotherWhirlpoolsConfigKeypair.publicKey,
            whirlpoolsConfigExtension,
            configExtensionAuthority:
              initialConfigExtensionAuthorityKeypair.publicKey,
            newConfigExtensionAuthority:
              updatedConfigExtensionAuthorityKeypair.publicKey,
          }),
        )
          .addSigner(initialConfigExtensionAuthorityKeypair)
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
          WhirlpoolIx.setConfigExtensionAuthorityIx(ctx.program, {
            whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
            whirlpoolsConfigExtension,
            configExtensionAuthority:
              initialConfigExtensionAuthorityKeypair.publicKey,
            newConfigExtensionAuthority:
              updatedConfigExtensionAuthorityKeypair.publicKey,
          }),
        )
          .addSigner(initialConfigExtensionAuthorityKeypair)
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
          WhirlpoolIx.setConfigExtensionAuthorityIx(ctx.program, {
            whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
            whirlpoolsConfigExtension: anotherWhirlpoolsConfigExtension,
            configExtensionAuthority:
              initialConfigExtensionAuthorityKeypair.publicKey,
            newConfigExtensionAuthority:
              updatedConfigExtensionAuthorityKeypair.publicKey,
          }),
        )
          .addSigner(initialConfigExtensionAuthorityKeypair)
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
          WhirlpoolIx.setConfigExtensionAuthorityIx(ctx.program, {
            whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
            whirlpoolsConfigExtension,
            configExtensionAuthority: fakeAuthority.publicKey,
            newConfigExtensionAuthority:
              updatedConfigExtensionAuthorityKeypair.publicKey,
          }),
        )
          .addSigner(fakeAuthority)
          .buildAndExecute(),
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
      await setConfigExtensionAuthority(
        whirlpoolsConfigKeypair.publicKey,
        initialConfigExtensionAuthorityKeypair,
        updatedConfigExtensionAuthorityKeypair.publicKey,
      );
      const extension = await fetcher.getConfigExtension(
        whirlpoolsConfigExtension,
        IGNORE_CACHE,
      );
      assert.ok(
        extension?.configExtensionAuthority.equals(
          updatedConfigExtensionAuthorityKeypair.publicKey,
        ),
      );

      const ix: TransactionInstruction =
        program.instruction.setConfigExtensionAuthority({
          accounts: {
            whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
            whirlpoolsConfigExtension,
            configExtensionAuthority:
              updatedConfigExtensionAuthorityKeypair.publicKey,
            newConfigExtensionAuthority: Keypair.generate().publicKey,
          },
        });

      assert.equal(ix.keys.length, 4);
      assert.ok(
        ix.keys[2].pubkey.equals(
          updatedConfigExtensionAuthorityKeypair.publicKey,
        ),
      );

      // unset signer flag
      ix.keys[2].isSigner = false;

      const tx = toTx(ctx, {
        instructions: [ix],
        cleanupInstructions: [],
        signers: [], // no updatedConfigExtensionAuthorityKeypair
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc2/, // AccountNotSigner
      );
    });
  });
});
