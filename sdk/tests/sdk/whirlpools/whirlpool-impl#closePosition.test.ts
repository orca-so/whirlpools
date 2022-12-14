import { deriveATA, MathUtil, Percentage } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import * as assert from "assert";
import { u64 } from "@solana/spl-token";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  collectFeesQuote,
  collectRewardsQuote,
  PDAUtil,
  TickArrayUtil,
  toTx,
  Whirlpool,
  WhirlpoolClient,
  WhirlpoolContext,
  WhirlpoolIx,
} from "../../../src";
import { createAssociatedTokenAccount, TickSpacing, transfer, ZERO_BN } from "../../utils";
import { WhirlpoolTestFixture } from "../../utils/fixture";

interface SharedTestContext {
  provider: anchor.AnchorProvider;
  program: Whirlpool;
  whirlpoolCtx: WhirlpoolContext;
  whirlpoolClient: WhirlpoolClient;
}

describe("WhirlpoolImpl#closePosition()", () => {
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

  async function accrueFees(fixture: WhirlpoolTestFixture) {
    const ctx = testCtx.whirlpoolCtx;
    const {
      poolInitInfo,
      positions: [positionInfo],
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();

    const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } = poolInitInfo;

    const tickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpoolPda.publicKey, 22528);
    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);
    const position = await testCtx.whirlpoolClient.getPosition(positionInfo.publicKey);

    // Accrue fees in token A
    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new u64(200_000),
        otherAmountThreshold: ZERO_BN,
        sqrtPriceLimit: MathUtil.toX64(new Decimal(4)),
        amountSpecifiedIsInput: true,
        aToB: true,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: tokenVaultBKeypair.publicKey,
        tickArray0: tickArrayPda.publicKey,
        tickArray1: tickArrayPda.publicKey,
        tickArray2: tickArrayPda.publicKey,
        oracle: oraclePda.publicKey,
      })
    ).buildAndExecute();

    // Accrue fees in token B
    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new u64(200_000),
        otherAmountThreshold: ZERO_BN,
        sqrtPriceLimit: MathUtil.toX64(new Decimal(5)),
        amountSpecifiedIsInput: true,
        aToB: false,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: tokenVaultBKeypair.publicKey,
        tickArray0: tickArrayPda.publicKey,
        tickArray1: tickArrayPda.publicKey,
        tickArray2: tickArrayPda.publicKey,
        oracle: oraclePda.publicKey,
      })
    ).buildAndExecute();

    const poolData = await pool.refreshData();
    const positionData = await position.refreshData();
    const tickLowerData = position.getLowerTickData();
    const tickUpperData = position.getLowerTickData();

    const quote = collectFeesQuote({
      whirlpool: poolData,
      position: positionData,
      tickLower: tickLowerData,
      tickUpper: tickUpperData,
    });

    assert.ok(quote.feeOwedA.gtn(0) || quote.feeOwedB.gtn(0));
  }

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

  async function removeLiquidity(fixture: WhirlpoolTestFixture) {
    const {
      positions: [positionInfo],
    } = fixture.getInfos();
    const position = await testCtx.whirlpoolClient.getPosition(positionInfo.publicKey);

    const tx = await position.decreaseLiquidity({
      tokenMinA: new u64(0),
      tokenMinB: new u64(0),
      liquidityAmount,
    });

    await tx.buildAndExecute();
  }

  async function testClosePosition(fixture: WhirlpoolTestFixture) {
    const { positions, poolInitInfo } = fixture.getInfos();

    const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const position = await testCtx.whirlpoolClient.getPosition(positions[0].publicKey);

    const positionDataBefore = await testCtx.whirlpoolCtx.fetcher.getPosition(
      position.getAddress(),
      true
    );

    assert.notEqual(positionDataBefore, null);

    const txs = await pool.closePosition(position.getAddress(), Percentage.fromFraction(10, 100));

    for (const tx of txs) {
      await tx.buildAndExecute();
    }

    const positionDataAfter = await testCtx.whirlpoolCtx.fetcher.getPosition(
      position.getAddress(),
      true
    );

    assert.equal(positionDataAfter, null);
  }

  context("when the whirlpool is SPL-only", () => {
    it("should close a position with no liquidity, fees, or rewards", async () => {
      const fixture = await new WhirlpoolTestFixture(testCtx.whirlpoolCtx).init({
        tickSpacing,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position
        ],
      });

      await removeLiquidity(fixture);
      await testClosePosition(fixture);
    });

    it("should close a position with only liquidity", async () => {
      const fixture = await new WhirlpoolTestFixture(testCtx.whirlpoolCtx).init({
        tickSpacing,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position
        ],
      });

      await testClosePosition(fixture);
    });

    it("should close a position with only fees", async () => {
      const fixture = await new WhirlpoolTestFixture(testCtx.whirlpoolCtx).init({
        tickSpacing,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position
        ],
      });

      await accrueFees(fixture);
      await removeLiquidity(fixture);

      await testClosePosition(fixture);
    });

    it("should close a position with only rewards", async () => {
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
      await removeLiquidity(fixture);

      await testClosePosition(fixture);
    });

    it("should close a position with only liquidity and fees", async () => {
      const fixture = await new WhirlpoolTestFixture(testCtx.whirlpoolCtx).init({
        tickSpacing,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position
        ],
      });

      await accrueFees(fixture);
      await testClosePosition(fixture);
    });

    // TODO(meep): This test fails because of reward quote not working (I think)
    it("should close a position with only liquidity and rewards", async () => {
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
      await testClosePosition(fixture);
    });

    it("should close a position with only fees and rewards", async () => {
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

      await accrueFees(fixture);
      await accrueRewards(fixture);
      await removeLiquidity(fixture);
      await testClosePosition(fixture);
    });

    it("should close a position with liquidity, fees, and rewards", async () => {
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

      await accrueFees(fixture);
      await accrueRewards(fixture);
      await testClosePosition(fixture);
    });

    it("should close a position with liquidity, fees, and rewards (no ATAs)", async () => {
      const ctx = testCtx.whirlpoolCtx;
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

      const otherWallet = anchor.web3.Keypair.generate();
      const positionData = fixture.getInfos().positions[0];

      const position = await testCtx.whirlpoolClient.getPosition(positionData.publicKey, true);

      const walletPositionTokenAccount = await deriveATA(
        testCtx.whirlpoolCtx.wallet.publicKey,
        positionData.mintKeypair.publicKey
      );

      const newOwnerPositionTokenAccount = await createAssociatedTokenAccount(
        ctx.provider,
        positionData.mintKeypair.publicKey,
        otherWallet.publicKey,
        ctx.wallet.publicKey
      );

      await accrueFees(fixture);
      await accrueRewards(fixture);
      await transfer(testCtx.provider, walletPositionTokenAccount, newOwnerPositionTokenAccount, 1);

      const { poolInitInfo } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey);

      const positionDataBefore = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        true
      );

      assert.notEqual(positionDataBefore, null);

      const txs = await pool.closePosition(
        position.getAddress(),
        Percentage.fromFraction(10, 100),
        otherWallet.publicKey,
        otherWallet.publicKey,
        ctx.wallet.publicKey
      );

      await txs[0].buildAndExecute();
      await txs[1].addSigner(otherWallet).buildAndExecute();

      const positionDataAfter = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        true
      );

      assert.equal(positionDataAfter, null);
    });
  });

  context("when the whirlpool is SOL-SPL", () => {
    it("should close a position with liquidity, fees, and rewards", async () => {
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

      await accrueFees(fixture);
      await accrueRewards(fixture);
      await testClosePosition(fixture);
    });

    it("should close a position with liquidity, fees, and rewards (no ATA)", async () => {
      const ctx = testCtx.whirlpoolCtx;
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

      const otherWallet = anchor.web3.Keypair.generate();
      const positionData = fixture.getInfos().positions[0];

      const position = await testCtx.whirlpoolClient.getPosition(positionData.publicKey, true);

      const walletPositionTokenAccount = await deriveATA(
        testCtx.whirlpoolCtx.wallet.publicKey,
        positionData.mintKeypair.publicKey
      );

      const newOwnerPositionTokenAccount = await createAssociatedTokenAccount(
        ctx.provider,
        positionData.mintKeypair.publicKey,
        otherWallet.publicKey,
        ctx.wallet.publicKey
      );

      await accrueFees(fixture);
      await accrueRewards(fixture);
      await transfer(testCtx.provider, walletPositionTokenAccount, newOwnerPositionTokenAccount, 1);

      const { poolInitInfo } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey);

      const positionDataBefore = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        true
      );

      assert.notEqual(positionDataBefore, null);

      const txs = await pool.closePosition(
        position.getAddress(),
        Percentage.fromFraction(10, 100),
        otherWallet.publicKey,
        otherWallet.publicKey,
        ctx.wallet.publicKey
      );

      await txs[0].buildAndExecute();
      await txs[1].addSigner(otherWallet).buildAndExecute();

      const positionDataAfter = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        true
      );

      assert.equal(positionDataAfter, null);
    });
  });
});
