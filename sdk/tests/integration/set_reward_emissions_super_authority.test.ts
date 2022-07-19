import * as anchor from "@project-serum/anchor";
import * as assert from "assert";
import { toTx, WhirlpoolContext, WhirlpoolIx, WhirlpoolsConfigData } from "../../src";
import { generateDefaultConfigParams } from "../utils/test-builders";

describe("set_reward_emissions_super_authority", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, provider.wallet, program);
  const fetcher = ctx.fetcher;

  it("successfully set_reward_emissions_super_authority with super authority keypair", async () => {
    const {
      configInitInfo,
      configKeypairs: { rewardEmissionsSuperAuthorityKeypair },
    } = generateDefaultConfigParams(ctx);

    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo)).buildAndExecute();
    const newAuthorityKeypair = anchor.web3.Keypair.generate();

    await toTx(
      ctx,
      WhirlpoolIx.setRewardEmissionsSuperAuthorityIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        rewardEmissionsSuperAuthority: rewardEmissionsSuperAuthorityKeypair.publicKey,
        newRewardEmissionsSuperAuthority: newAuthorityKeypair.publicKey,
      })
    )
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
    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo)).buildAndExecute();

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
    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo)).buildAndExecute();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setRewardEmissionsSuperAuthorityIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          rewardEmissionsSuperAuthority: provider.wallet.publicKey,
          newRewardEmissionsSuperAuthority: provider.wallet.publicKey,
        })
      ).buildAndExecute(),
      /0x7dc/ // An address constraint was violated
    );
  });
});
