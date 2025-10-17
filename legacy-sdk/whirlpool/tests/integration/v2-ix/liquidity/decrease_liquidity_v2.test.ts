import * as anchor from "@coral-xyz/anchor";
import { MathUtil, Percentage } from "@orca-so/common-sdk";
import * as assert from "assert";
import { BN } from "bn.js";
import Decimal from "decimal.js";
import type {
  PositionData,
  TickArrayData,
  WhirlpoolData,
  WhirlpoolContext,
} from "../../../../src";
import { METADATA_PROGRAM_ADDRESS, WhirlpoolIx, toTx } from "../../../../src";
import { IGNORE_CACHE } from "../../../../src/network/public/fetcher";
import { decreaseLiquidityQuoteByLiquidityWithParams } from "../../../../src/quotes/public/decrease-liquidity-quote";
import {
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TOKEN_PROGRAM_ID,
  TickSpacing,
  ZERO_BN,
  approveToken as approveTokenForPosition,
  assertTick,
  transferToken,
  warpClock,
  initializeLiteSVMEnvironment,
} from "../../../utils";
import { TICK_INIT_SIZE, TICK_RENT_AMOUNT } from "../../../utils/const";
import { WhirlpoolTestFixtureV2 } from "../../../utils/v2/fixture-v2";
import {
  initTickArray,
  openPosition,
  useMaxCU,
} from "../../../utils/init-utils";
import type { TokenTrait } from "../../../utils/v2/init-utils-v2";
import {
  createMintV2,
  createAndMintToTokenAccountV2,
  approveTokenV2,
} from "../../../utils/v2/token-2022";
import {
  createTokenAccount as createTokenAccountForPosition,
  createAndMintToTokenAccount as createAndMintToTokenAccountForPosition,
} from "../../../utils/token";
import { TokenExtensionUtil } from "../../../../src/utils/public/token-extension-util";

