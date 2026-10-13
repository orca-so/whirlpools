import * as anchor from "@coral-xyz/anchor";
import { MathUtil } from "@orca-so/common-sdk";
import * as assert from "assert";
import BN from "bn.js";
import Decimal from "decimal.js";
import type {
  PositionData,
  TickArrayData,
  WhirlpoolAccountFetcherInterface,
  WhirlpoolContext,
  WhirlpoolData,
} from "../../../src";
import {
  MAX_SQRT_PRICE_BN,
  MIN_SQRT_PRICE_BN,
  PDAUtil,
  TickArrayUtil,
  toTx,
  WhirlpoolIx,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { MAX_U64, TickSpacing, ZERO_BN, warpClock } from "../../utils";
import { initializeLiteSVMEnvironment } from "../../utils/litesvm";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import { initTestPool } from "../../utils/init-utils";
import type { PublicKey } from "@solana/web3.js";
import { it } from "vitest";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("update_fees_and_rewards", () => {
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  it("successfully updates fees and rewards", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        {
          tickLowerIndex,
          tickUpperIndex,
          liquidityAmount: new anchor.BN(1_000_000),
        },
      ],
      rewards: [
        {
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
          vaultAmount: new BN(1_000_000),
        },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();

    const tickArrayPda = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpoolPda.publicKey,
      22528,
    );

    const positionBefore = (await fetcher.getPosition(
      positions[0].publicKey,
      IGNORE_CACHE,
    )) as PositionData;
    assert.ok(positionBefore.feeGrowthCheckpointA.eq(ZERO_BN));
    assert.ok(positionBefore.feeGrowthCheckpointB.eq(ZERO_BN));
    assert.ok(positionBefore.rewardInfos[0].amountOwed.eq(ZERO_BN));
    assert.ok(positionBefore.rewardInfos[0].growthInsideCheckpoint.eq(ZERO_BN));

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

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
      }),
    ).buildAndExecute();

    // Advance blockchain time in LiteSVM so rewards accrue
    warpClock(2);

    await toTx(
      ctx,
      WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
        whirlpool: whirlpoolPda.publicKey,
        position: positions[0].publicKey,
        tickArrayLower: tickArrayPda.publicKey,
        tickArrayUpper: tickArrayPda.publicKey,
      }),
    ).buildAndExecute();
    const positionAfter = (await fetcher.getPosition(
      positions[0].publicKey,
      IGNORE_CACHE,
    )) as PositionData;
    assert.ok(positionAfter.feeOwedA.gt(positionBefore.feeOwedA));
    assert.ok(positionAfter.feeOwedB.eq(ZERO_BN));
    assert.ok(
      positionAfter.feeGrowthCheckpointA.gt(
        positionBefore.feeGrowthCheckpointA,
      ),
    );
    assert.ok(
      positionAfter.feeGrowthCheckpointB.eq(
        positionBefore.feeGrowthCheckpointB,
      ),
    );
    assert.ok(
      positionAfter.rewardInfos[0].amountOwed.gt(
        positionBefore.rewardInfos[0].amountOwed,
      ),
    );
    assert.ok(
      positionAfter.rewardInfos[0].growthInsideCheckpoint.gt(
        positionBefore.rewardInfos[0].growthInsideCheckpoint,
      ),
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

    const tickArrayPda = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpoolPda.publicKey,
      22528,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          position: positions[0].publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        }),
      ).buildAndExecute(),
      /0x177c/, // LiquidityZero
    );
  });

  it("fails when position does not match whirlpool", async () => {
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    const tickSpacing = TickSpacing.Standard;
    const {
      poolInitInfo: { whirlpoolPda },
    } = await initTestPool(ctx, tickSpacing);
    const tickArrayPda = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpoolPda.publicKey,
      22528,
    );

    const other = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        {
          tickLowerIndex,
          tickUpperIndex,
          liquidityAmount: new anchor.BN(1_000_000),
        },
      ],
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
        }),
      ).buildAndExecute(),
      /0x7d1/, // ConstraintHasOne
    );
  });

  it("fails when tick arrays do not match position", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        {
          tickLowerIndex,
          tickUpperIndex,
          liquidityAmount: new anchor.BN(1_000_000),
        },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
    } = fixture.getInfos();

    const tickArrayPda = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpoolPda.publicKey,
      0,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          position: positions[0].publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        }),
      ).buildAndExecute(),
      /0xbbf/, // AccountOwnedByWrongProgram
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
      22528,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          position: positions[0].publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        }),
      ).buildAndExecute(),
      /0xbbf/, // AccountOwnedByWrongProgram
    );
  });

  describe("handle fractional fees and rewards", () => {
    it("accumulate fractional fees", async () => {
      // In same tick array - start index 22528
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;
      const tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixture(ctx).init({
        tickSpacing,
        positions: [
          {
            tickLowerIndex,
            tickUpperIndex,
            liquidityAmount: new anchor.BN(210_000_000),
          }, // In range position
          {
            tickLowerIndex,
            tickUpperIndex,
            liquidityAmount: new anchor.BN(790_000_000),
          }, // In range position
        ],
      });
      const {
        poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
        tokenAccountA,
        tokenAccountB,
        positions,
      } = fixture.getInfos();

      const tickArrayPda = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpoolPda.publicKey,
        22528,
      );

      const oraclePda = PDAUtil.getOracle(
        ctx.program.programId,
        whirlpoolPda.publicKey,
      );

      // 21% share
      const positionPubkey = positions[0].publicKey;

      const positionBeforeSwap = (await fetcher.getPosition(
        positionPubkey,
      )) as PositionData;
      assert.ok(positionBeforeSwap.feeOwedA.eq(ZERO_BN));
      assert.ok(positionBeforeSwap.feeOwedB.eq(ZERO_BN));

      async function accrueFeesAndUpdate() {
        // Accrue fees in token A
        await toTx(
          ctx,
          WhirlpoolIx.swapIx(ctx.program, {
            amount: new BN(333), // trade fee = ceil(333 x 0.3%) = 1u64
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
          }),
        ).buildAndExecute();

        // Accrue fees in token B
        await toTx(
          ctx,
          WhirlpoolIx.swapIx(ctx.program, {
            amount: new BN(333), // trade fee = ceil(333 x 0.3%) = 1u64
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
          }),
        ).buildAndExecute();

        await toTx(
          ctx,
          WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
            whirlpool: whirlpoolPda.publicKey,
            position: positionPubkey,
            tickArrayLower: tickArrayPda.publicKey,
            tickArrayUpper: tickArrayPda.publicKey,
          }),
        ).buildAndExecute();
      }

      // single execution doesn't generate 1u64 owed.
      await accrueFeesAndUpdate();
      const positionAfterSingleExec = (await fetcher.getPosition(
        positionPubkey,
        IGNORE_CACHE,
      )) as PositionData;

      // fee is 1u64 and the share of position is 21%.
      // So the fee for this position is virtually 0.21u64.
      assert.ok(positionAfterSingleExec.feeOwedA.eq(new BN(0)));
      assert.ok(positionAfterSingleExec.feeOwedB.eq(new BN(0)));

      let preState = positionAfterSingleExec;
      let preInside = await calculateGrowthInside(
        fetcher,
        whirlpoolPda.publicKey,
        tickArrayPda.publicKey,
        positionPubkey,
      );
      for (let i = 1; i < 20; i++) {
        await accrueFeesAndUpdate();

        const currState = (await fetcher.getPosition(
          positionPubkey,
          IGNORE_CACHE,
        )) as PositionData;

        const currInside = await calculateGrowthInside(
          fetcher,
          whirlpoolPda.publicKey,
          tickArrayPda.publicKey,
          positionPubkey,
        );

        if (currState.feeOwedA.eq(preState.feeOwedA)) {
          // inside fee growth is increased, but the checkpoint remains the same
          assert.ok(currInside.insideA.gt(preInside.insideA));
          assert.ok(
            currState.feeGrowthCheckpointA.eq(preState.feeGrowthCheckpointA),
          );
        } else {
          const X64 = new BN(2).pow(new BN(64));
          const owedDelta = currState.feeOwedA.sub(preState.feeOwedA);
          const positionLiquidity = currState.liquidity;
          const convertedGrowth = owedDelta
            .mul(X64)
            .add(positionLiquidity.subn(1))
            .div(positionLiquidity); // div ceil
          const checkpointDelta = currState.feeGrowthCheckpointA.sub(
            preState.feeGrowthCheckpointA,
          );
          assert.ok(convertedGrowth.eq(checkpointDelta));

          const growthDelta = currInside.insideA.sub(
            preState.feeGrowthCheckpointA,
          );
          assert.ok(convertedGrowth.lte(growthDelta));
        }
        if (currState.feeOwedB.eq(preState.feeOwedB)) {
          // inside fee growth is increased, but the checkpoint remains the same
          assert.ok(currInside.insideB.gt(preInside.insideB));
          assert.ok(
            currState.feeGrowthCheckpointB.eq(preState.feeGrowthCheckpointB),
          );
        } else {
          const X64 = new BN(2).pow(new BN(64));
          const owedDelta = currState.feeOwedB.sub(preState.feeOwedB);
          const positionLiquidity = currState.liquidity;
          const convertedGrowth = owedDelta
            .mul(X64)
            .add(positionLiquidity.subn(1))
            .div(positionLiquidity); // div ceil
          const checkpointDelta = currState.feeGrowthCheckpointB.sub(
            preState.feeGrowthCheckpointB,
          );
          assert.ok(convertedGrowth.eq(checkpointDelta));

          const growthDelta = currInside.insideB.sub(
            preState.feeGrowthCheckpointB,
          );
          assert.ok(convertedGrowth.lte(growthDelta));
        }

        preState = currState;
        preInside = currInside;
      }

      const positionAfterRepeatExec = (await fetcher.getPosition(
        positionPubkey,
        IGNORE_CACHE,
      )) as PositionData;

      // 0.21u64 x 20 = 4.2u64
      assert.ok(positionAfterRepeatExec.feeOwedA.eq(new BN(4)));
      assert.ok(positionAfterRepeatExec.feeOwedB.eq(new BN(4)));
    });

    it("accumulate fractional rewards", async () => {
      const vaultStartBalance = 1_000_000;
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;
      const tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixture(ctx).init({
        tickSpacing,
        positions: [
          {
            tickLowerIndex,
            tickUpperIndex,
            liquidityAmount: new anchor.BN(210_000_000),
          }, // In range position
          {
            tickLowerIndex,
            tickUpperIndex,
            liquidityAmount: new anchor.BN(790_000_000),
          }, // In range position
        ],
        rewards: [
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(1)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(3)),
            vaultAmount: new BN(vaultStartBalance),
          },
        ],
      });

      const {
        poolInitInfo: { whirlpoolPda },
        positions,
      } = fixture.getInfos();

      const positionPubkey = positions[0].publicKey;

      const tickArrayPda = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpoolPda.publicKey,
        22528,
      );

      // accrue rewards
      async function accrueRewardsAndUpdate() {
        warpClock(1);

        await toTx(
          ctx,
          WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
            whirlpool: whirlpoolPda.publicKey,
            position: positionPubkey,
            tickArrayLower: positions[0].tickArrayLower,
            tickArrayUpper: positions[0].tickArrayUpper,
          }),
        ).buildAndExecute();
      }

      // single execution doesn't generate 1u64 owed.
      await accrueRewardsAndUpdate();
      const positionAfterSingleExec = (await fetcher.getPosition(
        positionPubkey,
        IGNORE_CACHE,
      )) as PositionData;

      // rewards are 1u64/2u64/3u64 and the share of position is 21%.
      // So the rewards for this position are virtually 0.21u64 / 0.42u64 / 0.63u64.
      assert.ok(
        positionAfterSingleExec.rewardInfos[0].amountOwed.eq(new BN(0)),
      );
      assert.ok(
        positionAfterSingleExec.rewardInfos[1].amountOwed.eq(new BN(0)),
      );
      assert.ok(
        positionAfterSingleExec.rewardInfos[2].amountOwed.eq(new BN(0)),
      );

      let preState = positionAfterSingleExec;
      let preInside = await calculateGrowthInside(
        fetcher,
        whirlpoolPda.publicKey,
        tickArrayPda.publicKey,
        positionPubkey,
      );
      for (let i = 1; i < 20; i++) {
        await accrueRewardsAndUpdate();

        const currState = (await fetcher.getPosition(
          positionPubkey,
          IGNORE_CACHE,
        )) as PositionData;

        const currInside = await calculateGrowthInside(
          fetcher,
          whirlpoolPda.publicKey,
          tickArrayPda.publicKey,
          positionPubkey,
        );

        for (let ri = 0; ri < 3; ri++) {
          if (
            currState.rewardInfos[ri].amountOwed.eq(
              preState.rewardInfos[ri].amountOwed,
            )
          ) {
            // inside reward growth is increased, but the checkpoint remains the same
            assert.ok(currInside.insideR[ri].gt(preInside.insideR[ri]));
            assert.ok(
              currState.rewardInfos[ri].growthInsideCheckpoint.eq(
                preState.rewardInfos[ri].growthInsideCheckpoint,
              ),
            );
          } else {
            const X64 = new BN(2).pow(new BN(64));
            const owedDelta = currState.rewardInfos[ri].amountOwed.sub(
              preState.rewardInfos[ri].amountOwed,
            );
            const positionLiquidity = currState.liquidity;
            const convertedGrowth = owedDelta
              .mul(X64)
              .add(positionLiquidity.subn(1))
              .div(positionLiquidity); // div ceil
            const checkpointDelta = currState.rewardInfos[
              ri
            ].growthInsideCheckpoint.sub(
              preState.rewardInfos[ri].growthInsideCheckpoint,
            );
            assert.ok(convertedGrowth.eq(checkpointDelta));

            const growthDelta = currInside.insideR[ri].sub(
              preState.rewardInfos[ri].growthInsideCheckpoint,
            );
            assert.ok(convertedGrowth.lte(growthDelta));
          }
        }

        preState = currState;
        preInside = currInside;
      }

      const positionAfterRepeatExec = (await fetcher.getPosition(
        positionPubkey,
        IGNORE_CACHE,
      )) as PositionData;

      // 0.21u64 x 20 = 4.2u64
      // 0.42u64 x 20 = 8.4u64
      // 0.63u64 x 20 = 12.6u64
      assert.ok(
        positionAfterRepeatExec.rewardInfos[0].amountOwed.eq(new BN(4)),
      );
      assert.ok(
        positionAfterRepeatExec.rewardInfos[1].amountOwed.eq(new BN(8)),
      );
      assert.ok(
        positionAfterRepeatExec.rewardInfos[2].amountOwed.eq(new BN(12)),
      );
    });

    describe("checkpoint behaviors", () => {
      async function setup() {
        const vaultStartBalance = 1_000_000;
        const tickLowerIndex = 29440;
        const tickUpperIndex = 33536;
        const tickSpacing = TickSpacing.Standard;
        const fixture = await new WhirlpoolTestFixture(ctx).init({
          tickSpacing,
          positions: [
            {
              tickLowerIndex,
              tickUpperIndex,
              liquidityAmount: new anchor.BN(210_000_000),
            }, // In range position
            {
              tickLowerIndex,
              tickUpperIndex,
              liquidityAmount: new anchor.BN(790_000_000),
            }, // In range position
          ],
          rewards: [
            {
              emissionsPerSecondX64: MathUtil.toX64(new Decimal(1)),
              vaultAmount: new BN(vaultStartBalance),
            },
            {
              emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
              vaultAmount: new BN(vaultStartBalance),
            },
            {
              emissionsPerSecondX64: MathUtil.toX64(new Decimal(3)),
              vaultAmount: new BN(vaultStartBalance),
            },
          ],
        });

        const {
          poolInitInfo: {
            whirlpoolPda,
            tokenVaultAKeypair,
            tokenVaultBKeypair,
          },
          tokenAccountA,
          tokenAccountB,
        } = fixture.getInfos();

        const tickArrayPda = PDAUtil.getTickArray(
          ctx.program.programId,
          whirlpoolPda.publicKey,
          22528,
        );

        const oraclePda = PDAUtil.getOracle(
          ctx.program.programId,
          whirlpoolPda.publicKey,
        );

        // Accrue fees in token A
        await toTx(
          ctx,
          WhirlpoolIx.swapIx(ctx.program, {
            amount: new BN(6666), // trade fee = ceil(6666 x 0.3%) = 20u64
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
          }),
        ).buildAndExecute();

        // Accrue fees in token B
        await toTx(
          ctx,
          WhirlpoolIx.swapIx(ctx.program, {
            amount: new BN(9999), // trade fee = ceil(9999 x 0.3%) = 30u64
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
          }),
        ).buildAndExecute();

        // accrue rewards
        warpClock(5);

        return fixture;
      }

      it("verify setup", async () => {
        const fixture = await setup();
        const {
          poolInitInfo: { whirlpoolPda },
          positions,
        } = fixture.getInfos();

        const position = positions[0];

        await toTx(
          ctx,
          WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
            whirlpool: whirlpoolPda.publicKey,
            position: position.publicKey,
            tickArrayLower: position.tickArrayLower,
            tickArrayUpper: position.tickArrayUpper,
          }),
        ).buildAndExecute();

        const inside = await calculateGrowthInside(
          fetcher,
          whirlpoolPda.publicKey,
          position.tickArrayLower,
          position.publicKey,
        );

        const positionData = (await fetcher.getPosition(
          position.publicKey,
          IGNORE_CACHE,
        )) as PositionData;

        assert.ok(positionData.feeOwedA.eq(new BN(4))); // 21% of 20u64 = 4.2 => 4u64
        assert.ok(positionData.feeOwedB.eq(new BN(6))); // 21% of 30u64 = 6.3 => 6u64
        assert.ok(positionData.rewardInfos[0].amountOwed.eq(new BN(1))); // 21% of 1u64 x 5 = 1.05u64 => 1u64
        assert.ok(positionData.rewardInfos[1].amountOwed.eq(new BN(2))); // 21% of 2u64 x 5 = 2.10u64 => 2u64
        assert.ok(positionData.rewardInfos[2].amountOwed.eq(new BN(3))); // 21% of 3u64 x 5 = 3.15u64 => 3u64

        // Verify that there are fractional amounts
        assert.ok(positionData.feeGrowthCheckpointA.lt(inside.insideA));
        assert.ok(positionData.feeGrowthCheckpointB.lt(inside.insideB));
        assert.ok(
          positionData.rewardInfos[0].growthInsideCheckpoint.lt(
            inside.insideR[0],
          ),
        );
        assert.ok(
          positionData.rewardInfos[1].growthInsideCheckpoint.lt(
            inside.insideR[1],
          ),
        );
        assert.ok(
          positionData.rewardInfos[2].growthInsideCheckpoint.lt(
            inside.insideR[2],
          ),
        );
      });

      it("multiple update calls", async () => {
        const fixture = await setup();
        const {
          poolInitInfo: { whirlpoolPda },
          positions,
        } = fixture.getInfos();

        const position = positions[0];

        await toTx(
          ctx,
          WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
            whirlpool: whirlpoolPda.publicKey,
            position: position.publicKey,
            tickArrayLower: position.tickArrayLower,
            tickArrayUpper: position.tickArrayUpper,
          }),
        ).buildAndExecute();

        const inside = await calculateGrowthInside(
          fetcher,
          whirlpoolPda.publicKey,
          position.tickArrayLower,
          position.publicKey,
        );

        const positionData = (await fetcher.getPosition(
          position.publicKey,
          IGNORE_CACHE,
        )) as PositionData;

        assert.ok(positionData.feeOwedA.eq(new BN(4))); // 21% of 20u64 = 4.2 => 4u64
        assert.ok(positionData.feeOwedB.eq(new BN(6))); // 21% of 30u64 = 6.3 => 6u64
        assert.ok(positionData.rewardInfos[0].amountOwed.eq(new BN(1))); // 21% of 1u64 x 5 = 1.05u64 => 1u64
        assert.ok(positionData.rewardInfos[1].amountOwed.eq(new BN(2))); // 21% of 2u64 x 5 = 2.10u64 => 2u64
        assert.ok(positionData.rewardInfos[2].amountOwed.eq(new BN(3))); // 21% of 3u64 x 5 = 3.15u64 => 3u64

        // Verify that there are fractional amounts
        assert.ok(positionData.feeGrowthCheckpointA.lt(inside.insideA));
        assert.ok(positionData.feeGrowthCheckpointB.lt(inside.insideB));
        assert.ok(
          positionData.rewardInfos[0].growthInsideCheckpoint.lt(
            inside.insideR[0],
          ),
        );
        assert.ok(
          positionData.rewardInfos[1].growthInsideCheckpoint.lt(
            inside.insideR[1],
          ),
        );
        assert.ok(
          positionData.rewardInfos[2].growthInsideCheckpoint.lt(
            inside.insideR[2],
          ),
        );

        // multiple update calls
        for (let i = 0; i < 5; i++) {
          await toTx(
            ctx,
            WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              position: position.publicKey,
              tickArrayLower: position.tickArrayLower,
              tickArrayUpper: position.tickArrayUpper,
            }),
          ).buildAndExecute();

          const updatedPositionData = (await fetcher.getPosition(
            position.publicKey,
            IGNORE_CACHE,
          )) as PositionData;

          // updatedPositionData == positionData
          assert.ok(updatedPositionData.feeOwedA.eq(positionData.feeOwedA));
          assert.ok(updatedPositionData.feeOwedB.eq(positionData.feeOwedB));
          assert.ok(
            updatedPositionData.rewardInfos[0].amountOwed.eq(
              positionData.rewardInfos[0].amountOwed,
            ),
          );
          assert.ok(
            updatedPositionData.rewardInfos[1].amountOwed.eq(
              positionData.rewardInfos[1].amountOwed,
            ),
          );
          assert.ok(
            updatedPositionData.rewardInfos[2].amountOwed.eq(
              positionData.rewardInfos[2].amountOwed,
            ),
          );
          assert.ok(
            updatedPositionData.feeGrowthCheckpointA.eq(
              positionData.feeGrowthCheckpointA,
            ),
          );
          assert.ok(
            updatedPositionData.feeGrowthCheckpointB.eq(
              positionData.feeGrowthCheckpointB,
            ),
          );
          assert.ok(
            updatedPositionData.rewardInfos[0].growthInsideCheckpoint.eq(
              positionData.rewardInfos[0].growthInsideCheckpoint,
            ),
          );
          assert.ok(
            updatedPositionData.rewardInfos[1].growthInsideCheckpoint.eq(
              positionData.rewardInfos[1].growthInsideCheckpoint,
            ),
          );
          assert.ok(
            updatedPositionData.rewardInfos[2].growthInsideCheckpoint.eq(
              positionData.rewardInfos[2].growthInsideCheckpoint,
            ),
          );
        }
      });

      describe("Full checkpoint for liquidity operations", () => {
        async function runTest(
          ix:
            | "increaseLiquidity"
            | "increaseLiquidityV2"
            | "decreaseLiquidity"
            | "decreaseLiquidityV2"
            | "increaseLiquidityByTokenAmountsV2",
        ) {
          const fixture = await setup();
          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tokenMintA,
              tokenMintB,
            },
            tokenAccountA,
            tokenAccountB,
            positions,
          } = fixture.getInfos();

          const position = positions[0];

          switch (ix) {
            case "increaseLiquidity":
              await toTx(
                ctx,
                WhirlpoolIx.increaseLiquidityIx(ctx.program, {
                  whirlpool: whirlpoolPda.publicKey,
                  position: position.publicKey,
                  tickArrayLower: position.tickArrayLower,
                  tickArrayUpper: position.tickArrayUpper,
                  liquidityAmount: new BN(100),
                  positionAuthority: ctx.wallet.publicKey,
                  positionTokenAccount: position.tokenAccount,
                  tokenMaxA: MAX_U64,
                  tokenMaxB: MAX_U64,
                  tokenOwnerAccountA: tokenAccountA,
                  tokenOwnerAccountB: tokenAccountB,
                  tokenVaultA: tokenVaultAKeypair.publicKey,
                  tokenVaultB: tokenVaultBKeypair.publicKey,
                }),
              ).buildAndExecute();
              break;
            case "increaseLiquidityV2":
              await toTx(
                ctx,
                WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                  whirlpool: whirlpoolPda.publicKey,
                  position: position.publicKey,
                  tickArrayLower: position.tickArrayLower,
                  tickArrayUpper: position.tickArrayUpper,
                  liquidityAmount: new BN(100),
                  positionAuthority: ctx.wallet.publicKey,
                  positionTokenAccount: position.tokenAccount,
                  tokenMaxA: MAX_U64,
                  tokenMaxB: MAX_U64,
                  tokenOwnerAccountA: tokenAccountA,
                  tokenOwnerAccountB: tokenAccountB,
                  tokenVaultA: tokenVaultAKeypair.publicKey,
                  tokenVaultB: tokenVaultBKeypair.publicKey,
                  tokenMintA,
                  tokenMintB,
                  tokenProgramA: TOKEN_PROGRAM_ID,
                  tokenProgramB: TOKEN_PROGRAM_ID,
                }),
              ).buildAndExecute();
              break;
            case "decreaseLiquidity":
              await toTx(
                ctx,
                WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
                  whirlpool: whirlpoolPda.publicKey,
                  position: position.publicKey,
                  tickArrayLower: position.tickArrayLower,
                  tickArrayUpper: position.tickArrayUpper,
                  liquidityAmount: new BN(100),
                  positionAuthority: ctx.wallet.publicKey,
                  positionTokenAccount: position.tokenAccount,
                  tokenMinA: new BN(0),
                  tokenMinB: new BN(0),
                  tokenOwnerAccountA: tokenAccountA,
                  tokenOwnerAccountB: tokenAccountB,
                  tokenVaultA: tokenVaultAKeypair.publicKey,
                  tokenVaultB: tokenVaultBKeypair.publicKey,
                }),
              ).buildAndExecute();
              break;
            case "decreaseLiquidityV2":
              await toTx(
                ctx,
                WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                  whirlpool: whirlpoolPda.publicKey,
                  position: position.publicKey,
                  tickArrayLower: position.tickArrayLower,
                  tickArrayUpper: position.tickArrayUpper,
                  liquidityAmount: new BN(100),
                  positionAuthority: ctx.wallet.publicKey,
                  positionTokenAccount: position.tokenAccount,
                  tokenMinA: new BN(0),
                  tokenMinB: new BN(0),
                  tokenOwnerAccountA: tokenAccountA,
                  tokenOwnerAccountB: tokenAccountB,
                  tokenVaultA: tokenVaultAKeypair.publicKey,
                  tokenVaultB: tokenVaultBKeypair.publicKey,
                  tokenMintA,
                  tokenMintB,
                  tokenProgramA: TOKEN_PROGRAM_ID,
                  tokenProgramB: TOKEN_PROGRAM_ID,
                }),
              ).buildAndExecute();
              break;
            case "increaseLiquidityByTokenAmountsV2":
              await toTx(
                ctx,
                WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
                  whirlpool: whirlpoolPda.publicKey,
                  position: position.publicKey,
                  tickArrayLower: position.tickArrayLower,
                  tickArrayUpper: position.tickArrayUpper,
                  minSqrtPrice: MIN_SQRT_PRICE_BN,
                  maxSqrtPrice: MAX_SQRT_PRICE_BN,
                  tokenMaxA: new BN(1000),
                  tokenMaxB: new BN(1000),
                  positionAuthority: ctx.wallet.publicKey,
                  positionTokenAccount: position.tokenAccount,
                  tokenOwnerAccountA: tokenAccountA,
                  tokenOwnerAccountB: tokenAccountB,
                  tokenVaultA: tokenVaultAKeypair.publicKey,
                  tokenVaultB: tokenVaultBKeypair.publicKey,
                  tokenMintA,
                  tokenMintB,
                  tokenProgramA: TOKEN_PROGRAM_ID,
                  tokenProgramB: TOKEN_PROGRAM_ID,
                }),
              ).buildAndExecute();
              break;
          }

          const inside = await calculateGrowthInside(
            fetcher,
            whirlpoolPda.publicKey,
            position.tickArrayLower,
            position.publicKey,
          );

          const positionData = (await fetcher.getPosition(
            position.publicKey,
            IGNORE_CACHE,
          )) as PositionData;

          assert.ok(positionData.feeOwedA.eq(new BN(4))); // 21% of 20u64 = 4.2 => 4u64
          assert.ok(positionData.feeOwedB.eq(new BN(6))); // 21% of 30u64 = 6.3 => 6u64
          assert.ok(positionData.rewardInfos[0].amountOwed.eq(new BN(1))); // 21% of 1u64 x 5 = 1.05u64 => 1u64
          assert.ok(positionData.rewardInfos[1].amountOwed.eq(new BN(2))); // 21% of 2u64 x 5 = 2.10u64 => 2u64
          assert.ok(positionData.rewardInfos[2].amountOwed.eq(new BN(3))); // 21% of 3u64 x 5 = 3.15u64 => 3u64

          // Full checkpoint
          assert.ok(positionData.feeGrowthCheckpointA.eq(inside.insideA));
          assert.ok(positionData.feeGrowthCheckpointB.eq(inside.insideB));
          assert.ok(
            positionData.rewardInfos[0].growthInsideCheckpoint.eq(
              inside.insideR[0],
            ),
          );
          assert.ok(
            positionData.rewardInfos[1].growthInsideCheckpoint.eq(
              inside.insideR[1],
            ),
          );
          assert.ok(
            positionData.rewardInfos[2].growthInsideCheckpoint.eq(
              inside.insideR[2],
            ),
          );
        }

        it("increase liquidity v1", async () => {
          await runTest("increaseLiquidity");
        });
        it("increase liquidity v2", async () => {
          await runTest("increaseLiquidityV2");
        });
        it("decrease liquidity v1", async () => {
          await runTest("decreaseLiquidity");
        });
        it("decrease liquidity v2", async () => {
          await runTest("decreaseLiquidityV2");
        });
        it("increase liquidity by token amounts v2", async () => {
          await runTest("increaseLiquidityByTokenAmountsV2");
        });
      });
    });
  });
});

