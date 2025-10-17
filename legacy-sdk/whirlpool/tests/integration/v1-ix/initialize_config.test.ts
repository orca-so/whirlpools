import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { InitConfigParams, WhirlpoolsConfigData } from "../../../src";
import { toTx, WhirlpoolContext, WhirlpoolIx } from "../../../src";
import {
  getLocalnetAdminKeypair0,
  getLocalnetAdminKeypair1,
  ONE_SOL,
  systemTransferTx,
} from "../../utils";
import { startLiteSVM, createLiteSVMProvider } from "../../utils/litesvm";
import { generateDefaultConfigParams } from "../../utils/test-builders";

describe("initialize_config (litesvm)", () => {
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

  let initializedConfigInfo: InitConfigParams;

  it("successfully init a WhirlpoolsConfig account", async () => {
    const admin = await getLocalnetAdminKeypair0(ctx);
    const { configInitInfo } = generateDefaultConfigParams(
      ctx,
      admin.publicKey,
    );
    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo))
      .addSigner(admin)
      .buildAndExecute();

    const configAccount = (await fetcher.getConfig(
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
    )) as WhirlpoolsConfigData;

    assert.ok(
      configAccount.collectProtocolFeesAuthority.equals(
        configInitInfo.collectProtocolFeesAuthority,
      ),
    );

    assert.ok(configAccount.feeAuthority.equals(configInitInfo.feeAuthority));

    assert.ok(
      configAccount.rewardEmissionsSuperAuthority.equals(
        configInitInfo.rewardEmissionsSuperAuthority,
      ),
    );

    assert.equal(
      configAccount.defaultProtocolFeeRate,
      configInitInfo.defaultProtocolFeeRate,
    );

    assert.equal(configAccount.featureFlags, 0);

    initializedConfigInfo = configInitInfo;
  });

  it("fail on passing in already initialized whirlpool account", async () => {
    let infoWithDupeConfigKey = {
      ...generateDefaultConfigParams(ctx).configInitInfo,
      whirlpoolsConfigKeypair: initializedConfigInfo.whirlpoolsConfigKeypair,
    };
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.initializeConfigIx(ctx.program, infoWithDupeConfigKey),
      ).buildAndExecute(),
      /0x0/,
    );
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    const funderKeypair = await getLocalnetAdminKeypair1(ctx);
    const { configInitInfo } = generateDefaultConfigParams(
      ctx,
      funderKeypair.publicKey,
    );
    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo))
      .addSigner(funderKeypair)
      .buildAndExecute();
  });

  it("fail when funder is NOT one of ADMINS", async () => {
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(
      provider,
      funderKeypair.publicKey,
      ONE_SOL,
    ).buildAndExecute();
    const { configInitInfo } = generateDefaultConfigParams(
      ctx,
      funderKeypair.publicKey,
    );
    await assert.rejects(
      toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo))
        .addSigner(funderKeypair)
        .buildAndExecute(),
      /0x7d3/, // Constraint
    );
  });
});
