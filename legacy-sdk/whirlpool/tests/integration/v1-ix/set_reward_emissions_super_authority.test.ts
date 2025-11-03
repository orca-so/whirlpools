import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { WhirlpoolsConfigData, WhirlpoolContext } from "../../../src";
import { toTx, WhirlpoolIx } from "../../../src";
import { initializeLiteSVMEnvironment } from "../../utils/litesvm";
import { generateDefaultConfigParams } from "../../utils/test-builders";
import { getLocalnetAdminKeypair0 } from "../../utils";

describe("set_reward_emissions_super_authority", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  it("successfully set_reward_emissions_super_authority with super authority keypair", async () => {
    const admin = await getLocalnetAdminKeypair0(ctx);
    const {
      configInitInfo,
      configKeypairs: { rewardEmissionsSuperAuthorityKeypair },
    } = generateDefaultConfigParams(ctx, admin.publicKey);

    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo))
      .addSigner(admin)
      .buildAndExecute();
    const newAuthorityKeypair = anchor.web3.Keypair.generate();

    await toTx(
      ctx,
      WhirlpoolIx.setRewardEmissionsSuperAuthorityIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        rewardEmissionsSuperAuthority:
          rewardEmissionsSuperAuthorityKeypair.publicKey,
        newRewardEmissionsSuperAuthority: newAuthorityKeypair.publicKey,
      }),
    )
      .addSigner(rewardEmissionsSuperAuthorityKeypair)
      .buildAndExecute();

    const config = (await fetcher.getConfig(
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
    )) as WhirlpoolsConfigData;
    assert.ok(
      config.rewardEmissionsSuperAuthority.equals(
        newAuthorityKeypair.publicKey,
      ),
    );
  });

  it("fails if current reward_emissions_super_authority is not a signer", async () => {
    const admin = await getLocalnetAdminKeypair0(ctx);
    const {
      configInitInfo,
      configKeypairs: { rewardEmissionsSuperAuthorityKeypair },
    } = generateDefaultConfigParams(ctx, admin.publicKey);
    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo))
      .addSigner(admin)
      .buildAndExecute();

    await assert.rejects(
      ctx.program.rpc.setRewardEmissionsSuperAuthority({
        accounts: {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          rewardEmissionsSuperAuthority:
            rewardEmissionsSuperAuthorityKeypair.publicKey,
          newRewardEmissionsSuperAuthority: provider.wallet.publicKey,
        },
      }),
      /.*signature verification fail.*/i,
    );
  });

  it("fails if incorrect reward_emissions_super_authority is passed in", async () => {
    const admin = await getLocalnetAdminKeypair0(ctx);
    const { configInitInfo } = generateDefaultConfigParams(
      ctx,
      admin.publicKey,
    );
    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo))
      .addSigner(admin)
      .buildAndExecute();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setRewardEmissionsSuperAuthorityIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          rewardEmissionsSuperAuthority: provider.wallet.publicKey,
          newRewardEmissionsSuperAuthority: provider.wallet.publicKey,
        }),
      ).buildAndExecute(),
      /0x7dc/, // An address constraint was violated
    );
  });
});
