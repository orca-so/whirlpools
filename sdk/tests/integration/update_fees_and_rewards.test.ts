import * as anchor from "@coral-xyz/anchor";
import { MathUtil } from "@orca-so/common-sdk";
import * as assert from "assert";
import { BN } from "bn.js";
import Decimal from "decimal.js";
import { PDAUtil, PositionData, toTx, WhirlpoolContext, WhirlpoolIx } from "../../src";
import { IGNORE_CACHE } from "../../src/network/public/fetcher";
import { sleep, TickSpacing, ZERO_BN } from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { WhirlpoolTestFixture } from "../utils/fixture";
import { initTestPool } from "../utils/init-utils";

describe("update_fees_and_rewards", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  it("successfully updates fees and rewards", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(1_000_000) }],
      rewards: [
        { emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)), vaultAmount: new BN(1_000_000) },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();

    const tickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpoolPda.publicKey, 22528);

    const positionBefore = (await fetcher.getPosition(
      positions[0].publicKey,
      IGNORE_CACHE
    )) as PositionData;
    assert.ok(positionBefore.feeGrowthCheckpointA.eq(ZERO_BN));
    assert.ok(positionBefore.feeGrowthCheckpointB.eq(ZERO_BN));
    assert.ok(positionBefore.rewardInfos[0].amountOwed.eq(ZERO_BN));
    assert.ok(positionBefore.rewardInfos[0].growthInsideCheckpoint.eq(ZERO_BN));

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    // Let the swap accumulate some rewards
    await sleep(1000);

    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new BN(100_000),
        otherAmountThreshold: ZERO_BN,
        sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
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

    await toTx(
      ctx,
      WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
        whirlpool: whirlpoolPda.publicKey,
        position: positions[0].publicKey,
        tickArrayLower: tickArrayPda.publicKey,
        tickArrayUpper: tickArrayPda.publicKey,
      })
    ).buildAndExecute();
    const positionAfter = (await fetcher.getPosition(positions[0].publicKey, IGNORE_CACHE)) as PositionData;
    assert.ok(positionAfter.feeOwedA.gt(positionBefore.feeOwedA));
    assert.ok(positionAfter.feeOwedB.eq(ZERO_BN));
    assert.ok(positionAfter.feeGrowthCheckpointA.gt(positionBefore.feeGrowthCheckpointA));
    assert.ok(positionAfter.feeGrowthCheckpointB.eq(positionBefore.feeGrowthCheckpointB));
    assert.ok(positionAfter.rewardInfos[0].amountOwed.gt(positionBefore.rewardInfos[0].amountOwed));
    assert.ok(
      positionAfter.rewardInfos[0].growthInsideCheckpoint.gt(
        positionBefore.rewardInfos[0].growthInsideCheckpoint
      )
    );
    assert.ok(positionAfter.liquidity.eq(positionBefore.liquidity));
  });

  it("fails when position has zero liquidity", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN }],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
    } = fixture.getInfos();

    const tickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpoolPda.publicKey, 22528);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          position: positions[0].publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        })
      ).buildAndExecute(),
      /0x177c/ // LiquidityZero
    );
  });

  it("fails when position does not match whirlpool", async () => {
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    const tickSpacing = TickSpacing.Standard;
    const {
      poolInitInfo: { whirlpoolPda },
    } = await initTestPool(ctx, tickSpacing);
    const tickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpoolPda.publicKey, 22528);

    const other = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(1_000_000) }],
    });
    const { positions: otherPositions } = other.getInfos();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          position: otherPositions[0].publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        })
      ).buildAndExecute(),
      /0xbbf/ // AccountOwnedByWrongProgram
    );
  });

  it("fails when tick arrays do not match position", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(1_000_000) }],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
    } = fixture.getInfos();

    const tickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpoolPda.publicKey, 0);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          position: positions[0].publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        })
      ).buildAndExecute(),
      /0xbbf/ // AccountOwnedByWrongProgram
    );
  });

  it("fails when tick arrays do not match whirlpool", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN }],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
    } = fixture.getInfos();

    const {
      poolInitInfo: { whirlpoolPda: otherWhirlpoolPda },
    } = await initTestPool(ctx, tickSpacing);

    const tickArrayPda = PDAUtil.getTickArray(
      ctx.program.programId,
      otherWhirlpoolPda.publicKey,
      22528
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          position: positions[0].publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        })
      ).buildAndExecute(),
      /0xbbf/ // AccountOwnedByWrongProgram
    );
  });
});
