import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { WhirlpoolData } from "../../src";
import { toTx, WhirlpoolContext, WhirlpoolIx } from "../../src";
import { TickSpacing } from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { initTestPool } from "../utils/init-utils";

describe("set_reward_authority_by_super_authority", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  it("successfully set_reward_authority_by_super_authority", async () => {
    const { configKeypairs, poolInitInfo, configInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const newAuthorityKeypair = anchor.web3.Keypair.generate();
    await toTx(
      ctx,
      WhirlpoolIx.setRewardAuthorityBySuperAuthorityIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        rewardEmissionsSuperAuthority:
          configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
        newRewardAuthority: newAuthorityKeypair.publicKey,
        rewardIndex: 0,
      }),
    )
      .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
      .buildAndExecute();
    const pool = (await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
    )) as WhirlpoolData;
    assert.ok(
      pool.rewardInfos[0].authority.equals(newAuthorityKeypair.publicKey),
    );
  });

  it("fails if invalid whirlpool provided", async () => {
    const { configKeypairs, configInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const {
      poolInitInfo: { whirlpoolPda: invalidPool },
    } = await initTestPool(ctx, TickSpacing.Standard);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setRewardAuthorityBySuperAuthorityIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          whirlpool: invalidPool.publicKey,
          rewardEmissionsSuperAuthority:
            configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          newRewardAuthority: provider.wallet.publicKey,
          rewardIndex: 0,
        }),
      )
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute(),
      /0x7d1/, // A has_one constraint was violated
    );
  });

  it("fails if invalid super authority provided", async () => {
    const { poolInitInfo, configInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const invalidSuperAuthorityKeypair = anchor.web3.Keypair.generate();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setRewardAuthorityBySuperAuthorityIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardEmissionsSuperAuthority: invalidSuperAuthorityKeypair.publicKey,
          newRewardAuthority: provider.wallet.publicKey,
          rewardIndex: 0,
        }),
      )
        .addSigner(invalidSuperAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/, // An address constraint was violated
    );
  });

  it("fails if super authority is not a signer", async () => {
    const { configKeypairs, poolInitInfo, configInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setRewardAuthorityBySuperAuthorityIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardEmissionsSuperAuthority:
            configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          newRewardAuthority: provider.wallet.publicKey,
          rewardIndex: 0,
        }),
      ).buildAndExecute(),
      /.*signature verification fail.*/i,
    );
  });

  it("fails on invalid reward index", async () => {
    const { configKeypairs, poolInitInfo, configInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    assert.throws(() => {
      toTx(
        ctx,
        WhirlpoolIx.setRewardAuthorityBySuperAuthorityIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardEmissionsSuperAuthority:
            configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          newRewardAuthority: provider.wallet.publicKey,
          rewardIndex: -1,
        }),
      )
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute();
    }, /out of range/);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setRewardAuthorityBySuperAuthorityIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardEmissionsSuperAuthority:
            configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          newRewardAuthority: provider.wallet.publicKey,
          rewardIndex: 200,
        }),
      )
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute(),
      /0x178a/, // InvalidRewardIndex
    );
  });
});
