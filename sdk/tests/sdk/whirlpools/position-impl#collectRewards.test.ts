import * as anchor from "@coral-xyz/anchor";
import { deriveATA, MathUtil } from "@orca-so/common-sdk";
import { u64 } from "@solana/spl-token";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  collectRewardsQuote,
  NUM_REWARDS,
  Whirlpool,
  WhirlpoolClient,
  WhirlpoolContext
} from "../../../src";
import { TickSpacing } from "../../utils";
import { WhirlpoolTestFixture } from "../../utils/fixture";

interface SharedTestContext {
  provider: anchor.AnchorProvider;
  program: Whirlpool;
  whirlpoolCtx: WhirlpoolContext;
  whirlpoolClient: WhirlpoolClient;
}

describe("PositionImpl#collectRewards()", () => {
  let testCtx: SharedTestContext;
  const tickLowerIndex = 29440;
  const tickUpperIndex = 33536;
  const vaultStartBalance = 1_000_000;
  const tickSpacing = TickSpacing.Standard;
  const liquidityAmount = new u64(10_000_000);

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

      const { positions, poolInitInfo, rewards } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey, true);
      const position = await testCtx.whirlpoolClient.getPosition(positions[0].publicKey, true);

      const otherWallet = anchor.web3.Keypair.generate();
      const preCollectPoolData = pool.getData();

      await (
        await position.collectRewards(
          rewards.map((r) => r.rewardMint),
          true,
          undefined,
          otherWallet.publicKey,
          testCtx.provider.wallet.publicKey,
          testCtx.provider.wallet.publicKey,
          true
        )
      ).buildAndExecute();

      // Verify the results fetched is the same as SDK estimate if the timestamp is the same
      const postCollectPoolData = await pool.refreshData();
      const quote = collectRewardsQuote({
        whirlpool: preCollectPoolData,
        position: position.getData(),
        tickLower: position.getLowerTickData(),
        tickUpper: position.getUpperTickData(),
        timeStampInSeconds: postCollectPoolData.rewardLastUpdatedTimestamp,
      });

      for (let i = 0; i < NUM_REWARDS; i++) {
        const rewardATA = await deriveATA(otherWallet.publicKey, rewards[i].rewardMint);
        const rewardTokenAccount = await testCtx.whirlpoolCtx.fetcher.getTokenInfo(rewardATA, true);
        assert.equal(rewardTokenAccount?.amount.toString(), quote[i]?.toString());
      }
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

      const { positions, poolInitInfo, rewards } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey, true);
      const position = await testCtx.whirlpoolClient.getPosition(positions[0].publicKey, true);
      const otherWallet = anchor.web3.Keypair.generate();
      const preCollectPoolData = pool.getData();

      await (
        await position.collectRewards(
          rewards.map((r) => r.rewardMint),
          true,
          undefined,
          otherWallet.publicKey,
          testCtx.provider.wallet.publicKey,
          testCtx.provider.wallet.publicKey,
          true
        )
      ).buildAndExecute();

      // Verify the results fetched is the same as SDK estimate if the timestamp is the same
      const postCollectPoolData = await pool.refreshData();
      const quote = collectRewardsQuote({
        whirlpool: preCollectPoolData,
        position: position.getData(),
        tickLower: position.getLowerTickData(),
        tickUpper: position.getUpperTickData(),
        timeStampInSeconds: postCollectPoolData.rewardLastUpdatedTimestamp,
      });

      for (let i = 0; i < NUM_REWARDS; i++) {
        const rewardATA = await deriveATA(otherWallet.publicKey, rewards[i].rewardMint);
        const rewardTokenAccount = await testCtx.whirlpoolCtx.fetcher.getTokenInfo(rewardATA, true);
        assert.equal(rewardTokenAccount?.amount.toString(), quote[i]?.toString());
      }
    });
  });
});
