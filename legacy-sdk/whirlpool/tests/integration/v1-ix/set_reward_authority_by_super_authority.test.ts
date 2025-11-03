import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { WhirlpoolData, WhirlpoolContext } from "../../../src";
import { PoolUtil, toTx, WhirlpoolIx } from "../../../src";
import { TickSpacing } from "../../utils";
import { initializeLiteSVMEnvironment } from "../../utils/litesvm";
import { initTestPool } from "../../utils/init-utils";

describe("set_reward_authority_by_super_authority", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

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
      PoolUtil.getRewardAuthority(pool).equals(newAuthorityKeypair.publicKey),
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

  it("successfully set_reward_authority_by_super_authority even when an invalid reward index is provided", async () => {
    const { configKeypairs, poolInitInfo, configInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    // -1 is invalid value for u8
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

    // 200 is invalid value for u8, but it is not checked in the instruction (ignored)
    await toTx(
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
      .buildAndExecute();
  });
});
