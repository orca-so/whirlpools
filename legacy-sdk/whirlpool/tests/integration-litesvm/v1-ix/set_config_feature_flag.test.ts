import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import { toTx, WhirlpoolContext, WhirlpoolIx } from "../../../src";
import { dropIsSignerFlag, getLocalnetAdminKeypair0 } from "../../utils";
import { startLiteSVM, createLiteSVMProvider } from "../../utils/litesvm";
import { IGNORE_CACHE } from "../../../dist/network/public/fetcher/fetcher-types";

describe("set_config_feature_flag (litesvm)", () => {
  let provider: anchor.AnchorProvider;

  let program: anchor.Program;

  let ctx: WhirlpoolContext;

  let fetcher: any;


  beforeAll(async () => {

    await startLiteSVM();

    provider = await createLiteSVMProvider();

    const programId = new anchor.web3.PublicKey(

      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"

    );

    const idl = require("../../../src/artifacts/whirlpool.json");

    program = new anchor.Program(idl, programId, provider);

  // program initialized in beforeAll
  ctx = WhirlpoolContext.fromWorkspace(provider, program);
  fetcher = ctx.fetcher;

  });

  let configAddress: anchor.web3.PublicKey;

  beforeEach(async () => {
    const admin = await getLocalnetAdminKeypair0(ctx);
    const newConfigAddress = anchor.web3.Keypair.generate();

    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, {
        whirlpoolsConfigKeypair: newConfigAddress,
        collectProtocolFeesAuthority: ctx.wallet.publicKey,
        feeAuthority: ctx.wallet.publicKey,
        rewardEmissionsSuperAuthority: ctx.wallet.publicKey,
        defaultProtocolFeeRate: 300,
        funder: admin.publicKey,
      }),
    )
      .addSigner(admin)
      .buildAndExecute();

    configAddress = newConfigAddress.publicKey;
  });

  describe("successfully set_config_feature_flag (litesvm)", () => {
    it("TokenBadge flag", async () => {
      const admin = await getLocalnetAdminKeypair0(ctx);

      const preConfig = await fetcher.getConfig(configAddress, IGNORE_CACHE);
      assert.ok(preConfig);

      assert.equal(preConfig.featureFlags, 0);

      await toTx(
        ctx,
        WhirlpoolIx.setConfigFeatureFlagIx(ctx.program, {
          whirlpoolsConfig: configAddress,
          authority: admin.publicKey,
          featureFlag: {
            tokenBadge: [true],
          },
        }),
      )
        .addSigner(admin)
        .buildAndExecute();

      const postConfig = await fetcher.getConfig(configAddress, IGNORE_CACHE);
      assert.ok(postConfig);
      assert.equal(postConfig.featureFlags, 1);

      await toTx(
        ctx,
        WhirlpoolIx.setConfigFeatureFlagIx(ctx.program, {
          whirlpoolsConfig: configAddress,
          authority: admin.publicKey,
          featureFlag: {
            tokenBadge: [false],
          },
        }),
      )
        .addSigner(admin)
        .buildAndExecute();

      const resetConfig = await fetcher.getConfig(configAddress, IGNORE_CACHE);
      assert.ok(resetConfig);
      assert.equal(resetConfig.featureFlags, 0);
    });
  });

  it("fails when authority is not a signer", async () => {
    const admin = await getLocalnetAdminKeypair0(ctx);

    const ix = WhirlpoolIx.setConfigFeatureFlagIx(ctx.program, {
      whirlpoolsConfig: configAddress,
      authority: admin.publicKey,
      featureFlag: {
        tokenBadge: [true],
      },
    });

    const ixWithoutSigner = dropIsSignerFlag(
      ix.instructions[0],
      admin.publicKey,
    );

    const tx = toTx(ctx, {
      instructions: [ixWithoutSigner],
      cleanupInstructions: [],
      signers: [],
    });
    // not adding admin as a signer

    await assert.rejects(
      tx.buildAndExecute(),
      /0xbc2/, // AccountNotSigner
    );
  });

  it("fails when authority is not one of ADMINS", async () => {
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setConfigFeatureFlagIx(ctx.program, {
          whirlpoolsConfig: configAddress,
          authority: ctx.wallet.publicKey, // Not an admin
          featureFlag: {
            tokenBadge: [true],
          },
        }),
      ).buildAndExecute(),
      /0x7d3/, // ConstraintRaw
    );
  });

  it("fails when feature_flag is invalid", async () => {
    const admin = await getLocalnetAdminKeypair0(ctx);

    const preConfig = await fetcher.getConfig(configAddress, IGNORE_CACHE);
    assert.ok(preConfig);

    assert.equal(preConfig.featureFlags, 0);

    const ix = WhirlpoolIx.setConfigFeatureFlagIx(ctx.program, {
      whirlpoolsConfig: configAddress,
      authority: admin.publicKey,
      featureFlag: {
        tokenBadge: [true],
      },
    }).instructions[0];

    assert.ok(ix.data.length === 8 + 1 + 1); // ix discriminator + enum discriminator + bool value
    assert.ok(ix.data[8] === 0x00); // TokenBadge
    assert.ok(ix.data[9] === 0x01); // true

    ix.data[8] = 0x01; // invalid enum discriminator
    ix.data[9] = 0x00; // valid bool value
    await assert.rejects(
      toTx(ctx, { instructions: [ix], cleanupInstructions: [], signers: [] })
        .addSigner(admin)
        .buildAndExecute(),
      /InstructionDidNotDeserialize/, // cannot deserialize ConfigFeatureFlag enum,
    );

    ix.data[8] = 0x01; // invalid enum discriminator
    ix.data[9] = 0x02; // invalid bool value
    await assert.rejects(
      toTx(ctx, { instructions: [ix], cleanupInstructions: [], signers: [] })
        .addSigner(admin)
        .buildAndExecute(),
      /InstructionDidNotDeserialize/, // cannot deserialize ConfigFeatureFlag enum,
    );

    ix.data[8] = 0x00; // valid enum discriminator
    ix.data[9] = 0x02; // invalid bool value
    await assert.rejects(
      toTx(ctx, { instructions: [ix], cleanupInstructions: [], signers: [] })
        .addSigner(admin)
        .buildAndExecute(),
      /InstructionDidNotDeserialize/, // cannot deserialize ConfigFeatureFlag enum,
    );
  });
});
