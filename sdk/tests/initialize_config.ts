import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { WhirlpoolContext } from "../src/context";
import { WhirlpoolClient } from "../src/client";
import { InitConfigParams } from "../src/types/public/ix-types";
import { generateDefaultConfigParams } from "./utils/test-builders";
import { ONE_SOL, systemTransferTx } from "./utils";

describe("initialize_config", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  let initializedConfigInfo: InitConfigParams;

  it("successfully init a WhirlpoolsConfig account", async () => {
    const { configInitInfo } = generateDefaultConfigParams(context);
    await client.initConfigTx(configInitInfo).buildAndExecute();

    const configAccount = await client.getConfig(configInitInfo.whirlpoolConfigKeypair.publicKey);

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
      ...generateDefaultConfigParams(context).configInitInfo,
      whirlpoolConfigKeypair: initializedConfigInfo.whirlpoolConfigKeypair,
    };
    await assert.rejects(client.initConfigTx(infoWithDupeConfigKey).buildAndExecute(), /0x0/);
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();
    const { configInitInfo } = generateDefaultConfigParams(context, funderKeypair.publicKey);
    await client.initConfigTx(configInitInfo).addSigner(funderKeypair).buildAndExecute();
  });
});
