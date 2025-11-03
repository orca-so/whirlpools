import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type {
  InitConfigParams,
  WhirlpoolsConfigData,
  WhirlpoolContext,
} from "../../../src";
import { toTx, WhirlpoolIx } from "../../../src";
import {
  getLocalnetAdminKeypair0,
  getLocalnetAdminKeypair1,
  ONE_SOL,
  systemTransferTx,
} from "../../utils";
import { initializeLiteSVMEnvironment } from "../../utils/litesvm";
import { generateDefaultConfigParams } from "../../utils/test-builders";

describe("initialize_config", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
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
