import * as anchor from "@coral-xyz/anchor";
import { MathUtil, Percentage } from "@orca-so/common-sdk";
import { Account, getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as assert from "assert";
import { BN } from "bn.js";
import Decimal from "decimal.js";
import {
  NUM_REWARDS,
  PDAUtil, Whirlpool,
  WhirlpoolClient,
  WhirlpoolContext,
  buildWhirlpoolClient,
  collectFeesQuote,
  collectRewardsQuote,
  decreaseLiquidityQuoteByLiquidity
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { TickSpacing, ZERO_BN, createAssociatedTokenAccount, sleep, transferToken } from "../../utils";
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

  async function accrueFeesAndRewards(fixture: WhirlpoolTestFixture) {
    const ctx = testCtx.whirlpoolCtx;
    const { poolInitInfo } = fixture.getInfos();
    const { whirlpoolClient } = testCtx;
    const { whirlpoolPda } = poolInitInfo;
    const tickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpoolPda.publicKey, 22528);

    // Accrue fees in token A
    const pool = await whirlpoolClient.getPool(whirlpoolPda.publicKey, IGNORE_CACHE);
    await (await pool.swap({
      amount: new BN(200_000),
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
      amount: new BN(200_000),
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
    const position = await testCtx.whirlpoolClient.getPosition(positionInfo.publicKey, IGNORE_CACHE);
    const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey, IGNORE_CACHE);


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
    const position = await whirlpoolClient.getPosition(positions[0].publicKey, IGNORE_CACHE);
    const hasL = !position.getData().liquidity.isZero()
    await (await position.collectFees(hasL)).buildAndExecute();
  }

  async function collectRewards(fixture: WhirlpoolTestFixture) {
    const { positions } = fixture.getInfos();
    const { whirlpoolClient } = testCtx;
    const position = await whirlpoolClient.getPosition(positions[0].publicKey, IGNORE_CACHE);
    await (await position.collectRewards(undefined, true)).buildAndExecute();
  }

  async function testClosePosition(fixture: WhirlpoolTestFixture, isWSOLTest = false) {
    const { positions, poolInitInfo, rewards } = fixture.getInfos();
    const { whirlpoolClient } = testCtx;
    const ctx = whirlpoolClient.getContext();
    const otherWallet = anchor.web3.Keypair.generate();

    const pool = await whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey, IGNORE_CACHE);
    const position = await whirlpoolClient.getPosition(positions[0].publicKey, IGNORE_CACHE);
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
      txs[txs.length - 1].addSigner(otherWallet)
    }

    for (const tx of txs) {
      await tx.buildAndExecute();
    }

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
    const accountAPubkey = getAssociatedTokenAddressSync(poolInitInfo.tokenMintA, otherWallet.publicKey);
    const accountA = (await ctx.fetcher.getTokenInfo(accountAPubkey, IGNORE_CACHE)) as Account;
    const expectAmountA = liquidityCollectedQuote.tokenMinA.add(feeQuote.feeOwedA);
    if (isWSOLTest) {
      // If this is a WSOL test, we have to account for account rent retrieval
      const solInOtherWallet = await ctx.connection.getBalance(otherWallet.publicKey);
      const minAccountExempt = await ctx.fetcher.getAccountRentExempt();
      const expectedReceivedSol = liquidityCollectedQuote.tokenMinA
        .add(feeQuote.feeOwedA)
        .add(new BN(positionAccountBalance))
        .add(new BN(minAccountExempt))
        .add(new BN(minAccountExempt))
        .toNumber();
      assert.equal(solInOtherWallet, expectedReceivedSol);
    } else if (expectAmountA.isZero()) {
      assert.ok(!accountA || accountA.amount === 0n);
    } else {
      assert.equal(
        accountA?.amount.toString(),
        expectAmountA.toString()
      );
    }

    const accountBPubkey = getAssociatedTokenAddressSync(poolInitInfo.tokenMintB, otherWallet.publicKey);
    const accountB = await ctx.fetcher.getTokenInfo(accountBPubkey, IGNORE_CACHE);
    const expectAmountB = liquidityCollectedQuote.tokenMinB.add(feeQuote.feeOwedB);
    if (expectAmountB.isZero()) {
      assert.ok(!accountB || accountB.amount === 0n);
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
        const rewardATA = getAssociatedTokenAddressSync(rewards[i].rewardMint, otherWallet.publicKey);
        const rewardTokenAccount = await ctx.fetcher.getTokenInfo(rewardATA, IGNORE_CACHE);
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

      const otherWallet = anchor.web3.Keypair.generate();
      const positionData = fixture.getInfos().positions[0];

      const position = await testCtx.whirlpoolClient.getPosition(positionData.publicKey, IGNORE_CACHE);

      const walletPositionTokenAccount = getAssociatedTokenAddressSync(
        positionData.mintKeypair.publicKey,
        testCtx.whirlpoolCtx.wallet.publicKey,
      );

      const newOwnerPositionTokenAccount = await createAssociatedTokenAccount(
        ctx.provider,
        positionData.mintKeypair.publicKey,
        otherWallet.publicKey,
        ctx.wallet.publicKey
      );

      await accrueFeesAndRewards(fixture);
      await transferToken(testCtx.provider, walletPositionTokenAccount, newOwnerPositionTokenAccount, 1);

      const { poolInitInfo } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey);

      const positionDataBefore = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        IGNORE_CACHE
      );

      assert.notEqual(positionDataBefore, null);

      const txs = await pool.closePosition(
        position.getAddress(),
        Percentage.fromFraction(10, 100),
        otherWallet.publicKey,
        otherWallet.publicKey,
        ctx.wallet.publicKey
      );

      txs[txs.length - 1].addSigner(otherWallet)

      for (const tx of txs) {
        await tx.buildAndExecute();
      }

      const positionDataAfter = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        IGNORE_CACHE
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

      const otherWallet = anchor.web3.Keypair.generate();
      const positionData = fixture.getInfos().positions[0];

      const position = await testCtx.whirlpoolClient.getPosition(positionData.publicKey, IGNORE_CACHE);

      const walletPositionTokenAccount = getAssociatedTokenAddressSync(
        positionData.mintKeypair.publicKey,
        testCtx.whirlpoolCtx.wallet.publicKey,
      );

      const newOwnerPositionTokenAccount = await createAssociatedTokenAccount(
        ctx.provider,
        positionData.mintKeypair.publicKey,
        otherWallet.publicKey,
        ctx.wallet.publicKey
      );

      await accrueFeesAndRewards(fixture);
      await transferToken(testCtx.provider, walletPositionTokenAccount, newOwnerPositionTokenAccount, 1);

      const { poolInitInfo } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey);

      const positionDataBefore = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        IGNORE_CACHE
      );

      assert.notEqual(positionDataBefore, null);

      const txs = await pool.closePosition(
        position.getAddress(),
        Percentage.fromFraction(10, 100),
        otherWallet.publicKey,
        otherWallet.publicKey,
        ctx.wallet.publicKey
      );

      txs[txs.length - 1].addSigner(otherWallet)

      for (const tx of txs) {
        await tx.buildAndExecute();
      }

      const positionDataAfter = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        IGNORE_CACHE
      );

      assert.equal(positionDataAfter, null);
    });
  });

  it("should only create 2 transactions if absolutely necessary", async () => {
    const ctx = testCtx.whirlpoolCtx;
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

    const otherWallet = anchor.web3.Keypair.generate();
    const positionData = fixture.getInfos().positions[0];

    const position = await testCtx.whirlpoolClient.getPosition(positionData.publicKey, IGNORE_CACHE);

    const walletPositionTokenAccount = getAssociatedTokenAddressSync(
      positionData.mintKeypair.publicKey,
      testCtx.whirlpoolCtx.wallet.publicKey,
    );

    const newOwnerPositionTokenAccount = await createAssociatedTokenAccount(
      ctx.provider,
      positionData.mintKeypair.publicKey,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );

    await accrueFeesAndRewards(fixture);
    await transferToken(testCtx.provider, walletPositionTokenAccount, newOwnerPositionTokenAccount, 1);

    const { poolInitInfo } = fixture.getInfos();

    const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey);

    const txsWith4Ata = await pool.closePosition(
      position.getAddress(),
      Percentage.fromFraction(10, 100),
      otherWallet.publicKey,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );
    assert.equal(txsWith4Ata.length, 2);

    await createAssociatedTokenAccount(
      ctx.provider,
      position.getWhirlpoolData().rewardInfos[0].mint,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );

    const txsWith3Ata = await pool.closePosition(
      position.getAddress(),
      Percentage.fromFraction(10, 100),
      otherWallet.publicKey,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );
    assert.equal(txsWith3Ata.length, 2);

    await createAssociatedTokenAccount(
      ctx.provider,
      position.getWhirlpoolData().rewardInfos[1].mint,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );

    const txsWith2Ata = await pool.closePosition(
      position.getAddress(),
      Percentage.fromFraction(10, 100),
      otherWallet.publicKey,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );
    assert.equal(txsWith2Ata.length, 2);

    await createAssociatedTokenAccount(
      ctx.provider,
      position.getWhirlpoolData().rewardInfos[2].mint,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );

    const txsWith1Ata = await pool.closePosition(
      position.getAddress(),
      Percentage.fromFraction(10, 100),
      otherWallet.publicKey,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );
    assert.equal(txsWith1Ata.length, 1);
    await txsWith1Ata[0].addSigner(otherWallet).buildAndExecute();
  });
});
