import * as anchor from "@coral-xyz/anchor";
import { deriveATA, MathUtil, Percentage } from "@orca-so/common-sdk";
import { u64 } from "@solana/spl-token";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  collectFeesQuote,
  collectRewardsQuote,
  decreaseLiquidityQuoteByLiquidity,
  NUM_REWARDS,
  PDAUtil, Whirlpool,
  WhirlpoolClient,
  WhirlpoolContext
} from "../../../src";
import { createAssociatedTokenAccount, sleep, TickSpacing, transfer, ZERO_BN } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
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

  async function accrueFeesAndRewards(fixture: WhirlpoolTestFixture) {
    const ctx = testCtx.whirlpoolCtx;
    const { poolInitInfo } = fixture.getInfos();
    const { whirlpoolClient } = testCtx;
    const { whirlpoolPda } = poolInitInfo;
    const tickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpoolPda.publicKey, 22528);

    // Accrue fees in token A
    const pool = await whirlpoolClient.getPool(whirlpoolPda.publicKey, true);
    await (await pool.swap({
      amount: new u64(200_000),
      amountSpecifiedIsInput: true,
      sqrtPriceLimit: MathUtil.toX64(new Decimal(4)),
      otherAmountThreshold: ZERO_BN,
      aToB: true,
      tickArray0: tickArrayPda.publicKey,
      tickArray1: tickArrayPda.publicKey,
      tickArray2: tickArrayPda.publicKey,
    })).buildAndExecute()

    // Accrue fees in token B
    await (await pool.swap({
      amount: new u64(200_000),
      otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: MathUtil.toX64(new Decimal(5)),
      amountSpecifiedIsInput: true,
      aToB: false,
      tickArray0: tickArrayPda.publicKey,
      tickArray1: tickArrayPda.publicKey,
      tickArray2: tickArrayPda.publicKey,
    })).buildAndExecute()

    // accrue rewards
    await sleep(1200);
  }

  async function removeLiquidity(fixture: WhirlpoolTestFixture) {
    const {
      poolInitInfo,
      positions: [positionInfo],
    } = fixture.getInfos();
    const position = await testCtx.whirlpoolClient.getPosition(positionInfo.publicKey, true);
    const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey, true);


    const liquidityCollectedQuote = await decreaseLiquidityQuoteByLiquidity(
      position.getData().liquidity,
      Percentage.fromDecimal(new Decimal(0)),
      position,
      pool
    );

    const tx = await position.decreaseLiquidity(liquidityCollectedQuote);

    await tx.buildAndExecute();
  }

  async function collectFees(fixture: WhirlpoolTestFixture) {
    const { positions } = fixture.getInfos();
    const { whirlpoolClient } = testCtx;
    const position = await whirlpoolClient.getPosition(positions[0].publicKey, true);
    const hasL = !position.getData().liquidity.isZero()
    await (await position.collectFees(hasL)).buildAndExecute();
  }

  async function collectRewards(fixture: WhirlpoolTestFixture) {
    const { positions } = fixture.getInfos();
    const { whirlpoolClient } = testCtx;
    const position = await whirlpoolClient.getPosition(positions[0].publicKey, true);
    await (await position.collectRewards(undefined, true)).buildAndExecute();
  }

  async function testClosePosition(fixture: WhirlpoolTestFixture, isWSOLTest = false) {
    const { positions, poolInitInfo, rewards } = fixture.getInfos();
    const { whirlpoolClient } = testCtx;
    const ctx = whirlpoolClient.getContext();
    const otherWallet = anchor.web3.Keypair.generate();

    const pool = await whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey, true);
    const position = await whirlpoolClient.getPosition(positions[0].publicKey, true);
    const preClosePoolData = pool.getData();
    const positionAccountBalance = await ctx.connection.getBalance(positions[0].publicKey);

    const txs = await pool.closePosition(
      position.getAddress(),
      Percentage.fromFraction(10, 100),
      otherWallet.publicKey,
      undefined,
      ctx.wallet.publicKey
    );

    // TODO: Our createWSOLAccountInstructions ignores payer and requires destinationWallet to sign
    // We can remove this once we move to syncNative and wSOL becomes another ATA to handle.
    if (isWSOLTest) {
      txs[1].addSigner(otherWallet)
    }

    await txs[0].buildAndExecute();
    await txs[1].buildAndExecute();

    // Verify liquidity and fees collected
    const liquidityCollectedQuote = decreaseLiquidityQuoteByLiquidity(
      position.getData().liquidity,
      Percentage.fromDecimal(new Decimal(0)),
      position,
      pool
    );

    const feeQuote = collectFeesQuote({
      position: position.getData(),
      whirlpool: pool.getData(),
      tickLower: position.getLowerTickData(),
      tickUpper: position.getUpperTickData(),
    });
    const accountAPubkey = await deriveATA(otherWallet.publicKey, poolInitInfo.tokenMintA);
    const accountA = await ctx.fetcher.getTokenInfo(accountAPubkey, true);
    const expectAmountA = liquidityCollectedQuote.tokenMinA.add(feeQuote.feeOwedA);
    if (isWSOLTest) {
      // If this is a WSOL test, we have to account for account rent retrieval
      const solInOtherWallet = await ctx.connection.getBalance(otherWallet.publicKey);
      const minAccountExempt = await ctx.fetcher.getAccountRentExempt();
      const expectedReceivedSol = liquidityCollectedQuote.tokenMinA
        .add(feeQuote.feeOwedA)
        .add(new u64(positionAccountBalance))
        .add(new u64(minAccountExempt))
        .add(new u64(minAccountExempt))
        .toNumber();
      assert.equal(solInOtherWallet, expectedReceivedSol);
    } else if (expectAmountA.isZero()) {
      assert.ok(!accountA || accountA.amount.isZero());
    } else {
      assert.equal(
        accountA?.amount.toString(),
        expectAmountA.toString()
      );
    }

    const accountBPubkey = await deriveATA(otherWallet.publicKey, poolInitInfo.tokenMintB);
    const accountB = await ctx.fetcher.getTokenInfo(accountBPubkey, true);
    const expectAmountB = liquidityCollectedQuote.tokenMinB.add(feeQuote.feeOwedB);
    if (expectAmountB.isZero()) {
      assert.ok(!accountB || accountB.amount.isZero());
    } else {
      assert.equal(
        accountB?.amount.toString(),
        expectAmountB.toString()
      );
    }

    // Verify reward collected. We use the same timestamp that the closePosition call used to collectRewards.
    const postClosePoolData = await pool.refreshData();
    const rewardQuote = collectRewardsQuote({
      position: position.getData(),
      whirlpool: preClosePoolData,
      tickLower: position.getLowerTickData(),
      tickUpper: position.getUpperTickData(),
      timeStampInSeconds: postClosePoolData.rewardLastUpdatedTimestamp,
    });
    for (let i = 0; i < NUM_REWARDS; i++) {
      if (!!rewards[i]) {
        const rewardATA = await deriveATA(otherWallet.publicKey, rewards[i].rewardMint);
        const rewardTokenAccount = await ctx.fetcher.getTokenInfo(rewardATA, true);
        assert.equal(rewardTokenAccount?.amount.toString(), rewardQuote[i]?.toString());
      }
    }
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

      await accrueFeesAndRewards(fixture);
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

      // accrue rewards
      // closePosition does not attempt to create an ATA unless reward has accumulated.
      await sleep(1200);

      await removeLiquidity(fixture);
      await collectFees(fixture);
      await testClosePosition(fixture);
    });

    it("should close a position with only liquidity and fees", async () => {
      const fixture = await new WhirlpoolTestFixture(testCtx.whirlpoolCtx).init({
        tickSpacing,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position
        ],
      });

      await accrueFeesAndRewards(fixture);
      await testClosePosition(fixture);
    });

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

      // accrue rewards
      // closePosition does not attempt to create an ATA unless reward has accumulated.
      await sleep(1200);

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

      await accrueFeesAndRewards(fixture);
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

      await accrueFeesAndRewards(fixture);
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

      await accrueFeesAndRewards(fixture);
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

      await accrueFeesAndRewards(fixture);
      await testClosePosition(fixture, true);
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

      await accrueFeesAndRewards(fixture);
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
