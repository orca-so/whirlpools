import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import {
  WhirlpoolContext,
  AccountFetcher,
  WhirlpoolsConfigData,
  WhirlpoolIx,
  InitConfigParams,
} from "../../src";
import { systemTransferTx, ONE_SOL } from "../utils";
import { generateDefaultConfigParams } from "../utils/test-builders";
import { toTx } from "../../src/utils/instructions-util";

describe("initialize_config", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = new AccountFetcher(ctx.connection);

  let initializedConfigInfo: InitConfigParams;

  it("successfully init a WhirlpoolsConfig account", async () => {
    const { configInitInfo } = generateDefaultConfigParams(ctx);
    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo)).buildAndExecute();

    const configAccount = (await fetcher.getConfig(
      configInitInfo.whirlpoolsConfigKeypair.publicKey
    )) as WhirlpoolsConfigData;

    assert.ok(
      configAccount.collectProtocolFeesAuthority.equals(configInitInfo.collectProtocolFeesAuthority)
    );

    assert.ok(configAccount.feeAuthority.equals(configInitInfo.feeAuthority));

    assert.ok(
      configAccount.rewardEmissionsSuperAuthority.equals(
        configInitInfo.rewardEmissionsSuperAuthority
      )
    );

    assert.equal(configAccount.defaultProtocolFeeRate, configInitInfo.defaultProtocolFeeRate);

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
        WhirlpoolIx.initializeConfigIx(ctx.program, infoWithDupeConfigKey)
      ).buildAndExecute(),
      /0x0/
    );
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();
    const { configInitInfo } = generateDefaultConfigParams(ctx, funderKeypair.publicKey);
    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo))
      .addSigner(funderKeypair)
      .buildAndExecute();
  });
});
