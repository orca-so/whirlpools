import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import {
  WhirlpoolContext,
  AccountFetcher,
  NUM_REWARDS,
  WhirlpoolData,
  WhirlpoolIx,
  toTx,
} from "../../src";
import { TickSpacing } from "../utils";
import { initTestPool } from "../utils/init-utils";
import { TransactionBuilder } from "@orca-so/common-sdk";

describe("set_reward_authority", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = new AccountFetcher(ctx.connection);

  it("successfully set_reward_authority at every reward index", async () => {
    const { configKeypairs, poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const newKeypairs = generateKeypairs(NUM_REWARDS);
    const txBuilder = new TransactionBuilder(provider);
    for (let i = 0; i < NUM_REWARDS; i++) {
      txBuilder.addInstruction(
        WhirlpoolIx.setRewardAuthorityIx(ctx.program, {
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardAuthority: configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          newRewardAuthority: newKeypairs[i].publicKey,
          rewardIndex: i,
        })
      );
    }
    await txBuilder
      .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
      .buildAndExecute();

    const pool = (await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey)) as WhirlpoolData;
    for (let i = 0; i < NUM_REWARDS; i++) {
      assert.ok(pool.rewardInfos[i].authority.equals(newKeypairs[i].publicKey));
    }
  });

  it("fails when provided reward_authority does not match whirlpool reward authority", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const fakeAuthority = anchor.web3.Keypair.generate();
    const newAuthority = anchor.web3.Keypair.generate();
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setRewardAuthorityIx(ctx.program, {
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardAuthority: fakeAuthority.publicKey,
          newRewardAuthority: newAuthority.publicKey,
          rewardIndex: 0,
        })
      )
        .addSigner(fakeAuthority)
        .buildAndExecute(),
      /0x7dc/ // An address constraint was violated
    );
  });

  it("fails on invalid reward index", async () => {
    const { configKeypairs, poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const newAuthority = anchor.web3.Keypair.generate();
    assert.throws(() => {
      toTx(
        ctx,
        WhirlpoolIx.setRewardAuthorityIx(ctx.program, {
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardAuthority: configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          newRewardAuthority: newAuthority.publicKey,
          rewardIndex: -1,
        })
      ).buildAndExecute();
    }, /out of range/);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setRewardAuthorityIx(ctx.program, {
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardAuthority: configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          newRewardAuthority: newAuthority.publicKey,
          rewardIndex: 255,
        })
      )
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute()
      //   /failed to send transaction/
    );
  });

  it("fails when reward_authority is not a signer", async () => {
    const { configKeypairs, poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const newAuthority = anchor.web3.Keypair.generate();
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setRewardAuthorityIx(ctx.program, {
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardAuthority: configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          newRewardAuthority: newAuthority.publicKey,
          rewardIndex: 0,
        })
      ).buildAndExecute(),
      /Signature verification failed/
    );
  });
});

function generateKeypairs(n: number): anchor.web3.Keypair[] {
  const keypairs = [];
  for (let i = 0; i < n; i++) {
    keypairs.push(anchor.web3.Keypair.generate());
  }
  return keypairs;
}
