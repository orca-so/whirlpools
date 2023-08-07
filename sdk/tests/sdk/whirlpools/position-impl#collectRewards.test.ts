import * as anchor from "@coral-xyz/anchor";
import { MathUtil } from "@orca-so/common-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as assert from "assert";
import { BN } from "bn.js";
import Decimal from "decimal.js";
import {
  NUM_REWARDS,
  Whirlpool,
  WhirlpoolClient,
  WhirlpoolContext,
  buildWhirlpoolClient,
  collectRewardsQuote
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { TickSpacing, sleep } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
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
  const liquidityAmount = new BN(10_000_000);

  before(() => {
    const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);
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
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
        ],
      });

      const { positions, poolInitInfo, rewards } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey, IGNORE_CACHE);
      const position = await testCtx.whirlpoolClient.getPosition(positions[0].publicKey, IGNORE_CACHE);

      const otherWallet = anchor.web3.Keypair.generate();
      const preCollectPoolData = pool.getData();

      // accrue rewards
      await sleep(1200);

      await (
        await position.collectRewards(
          rewards.map((r) => r.rewardMint),
          true,
          undefined,
          otherWallet.publicKey,
          testCtx.provider.wallet.publicKey,
          testCtx.provider.wallet.publicKey,
          IGNORE_CACHE
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

      // Check that the expectation is not zero
      for (let i = 0; i < NUM_REWARDS; i++) {
        assert.ok(!quote[i]!.isZero());
      }

      for (let i = 0; i < NUM_REWARDS; i++) {
        const rewardATA = getAssociatedTokenAddressSync(rewards[i].rewardMint, otherWallet.publicKey);
        const rewardTokenAccount = await testCtx.whirlpoolCtx.fetcher.getTokenInfo(rewardATA, IGNORE_CACHE);
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
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
        ],
        tokenAIsNative: true,
      });

      const { positions, poolInitInfo, rewards } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey, IGNORE_CACHE);
      const position = await testCtx.whirlpoolClient.getPosition(positions[0].publicKey, IGNORE_CACHE);
      const otherWallet = anchor.web3.Keypair.generate();
      const preCollectPoolData = pool.getData();

      // accrue rewards
      await sleep(1200);

      await (
        await position.collectRewards(
          rewards.map((r) => r.rewardMint),
          true,
          undefined,
          otherWallet.publicKey,
          testCtx.provider.wallet.publicKey,
          testCtx.provider.wallet.publicKey,
          IGNORE_CACHE
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

      // Check that the expectation is not zero
      for (let i = 0; i < NUM_REWARDS; i++) {
        assert.ok(!quote[i]!.isZero());
      }

      for (let i = 0; i < NUM_REWARDS; i++) {
        const rewardATA = getAssociatedTokenAddressSync(rewards[i].rewardMint, otherWallet.publicKey);
        const rewardTokenAccount = await testCtx.whirlpoolCtx.fetcher.getTokenInfo(rewardATA, IGNORE_CACHE);
        assert.equal(rewardTokenAccount?.amount.toString(), quote[i]?.toString());
      }
    });
  });
});