export async function calculateGrowthInside(
  fetcher: WhirlpoolAccountFetcherInterface,
  whirlpoolPubkey: PublicKey,
  tickArrayPubkey: PublicKey,
  positionPubkey: PublicKey,
) {
  const whirlpoolData = (await fetcher.getPool(
    whirlpoolPubkey,
    IGNORE_CACHE,
  )) as WhirlpoolData;
  const tickArrayData = (await fetcher.getTickArray(
    tickArrayPubkey,
    IGNORE_CACHE,
  )) as TickArrayData;
  const positionData = (await fetcher.getPosition(
    positionPubkey,
    IGNORE_CACHE,
  )) as PositionData;

  const lowerTick = TickArrayUtil.getTickFromArray(
    tickArrayData,
    positionData.tickLowerIndex,
    whirlpoolData.tickSpacing,
  );
  const upperTick = TickArrayUtil.getTickFromArray(
    tickArrayData,
    positionData.tickUpperIndex,
    whirlpoolData.tickSpacing,
  );

  // position status must be In-range
  assert.ok(
    whirlpoolData.tickCurrentIndex >= positionData.tickLowerIndex &&
      whirlpoolData.tickCurrentIndex < positionData.tickUpperIndex,
  );
  function wrappingSub(a: BN, b: BN): BN {
    const X128 = new BN(2).pow(new BN(128));
    return a.sub(b).add(X128).mod(X128);
  }
  function inside(lowerOutside: BN, upperOutside: BN, global: BN): BN {
    return wrappingSub(wrappingSub(global, lowerOutside), upperOutside);
  }

  const insideA = inside(
    lowerTick.feeGrowthOutsideA,
    upperTick.feeGrowthOutsideA,
    whirlpoolData.feeGrowthGlobalA,
  );
  const insideB = inside(
    lowerTick.feeGrowthOutsideB,
    upperTick.feeGrowthOutsideB,
    whirlpoolData.feeGrowthGlobalB,
  );
  const insideR0 = inside(
    lowerTick.rewardGrowthsOutside[0],
    upperTick.rewardGrowthsOutside[0],
    whirlpoolData.rewardInfos[0].growthGlobalX64,
  );
  const insideR1 = inside(
    lowerTick.rewardGrowthsOutside[1],
    upperTick.rewardGrowthsOutside[1],
    whirlpoolData.rewardInfos[1].growthGlobalX64,
  );
  const insideR2 = inside(
    lowerTick.rewardGrowthsOutside[2],
    upperTick.rewardGrowthsOutside[2],
    whirlpoolData.rewardInfos[2].growthGlobalX64,
  );
  return {
    insideA,
    insideB,
    insideR: [insideR0, insideR1, insideR2],
  };
}
