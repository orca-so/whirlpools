import { deriveATA, MathUtil, Percentage } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import * as assert from "assert";
import { u64 } from "@solana/spl-token";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  collectRewardsQuote,
  TickArrayUtil,
  Whirlpool,
  WhirlpoolClient,
  WhirlpoolContext,
} from "../../../src";
import { TickSpacing } from "../../utils";
import { WhirlpoolTestFixture } from "../../utils/fixture";

interface SharedTestContext {
  provider: anchor.AnchorProvider;
  program: Whirlpool;
  whirlpoolCtx: WhirlpoolContext;
  whirlpoolClient: WhirlpoolClient;
}

// TODO(meep): These tests are kind of flaky, I think this also has to do with the rewards quote bug.
describe("PositionImpl#collectRewards()", () => {
  let testCtx: SharedTestContext;
  const tickLowerIndex = 29440;
  const tickUpperIndex = 33536;
  const vaultStartBalance = 1_000_000;
  const tickSpacing = TickSpacing.Standard;
  const liquidityAmount = new u64(10_000_000);

  async function delay(ms: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  before(() => {
    const provider = anchor.AnchorProvider.local(undefined, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });

    anchor.setProvider(provider);
    const program = anchor.workspace.Whirlpool;
    const whirlpoolCtx = WhirlpoolContext.fromWorkspace(provider, program);
    const whirlpoolClient = buildWhirlpoolClient(whirlpoolCtx);

    testCtx = {
      provider,
      program,
      whirlpoolCtx,
      whirlpoolClient,
    };
  });

  async function accrueRewards(fixture: WhirlpoolTestFixture) {
    const ctx = testCtx.whirlpoolCtx;

    const {
      positions: [positionInfo],
      poolInitInfo,
    } = fixture.getInfos();

    const position = await testCtx.whirlpoolClient.getPosition(positionInfo.publicKey);
    const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey);

    const tickLowerArrayData = await ctx.fetcher.getTickArray(positionInfo.tickArrayLower, true);

    const tickUpperArrayData = await ctx.fetcher.getTickArray(positionInfo.tickArrayUpper, true);

    const tickLower = TickArrayUtil.getTickFromArray(
      tickLowerArrayData!,
      tickLowerIndex,
      tickSpacing
    );

    const tickUpper = TickArrayUtil.getTickFromArray(
      tickUpperArrayData!,
      tickUpperIndex,
      tickSpacing
    );

    const rewardsQuote = collectRewardsQuote({
      whirlpool: await pool.refreshData(),
      position: await position.refreshData(),
      tickLower,
      tickUpper,
    });

    assert.ok(
      rewardsQuote.some((quote) => quote && quote.gtn(0)),
      "Rewards haven't accrued"
    );
  }

  context("when the whirlpool is SPL-only", () => {
    it("should collect rewards", async () => {
      const fixture = await new WhirlpoolTestFixture(testCtx.whirlpoolCtx).init({
        tickSpacing,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position
        ],
        rewards: [
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new u64(vaultStartBalance),
          },
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new u64(vaultStartBalance),
          },
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new u64(vaultStartBalance),
          },
        ],
      });

      await accrueRewards(fixture);

      const { positions, poolInitInfo, rewards } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey);
      const position = await testCtx.whirlpoolClient.getPosition(positions[0].publicKey);

      const positionDataBefore = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        true
      );

      const otherWallet = anchor.web3.Keypair.generate();

      const poolData = await pool.refreshData();
      const positionData = await position.refreshData();
      const tickLowerData = position.getLowerTickData();
      const tickUpperData = position.getLowerTickData();

      const quote = collectRewardsQuote({
        whirlpool: poolData,
        position: positionData,
        tickLower: tickLowerData,
        tickUpper: tickUpperData,
      });

      assert.notEqual(positionDataBefore, null);

      const tx = await position.collectRewards(
        rewards.map((r) => r.rewardMint),
        true,
        undefined,
        otherWallet.publicKey,
        testCtx.provider.wallet.publicKey,
        testCtx.provider.wallet.publicKey,
        true
      );

      await tx.buildAndExecute();

      const positionDataAfter = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        true
      );

      assert.notEqual(positionDataAfter, null);

      const r0Pubkey = await deriveATA(otherWallet.publicKey, rewards[0].rewardMint);
      const r0Account = await testCtx.whirlpoolCtx.fetcher.getTokenInfo(r0Pubkey, true);
      assert.ok(quote[0] && r0Account && r0Account.amount.eq(quote[0]));

      const r1Pubkey = await deriveATA(otherWallet.publicKey, rewards[1].rewardMint);
      const r1Account = await testCtx.whirlpoolCtx.fetcher.getTokenInfo(r1Pubkey, true);
      assert.ok(quote[1] && r1Account && r1Account.amount.eq(quote[1]));

      const r2Pubkey = await deriveATA(otherWallet.publicKey, rewards[2].rewardMint);
      const r2Account = await testCtx.whirlpoolCtx.fetcher.getTokenInfo(r2Pubkey, true);
      assert.ok(quote[2] && r2Account && r2Account.amount.eq(quote[2]));
    });
  });

  context("when the whirlpool is SOL-SPL", () => {
    it("should collect rewards", async () => {
      const fixture = await new WhirlpoolTestFixture(testCtx.whirlpoolCtx).init({
        tickSpacing,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position
        ],
        rewards: [
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new u64(vaultStartBalance),
          },
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new u64(vaultStartBalance),
          },
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new u64(vaultStartBalance),
          },
        ],
        tokenAIsNative: true,
      });

      await accrueRewards(fixture);

      const { positions, poolInitInfo, rewards } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey);
      const position = await testCtx.whirlpoolClient.getPosition(positions[0].publicKey);

      const positionDataBefore = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        true
      );

      const otherWallet = anchor.web3.Keypair.generate();

      const poolData = await pool.refreshData();
      const positionData = await position.refreshData();
      const tickLowerData = position.getLowerTickData();
      const tickUpperData = position.getLowerTickData();

      const quote = collectRewardsQuote({
        whirlpool: poolData,
        position: positionData,
        tickLower: tickLowerData,
        tickUpper: tickUpperData,
      });

      assert.notEqual(positionDataBefore, null);

      const tx = await position.collectRewards(
        rewards.map((r) => r.rewardMint),
        true,
        undefined,
        otherWallet.publicKey,
        testCtx.provider.wallet.publicKey,
        testCtx.provider.wallet.publicKey,
        true
      );

      await tx.buildAndExecute();

      const positionDataAfter = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        true
      );

      assert.notEqual(positionDataAfter, null);

      const r0Pubkey = await deriveATA(otherWallet.publicKey, rewards[0].rewardMint);
      const r0Account = await testCtx.whirlpoolCtx.fetcher.getTokenInfo(r0Pubkey, true);
      assert.ok(quote[0] && r0Account && r0Account.amount.eq(quote[0]));

      const r1Pubkey = await deriveATA(otherWallet.publicKey, rewards[1].rewardMint);
      const r1Account = await testCtx.whirlpoolCtx.fetcher.getTokenInfo(r1Pubkey, true);
      assert.ok(quote[1] && r1Account && r1Account.amount.eq(quote[1]));

      const r2Pubkey = await deriveATA(otherWallet.publicKey, rewards[2].rewardMint);
      const r2Account = await testCtx.whirlpoolCtx.fetcher.getTokenInfo(r2Pubkey, true);
      assert.ok(quote[2] && r2Account && r2Account.amount.eq(quote[2]));
    });
  });
});