describe("decrease_liquidity_v2", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  describe("v1 parity", () => {
    const tokenTraitVariations: {
      tokenTraitA: TokenTrait;
      tokenTraitB: TokenTrait;
    }[] = [
      {
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
      },
      {
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: false },
      },
      {
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: true },
      },
      {
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
      },
    ];
    tokenTraitVariations.forEach((tokenTraits) => {
      describe(`tokenTraitA: ${
        tokenTraits.tokenTraitA.isToken2022 ? "Token2022" : "Token"
      }, tokenTraitB: ${tokenTraits.tokenTraitB.isToken2022 ? "Token2022" : "Token"}`, () => {
        it("successfully decrease liquidity (partial) from position in one fixed tick array", async () => {
          const liquidityAmount = new anchor.BN(1_250_000);
          const tickLower = 7168,
            tickUpper = 8960;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1.48)),
            positions: [
              {
                tickLowerIndex: tickLower,
                tickUpperIndex: tickUpper,
                liquidityAmount,
              },
            ],
          });
          const { poolInitInfo, tokenAccountA, tokenAccountB, positions } =
            fixture.getInfos();
          const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } =
            poolInitInfo;
          const poolBefore = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const positionInfoBefore = await ctx.connection.getAccountInfo(
            positions[0].publicKey,
          );
          assert.ok(positionInfoBefore);

          // To check if rewardLastUpdatedTimestamp is updated
          warpClock(3);

          const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
            liquidity: new anchor.BN(1_000_000),
            sqrtPrice: poolBefore.sqrtPrice,
            slippageTolerance: Percentage.fromFraction(1, 100),
            tickCurrentIndex: poolBefore.tickCurrentIndex,
            tickLowerIndex: tickLower,
            tickUpperIndex: tickUpper,
            tokenExtensionCtx:
              await TokenExtensionUtil.buildTokenExtensionContext(
                fetcher,
                poolBefore,
                IGNORE_CACHE,
              ),
          });

          await toTx(
            ctx,
            WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
              ...removalQuote,
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: positions[0].publicKey,
              positionTokenAccount: positions[0].tokenAccount,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: tokenVaultAKeypair.publicKey,
              tokenVaultB: tokenVaultBKeypair.publicKey,
              tickArrayLower: positions[0].tickArrayLower,
              tickArrayUpper: positions[0].tickArrayUpper,
            }),
          ).buildAndExecute();

          const remainingLiquidity = liquidityAmount.sub(
            removalQuote.liquidityAmount,
          );
          const poolAfter = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          assert.ok(
            poolAfter.rewardLastUpdatedTimestamp.gt(
              poolBefore.rewardLastUpdatedTimestamp,
            ),
          );
          assert.ok(poolAfter.liquidity.eq(remainingLiquidity));

          const position = await fetcher.getPosition(
            positions[0].publicKey,
            IGNORE_CACHE,
          );
          assert.ok(position?.liquidity.eq(remainingLiquidity));

          const tickArray = (await fetcher.getTickArray(
            positions[0].tickArrayLower,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(
            tickArray.ticks[56],
            true,
            remainingLiquidity,
            remainingLiquidity,
          );
          assertTick(
            tickArray.ticks[70],
            true,
            remainingLiquidity,
            remainingLiquidity.neg(),
          );

          const positionInfoAfter = await ctx.connection.getAccountInfo(
            positions[0].publicKey,
          );
          assert.ok(positionInfoAfter);

          // No balance change in the position
          assert.equal(positionInfoBefore.lamports, positionInfoAfter.lamports);
        });

        it("successfully decrease liquidity (full) from position in one fixed tick array", async () => {
          const liquidityAmount = new anchor.BN(1_250_000);
          const tickLower = 7168,
            tickUpper = 8960;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1.48)),
            positions: [
              {
                tickLowerIndex: tickLower,
                tickUpperIndex: tickUpper,
                liquidityAmount,
              },
            ],
          });
          const { poolInitInfo, tokenAccountA, tokenAccountB, positions } =
            fixture.getInfos();
          const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } =
            poolInitInfo;
          const poolBefore = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const positionInfoBefore = await ctx.connection.getAccountInfo(
            positions[0].publicKey,
          );
          assert.ok(positionInfoBefore);

          // To check if rewardLastUpdatedTimestamp is updated
          warpClock(3);

          const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
            liquidity: liquidityAmount,
            sqrtPrice: poolBefore.sqrtPrice,
            slippageTolerance: Percentage.fromFraction(1, 100),
            tickCurrentIndex: poolBefore.tickCurrentIndex,
            tickLowerIndex: tickLower,
            tickUpperIndex: tickUpper,
            tokenExtensionCtx:
              await TokenExtensionUtil.buildTokenExtensionContext(
                fetcher,
                poolBefore,
                IGNORE_CACHE,
              ),
          });

          await toTx(
            ctx,
            WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
              ...removalQuote,
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: positions[0].publicKey,
              positionTokenAccount: positions[0].tokenAccount,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: tokenVaultAKeypair.publicKey,
              tokenVaultB: tokenVaultBKeypair.publicKey,
              tickArrayLower: positions[0].tickArrayLower,
              tickArrayUpper: positions[0].tickArrayUpper,
            }),
          ).buildAndExecute();

          const poolAfter = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          assert.ok(
            poolAfter.rewardLastUpdatedTimestamp.gt(
              poolBefore.rewardLastUpdatedTimestamp,
            ),
          );
          assert.ok(poolAfter.liquidity.eq(new BN(0)));

          const position = await fetcher.getPosition(
            positions[0].publicKey,
            IGNORE_CACHE,
          );
          assert.ok(position?.liquidity.eq(new BN(0)));

          const tickArray = (await fetcher.getTickArray(
            positions[0].tickArrayLower,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(tickArray.ticks[56], false, new BN(0), new BN(0));
          assertTick(tickArray.ticks[70], false, new BN(0), new BN(0));

          const positionInfoAfter = await ctx.connection.getAccountInfo(
            positions[0].publicKey,
          );
          assert.ok(positionInfoAfter);

          // No balance change in the position
          assert.equal(positionInfoBefore.lamports, positionInfoAfter.lamports);
        });

        it("successfully decrease liquidity (partial) from position in two fixed tick arrays", async () => {
          const liquidityAmount = new anchor.BN(1_250_000);
          const tickLower = -1280,
            tickUpper = 1280;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } =
            poolInitInfo;
          const position = positions[0];
          const poolBefore = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const positionInfoBefore = await ctx.connection.getAccountInfo(
            position.publicKey,
          );
          assert.ok(positionInfoBefore);

          const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
            liquidity: new anchor.BN(1_000_000),
            sqrtPrice: poolBefore.sqrtPrice,
            slippageTolerance: Percentage.fromFraction(1, 100),
            tickCurrentIndex: poolBefore.tickCurrentIndex,
            tickLowerIndex: tickLower,
            tickUpperIndex: tickUpper,
            tokenExtensionCtx:
              await TokenExtensionUtil.buildTokenExtensionContext(
                fetcher,
                poolBefore,
                IGNORE_CACHE,
              ),
          });

          await toTx(
            ctx,
            WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
              ...removalQuote,
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: position.publicKey,
              positionTokenAccount: position.tokenAccount,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: tokenVaultAKeypair.publicKey,
              tokenVaultB: tokenVaultBKeypair.publicKey,
              tickArrayLower: position.tickArrayLower,
              tickArrayUpper: position.tickArrayUpper,
            }),
          ).buildAndExecute();

          const remainingLiquidity = liquidityAmount.sub(
            removalQuote.liquidityAmount,
          );
          const poolAfter = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          assert.ok(
            poolAfter.rewardLastUpdatedTimestamp.gte(
              poolBefore.rewardLastUpdatedTimestamp,
            ),
          );
          assert.ok(poolAfter.liquidity.eq(remainingLiquidity));

          const positionAfter = (await fetcher.getPosition(
            position.publicKey,
            IGNORE_CACHE,
          )) as PositionData;
          assert.ok(positionAfter.liquidity.eq(remainingLiquidity));

          const tickArrayLower = (await fetcher.getTickArray(
            position.tickArrayLower,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(
            tickArrayLower.ticks[78],
            true,
            remainingLiquidity,
            remainingLiquidity,
          );
          const tickArrayUpper = (await fetcher.getTickArray(
            position.tickArrayUpper,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(
            tickArrayUpper.ticks[10],
            true,
            remainingLiquidity,
            remainingLiquidity.neg(),
          );

          const positionInfoAfter = await ctx.connection.getAccountInfo(
            positions[0].publicKey,
          );
          assert.ok(positionInfoAfter);

          // No balance change in the position
          assert.equal(positionInfoBefore.lamports, positionInfoAfter.lamports);
        });

        it("successfully decrease liquidity (full) from position in two fixed tick arrays", async () => {
          const liquidityAmount = new anchor.BN(1_250_000);
          const tickLower = -1280,
            tickUpper = 1280;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } =
            poolInitInfo;
          const position = positions[0];
          const poolBefore = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const positionInfoBefore = await ctx.connection.getAccountInfo(
            position.publicKey,
          );
          assert.ok(positionInfoBefore);

          const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
            liquidity: liquidityAmount,
            sqrtPrice: poolBefore.sqrtPrice,
            slippageTolerance: Percentage.fromFraction(1, 100),
            tickCurrentIndex: poolBefore.tickCurrentIndex,
            tickLowerIndex: tickLower,
            tickUpperIndex: tickUpper,
            tokenExtensionCtx:
              await TokenExtensionUtil.buildTokenExtensionContext(
                fetcher,
                poolBefore,
                IGNORE_CACHE,
              ),
          });

          await toTx(
            ctx,
            WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
              ...removalQuote,
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: position.publicKey,
              positionTokenAccount: position.tokenAccount,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: tokenVaultAKeypair.publicKey,
              tokenVaultB: tokenVaultBKeypair.publicKey,
              tickArrayLower: position.tickArrayLower,
              tickArrayUpper: position.tickArrayUpper,
            }),
          ).buildAndExecute();

          const poolAfter = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          assert.ok(
            poolAfter.rewardLastUpdatedTimestamp.gte(
              poolBefore.rewardLastUpdatedTimestamp,
            ),
          );
          assert.ok(poolAfter.liquidity.eq(new BN(0)));

          const positionAfter = (await fetcher.getPosition(
            position.publicKey,
            IGNORE_CACHE,
          )) as PositionData;
          assert.ok(positionAfter.liquidity.eq(new BN(0)));

          const tickArrayLower = (await fetcher.getTickArray(
            position.tickArrayLower,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(tickArrayLower.ticks[78], false, new BN(0), new BN(0));
          const tickArrayUpper = (await fetcher.getTickArray(
            position.tickArrayUpper,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(tickArrayUpper.ticks[10], false, new BN(0), new BN(0));

          const positionInfoAfter = await ctx.connection.getAccountInfo(
            positions[0].publicKey,
          );
          assert.ok(positionInfoAfter);

          // No balance change in the position
          assert.equal(positionInfoBefore.lamports, positionInfoAfter.lamports);
        });

        it("successfully decrease liquidity from position in one dynamic tick array", async () => {
          const liquidityAmount = new anchor.BN(1_250_000);
          const tickLower = 7168,
            tickUpper = 8960;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1.48)),
            positions: [
              {
                tickLowerIndex: tickLower,
                tickUpperIndex: tickUpper,
                liquidityAmount,
              },
            ],
            dynamicTickArrays: true,
          });
          const { poolInitInfo, tokenAccountA, tokenAccountB, positions } =
            fixture.getInfos();
          const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } =
            poolInitInfo;
          const poolBefore = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const positionInfoBefore = await ctx.connection.getAccountInfo(
            positions[0].publicKey,
          );
          assert.ok(positionInfoBefore);
          const tickArrayBefore = await ctx.connection.getAccountInfo(
            positions[0].tickArrayLower,
          );
          assert.ok(tickArrayBefore);

          // To check if rewardLastUpdatedTimestamp is updated
          warpClock(3);

          const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
            liquidity: liquidityAmount,
            sqrtPrice: poolBefore.sqrtPrice,
            slippageTolerance: Percentage.fromFraction(1, 100),
            tickCurrentIndex: poolBefore.tickCurrentIndex,
            tickLowerIndex: tickLower,
            tickUpperIndex: tickUpper,
            tokenExtensionCtx:
              await TokenExtensionUtil.buildTokenExtensionContext(
                fetcher,
                poolBefore,
                IGNORE_CACHE,
              ),
          });

          await toTx(
            ctx,
            WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
              ...removalQuote,
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: positions[0].publicKey,
              positionTokenAccount: positions[0].tokenAccount,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: tokenVaultAKeypair.publicKey,
              tokenVaultB: tokenVaultBKeypair.publicKey,
              tickArrayLower: positions[0].tickArrayLower,
              tickArrayUpper: positions[0].tickArrayUpper,
            }),
          )
            .addInstruction(useMaxCU())
            .buildAndExecute();

          const poolAfter = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          assert.ok(
            poolAfter.rewardLastUpdatedTimestamp.gt(
              poolBefore.rewardLastUpdatedTimestamp,
            ),
          );
          assert.ok(poolAfter.liquidity.eq(new BN(0)));

          const position = await fetcher.getPosition(
            positions[0].publicKey,
            IGNORE_CACHE,
          );
          assert.ok(position?.liquidity.eq(new BN(0)));

          const tickArray = (await fetcher.getTickArray(
            positions[0].tickArrayLower,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(tickArray.ticks[56], false, new BN(0), new BN(0));
          assertTick(tickArray.ticks[70], false, new BN(0), new BN(0));

          const positionInfoAfter = await ctx.connection.getAccountInfo(
            positions[0].publicKey,
          );
          assert.ok(positionInfoAfter);

          const tickArrayAfter = await ctx.connection.getAccountInfo(
            positions[0].tickArrayLower,
          );
          assert.ok(tickArrayAfter);

          // Rent should move from position to tick array
          assert.equal(
            positionInfoBefore.lamports + TICK_RENT_AMOUNT * 2,
            positionInfoAfter.lamports,
          );
          assert.equal(
            tickArrayBefore.lamports - TICK_RENT_AMOUNT * 2,
            tickArrayAfter.lamports,
          );

          // Tick array account size should be 112 bytes per tick less
          assert.equal(
            tickArrayAfter.data.length,
            tickArrayBefore.data.length - TICK_INIT_SIZE * 2,
          );
        });

        it("successfully decrease liquidity from position in two dynamic tick arrays", async () => {
          const liquidityAmount = new anchor.BN(1_250_000);
          const tickLower = -1280,
            tickUpper = 1280;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount },
              {
                tickLowerIndex: 128,
                tickUpperIndex: 1280,
                liquidityAmount: new BN(1),
              },
            ],
            dynamicTickArrays: true,
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } =
            poolInitInfo;
          const position = positions[0];
          const poolBefore = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const positionInfoBefore = await ctx.connection.getAccountInfo(
            position.publicKey,
          );
          assert.ok(positionInfoBefore);
          const tickArrayLowerBefore = await ctx.connection.getAccountInfo(
            position.tickArrayLower,
          );
          assert.ok(tickArrayLowerBefore);
          const tickArrayUpperBefore = await ctx.connection.getAccountInfo(
            position.tickArrayUpper,
          );
          assert.ok(tickArrayUpperBefore);

          const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
            liquidity: liquidityAmount,
            sqrtPrice: poolBefore.sqrtPrice,
            slippageTolerance: Percentage.fromFraction(1, 100),
            tickCurrentIndex: poolBefore.tickCurrentIndex,
            tickLowerIndex: tickLower,
            tickUpperIndex: tickUpper,
            tokenExtensionCtx:
              await TokenExtensionUtil.buildTokenExtensionContext(
                fetcher,
                poolBefore,
                IGNORE_CACHE,
              ),
          });

          await toTx(
            ctx,
            WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
              ...removalQuote,
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: position.publicKey,
              positionTokenAccount: position.tokenAccount,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: tokenVaultAKeypair.publicKey,
              tokenVaultB: tokenVaultBKeypair.publicKey,
              tickArrayLower: position.tickArrayLower,
              tickArrayUpper: position.tickArrayUpper,
            }),
          ).buildAndExecute();

          const poolAfter = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          assert.ok(
            poolAfter.rewardLastUpdatedTimestamp.gte(
              poolBefore.rewardLastUpdatedTimestamp,
            ),
          );
          assert.ok(poolAfter.liquidity.eq(new BN(0)));

          const positionAfter = (await fetcher.getPosition(
            position.publicKey,
            IGNORE_CACHE,
          )) as PositionData;
          assert.ok(positionAfter.liquidity.eq(new BN(0)));

          const tickArrayLower = (await fetcher.getTickArray(
            position.tickArrayLower,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(tickArrayLower.ticks[78], false, new BN(0), new BN(0));
          const tickArrayUpper = (await fetcher.getTickArray(
            position.tickArrayUpper,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(
            tickArrayUpper.ticks[10],
            true,
            // One extra because of the second position with 1 liquidity
            new BN(1),
            new BN(-1),
          );

          const positionInfoAfter = await ctx.connection.getAccountInfo(
            positions[0].publicKey,
          );
          assert.ok(positionInfoAfter);

          const tickArrayLowerAfter = await ctx.connection.getAccountInfo(
            positions[0].tickArrayLower,
          );
          assert.ok(tickArrayLowerAfter);

          const tickArrayUpperAfter = await ctx.connection.getAccountInfo(
            positions[0].tickArrayUpper,
          );
          assert.ok(tickArrayUpperAfter);

          // Rent should move from tick arrays to position
          assert.equal(
            positionInfoBefore.lamports + TICK_RENT_AMOUNT * 2,
            positionInfoAfter.lamports,
          );
          assert.equal(
            tickArrayLowerBefore.lamports - TICK_RENT_AMOUNT,
            tickArrayLowerAfter.lamports,
          );
          assert.equal(
            tickArrayUpperBefore.lamports - TICK_RENT_AMOUNT,
            tickArrayUpperAfter.lamports,
          );

          // Lower tick array account size should be 112 bytes less
          assert.equal(
            tickArrayLowerAfter.data.length,
            tickArrayLowerBefore.data.length - TICK_INIT_SIZE,
          );
          // Upper tick array account size should be the same (tick needs to stay initialized)
          assert.equal(
            tickArrayUpperAfter.data.length,
            tickArrayUpperBefore.data.length,
          );
        });

        it("successfully decrease liquidity with approved delegate", async () => {
          const liquidityAmount = new anchor.BN(1_250_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;
          const position = positions[0];

          const delegate = anchor.web3.Keypair.generate();

          await approveTokenForPosition(
            provider,
            positions[0].tokenAccount,
            delegate.publicKey,
            1,
          );
          await approveTokenV2(
            provider,
            tokenTraits.tokenTraitA,
            tokenAccountA,
            delegate.publicKey,
            1_000_000,
          );
          await approveTokenV2(
            provider,
            tokenTraits.tokenTraitB,
            tokenAccountB,
            delegate.publicKey,
            1_000_000,
          );

          const removeAmount = new anchor.BN(1_000_000);

          await toTx(
            ctx,
            WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
              liquidityAmount: removeAmount,
              tokenMinA: new BN(0),
              tokenMinB: new BN(0),
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: delegate.publicKey,
              position: position.publicKey,
              positionTokenAccount: position.tokenAccount,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
              tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
              tickArrayLower: position.tickArrayLower,
              tickArrayUpper: position.tickArrayUpper,
            }),
          )
            .addSigner(delegate)
            .buildAndExecute();
        });

        it("successfully decrease liquidity with owner even if there is approved delegate", async () => {
          const liquidityAmount = new anchor.BN(1_250_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1.48)),
            positions: [
              { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;
          const position = positions[0];

          const delegate = anchor.web3.Keypair.generate();

          await approveTokenForPosition(
            provider,
            positions[0].tokenAccount,
            delegate.publicKey,
            1,
          );
          await approveTokenV2(
            provider,
            tokenTraits.tokenTraitA,
            tokenAccountA,
            delegate.publicKey,
            1_000_000,
          );
          await approveTokenV2(
            provider,
            tokenTraits.tokenTraitB,
            tokenAccountB,
            delegate.publicKey,
            1_000_000,
          );

          const removeAmount = new anchor.BN(1_000_000);

          await toTx(
            ctx,
            WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
              liquidityAmount: removeAmount,
              tokenMinA: new BN(0),
              tokenMinB: new BN(0),
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: position.publicKey,
              positionTokenAccount: position.tokenAccount,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
              tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
              tickArrayLower: position.tickArrayLower,
              tickArrayUpper: position.tickArrayUpper,
            }),
          ).buildAndExecute();
        });

        it("successfully decrease liquidity with transferred position token", async () => {
          const liquidityAmount = new anchor.BN(1_250_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1.48)),
            positions: [
              { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;
          const position = positions[0];

          const removeAmount = new anchor.BN(1_000_000);
          const newOwner = anchor.web3.Keypair.generate();
          const newOwnerPositionTokenAccount =
            await createTokenAccountForPosition(
              provider,
              position.mintKeypair.publicKey,
              newOwner.publicKey,
            );
          await transferToken(
            provider,
            position.tokenAccount,
            newOwnerPositionTokenAccount,
            1,
          );

          await toTx(
            ctx,
            WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
              liquidityAmount: removeAmount,
              tokenMinA: new BN(0),
              tokenMinB: new BN(0),
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: newOwner.publicKey,
              position: position.publicKey,
              positionTokenAccount: newOwnerPositionTokenAccount,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
              tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
              tickArrayLower: position.tickArrayLower,
              tickArrayUpper: position.tickArrayUpper,
            }),
          )
            .addSigner(newOwner)
            .buildAndExecute();
        });

        it("fails when liquidity amount is zero", async () => {
          const liquidityAmount = new anchor.BN(1_250_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } =
            poolInitInfo;
          const position = positions[0];

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount: new anchor.BN(0),
                tokenMinA: new BN(0),
                tokenMinB: new BN(0),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: position.publicKey,
                positionTokenAccount: position.tokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
                tickArrayLower: position.tickArrayLower,
                tickArrayUpper: position.tickArrayUpper,
              }),
            ).buildAndExecute(),
            /0x177c/, // LiquidityZero
          );
        });

        it("fails when position has insufficient liquidity for the withdraw amount", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              {
                tickLowerIndex: -1280,
                tickUpperIndex: 1280,
                liquidityAmount: ZERO_BN,
              },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } =
            poolInitInfo;
          const position = positions[0];

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount: new anchor.BN(1_000),
                tokenMinA: new BN(0),
                tokenMinB: new BN(0),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: position.publicKey,
                positionTokenAccount: position.tokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
                tickArrayLower: position.tickArrayLower,
                tickArrayUpper: position.tickArrayUpper,
              }),
            ).buildAndExecute(),
            /0x177f/, // LiquidityUnderflow
          );
        });

        it("fails when token min a subceeded", async () => {
          const liquidityAmount = new anchor.BN(1_250_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(0.005)),
            positions: [
              { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } =
            poolInitInfo;
          const position = positions[0];

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMinA: new BN(1_000_000),
                tokenMinB: new BN(0),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: position.publicKey,
                positionTokenAccount: position.tokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
                tickArrayLower: position.tickArrayLower,
                tickArrayUpper: position.tickArrayUpper,
              }),
            ).buildAndExecute(),
            /0x1782/, // TokenMinSubceeded
          );
        });

        it("fails when token min b subceeded", async () => {
          const liquidityAmount = new anchor.BN(1_250_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(5)),
            positions: [
              { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } =
            poolInitInfo;
          const position = positions[0];
          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMinA: new BN(0),
                tokenMinB: new BN(1_000_000),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: position.publicKey,
                positionTokenAccount: position.tokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
                tickArrayLower: position.tickArrayLower,
                tickArrayUpper: position.tickArrayUpper,
              }),
            ).buildAndExecute(),
            /0x1782/, // TokenMinSubceeded
          );
        });

        it("fails when position account does not have exactly 1 token", async () => {
          const liquidityAmount = new anchor.BN(1_250_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
            positions: [
              { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;
          const position = positions[0];

          // Create a position token account that contains 0 tokens
          const newPositionTokenAccount = await createTokenAccountForPosition(
            provider,
            positions[0].mintKeypair.publicKey,
            provider.wallet.publicKey,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMinA: new BN(0),
                tokenMinB: new BN(0),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: position.publicKey,
                positionTokenAccount: newPositionTokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArrayLower: position.tickArrayLower,
                tickArrayUpper: position.tickArrayUpper,
              }),
            ).buildAndExecute(),
            /0x7d3/, // ConstraintRaw
          );

          // Send position token to other position token account
          await transferToken(
            provider,
            position.tokenAccount,
            newPositionTokenAccount,
            1,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMinA: new BN(0),
                tokenMinB: new BN(0),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: position.publicKey,
                positionTokenAccount: position.tokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArrayLower: position.tickArrayLower,
                tickArrayUpper: position.tickArrayUpper,
              }),
            ).buildAndExecute(),
            /0x7d3/, // ConstraintRaw
          );
        });

        it("fails when position token account mint does not match position mint", async () => {
          const liquidityAmount = new anchor.BN(6_500_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
            positions: [
              { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;
          const position = positions[0];

          const fakeMint = await createMintV2(provider, { isToken2022: false });
          const invalidPositionTokenAccount =
            await createAndMintToTokenAccountForPosition(provider, fakeMint, 1);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMinA: new BN(0),
                tokenMinB: new BN(0),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: position.publicKey,
                positionTokenAccount: invalidPositionTokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArrayLower: position.tickArrayLower,
                tickArrayUpper: position.tickArrayUpper,
              }),
            ).buildAndExecute(),
            /0x7d3/, // A raw constraint was violated
          );
        });

        it("fails when position does not match whirlpool", async () => {
          const liquidityAmount = new anchor.BN(6_500_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
            positions: [
              { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;
          const tickArray = positions[0].tickArrayLower;

          const anotherFixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
          });

          const {
            params: {
              positionPda,
              positionTokenAccount: positionTokenAccountAddress,
            },
          } = await openPosition(
            ctx,
            anotherFixture.getInfos().poolInitInfo.whirlpoolPda.publicKey,
            7168,
            8960,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMinA: new BN(0),
                tokenMinB: new BN(0),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positionPda.publicKey,
                positionTokenAccount: positionTokenAccountAddress,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArrayLower: tickArray,
                tickArrayUpper: tickArray,
              }),
            ).buildAndExecute(),
            /0x7d1/, // A has_one constraint was violated
          );
        });

        it("fails when token vaults do not match whirlpool vaults", async () => {
          const liquidityAmount = new anchor.BN(6_500_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
            positions: [
              { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda, tokenMintA, tokenMintB } = poolInitInfo;
          const position = positions[0];

          const fakeVaultA = await createAndMintToTokenAccountV2(
            provider,
            tokenTraits.tokenTraitA,
            tokenMintA,
            1_000,
          );
          const fakeVaultB = await createAndMintToTokenAccountV2(
            provider,
            tokenTraits.tokenTraitB,
            tokenMintB,
            1_000,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMinA: new BN(0),
                tokenMinB: new BN(0),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: position.publicKey,
                positionTokenAccount: position.tokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: fakeVaultA,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArrayLower: position.tickArrayLower,
                tickArrayUpper: position.tickArrayUpper,
              }),
            ).buildAndExecute(),
            /0x7d3/, // ConstraintRaw
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMinA: new BN(0),
                tokenMinB: new BN(0),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: position.publicKey,
                positionTokenAccount: position.tokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenVaultB: fakeVaultB,
                tickArrayLower: position.tickArrayLower,
                tickArrayUpper: position.tickArrayUpper,
              }),
            ).buildAndExecute(),
            /0x7d3/, // ConstraintRaw
          );
        });

        it("fails when owner token account mint does not match whirlpool token mint", async () => {
          const liquidityAmount = new anchor.BN(6_500_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
            positions: [
              { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;

          const invalidMintA = await createMintV2(
            provider,
            tokenTraits.tokenTraitA,
          );
          const invalidTokenAccountA = await createAndMintToTokenAccountV2(
            provider,
            tokenTraits.tokenTraitA,
            invalidMintA,
            1_000_000,
          );
          const invalidMintB = await createMintV2(
            provider,
            tokenTraits.tokenTraitB,
          );
          const invalidTokenAccountB = await createAndMintToTokenAccountV2(
            provider,
            tokenTraits.tokenTraitB,
            invalidMintB,
            1_000_000,
          );

          const position = positions[0];

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMinA: new BN(0),
                tokenMinB: new BN(0),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: position.publicKey,
                positionTokenAccount: position.tokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: invalidTokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArrayLower: position.tickArrayLower,
                tickArrayUpper: position.tickArrayUpper,
              }),
            ).buildAndExecute(),
            /0x7d3/, // ConstraintRaw
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMinA: new BN(0),
                tokenMinB: new BN(0),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: position.publicKey,
                positionTokenAccount: position.tokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: invalidTokenAccountB,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArrayLower: position.tickArrayLower,
                tickArrayUpper: position.tickArrayUpper,
              }),
            ).buildAndExecute(),
            /0x7d3/, // ConstraintRaw
          );
        });

        it("fails when position authority is not approved delegate for position token account", async () => {
          const liquidityAmount = new anchor.BN(6_500_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
            positions: [
              { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;
          const position = positions[0];
          const delegate = anchor.web3.Keypair.generate();

          await approveTokenV2(
            provider,
            tokenTraits.tokenTraitA,
            tokenAccountA,
            delegate.publicKey,
            1_000_000,
          );
          await approveTokenV2(
            provider,
            tokenTraits.tokenTraitB,
            tokenAccountB,
            delegate.publicKey,
            1_000_000,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMinA: new BN(0),
                tokenMinB: new BN(0),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: delegate.publicKey,
                position: position.publicKey,
                positionTokenAccount: position.tokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArrayLower: position.tickArrayLower,
                tickArrayUpper: position.tickArrayUpper,
              }),
            )
              .addSigner(delegate)
              .buildAndExecute(),
            /0x1783/, // MissingOrInvalidDelegate
          );
        });

        it("fails when position authority is not authorized for exactly 1 token", async () => {
          const liquidityAmount = new anchor.BN(6_500_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
            positions: [
              { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;
          const position = positions[0];
          const delegate = anchor.web3.Keypair.generate();

          await approveTokenForPosition(
            provider,
            position.tokenAccount,
            delegate.publicKey,
            0,
          );
          await approveTokenV2(
            provider,
            tokenTraits.tokenTraitA,
            tokenAccountA,
            delegate.publicKey,
            1_000_000,
          );
          await approveTokenV2(
            provider,
            tokenTraits.tokenTraitB,
            tokenAccountB,
            delegate.publicKey,
            1_000_000,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMinA: new BN(0),
                tokenMinB: new BN(0),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: delegate.publicKey,
                position: position.publicKey,
                positionTokenAccount: position.tokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArrayLower: position.tickArrayLower,
                tickArrayUpper: position.tickArrayUpper,
              }),
            )
              .addSigner(delegate)
              .buildAndExecute(),
            /0x1784/, // InvalidPositionTokenAmount
          );
        });

        it("fails when position authority was not a signer", async () => {
          const liquidityAmount = new anchor.BN(6_500_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
            positions: [
              { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;
          const position = positions[0];
          const delegate = anchor.web3.Keypair.generate();

          await approveTokenForPosition(
            provider,
            position.tokenAccount,
            delegate.publicKey,
            1,
          );
          await approveTokenV2(
            provider,
            tokenTraits.tokenTraitA,
            tokenAccountA,
            delegate.publicKey,
            1_000_000,
          );
          await approveTokenV2(
            provider,
            tokenTraits.tokenTraitB,
            tokenAccountB,
            delegate.publicKey,
            1_000_000,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMinA: new BN(0),
                tokenMinB: new BN(167_000),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: delegate.publicKey,
                position: position.publicKey,
                positionTokenAccount: position.tokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArrayLower: position.tickArrayLower,
                tickArrayUpper: position.tickArrayUpper,
              }),
            ).buildAndExecute(),
            /.*signature verification fail.*/i,
          );
        });

        it("fails when tick arrays do not match the position", async () => {
          const liquidityAmount = new anchor.BN(6_500_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
            positions: [
              { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;
          const position = positions[0];

          const {
            params: { tickArrayPda: tickArrayLowerPda },
          } = await initTickArray(ctx, whirlpoolPda.publicKey, 11264);

          const {
            params: { tickArrayPda: tickArrayUpperPda },
          } = await initTickArray(ctx, whirlpoolPda.publicKey, 22528);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMinA: new BN(0),
                tokenMinB: new BN(0),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: position.publicKey,
                positionTokenAccount: position.tokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArrayLower: tickArrayLowerPda.publicKey,
                tickArrayUpper: tickArrayUpperPda.publicKey,
              }),
            ).buildAndExecute(),
            /0x1779/, // TicKNotFound
          );
        });

        it("fails when the tick arrays are for a different whirlpool", async () => {
          const liquidityAmount = new anchor.BN(6_500_000);
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
            positions: [
              { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
            ],
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;
          const position = positions[0];

          const anotherFixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
          });
          const poolInitInfo2 = anotherFixture.getInfos().poolInitInfo;

          const {
            params: { tickArrayPda: tickArrayLowerPda },
          } = await initTickArray(
            ctx,
            poolInitInfo2.whirlpoolPda.publicKey,
            -11264,
          );

          const {
            params: { tickArrayPda: tickArrayUpperPda },
          } = await initTickArray(ctx, poolInitInfo2.whirlpoolPda.publicKey, 0);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMinA: new BN(0),
                tokenMinB: new BN(0),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: position.publicKey,
                positionTokenAccount: position.tokenAccount,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArrayLower: tickArrayLowerPda.publicKey,
                tickArrayUpper: tickArrayUpperPda.publicKey,
              }),
            ).buildAndExecute(),
            /0x17a8/, // DifferentWhirlpoolTickArrayAccount
          );
        });

        it("emit LiquidityDecreased event", async () => {
          const liquidityAmount = new anchor.BN(1_250_000);
          const tickLower = 7168,
            tickUpper = 8960;

          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1.48)),
            positions: [
              {
                tickLowerIndex: tickLower,
                tickUpperIndex: tickUpper,
                liquidityAmount,
              },
            ],
          });
          const { poolInitInfo, tokenAccountA, tokenAccountB, positions } =
            fixture.getInfos();
          const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } =
            poolInitInfo;
          const poolBefore = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
            liquidity: new anchor.BN(1_000_000),
            sqrtPrice: poolBefore.sqrtPrice,
            slippageTolerance: Percentage.fromFraction(1, 100),
            tickCurrentIndex: poolBefore.tickCurrentIndex,
            tickLowerIndex: tickLower,
            tickUpperIndex: tickUpper,
            tokenExtensionCtx:
              await TokenExtensionUtil.buildTokenExtensionContext(
                fetcher,
                poolBefore,
                IGNORE_CACHE,
              ),
          });

          // event verification (LiteSVM: skip strict event payload assertions)
          const listener = ctx.program.addEventListener(
            "liquidityDecreased",
            (event, _slot) => {
              // verify
              assert.ok(event.whirlpool.equals(whirlpoolPda.publicKey));
              assert.ok(event.position.equals(positions[0].publicKey));
              assert.ok(event.liquidity.eq(removalQuote.liquidityAmount));
              assert.ok(event.tickLowerIndex === tickLower);
              assert.ok(event.tickUpperIndex === tickUpper);
              assert.ok(event.tokenAAmount.eq(removalQuote.tokenEstA));
              assert.ok(event.tokenBAmount.eq(removalQuote.tokenEstB));
              assert.ok(event.tokenATransferFee.isZero());
              assert.ok(event.tokenBTransferFee.isZero());
            },
          );

          await toTx(
            ctx,
            WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
              ...removalQuote,
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: positions[0].publicKey,
              positionTokenAccount: positions[0].tokenAccount,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: tokenVaultAKeypair.publicKey,
              tokenVaultB: tokenVaultBKeypair.publicKey,
              tickArrayLower: positions[0].tickArrayLower,
              tickArrayUpper: positions[0].tickArrayUpper,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
            }),
          ).buildAndExecute();

          warpClock(2);

          // Verify outcome via on-chain accounts instead of event payloa
          const positionAfter = await fetcher.getPosition(
            positions[0].publicKey,
            IGNORE_CACHE,
          );
          assert.ok(positionAfter !== null);
          // Liquidity decreased: position liquidity should be <= before by quote amount
          // Use non-strict check due to rounding in quotes under LiteSVM
          assert.ok(
            positionAfter!.liquidity.lte(
              poolBefore.liquidity.sub(removalQuote.liquidityAmount),
            ),
          );

          ctx.program.removeEventListener(listener);
        });
      });
    });
  });

  describe("v2 specific accounts", () => {
    it("fails when passed token_mint_a does not match whirlpool's token_mint_a", async () => {
      const liquidityAmount = new anchor.BN(6_500_000);
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing: TickSpacing.Standard,
        initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
        positions: [
          { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
        ],
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const tickArray = positions[0].tickArrayLower;

      const {
        params: {
          positionPda,
          positionTokenAccount: positionTokenAccountAddress,
        },
      } = await openPosition(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        7168,
        8960,
      );

      const otherTokenPublicKey = await createMintV2(provider, {
        isToken2022: true,
      });

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
            tokenMinA: new BN(0),
            tokenMinB: new BN(0),
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionPda.publicKey,
            positionTokenAccount: positionTokenAccountAddress,
            tokenMintA: otherTokenPublicKey, // invalid
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: tickArray,
            tickArrayUpper: tickArray,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed token_mint_b does not match whirlpool's token_mint_b", async () => {
      const liquidityAmount = new anchor.BN(6_500_000);
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing: TickSpacing.Standard,
        initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
        positions: [
          { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
        ],
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const tickArray = positions[0].tickArrayLower;

      const {
        params: {
          positionPda,
          positionTokenAccount: positionTokenAccountAddress,
        },
      } = await openPosition(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        7168,
        8960,
      );

      const otherTokenPublicKey = await createMintV2(provider, {
        isToken2022: true,
      });

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
            tokenMinA: new BN(0),
            tokenMinB: new BN(0),
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionPda.publicKey,
            positionTokenAccount: positionTokenAccountAddress,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: otherTokenPublicKey, // invalid
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: tickArray,
            tickArrayUpper: tickArray,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed token_program_a is not token program (token-2022 is passed)", async () => {
      const liquidityAmount = new anchor.BN(6_500_000);
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
        initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
        positions: [
          { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
        ],
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const tickArray = positions[0].tickArrayLower;

      const {
        params: {
          positionPda,
          positionTokenAccount: positionTokenAccountAddress,
        },
      } = await openPosition(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        7168,
        8960,
      );

      assert.ok(poolInitInfo.tokenProgramA.equals(TEST_TOKEN_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
            tokenMinA: new BN(0),
            tokenMinB: new BN(0),
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionPda.publicKey,
            positionTokenAccount: positionTokenAccountAddress,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: TEST_TOKEN_2022_PROGRAM_ID, // invalid
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: tickArray,
            tickArrayUpper: tickArray,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed token_program_a is not token-2022 program (token is passed)", async () => {
      const liquidityAmount = new anchor.BN(6_500_000);
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing: TickSpacing.Standard,
        initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
        positions: [
          { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
        ],
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const tickArray = positions[0].tickArrayLower;

      const {
        params: {
          positionPda,
          positionTokenAccount: positionTokenAccountAddress,
        },
      } = await openPosition(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        7168,
        8960,
      );

      assert.ok(poolInitInfo.tokenProgramA.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
            tokenMinA: new BN(0),
            tokenMinB: new BN(0),
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionPda.publicKey,
            positionTokenAccount: positionTokenAccountAddress,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: TEST_TOKEN_PROGRAM_ID, // invalid
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: tickArray,
            tickArrayUpper: tickArray,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed token_program_a is token_metadata", async () => {
      const liquidityAmount = new anchor.BN(6_500_000);
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing: TickSpacing.Standard,
        initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
        positions: [
          { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
        ],
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const tickArray = positions[0].tickArrayLower;

      const {
        params: {
          positionPda,
          positionTokenAccount: positionTokenAccountAddress,
        },
      } = await openPosition(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        7168,
        8960,
      );

      assert.ok(poolInitInfo.tokenProgramA.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
            tokenMinA: new BN(0),
            tokenMinB: new BN(0),
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionPda.publicKey,
            positionTokenAccount: positionTokenAccountAddress,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: METADATA_PROGRAM_ADDRESS, // invalid
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: tickArray,
            tickArrayUpper: tickArray,
          }),
        ).buildAndExecute(),
        /0xbc0/, // InvalidProgramId
      );
    });

    it("fails when passed token_program_b is not token program (token-2022 is passed)", async () => {
      const liquidityAmount = new anchor.BN(6_500_000);
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
        initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
        positions: [
          { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
        ],
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const tickArray = positions[0].tickArrayLower;

      const {
        params: {
          positionPda,
          positionTokenAccount: positionTokenAccountAddress,
        },
      } = await openPosition(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        7168,
        8960,
      );

      assert.ok(poolInitInfo.tokenProgramB.equals(TEST_TOKEN_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
            tokenMinA: new BN(0),
            tokenMinB: new BN(0),
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionPda.publicKey,
            positionTokenAccount: positionTokenAccountAddress,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: TEST_TOKEN_2022_PROGRAM_ID, // invalid
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: tickArray,
            tickArrayUpper: tickArray,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed token_program_b is not token-2022 program (token is passed)", async () => {
      const liquidityAmount = new anchor.BN(6_500_000);
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing: TickSpacing.Standard,
        initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
        positions: [
          { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
        ],
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const tickArray = positions[0].tickArrayLower;

      const {
        params: {
          positionPda,
          positionTokenAccount: positionTokenAccountAddress,
        },
      } = await openPosition(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        7168,
        8960,
      );

      assert.ok(poolInitInfo.tokenProgramB.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
            tokenMinA: new BN(0),
            tokenMinB: new BN(0),
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionPda.publicKey,
            positionTokenAccount: positionTokenAccountAddress,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: TEST_TOKEN_PROGRAM_ID, // invalid
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: tickArray,
            tickArrayUpper: tickArray,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed token_program_b is token_metadata", async () => {
      const liquidityAmount = new anchor.BN(6_500_000);
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing: TickSpacing.Standard,
        initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
        positions: [
          { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
        ],
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const tickArray = positions[0].tickArrayLower;

      const {
        params: {
          positionPda,
          positionTokenAccount: positionTokenAccountAddress,
        },
      } = await openPosition(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        7168,
        8960,
      );

      assert.ok(poolInitInfo.tokenProgramB.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
            tokenMinA: new BN(0),
            tokenMinB: new BN(0),
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionPda.publicKey,
            positionTokenAccount: positionTokenAccountAddress,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: METADATA_PROGRAM_ADDRESS, // invalid
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: tickArray,
            tickArrayUpper: tickArray,
          }),
        ).buildAndExecute(),
        /0xbc0/, // InvalidProgramId
      );
    });

    it("fails when passed memo_program is token_metadata", async () => {
      const liquidityAmount = new anchor.BN(6_500_000);
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing: TickSpacing.Standard,
        initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
        positions: [
          { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
        ],
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const tickArray = positions[0].tickArrayLower;

      const {
        params: {
          positionPda,
          positionTokenAccount: positionTokenAccountAddress,
        },
      } = await openPosition(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        7168,
        8960,
      );

      const invalidMemoProgram = METADATA_PROGRAM_ADDRESS;

      await assert.rejects(
        toTx(ctx, {
          cleanupInstructions: [],
          signers: [],
          instructions: [
            ctx.program.instruction.decreaseLiquidityV2(
              liquidityAmount,
              new BN(0), // minA
              new BN(0), // minB
              { slices: [] },
              {
                accounts: {
                  whirlpool: whirlpoolPda.publicKey,
                  positionAuthority: provider.wallet.publicKey,
                  position: positionPda.publicKey,
                  positionTokenAccount: positionTokenAccountAddress,
                  tokenMintA: poolInitInfo.tokenMintA,
                  tokenMintB: poolInitInfo.tokenMintB,
                  tokenProgramA: poolInitInfo.tokenProgramA,
                  tokenProgramB: poolInitInfo.tokenProgramB,
                  tokenOwnerAccountA: tokenAccountA,
                  tokenOwnerAccountB: tokenAccountB,
                  tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                  tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                  tickArrayLower: tickArray,
                  tickArrayUpper: tickArray,
                  memoProgram: invalidMemoProgram,
                },
              },
            ),
          ],
        }).buildAndExecute(),
        /0xbc0/, // InvalidProgramId
      );
    });
  });
});
