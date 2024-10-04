import * as anchor from "@coral-xyz/anchor";
import { MathUtil } from "@orca-so/common-sdk";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import * as assert from "assert";
import BN from "bn.js";
import Decimal from "decimal.js";
import type { Whirlpool, WhirlpoolClient } from "../../../src";
import {
  NUM_REWARDS,
  PDAUtil,
  WhirlpoolContext,
  buildWhirlpoolClient,
  collectRewardsQuote,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { MAX_U64, TEST_TOKEN_2022_PROGRAM_ID, TickSpacing, sleep } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import { TokenExtensionUtil } from "../../../src/utils/public/token-extension-util";
import { WhirlpoolTestFixtureV2 } from "../../utils/v2/fixture-v2";

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
    const provider = anchor.AnchorProvider.local(
      undefined,
      defaultConfirmOptions,
    );
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
      const fixture = await new WhirlpoolTestFixture(testCtx.whirlpoolCtx).init(
        {
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
        },
      );

      const { positions, poolInitInfo, rewards } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );
      const position = await testCtx.whirlpoolClient.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      );

      const otherWallet = anchor.web3.Keypair.generate();
      const preCollectPoolData = pool.getData();

      // accrue rewards
      await sleep(2000);

      const txs = await position.collectRewards(
        rewards.map((r) => r.rewardMint),
        true,
        undefined,
        otherWallet.publicKey,
        testCtx.provider.wallet.publicKey,
        testCtx.provider.wallet.publicKey,
        IGNORE_CACHE,
      );
      for (const tx of txs) {
        await tx.buildAndExecute();
      }

      // Verify the results fetched is the same as SDK estimate if the timestamp is the same
      const postCollectPoolData = await pool.refreshData();
      const quote = collectRewardsQuote({
        whirlpool: preCollectPoolData,
        position: position.getData(),
        tickLower: position.getLowerTickData(),
        tickUpper: position.getUpperTickData(),
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
          testCtx.whirlpoolCtx.fetcher,
          pool.getData(),
          IGNORE_CACHE,
        ),
        timeStampInSeconds: postCollectPoolData.rewardLastUpdatedTimestamp,
      });

      // Check that the expectation is not zero
      for (let i = 0; i < NUM_REWARDS; i++) {
        assert.ok(!quote.rewardOwed[i]!.isZero());
      }

      for (let i = 0; i < NUM_REWARDS; i++) {
        const rewardATA = getAssociatedTokenAddressSync(
          rewards[i].rewardMint,
          otherWallet.publicKey,
        );
        const rewardTokenAccount =
          await testCtx.whirlpoolCtx.fetcher.getTokenInfo(
            rewardATA,
            IGNORE_CACHE,
          );
        assert.equal(
          rewardTokenAccount?.amount.toString(),
          quote.rewardOwed[i]?.toString(),
        );
      }
    });

    it("should collect rewards (TokenExtensions based Position", async () => {
      const fixture = await new WhirlpoolTestFixture(testCtx.whirlpoolCtx).init(
        {
          tickSpacing,
          positions: [
            { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position (dummy)
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
        },
      );

      const { poolInitInfo, rewards } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
      );

      // open TokenExtensions based position
      const positionWithTokenExtensions = await pool.openPosition(tickLowerIndex, tickUpperIndex, {
        liquidityAmount,
        tokenMaxA: MAX_U64,
        tokenMaxB: MAX_U64,
      }, undefined, undefined, undefined, TOKEN_2022_PROGRAM_ID);
      await positionWithTokenExtensions.tx.buildAndExecute();
      const positionAddress = PDAUtil.getPosition(testCtx.whirlpoolCtx.program.programId, positionWithTokenExtensions.positionMint).publicKey;

      const position = await testCtx.whirlpoolClient.getPosition(
        positionAddress
      );
      assert.ok(position.getPositionMintTokenProgramId().equals(TOKEN_2022_PROGRAM_ID));

      const otherWallet = anchor.web3.Keypair.generate();
      const preCollectPoolData = await pool.refreshData();

      // accrue rewards
      await sleep(2000);

      const txs = await position.collectRewards(
        rewards.map((r) => r.rewardMint),
        true,
        undefined,
        otherWallet.publicKey,
        testCtx.provider.wallet.publicKey,
        testCtx.provider.wallet.publicKey,
        IGNORE_CACHE,
      );
      for (const tx of txs) {
        await tx.buildAndExecute();
      }

      // Verify the results fetched is the same as SDK estimate if the timestamp is the same
      const postCollectPoolData = await pool.refreshData();
      const quote = collectRewardsQuote({
        whirlpool: preCollectPoolData,
        position: position.getData(),
        tickLower: position.getLowerTickData(),
        tickUpper: position.getUpperTickData(),
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
          testCtx.whirlpoolCtx.fetcher,
          pool.getData(),
          IGNORE_CACHE,
        ),
        timeStampInSeconds: postCollectPoolData.rewardLastUpdatedTimestamp,
      });

      // Check that the expectation is not zero
      for (let i = 0; i < NUM_REWARDS; i++) {
        assert.ok(!quote.rewardOwed[i]!.isZero());
      }

      for (let i = 0; i < NUM_REWARDS; i++) {
        const rewardATA = getAssociatedTokenAddressSync(
          rewards[i].rewardMint,
          otherWallet.publicKey,
        );
        const rewardTokenAccount =
          await testCtx.whirlpoolCtx.fetcher.getTokenInfo(
            rewardATA,
            IGNORE_CACHE,
          );
        assert.equal(
          rewardTokenAccount?.amount.toString(),
          quote.rewardOwed[i]?.toString(),
        );
      }
    });
  });

  context("when the whirlpool is SOL-SPL", () => {
    it("should collect rewards", async () => {
      const fixture = await new WhirlpoolTestFixture(testCtx.whirlpoolCtx).init(
        {
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
        },
      );

      const { positions, poolInitInfo, rewards } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );
      const position = await testCtx.whirlpoolClient.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      );
      const otherWallet = anchor.web3.Keypair.generate();
      const preCollectPoolData = pool.getData();

      // accrue rewards
      await sleep(2000);

      const txs = await position.collectRewards(
        rewards.map((r) => r.rewardMint),
        true,
        undefined,
        otherWallet.publicKey,
        testCtx.provider.wallet.publicKey,
        testCtx.provider.wallet.publicKey,
        IGNORE_CACHE,
      );
      for (const tx of txs) {
        await tx.buildAndExecute();
      }

      // Verify the results fetched is the same as SDK estimate if the timestamp is the same
      const postCollectPoolData = await pool.refreshData();
      const quote = collectRewardsQuote({
        whirlpool: preCollectPoolData,
        position: position.getData(),
        tickLower: position.getLowerTickData(),
        tickUpper: position.getUpperTickData(),
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
          testCtx.whirlpoolCtx.fetcher,
          pool.getData(),
          IGNORE_CACHE,
        ),
        timeStampInSeconds: postCollectPoolData.rewardLastUpdatedTimestamp,
      });

      // Check that the expectation is not zero
      for (let i = 0; i < NUM_REWARDS; i++) {
        assert.ok(!quote.rewardOwed[i]!.isZero());
      }

      for (let i = 0; i < NUM_REWARDS; i++) {
        const rewardATA = getAssociatedTokenAddressSync(
          rewards[i].rewardMint,
          otherWallet.publicKey,
        );
        const rewardTokenAccount =
          await testCtx.whirlpoolCtx.fetcher.getTokenInfo(
            rewardATA,
            IGNORE_CACHE,
          );
        assert.equal(
          rewardTokenAccount?.amount.toString(),
          quote.rewardOwed[i]?.toString(),
        );
      }
    });
  });

  context("when the whirlpool is SPL-only (TokenExtension)", () => {
    it("should collect rewards", async () => {
      const fixture = await new WhirlpoolTestFixtureV2(
        testCtx.whirlpoolCtx,
      ).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position
        ],
        rewards: [
          {
            rewardTokenTrait: {
              isToken2022: true,
              hasTransferHookExtension: true,
            },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: {
              isToken2022: true,
              hasTransferHookExtension: true,
            },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: {
              isToken2022: true,
              hasTransferHookExtension: true,
            },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
        ],
      });

      const { positions, poolInitInfo, rewards } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );
      const position = await testCtx.whirlpoolClient.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      );

      const otherWallet = anchor.web3.Keypair.generate();
      const preCollectPoolData = pool.getData();

      // accrue rewards
      await sleep(2000);

      const txs = await position.collectRewards(
        rewards.map((r) => r.rewardMint),
        true,
        undefined,
        otherWallet.publicKey,
        testCtx.provider.wallet.publicKey,
        testCtx.provider.wallet.publicKey,
        IGNORE_CACHE,
      );
      for (const tx of txs) {
        await tx.buildAndExecute();
      }

      // Verify the results fetched is the same as SDK estimate if the timestamp is the same
      const postCollectPoolData = await pool.refreshData();
      const quote = collectRewardsQuote({
        whirlpool: preCollectPoolData,
        position: position.getData(),
        tickLower: position.getLowerTickData(),
        tickUpper: position.getUpperTickData(),
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
          testCtx.whirlpoolCtx.fetcher,
          pool.getData(),
          IGNORE_CACHE,
        ),
        timeStampInSeconds: postCollectPoolData.rewardLastUpdatedTimestamp,
      });

      // Check that the expectation is not zero
      for (let i = 0; i < NUM_REWARDS; i++) {
        assert.ok(!quote.rewardOwed[i]!.isZero());
      }

      for (let i = 0; i < NUM_REWARDS; i++) {
        const rewardATA = getAssociatedTokenAddressSync(
          rewards[i].rewardMint,
          otherWallet.publicKey,
          undefined,
          TEST_TOKEN_2022_PROGRAM_ID,
        );
        const rewardTokenAccount =
          await testCtx.whirlpoolCtx.fetcher.getTokenInfo(
            rewardATA,
            IGNORE_CACHE,
          );
        assert.equal(
          rewardTokenAccount?.amount.toString(),
          quote.rewardOwed[i]?.toString(),
        );
      }
    });
  });
});
