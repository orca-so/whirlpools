import * as anchor from "@coral-xyz/anchor";
import { deriveATA, MathUtil, TransactionBuilder, ZERO } from "@orca-so/common-sdk";
import { u64 } from "@solana/spl-token";
import { Keypair, SystemProgram } from "@solana/web3.js";
import * as assert from "assert";
import { BN } from "bn.js";
import Decimal from "decimal.js";
import { buildWhirlpoolClient, collectFeesQuote, NUM_REWARDS, PDAUtil, PoolUtil, PositionBundleData, POSITION_BUNDLE_SIZE, PriceMath, toTx, Whirlpool, WhirlpoolClient, WhirlpoolIx } from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import { createTokenAccount, TickSpacing, ZERO_BN } from "../../utils";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import { initializePositionBundle, openBundledPosition } from "../../utils/init-utils";


interface SharedTestContext {
  provider: anchor.AnchorProvider;
  program: Whirlpool;
  whirlpoolCtx: WhirlpoolContext;
  whirlpoolClient: WhirlpoolClient;
}

describe("bundled position management tests", () => {
  const provider = anchor.AnchorProvider.local(undefined, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  let testCtx: SharedTestContext;
  const tickLowerIndex = 29440;
  const tickUpperIndex = 33536;
  const tickSpacing = TickSpacing.Standard;
  const vaultStartBalance = 1_000_000;
  const liquidityAmount = new u64(10_000_000);
  const sleep = (second: number) => new Promise(resolve => setTimeout(resolve, second * 1000))

  before(() => {
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

  function checkBitmapIsOpened(account: PositionBundleData, bundleIndex: number): boolean {
    if (bundleIndex < 0 || bundleIndex >= POSITION_BUNDLE_SIZE) throw Error("bundleIndex is out of bounds");

    const bitmapIndex = Math.floor(bundleIndex / 8);
    const bitmapOffset = bundleIndex % 8;
    return (account.positionBitmap[bitmapIndex] & (1 << bitmapOffset)) > 0;
  }

  function checkBitmapIsClosed(account: PositionBundleData, bundleIndex: number): boolean {
    if (bundleIndex < 0 || bundleIndex >= POSITION_BUNDLE_SIZE) throw Error("bundleIndex is out of bounds");

    const bitmapIndex = Math.floor(bundleIndex / 8);
    const bitmapOffset = bundleIndex % 8;
    return (account.positionBitmap[bitmapIndex] & (1 << bitmapOffset)) === 0;
  }

  function checkBitmap(account: PositionBundleData, openedBundleIndexes: number[]) {
    for (let i = 0; i < POSITION_BUNDLE_SIZE; i++) {
      if (openedBundleIndexes.includes(i)) {
        assert.ok(checkBitmapIsOpened(account, i));
      }
      else {
        assert.ok(checkBitmapIsClosed(account, i));
      }
    }
  }

  async function accrueFees(fixture: WhirlpoolTestFixture) {
    const ctx = testCtx.whirlpoolCtx;
    const {
      poolInitInfo,
      positions,
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();

    const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } = poolInitInfo;

    const tickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpoolPda.publicKey, 22528);
    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);

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

    // all position should get some fees
    for (const positionInfo of positions) {
      const position = await testCtx.whirlpoolClient.getPosition(positionInfo.publicKey);

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
  }

  async function stopRewardsEmission(fixture: WhirlpoolTestFixture) {
    const ctx = testCtx.whirlpoolCtx;
    const { poolInitInfo, configKeypairs } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;

    const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);

    for (let i = 0; i < NUM_REWARDS; i++) {
      await toTx(
        ctx,
        WhirlpoolIx.setRewardEmissionsIx(ctx.program, {
          whirlpool: pool.getAddress(),
          rewardVaultKey: pool.getData().rewardInfos[i].vault,
          rewardAuthority: configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          rewardIndex: i,
          emissionsPerSecondX64: ZERO,
        })
      ).addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair).buildAndExecute();
    }
  }

  it(`successfully open POSITION_BUNDLE_SIZE(${POSITION_BUNDLE_SIZE}) bundled positions and then close them`, async () => {
    // create test pool
    const ctx = testCtx.whirlpoolCtx;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [],
      rewards: [],
    });
    const { poolInitInfo, rewards } = fixture.getInfos();
    // initialize position bundle
    const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);
    const positionBundlePubkey = positionBundleInfo.positionBundlePda.publicKey;
    const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;

    const batchSize = 12;
    const openedBundleIndexes: number[] = [];

    // open all
    for (let startBundleIndex = 0; startBundleIndex < POSITION_BUNDLE_SIZE; startBundleIndex += batchSize) {
      const minBundleIndex = startBundleIndex;
      const maxBundleIndex = Math.min(startBundleIndex + batchSize, POSITION_BUNDLE_SIZE) - 1;

      const builder = new TransactionBuilder(ctx.connection, ctx.wallet);

      for (let bundleIndex = minBundleIndex; bundleIndex <= maxBundleIndex; bundleIndex++) {
        const bundledPositionPda = PDAUtil.getBundledPosition(ctx.program.programId, positionBundleInfo.positionBundleMintKeypair.publicKey, bundleIndex);
        builder.addInstruction(WhirlpoolIx.openBundledPositionIx(ctx.program, {
          bundledPositionPda,
          bundleIndex,
          positionBundle: positionBundlePubkey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          tickLowerIndex,
          tickUpperIndex,
          whirlpool: whirlpoolPubkey,
          funder: ctx.wallet.publicKey
        }));
        openedBundleIndexes.push(bundleIndex);
      }

      await builder.buildAndExecute();
      const positionBundleAccount = await ctx.fetcher.getPositionBundle(positionBundlePubkey, true);
      checkBitmap(positionBundleAccount!, openedBundleIndexes);
    }
    assert.equal(openedBundleIndexes.length, POSITION_BUNDLE_SIZE);

    // close all
    for (let startBundleIndex = 0; startBundleIndex < POSITION_BUNDLE_SIZE; startBundleIndex += batchSize) {
      const minBundleIndex = startBundleIndex;
      const maxBundleIndex = Math.min(startBundleIndex + batchSize, POSITION_BUNDLE_SIZE) - 1;

      const builder = new TransactionBuilder(ctx.connection, ctx.wallet);

      for (let bundleIndex = minBundleIndex; bundleIndex <= maxBundleIndex; bundleIndex++) {
        const bundledPositionPda = PDAUtil.getBundledPosition(ctx.program.programId, positionBundleInfo.positionBundleMintKeypair.publicKey, bundleIndex);
        builder.addInstruction(WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: bundledPositionPda.publicKey,
          bundleIndex,
          positionBundle: positionBundlePubkey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          receiver: ctx.wallet.publicKey
        }));
        openedBundleIndexes.shift();
      }

      await builder.buildAndExecute();
      const positionBundleAccount = await ctx.fetcher.getPositionBundle(positionBundlePubkey, true);
      checkBitmap(positionBundleAccount!, openedBundleIndexes);
    }
    assert.equal(openedBundleIndexes.length, 0);

    // delete position bundle
    await toTx(
      ctx,
      WhirlpoolIx.deletePositionBundleIx(ctx.program, {
        positionBundle: positionBundlePubkey,
        positionBundleMint: positionBundleInfo.positionBundleMintKeypair.publicKey,
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        owner: ctx.wallet.publicKey,
        receiver: ctx.wallet.publicKey,
      })
    ).buildAndExecute();
    const positionBundleAccount = await ctx.fetcher.getPositionBundle(positionBundlePubkey, true);
    assert.ok(positionBundleAccount === null);
  });

  it("successfully increase/decrease liquidity and harvest on bundled position", async () => {
    // create test pool
    const ctx = testCtx.whirlpoolCtx;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        { liquidityAmount, tickLowerIndex, tickUpperIndex }, // non bundled position (to create TickArrays)
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
    const { poolInitInfo, rewards } = fixture.getInfos();

    // initialize position bundle
    const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

    // open bundled position
    const bundleIndex = 0;
    const positionInitInfo = await openBundledPosition(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      tickLowerIndex,
      tickUpperIndex
    );
    const { bundledPositionPda } = positionInitInfo.params;

    const bundledPositionPubkey = bundledPositionPda.publicKey;
    const tickArrayLower = PDAUtil.getTickArrayFromTickIndex(positionInitInfo.params.tickLowerIndex, poolInitInfo.tickSpacing, poolInitInfo.whirlpoolPda.publicKey, ctx.program.programId).publicKey;
    const tickArrayUpper = PDAUtil.getTickArrayFromTickIndex(positionInitInfo.params.tickUpperIndex, poolInitInfo.tickSpacing, poolInitInfo.whirlpoolPda.publicKey, ctx.program.programId).publicKey;
    const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;
    const tokenOwnerAccountA = await deriveATA(ctx.wallet.publicKey, poolInitInfo.tokenMintA);
    const tokenOwnerAccountB = await deriveATA(ctx.wallet.publicKey, poolInitInfo.tokenMintB);

    const modifyLiquidityParams = {
      liquidityAmount,
      position: bundledPositionPubkey,
      positionAuthority: ctx.wallet.publicKey,
      positionTokenAccount: positionBundleInfo.positionBundleTokenAccount,
      tickArrayLower,
      tickArrayUpper,
      tokenOwnerAccountA,
      tokenOwnerAccountB,
      tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
      tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
      whirlpool: whirlpoolPubkey,
    }

    // increaseLiquidity
    const depositAmounts = PoolUtil.getTokenAmountsFromLiquidity(
      liquidityAmount,
      (await ctx.fetcher.getPool(whirlpoolPubkey, true))!.sqrtPrice,
      PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex),
      PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex),
      true
    );

    const preIncrease = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
    assert.ok(preIncrease!.liquidity.isZero());
    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityIx(ctx.program, {
        ...modifyLiquidityParams,
        tokenMaxA: depositAmounts.tokenA,
        tokenMaxB: depositAmounts.tokenB,
      })
    ).buildAndExecute();
    const postIncrease = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
    assert.ok(postIncrease!.liquidity.eq(liquidityAmount));

    await sleep(2); // accrueRewards
    await accrueFees(fixture);
    await stopRewardsEmission(fixture);

    // updateFeesAndRewards
    const preUpdate = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
    assert.ok(preUpdate!.feeOwedA.isZero());
    assert.ok(preUpdate!.feeOwedB.isZero());
    assert.ok(preUpdate!.rewardInfos.every((r) => r.amountOwed.isZero()));
    await toTx(
      ctx,
      WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
        position: bundledPositionPubkey,
        tickArrayLower,
        tickArrayUpper,
        whirlpool: whirlpoolPubkey,
      })
    ).buildAndExecute();
    const postUpdate = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
    assert.ok(postUpdate!.feeOwedA.gtn(0));
    assert.ok(postUpdate!.feeOwedB.gtn(0));
    assert.ok(postUpdate!.rewardInfos.every((r) => r.amountOwed.gtn(0)));

    // collectFees
    await toTx(
      ctx,
      WhirlpoolIx.collectFeesIx(ctx.program, {
        position: bundledPositionPubkey,
        positionAuthority: ctx.wallet.publicKey,
        positionTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        tokenOwnerAccountA,
        tokenOwnerAccountB,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        whirlpool: whirlpoolPubkey,
      })
    ).buildAndExecute();
    const postCollectFees = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
    assert.ok(postCollectFees!.feeOwedA.isZero());
    assert.ok(postCollectFees!.feeOwedB.isZero());

    // collectReward
    for (let i = 0; i < NUM_REWARDS; i++) {
      const ata = await createTokenAccount(
        provider,
        rewards[i].rewardMint,
        ctx.wallet.publicKey
      );

      const preCollectReward = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
      assert.ok(preCollectReward!.rewardInfos[i].amountOwed.gtn(0));
      await toTx(
        ctx,
        WhirlpoolIx.collectRewardIx(ctx.program, {
          position: bundledPositionPubkey,
          positionAuthority: ctx.wallet.publicKey,
          positionTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          rewardIndex: i,
          rewardVault: rewards[i].rewardVaultKeypair.publicKey,
          rewardOwnerAccount: ata,
          whirlpool: whirlpoolPubkey,
        })
      ).buildAndExecute();
      const postCollectReward = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
      assert.ok(postCollectReward!.rewardInfos[i].amountOwed.isZero());
    }
    // decreaseLiquidity
    const withdrawAmounts = PoolUtil.getTokenAmountsFromLiquidity(
      liquidityAmount,
      (await ctx.fetcher.getPool(whirlpoolPubkey, true))!.sqrtPrice,
      PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex),
      PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex),
      false
    );

    const preDecrease = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
    assert.ok(preDecrease!.liquidity.eq(liquidityAmount));
    await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
        ...modifyLiquidityParams,
        tokenMinA: withdrawAmounts.tokenA,
        tokenMinB: withdrawAmounts.tokenB,
      })
    ).buildAndExecute();
    const postDecrease = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
    assert.ok(postDecrease!.liquidity.isZero());

    // close bundled position
    await toTx(
      ctx,
      WhirlpoolIx.closeBundledPositionIx(ctx.program, {
        bundledPosition: bundledPositionPubkey,
        bundleIndex,
        positionBundle: positionBundleInfo.positionBundlePda.publicKey,
        positionBundleAuthority: ctx.wallet.publicKey,
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        receiver: ctx.wallet.publicKey,
      })
    ).buildAndExecute();
    const postClose = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
    assert.ok(postClose === null);
  });

  it("successfully repeatedly open bundled position & close bundled position", async () => {
    const openCloseIterationNum = 5;

    // create test pool
    const ctx = testCtx.whirlpoolCtx;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        { liquidityAmount, tickLowerIndex, tickUpperIndex }, // non bundled position (to create TickArrays)
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
    const { poolInitInfo, rewards } = fixture.getInfos();

    // increase feeGrowth
    await accrueFees(fixture);

    // initialize position bundle
    const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);
    const bundleIndex = Math.floor(Math.random() * POSITION_BUNDLE_SIZE);

    for (let iter = 0; iter < openCloseIterationNum; iter++) {
      // open bundled position
      const positionInitInfo = await openBundledPosition(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex
      );
      const { bundledPositionPda } = positionInitInfo.params;

      const bundledPositionPubkey = bundledPositionPda.publicKey;
      const tickArrayLower = PDAUtil.getTickArrayFromTickIndex(positionInitInfo.params.tickLowerIndex, poolInitInfo.tickSpacing, poolInitInfo.whirlpoolPda.publicKey, ctx.program.programId).publicKey;
      const tickArrayUpper = PDAUtil.getTickArrayFromTickIndex(positionInitInfo.params.tickUpperIndex, poolInitInfo.tickSpacing, poolInitInfo.whirlpoolPda.publicKey, ctx.program.programId).publicKey;
      const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;
      const tokenOwnerAccountA = await deriveATA(ctx.wallet.publicKey, poolInitInfo.tokenMintA);
      const tokenOwnerAccountB = await deriveATA(ctx.wallet.publicKey, poolInitInfo.tokenMintB);

      // initialized check (No data left over from previous opening)
      const postOpen = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
      assert.ok(postOpen!.feeGrowthCheckpointA.isZero());
      assert.ok(postOpen!.feeGrowthCheckpointB.isZero());
      assert.ok(postOpen!.rewardInfos.every((r) => r.growthInsideCheckpoint.isZero()));

      const modifyLiquidityParams = {
        liquidityAmount,
        position: bundledPositionPubkey,
        positionAuthority: ctx.wallet.publicKey,
        positionTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        tickArrayLower,
        tickArrayUpper,
        tokenOwnerAccountA,
        tokenOwnerAccountB,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        whirlpool: whirlpoolPubkey,
      }

      // increaseLiquidity
      const depositAmounts = PoolUtil.getTokenAmountsFromLiquidity(
        liquidityAmount,
        (await ctx.fetcher.getPool(whirlpoolPubkey, true))!.sqrtPrice,
        PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex),
        PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex),
        true
      );
      const preIncrease = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
      assert.ok(preIncrease!.liquidity.isZero());
      await toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          ...modifyLiquidityParams,
          tokenMaxA: depositAmounts.tokenA,
          tokenMaxB: depositAmounts.tokenB,
        })
      ).buildAndExecute();
      const postIncrease = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
      assert.ok(postIncrease!.liquidity.eq(liquidityAmount));

      // non-zero check
      assert.ok(postIncrease!.feeGrowthCheckpointA.gtn(0));
      assert.ok(postIncrease!.feeGrowthCheckpointB.gtn(0));
      assert.ok(postIncrease!.rewardInfos.every((r) => r.growthInsideCheckpoint.gtn(0)));

      await sleep(2); // accrueRewards
      await accrueFees(fixture);
      // decreaseLiquidity
      const withdrawAmounts = PoolUtil.getTokenAmountsFromLiquidity(
        liquidityAmount,
        (await ctx.fetcher.getPool(whirlpoolPubkey, true))!.sqrtPrice,
        PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex),
        PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex),
        false
      );

      const preDecrease = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
      assert.ok(preDecrease!.liquidity.eq(liquidityAmount));
      await toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          ...modifyLiquidityParams,
          tokenMinA: withdrawAmounts.tokenA,
          tokenMinB: withdrawAmounts.tokenB,
        })
      ).buildAndExecute();
      const postDecrease = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
      assert.ok(postDecrease!.liquidity.isZero());

      // collectFees
      await toTx(
        ctx,
        WhirlpoolIx.collectFeesIx(ctx.program, {
          position: bundledPositionPubkey,
          positionAuthority: ctx.wallet.publicKey,
          positionTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          tokenOwnerAccountA,
          tokenOwnerAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          whirlpool: whirlpoolPubkey,
        })
      ).buildAndExecute();
      const postCollectFees = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
      assert.ok(postCollectFees!.feeOwedA.isZero());
      assert.ok(postCollectFees!.feeOwedB.isZero());

      // collectReward
      for (let i = 0; i < NUM_REWARDS; i++) {
        const ata = await createTokenAccount(
          provider,
          rewards[i].rewardMint,
          ctx.wallet.publicKey
        );

        const preCollectReward = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
        assert.ok(preCollectReward!.rewardInfos[i].amountOwed.gtn(0));
        await toTx(
          ctx,
          WhirlpoolIx.collectRewardIx(ctx.program, {
            position: bundledPositionPubkey,
            positionAuthority: ctx.wallet.publicKey,
            positionTokenAccount: positionBundleInfo.positionBundleTokenAccount,
            rewardIndex: i,
            rewardVault: rewards[i].rewardVaultKeypair.publicKey,
            rewardOwnerAccount: ata,
            whirlpool: whirlpoolPubkey,
          })
        ).buildAndExecute();
        const postCollectReward = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
        assert.ok(postCollectReward!.rewardInfos[i].amountOwed.isZero());
      }

      // close bundled position
      await toTx(
        ctx,
        WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: bundledPositionPubkey,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          receiver: ctx.wallet.publicKey,
        })
      ).buildAndExecute();
      const postClose = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
      assert.ok(postClose === null);
    }
  });

  describe("Single Transaction", () => {
    it("successfully openBundledPosition+increaseLiquidity / decreaseLiquidity+closeBundledPosition in single Tx", async () => {
      // create test pool
      const ctx = testCtx.whirlpoolCtx;
      const fixture = await new WhirlpoolTestFixture(ctx).init({
        tickSpacing,
        positions: [
          { liquidityAmount, tickLowerIndex, tickUpperIndex }, // non bundled position (to create TickArrays)
        ],
        rewards: [],
      });
      const { poolInitInfo, rewards } = fixture.getInfos();

      // initialize position bundle
      const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);
      const bundleIndex = Math.floor(Math.random() * POSITION_BUNDLE_SIZE);

      const bundledPositionPda = PDAUtil.getBundledPosition(ctx.program.programId, positionBundleInfo.positionBundleMintKeypair.publicKey, bundleIndex);
      const bundledPositionPubkey = bundledPositionPda.publicKey;
      const tickArrayLower = PDAUtil.getTickArrayFromTickIndex(tickLowerIndex, poolInitInfo.tickSpacing, poolInitInfo.whirlpoolPda.publicKey, ctx.program.programId).publicKey;
      const tickArrayUpper = PDAUtil.getTickArrayFromTickIndex(tickUpperIndex, poolInitInfo.tickSpacing, poolInitInfo.whirlpoolPda.publicKey, ctx.program.programId).publicKey;
      const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;
      const tokenOwnerAccountA = await deriveATA(ctx.wallet.publicKey, poolInitInfo.tokenMintA);
      const tokenOwnerAccountB = await deriveATA(ctx.wallet.publicKey, poolInitInfo.tokenMintB);

      const modifyLiquidityParams = {
        liquidityAmount,
        position: bundledPositionPubkey,
        positionAuthority: ctx.wallet.publicKey,
        positionTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        tickArrayLower,
        tickArrayUpper,
        tokenOwnerAccountA,
        tokenOwnerAccountB,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        whirlpool: whirlpoolPubkey,
      }

      const depositAmounts = PoolUtil.getTokenAmountsFromLiquidity(
        liquidityAmount,
        (await ctx.fetcher.getPool(whirlpoolPubkey, true))!.sqrtPrice,
        PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex),
        PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex),
        true
      );

      // openBundledPosition + increaseLiquidity
      const openIncreaseBuilder = new TransactionBuilder(ctx.connection, ctx.wallet);
      openIncreaseBuilder
        .addInstruction(WhirlpoolIx.openBundledPositionIx(ctx.program, {
          bundledPositionPda,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          tickLowerIndex,
          tickUpperIndex,
          whirlpool: whirlpoolPubkey,
          funder: ctx.wallet.publicKey
        }))
        .addInstruction(WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          ...modifyLiquidityParams,
          tokenMaxA: depositAmounts.tokenA,
          tokenMaxB: depositAmounts.tokenB,
        }));
      await openIncreaseBuilder.buildAndExecute();
      const postIncrease = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
      assert.ok(postIncrease!.liquidity.eq(liquidityAmount));

      const withdrawAmounts = PoolUtil.getTokenAmountsFromLiquidity(
        liquidityAmount,
        (await ctx.fetcher.getPool(whirlpoolPubkey, true))!.sqrtPrice,
        PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex),
        PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex),
        false
      );

      const decreaseCloseBuilder = new TransactionBuilder(ctx.connection, ctx.wallet);
      decreaseCloseBuilder
        .addInstruction(WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          ...modifyLiquidityParams,
          tokenMinA: withdrawAmounts.tokenA,
          tokenMinB: withdrawAmounts.tokenB,
        }))
        .addInstruction(WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: bundledPositionPubkey,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          receiver: ctx.wallet.publicKey,
        }));
      await decreaseCloseBuilder.buildAndExecute();
      const postClose = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
      assert.ok(postClose === null);
    });

    it("successfully open bundled position & close bundled position in single Tx", async () => {
      // create test pool
      const ctx = testCtx.whirlpoolCtx;
      const fixture = await new WhirlpoolTestFixture(ctx).init({
        tickSpacing,
        positions: [
          { liquidityAmount, tickLowerIndex, tickUpperIndex }, // non bundled position (to create TickArrays)
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
      const { poolInitInfo, rewards } = fixture.getInfos();

      // initialize position bundle
      const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);
      const bundleIndex = Math.floor(Math.random() * POSITION_BUNDLE_SIZE);

      const bundledPositionPda = PDAUtil.getBundledPosition(ctx.program.programId, positionBundleInfo.positionBundleMintKeypair.publicKey, bundleIndex);
      const bundledPositionPubkey = bundledPositionPda.publicKey;
      const tickArrayLower = PDAUtil.getTickArrayFromTickIndex(tickLowerIndex, poolInitInfo.tickSpacing, poolInitInfo.whirlpoolPda.publicKey, ctx.program.programId).publicKey;
      const tickArrayUpper = PDAUtil.getTickArrayFromTickIndex(tickUpperIndex, poolInitInfo.tickSpacing, poolInitInfo.whirlpoolPda.publicKey, ctx.program.programId).publicKey;
      const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;
      const tokenOwnerAccountA = await deriveATA(ctx.wallet.publicKey, poolInitInfo.tokenMintA);
      const tokenOwnerAccountB = await deriveATA(ctx.wallet.publicKey, poolInitInfo.tokenMintB);

      const modifyLiquidityParams = {
        liquidityAmount,
        position: bundledPositionPubkey,
        positionAuthority: ctx.wallet.publicKey,
        positionTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        tickArrayLower,
        tickArrayUpper,
        tokenOwnerAccountA,
        tokenOwnerAccountB,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        whirlpool: whirlpoolPubkey,
      }

      const depositAmounts = PoolUtil.getTokenAmountsFromLiquidity(
        liquidityAmount,
        (await ctx.fetcher.getPool(whirlpoolPubkey, true))!.sqrtPrice,
        PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex),
        PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex),
        true
      );

      const receiver = Keypair.generate();
      const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
      builder
        .addInstruction(WhirlpoolIx.openBundledPositionIx(ctx.program, {
          bundledPositionPda,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          tickLowerIndex,
          tickUpperIndex,
          whirlpool: whirlpoolPubkey,
          funder: ctx.wallet.publicKey
        }))
        .addInstruction(WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          ...modifyLiquidityParams,
          tokenMaxA: depositAmounts.tokenA,
          tokenMaxB: depositAmounts.tokenB,
        }))
        .addInstruction(WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          ...modifyLiquidityParams,
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
        }))
        .addInstruction(WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: bundledPositionPubkey,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          receiver: receiver.publicKey,
        }));

      await builder.buildAndExecute();
      const receiverBalance = await ctx.connection.getBalance(receiver.publicKey, "confirmed");
      assert.ok(receiverBalance > 0);
    });

    it("successfully close & re-open bundled position with the same bundle index in single Tx", async () => {
      // create test pool
      const ctx = testCtx.whirlpoolCtx;
      const fixture = await new WhirlpoolTestFixture(ctx).init({
        tickSpacing,
        positions: [],
        rewards: [],
      });
      const { poolInitInfo, rewards } = fixture.getInfos();

      // initialize position bundle
      const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);
      const bundleIndex = Math.floor(Math.random() * POSITION_BUNDLE_SIZE);

      const bundledPositionPda = PDAUtil.getBundledPosition(ctx.program.programId, positionBundleInfo.positionBundleMintKeypair.publicKey, bundleIndex);
      const bundledPositionPubkey = bundledPositionPda.publicKey;
      const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;

      const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
      builder
        // open
        .addInstruction(WhirlpoolIx.openBundledPositionIx(ctx.program, {
          bundledPositionPda,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          tickLowerIndex,
          tickUpperIndex,
          whirlpool: whirlpoolPubkey,
          funder: ctx.wallet.publicKey
        }))
        // close
        .addInstruction(WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: bundledPositionPubkey,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          receiver: whirlpoolPubkey,
        }))
        // reopen bundled position with same bundleIndex in single Tx
        .addInstruction(WhirlpoolIx.openBundledPositionIx(ctx.program, {
          bundledPositionPda,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          tickLowerIndex: tickLowerIndex + tickSpacing,
          tickUpperIndex: tickUpperIndex + tickSpacing,
          whirlpool: whirlpoolPubkey,
          funder: ctx.wallet.publicKey
        }));

      // Account closing reassigns to system program and reallocates
      // https://github.com/coral-xyz/anchor/pull/2169
      // in Anchor v0.26.0, close & open in same Tx will success.
      await builder.buildAndExecute();
      const postReopen = await ctx.fetcher.getPosition(bundledPositionPubkey, true);
      assert.ok(postReopen!.liquidity.isZero());
      assert.ok(postReopen!.tickLowerIndex === tickLowerIndex + tickSpacing);
      assert.ok(postReopen!.tickUpperIndex === tickUpperIndex + tickSpacing);
    });

    it("successfully open bundled position & swap & close bundled position in single Tx", async () => {
      // create test pool
      const ctx = testCtx.whirlpoolCtx;
      const fixture = await new WhirlpoolTestFixture(ctx).init({
        tickSpacing,
        positions: [
          { liquidityAmount, tickLowerIndex, tickUpperIndex }, // non bundled position (to create TickArrays)
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
      const { poolInitInfo, rewards } = fixture.getInfos();

      // initialize position bundle
      const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);
      const bundleIndex = Math.floor(Math.random() * POSITION_BUNDLE_SIZE);

      const bundledPositionPda = PDAUtil.getBundledPosition(ctx.program.programId, positionBundleInfo.positionBundleMintKeypair.publicKey, bundleIndex);
      const bundledPositionPubkey = bundledPositionPda.publicKey;
      const tickArrayLower = PDAUtil.getTickArrayFromTickIndex(tickLowerIndex, poolInitInfo.tickSpacing, poolInitInfo.whirlpoolPda.publicKey, ctx.program.programId).publicKey;
      const tickArrayUpper = PDAUtil.getTickArrayFromTickIndex(tickUpperIndex, poolInitInfo.tickSpacing, poolInitInfo.whirlpoolPda.publicKey, ctx.program.programId).publicKey;
      const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;
      const tokenOwnerAccountA = await deriveATA(ctx.wallet.publicKey, poolInitInfo.tokenMintA);
      const tokenOwnerAccountB = await deriveATA(ctx.wallet.publicKey, poolInitInfo.tokenMintB);

      const tickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpoolPubkey, 22528);
      const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPubkey);

      const modifyLiquidityParams = {
        liquidityAmount,
        position: bundledPositionPubkey,
        positionAuthority: ctx.wallet.publicKey,
        positionTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        tickArrayLower,
        tickArrayUpper,
        tokenOwnerAccountA,
        tokenOwnerAccountB,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        whirlpool: whirlpoolPubkey,
      }

      const depositAmounts = PoolUtil.getTokenAmountsFromLiquidity(
        liquidityAmount,
        (await ctx.fetcher.getPool(whirlpoolPubkey, true))!.sqrtPrice,
        PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex),
        PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex),
        true
      );

      const swapInput = new u64(200_000);
      const poolLiquidity = new BN(liquidityAmount.muln(2).toString());
      const estimatedFee = new BN(swapInput.toString())
        .muln(3).divn(1000) // feeRate 0.3%
        .muln(97).divn(100) // minus protocolFee 3%
        .shln(64).div(poolLiquidity) // to X64 growth
        .mul(liquidityAmount)
        .shrn(64)
        .toNumber();

      const receiver = Keypair.generate();
      const receiverAtaA = await createTokenAccount(provider, poolInitInfo.tokenMintA, receiver.publicKey);
      const receiverAtaB = await createTokenAccount(provider, poolInitInfo.tokenMintB, receiver.publicKey);

      const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
      builder
        .addInstruction(WhirlpoolIx.openBundledPositionIx(ctx.program, {
          bundledPositionPda,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          tickLowerIndex,
          tickUpperIndex,
          whirlpool: whirlpoolPubkey,
          funder: ctx.wallet.publicKey
        }))
        .addInstruction(WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          ...modifyLiquidityParams,
          tokenMaxA: depositAmounts.tokenA,
          tokenMaxB: depositAmounts.tokenB,
        }))
        .addInstruction(WhirlpoolIx.swapIx(ctx.program, {
          amount: swapInput,
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(4)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPubkey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenOwnerAccountA,
          tokenOwnerAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrayPda.publicKey,
          tickArray1: tickArrayPda.publicKey,
          tickArray2: tickArrayPda.publicKey,
          oracle: oraclePda.publicKey,
        }))
        .addInstruction(WhirlpoolIx.swapIx(ctx.program, {
          amount: swapInput,
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(5)),
          amountSpecifiedIsInput: true,
          aToB: false,
          whirlpool: whirlpoolPubkey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenOwnerAccountA,
          tokenOwnerAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrayPda.publicKey,
          tickArray1: tickArrayPda.publicKey,
          tickArray2: tickArrayPda.publicKey,
          oracle: oraclePda.publicKey,
        }))
        .addInstruction(WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          ...modifyLiquidityParams,
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
        }))
        .addInstruction(WhirlpoolIx.collectFeesIx(ctx.program, {
          position: bundledPositionPubkey,
          positionAuthority: ctx.wallet.publicKey,
          positionTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          tokenOwnerAccountA: receiverAtaA,
          tokenOwnerAccountB: receiverAtaB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          whirlpool: whirlpoolPubkey,
        }))
        .addInstruction(WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: bundledPositionPubkey,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          receiver: receiver.publicKey,
        }));

      await builder.buildAndExecute();
      assert.ok((await ctx.fetcher.getTokenInfo(receiverAtaA, true))!.amount.eqn(estimatedFee));
      assert.ok((await ctx.fetcher.getTokenInfo(receiverAtaB, true))!.amount.eqn(estimatedFee));
    });
  });

  describe("Ensuring that the account is closed", () => {
    it("The discriminator of the deleted position bundle is marked as closed", async () => {
      const ctx = testCtx.whirlpoolCtx;

      // initialize position bundle
      const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

      const preClose = await ctx.connection.getAccountInfo(positionBundleInfo.positionBundlePda.publicKey, "confirmed");
      assert.ok(preClose !== null);
      const rentOfPositionBundle = preClose.lamports;
      assert.ok(rentOfPositionBundle > 0);

      const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
      builder
        // close
        .addInstruction(WhirlpoolIx.deletePositionBundleIx(ctx.program, {
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleMint: positionBundleInfo.positionBundleMintKeypair.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          owner: ctx.wallet.publicKey,
          receiver: ctx.wallet.publicKey,
        }))
        // fund rent
        .addInstruction({
          instructions: [
            SystemProgram.transfer({
              fromPubkey: ctx.wallet.publicKey,
              toPubkey: positionBundleInfo.positionBundlePda.publicKey,
              lamports: rentOfPositionBundle,
            })
          ],
          cleanupInstructions: [],
          signers: [],
        });
      await builder.buildAndExecute();

      // Account closing reassigns to system program and reallocates
      // https://github.com/coral-xyz/anchor/pull/2169
      const postClose = await ctx.connection.getAccountInfo(positionBundleInfo.positionBundlePda.publicKey, "confirmed");
      assert.ok(postClose !== null);
      assert.ok(postClose.owner.equals(SystemProgram.programId));
      assert.ok(postClose.data.length === 0);
    });

    it("The owner of closed account should be system program", async () => {
      // create test pool
      const ctx = testCtx.whirlpoolCtx;
      const fixture = await new WhirlpoolTestFixture(ctx).init({
        tickSpacing,
        positions: [],
        rewards: [],
      });
      const { poolInitInfo, rewards } = fixture.getInfos();

      // initialize position bundle
      const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);
      const bundleIndex = Math.floor(Math.random() * POSITION_BUNDLE_SIZE);

      const bundledPositionPda = PDAUtil.getBundledPosition(ctx.program.programId, positionBundleInfo.positionBundleMintKeypair.publicKey, bundleIndex);
      const bundledPositionPubkey = bundledPositionPda.publicKey;
      const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;

      // open
      await toTx(
        ctx,
        WhirlpoolIx.openBundledPositionIx(ctx.program, {
          bundledPositionPda,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          tickLowerIndex,
          tickUpperIndex,
          whirlpool: whirlpoolPubkey,
          funder: ctx.wallet.publicKey
        })
      ).buildAndExecute();

      const preClose = await ctx.connection.getAccountInfo(bundledPositionPubkey, "confirmed");
      assert.ok(preClose !== null);
      const rentOfBundledPosition = preClose.lamports;
      assert.ok(rentOfBundledPosition > 0);

      const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
      builder
        // close
        .addInstruction(WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: bundledPositionPubkey,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          receiver: whirlpoolPubkey,
        }))
        // fund rent
        .addInstruction({
          instructions: [
            SystemProgram.transfer({
              fromPubkey: ctx.wallet.publicKey,
              toPubkey: bundledPositionPubkey,
              lamports: rentOfBundledPosition,
            })
          ],
          cleanupInstructions: [],
          signers: [],
        });
      await builder.buildAndExecute();

      // Account closing reassigns to system program and reallocates
      // https://github.com/coral-xyz/anchor/pull/2169
      const postClose = await ctx.connection.getAccountInfo(bundledPositionPubkey, "confirmed");
      assert.ok(postClose !== null);
      assert.ok(postClose.owner.equals(SystemProgram.programId));
      assert.ok(postClose.data.length === 0);
    });

    it("should be failed: close bundled position and then updateFeesAndRewards in single Tx", async () => {
      // create test pool
      const ctx = testCtx.whirlpoolCtx;
      const fixture = await new WhirlpoolTestFixture(ctx).init({
        tickSpacing,
        positions: [],
        rewards: [],
      });
      const { poolInitInfo, rewards } = fixture.getInfos();

      // initialize position bundle
      const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);
      const bundleIndex = Math.floor(Math.random() * POSITION_BUNDLE_SIZE);

      const bundledPositionPda = PDAUtil.getBundledPosition(ctx.program.programId, positionBundleInfo.positionBundleMintKeypair.publicKey, bundleIndex);
      const bundledPositionPubkey = bundledPositionPda.publicKey;
      const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;
      const tickArrayLower = PDAUtil.getTickArrayFromTickIndex(tickLowerIndex, poolInitInfo.tickSpacing, poolInitInfo.whirlpoolPda.publicKey, ctx.program.programId).publicKey;
      const tickArrayUpper = PDAUtil.getTickArrayFromTickIndex(tickUpperIndex, poolInitInfo.tickSpacing, poolInitInfo.whirlpoolPda.publicKey, ctx.program.programId).publicKey;

      const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
      builder
        // open
        .addInstruction(WhirlpoolIx.openBundledPositionIx(ctx.program, {
          bundledPositionPda,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          tickLowerIndex,
          tickUpperIndex,
          whirlpool: whirlpoolPubkey,
          funder: ctx.wallet.publicKey
        }))
        // close
        .addInstruction(WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: bundledPositionPubkey,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          receiver: whirlpoolPubkey,
        }))
        // try to use closed bundled position
        .addInstruction(WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
          position: bundledPositionPubkey,
          tickArrayLower,
          tickArrayUpper,
          whirlpool: whirlpoolPubkey,
        }));

      await assert.rejects(
        builder.buildAndExecute(),
        /0xbc4/ // AccountNotInitialized
      );
    });
  });

});
