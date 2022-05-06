import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { WhirlpoolContext, AccountFetcher, WhirlpoolsConfigData, WhirlpoolIx } from "../../src";
import { generateDefaultConfigParams } from "../utils/test-builders";

describe("set_reward_emissions_super_authority", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = new AccountFetcher(ctx.connection);

  it("successfully set_reward_emissions_super_authority with super authority keypair", async () => {
    const {
      configInitInfo,
      configKeypairs: { rewardEmissionsSuperAuthorityKeypair },
    } = generateDefaultConfigParams(ctx);

    await WhirlpoolIx.initializeConfigIx(ctx, configInitInfo).toTx().buildAndExecute();
    const newAuthorityKeypair = anchor.web3.Keypair.generate();

    await WhirlpoolIx.setRewardEmissionsSuperAuthorityIx(ctx, {
      whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
      rewardEmissionsSuperAuthority: rewardEmissionsSuperAuthorityKeypair.publicKey,
      newRewardEmissionsSuperAuthority: newAuthorityKeypair.publicKey,
    })
      .toTx()
      .addSigner(rewardEmissionsSuperAuthorityKeypair)
      .buildAndExecute();

    const config = (await fetcher.getConfig(
      configInitInfo.whirlpoolsConfigKeypair.publicKey
    )) as WhirlpoolsConfigData;
    assert.ok(config.rewardEmissionsSuperAuthority.equals(newAuthorityKeypair.publicKey));
  });

  it("fails if current reward_emissions_super_authority is not a signer", async () => {
    const {
      configInitInfo,
      configKeypairs: { rewardEmissionsSuperAuthorityKeypair },
    } = generateDefaultConfigParams(ctx);
    await WhirlpoolIx.initializeConfigIx(ctx, configInitInfo).toTx().buildAndExecute();

    await assert.rejects(
      ctx.program.rpc.setRewardEmissionsSuperAuthority({
        accounts: {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          rewardEmissionsSuperAuthority: rewardEmissionsSuperAuthorityKeypair.publicKey,
          newRewardEmissionsSuperAuthority: provider.wallet.publicKey,
        },
      }),
      /Signature verification failed/
    );
  });

  it("fails if incorrect reward_emissions_super_authority is passed in", async () => {
    const { configInitInfo } = generateDefaultConfigParams(ctx);
    await WhirlpoolIx.initializeConfigIx(ctx, configInitInfo).toTx().buildAndExecute();

    await assert.rejects(
      WhirlpoolIx.setRewardEmissionsSuperAuthorityIx(ctx, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        rewardEmissionsSuperAuthority: provider.wallet.publicKey,
        newRewardEmissionsSuperAuthority: provider.wallet.publicKey,
      })
        .toTx()
        .buildAndExecute(),
      /0x7dc/ // An address constraint was violated
    );
  });
});
