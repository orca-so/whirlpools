import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { WhirlpoolContext } from "../src/context";
import { WhirlpoolClient } from "../src/client";
import { initTestPool } from "./utils/init-utils";
import { TickSpacing } from "./utils";

describe("set_reward_authority_by_super_authority", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  it("successfully set_reward_authority_by_super_authority", async () => {
    const { configKeypairs, poolInitInfo, configInitInfo } = await initTestPool(
      client,
      TickSpacing.Standard
    );
    const newAuthorityKeypair = anchor.web3.Keypair.generate();
    await client
      .setRewardAuthorityBySuperAuthorityTx({
        whirlpoolsConfig: configInitInfo.whirlpoolConfigKeypair.publicKey,
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        rewardEmissionsSuperAuthority:
          configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
        newRewardAuthority: newAuthorityKeypair.publicKey,
        rewardIndex: 0,
      })
      .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
      .buildAndExecute();
    const pool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);
    assert.ok(pool.rewardInfos[0].authority.equals(newAuthorityKeypair.publicKey));
  });

  it("fails if invalid whirlpool provided", async () => {
    const { configKeypairs, configInitInfo } = await initTestPool(client, TickSpacing.Standard);
    const {
      poolInitInfo: { whirlpoolPda: invalidPool },
    } = await initTestPool(client, TickSpacing.Standard);

    await assert.rejects(
      client
        .setRewardAuthorityBySuperAuthorityTx({
          whirlpoolsConfig: configInitInfo.whirlpoolConfigKeypair.publicKey,
          whirlpool: invalidPool.publicKey,
          rewardEmissionsSuperAuthority:
            configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          newRewardAuthority: provider.wallet.publicKey,
          rewardIndex: 0,
        })
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute(),
      /0x7d1/ // A has_one constraint was violated
    );
  });

  it("fails if invalid super authority provided", async () => {
    const { poolInitInfo, configInitInfo } = await initTestPool(client, TickSpacing.Standard);
    const invalidSuperAuthorityKeypair = anchor.web3.Keypair.generate();

    await assert.rejects(
      client
        .setRewardAuthorityBySuperAuthorityTx({
          whirlpoolsConfig: configInitInfo.whirlpoolConfigKeypair.publicKey,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardEmissionsSuperAuthority: invalidSuperAuthorityKeypair.publicKey,
          newRewardAuthority: provider.wallet.publicKey,
          rewardIndex: 0,
        })
        .addSigner(invalidSuperAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/ // An address constraint was violated
    );
  });

  it("fails if super authority is not a signer", async () => {
    const { configKeypairs, poolInitInfo, configInitInfo } = await initTestPool(
      client,
      TickSpacing.Standard
    );

    await assert.rejects(
      client
        .setRewardAuthorityBySuperAuthorityTx({
          whirlpoolsConfig: configInitInfo.whirlpoolConfigKeypair.publicKey,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardEmissionsSuperAuthority:
            configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          newRewardAuthority: provider.wallet.publicKey,
          rewardIndex: 0,
        })
        .buildAndExecute(),
      /Signature verification failed/
    );
  });

  it("fails on invalid reward index", async () => {
    const { configKeypairs, poolInitInfo, configInitInfo } = await initTestPool(
      client,
      TickSpacing.Standard
    );

    assert.throws(() => {
      client
        .setRewardAuthorityBySuperAuthorityTx({
          whirlpoolsConfig: configInitInfo.whirlpoolConfigKeypair.publicKey,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardEmissionsSuperAuthority:
            configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          newRewardAuthority: provider.wallet.publicKey,
          rewardIndex: -1,
        })
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute();
    }, /out of range/);

    await assert.rejects(
      client
        .setRewardAuthorityBySuperAuthorityTx({
          whirlpoolsConfig: configInitInfo.whirlpoolConfigKeypair.publicKey,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardEmissionsSuperAuthority:
            configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          newRewardAuthority: provider.wallet.publicKey,
          rewardIndex: 200,
        })
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute(),
      /0x178a/ // InvalidRewardIndex
    );
  });
});
