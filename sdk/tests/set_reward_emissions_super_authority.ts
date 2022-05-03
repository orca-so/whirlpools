import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { WhirlpoolContext } from "../src/context";
import { WhirlpoolClient } from "../src/client";
import { generateDefaultConfigParams } from "./utils/test-builders";

describe("set_reward_emissions_super_authority", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  it("successfully set_reward_emissions_super_authority with super authority keypair", async () => {
    const {
      configInitInfo,
      configKeypairs: { rewardEmissionsSuperAuthorityKeypair },
    } = generateDefaultConfigParams(context);

    await client.initConfigTx(configInitInfo).buildAndExecute();
    const newAuthorityKeypair = anchor.web3.Keypair.generate();

    await client
      .setRewardEmissionsSuperAuthorityTx({
        whirlpoolsConfig: configInitInfo.whirlpoolConfigKeypair.publicKey,
        rewardEmissionsSuperAuthority: rewardEmissionsSuperAuthorityKeypair.publicKey,
        newRewardEmissionsSuperAuthority: newAuthorityKeypair.publicKey,
      })
      .addSigner(rewardEmissionsSuperAuthorityKeypair)
      .buildAndExecute();

    const config = await client.getConfig(configInitInfo.whirlpoolConfigKeypair.publicKey);
    assert.ok(config.rewardEmissionsSuperAuthority.equals(newAuthorityKeypair.publicKey));
  });

  it("fails if current reward_emissions_super_authority is not a signer", async () => {
    const {
      configInitInfo,
      configKeypairs: { rewardEmissionsSuperAuthorityKeypair },
    } = generateDefaultConfigParams(context);
    await client.initConfigTx(configInitInfo).buildAndExecute();

    await assert.rejects(
      context.program.rpc.setRewardEmissionsSuperAuthority({
        accounts: {
          whirlpoolsConfig: configInitInfo.whirlpoolConfigKeypair.publicKey,
          rewardEmissionsSuperAuthority: rewardEmissionsSuperAuthorityKeypair.publicKey,
          newRewardEmissionsSuperAuthority: provider.wallet.publicKey,
        },
      }),
      /Signature verification failed/
    );
  });

  it("fails if incorrect reward_emissions_super_authority is passed in", async () => {
    const { configInitInfo } = generateDefaultConfigParams(context);
    await client.initConfigTx(configInitInfo).buildAndExecute();

    await assert.rejects(
      client
        .setRewardEmissionsSuperAuthorityTx({
          whirlpoolsConfig: configInitInfo.whirlpoolConfigKeypair.publicKey,
          rewardEmissionsSuperAuthority: provider.wallet.publicKey,
          newRewardEmissionsSuperAuthority: provider.wallet.publicKey,
        })
        .buildAndExecute(),
      /0x7dc/ // An address constraint was violated
    );
  });
});
