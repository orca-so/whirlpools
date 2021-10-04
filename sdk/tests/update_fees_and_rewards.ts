import * as anchor from "@project-serum/anchor";
import * as assert from "assert";
import { u64 } from "@solana/spl-token";
import Decimal from "decimal.js";
import { getOraclePda, getTickArrayPda, toX64 } from "../src";
import { WhirlpoolClient } from "../src/client";
import { WhirlpoolContext } from "../src/context";
import { sleep, TickSpacing, ZERO_BN } from "./utils";
import { WhirlpoolTestFixture } from "./utils/fixture";
import { initTestPool } from "./utils/init-utils";

describe("update_fees_and_rewards", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  it("successfully updates fees and rewards", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new u64(1_000_000) }],
      rewards: [{ emissionsPerSecondX64: toX64(new Decimal(2)), vaultAmount: new u64(1_000_000) }],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();

    const tickArrayPda = getTickArrayPda(context.program.programId, whirlpoolPda.publicKey, 22528);

    const positionBefore = await client.getPosition(positions[0].publicKey);
    assert.ok(positionBefore.feeGrowthCheckpointA.eq(ZERO_BN));
    assert.ok(positionBefore.feeGrowthCheckpointB.eq(ZERO_BN));
    assert.ok(positionBefore.rewardInfos[0].amountOwed.eq(ZERO_BN));
    assert.ok(positionBefore.rewardInfos[0].growthInsideCheckpoint.eq(ZERO_BN));

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    await client
      .swapTx({
        amount: new u64(100_000),
        otherAmountThreshold: ZERO_BN,
        sqrtPriceLimit: toX64(new Decimal(4.95)),
        amountSpecifiedIsInput: true,
        aToB: true,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: context.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: tokenVaultBKeypair.publicKey,
        tickArray0: tickArrayPda.publicKey,
        tickArray1: tickArrayPda.publicKey,
        tickArray2: tickArrayPda.publicKey,
        oracle: oraclePda.publicKey,
      })
      .buildAndExecute();

    await sleep(1_000);

    await client
      .updateFeesAndRewards({
        whirlpool: whirlpoolPda.publicKey,
        position: positions[0].publicKey,
        tickArrayLower: tickArrayPda.publicKey,
        tickArrayUpper: tickArrayPda.publicKey,
      })
      .buildAndExecute();
    const positionAfter = await client.getPosition(positions[0].publicKey);
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
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN }],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
    } = fixture.getInfos();

    const tickArrayPda = getTickArrayPda(context.program.programId, whirlpoolPda.publicKey, 22528);

    await assert.rejects(
      client
        .updateFeesAndRewards({
          whirlpool: whirlpoolPda.publicKey,
          position: positions[0].publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        })
        .buildAndExecute(),
      /0x177c/ // LiquidityZero
    );
  });

  it("fails when position does not match whirlpool", async () => {
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    const tickSpacing = TickSpacing.Standard;
    const {
      poolInitInfo: { whirlpoolPda },
    } = await initTestPool(client, tickSpacing);
    const tickArrayPda = getTickArrayPda(context.program.programId, whirlpoolPda.publicKey, 22528);

    const other = await new WhirlpoolTestFixture(client).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new u64(1_000_000) }],
    });
    const { positions: otherPositions } = other.getInfos();

    await assert.rejects(
      client
        .updateFeesAndRewards({
          whirlpool: whirlpoolPda.publicKey,
          position: otherPositions[0].publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        })
        .buildAndExecute(),
      /0xbbf/ // AccountOwnedByWrongProgram
    );
  });

  it("fails when tick arrays do not match position", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(1_000_000) }],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
    } = fixture.getInfos();

    const tickArrayPda = getTickArrayPda(context.program.programId, whirlpoolPda.publicKey, 0);

    await assert.rejects(
      client
        .updateFeesAndRewards({
          whirlpool: whirlpoolPda.publicKey,
          position: positions[0].publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        })
        .buildAndExecute(),
      /0xbbf/ // AccountOwnedByWrongProgram
    );
  });

  it("fails when tick arrays do not match whirlpool", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN }],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
    } = fixture.getInfos();

    const {
      poolInitInfo: { whirlpoolPda: otherWhirlpoolPda },
    } = await initTestPool(client, tickSpacing);

    const tickArrayPda = getTickArrayPda(
      context.program.programId,
      otherWhirlpoolPda.publicKey,
      22528
    );

    await assert.rejects(
      client
        .updateFeesAndRewards({
          whirlpool: whirlpoolPda.publicKey,
          position: positions[0].publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        })
        .buildAndExecute(),
      /0xbbf/ // AccountOwnedByWrongProgram
    );
  });
});
