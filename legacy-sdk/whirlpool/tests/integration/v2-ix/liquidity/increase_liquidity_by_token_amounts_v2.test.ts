import * as anchor from "@coral-xyz/anchor";
import { MathUtil, TransactionBuilder } from "@orca-so/common-sdk";
import * as assert from "assert";
import { BN } from "bn.js";
import Decimal from "decimal.js";
import type {
  PositionData,
  TickArrayData,
  WhirlpoolData,
  WhirlpoolContext,
} from "../../../../src";
import {
  METADATA_PROGRAM_ADDRESS,
  PDAUtil,
  PriceMath,
  TickUtil,
  WhirlpoolIx,
  toTx,
} from "../../../../src";
import { IGNORE_CACHE } from "../../../../src/network/public/fetcher";
import {
  PoolUtil,
  toTokenAmount,
} from "../../../../src/utils/public/pool-utils";
import {
  MAX_U64,
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TOKEN_PROGRAM_ID,
  TickSpacing,
  ZERO_BN,
  approveToken as approveTokenForPosition,
  assertTick,
  getTokenBalance,
  warpClock,
  initializeLiteSVMEnvironment,
} from "../../../utils";
import { TICK_INIT_SIZE, TICK_RENT_AMOUNT } from "../../../utils/const";
import { WhirlpoolTestFixtureV2 } from "../../../utils/v2/fixture-v2";
import { initTickArray, openPosition } from "../../../utils/init-utils";
import { useMaxCU, type TokenTrait } from "../../../utils/v2/init-utils-v2";
import {
  createMintV2,
  createAndMintToTokenAccountV2,
  approveTokenV2,
} from "../../../utils/v2/token-2022";
import { createAndMintToTokenAccount as createAndMintToTokenAccountForPosition } from "../../../utils/token";
import {
  generateDefaultInitTickArrayParams,
  generateDefaultOpenPositionParams,
} from "../../../utils/test-builders";

describe("increase_liquidity_by_token_amounts_v2", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  describe("core flows across Token/Token-2022 variants (adds liquidity by token maxima)", () => {
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
      describe(`tokenTraitA: ${tokenTraits.tokenTraitA.isToken2022 ? "Token2022" : "Token"}, tokenTraitB: ${tokenTraits.tokenTraitB.isToken2022 ? "Token2022" : "Token"}`, () => {
        it("adds liquidity spanning two tick arrays", async () => {
          const currTick = 0;
          const tickLowerIndex = -1280,
            tickUpperIndex = 1280;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            positions: [
              { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
            ],
            initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;
          const positionInitInfo = positions[0];

          const poolBefore = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const tokenAmount = toTokenAmount(167_000, 167_000);
          const expectedLiquidity = PoolUtil.estimateLiquidityFromTokenAmounts(
            currTick,
            tickLowerIndex,
            tickUpperIndex,
            tokenAmount,
          );

          const positionInfoBefore = await ctx.connection.getAccountInfo(
            positionInitInfo.publicKey,
          );
          assert.ok(positionInfoBefore);
          warpClock(3);

          await toTx(
            ctx,
            WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
              tokenMaxA: tokenAmount.tokenA,
              tokenMaxB: tokenAmount.tokenB,
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: positionInitInfo.publicKey,
              positionTokenAccount: positionInitInfo.tokenAccount,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
              tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
              tickArrayLower: positionInitInfo.tickArrayLower,
              tickArrayUpper: positionInitInfo.tickArrayUpper,
            }),
          ).buildAndExecute();

          const position = (await fetcher.getPosition(
            positionInitInfo.publicKey,
            IGNORE_CACHE,
          )) as PositionData;
          assert.ok(position.liquidity.eq(expectedLiquidity));

          const poolAfter = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          assert.ok(
            poolAfter.rewardLastUpdatedTimestamp.gt(
              poolBefore.rewardLastUpdatedTimestamp,
            ),
          );
          assert.equal(
            await getTokenBalance(
              provider,
              poolInitInfo.tokenVaultAKeypair.publicKey,
            ),
            tokenAmount.tokenA.toString(),
          );
          assert.equal(
            await getTokenBalance(
              provider,
              poolInitInfo.tokenVaultBKeypair.publicKey,
            ),
            tokenAmount.tokenB.toString(),
          );

          const taLower = (await fetcher.getTickArray(
            positionInitInfo.tickArrayLower,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(
            taLower.ticks[78],
            true,
            expectedLiquidity,
            expectedLiquidity,
          );
          const taUpper = (await fetcher.getTickArray(
            positionInitInfo.tickArrayUpper,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(
            taUpper.ticks[10],
            true,
            expectedLiquidity,
            expectedLiquidity.neg(),
          );

          const positionInfoAfter = await ctx.connection.getAccountInfo(
            positionInitInfo.publicKey,
          );
          assert.ok(positionInfoAfter);
          assert.equal(positionInfoBefore.lamports, positionInfoAfter.lamports);
        });

        it("adds liquidity contained in one tick array", async () => {
          const currTick = 500;
          const tickLowerIndex = 7168;
          const tickUpperIndex = 8960;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            positions: [
              { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
            ],
            initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;
          const positionInitInfo = positions[0];

          const tokenAmount = toTokenAmount(1_000_000, 0);
          const expectedLiquidity = PoolUtil.estimateLiquidityFromTokenAmounts(
            currTick,
            tickLowerIndex,
            tickUpperIndex,
            tokenAmount,
          );

          const positionInfoBefore = await ctx.connection.getAccountInfo(
            positionInitInfo.publicKey,
          );
          assert.ok(positionInfoBefore);

          await toTx(
            ctx,
            WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
              tokenMaxA: tokenAmount.tokenA,
              tokenMaxB: tokenAmount.tokenB,
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: positionInitInfo.publicKey,
              positionTokenAccount: positionInitInfo.tokenAccount,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
              tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
              tickArrayLower: positionInitInfo.tickArrayLower,
              tickArrayUpper: positionInitInfo.tickArrayUpper,
            }),
          ).buildAndExecute();

          assert.equal(
            await getTokenBalance(
              provider,
              poolInitInfo.tokenVaultAKeypair.publicKey,
            ),
            tokenAmount.tokenA.toString(),
          );
          assert.equal(
            await getTokenBalance(
              provider,
              poolInitInfo.tokenVaultBKeypair.publicKey,
            ),
            tokenAmount.tokenB.toString(),
          );

          const expected = new anchor.BN(expectedLiquidity);
          const position = (await fetcher.getPosition(
            positionInitInfo.publicKey,
            IGNORE_CACHE,
          )) as PositionData;
          assert.ok(position.liquidity.eq(expected));

          const ta = (await fetcher.getTickArray(
            positionInitInfo.tickArrayLower,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(ta.ticks[56], true, expected, expected);
          assertTick(ta.ticks[70], true, expected, expected.neg());
        });

        it("emits LiquidityIncreased event", async () => {
          const currTick = 0;
          const tickLowerIndex = -1280,
            tickUpperIndex = 1280;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            positions: [
              { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
            ],
            initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
          });
          const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;
          const positionInitInfo = positions[0];

          const tokenAmount = toTokenAmount(167_000, 167_000);
          const expectedLiquidity = PoolUtil.estimateLiquidityFromTokenAmounts(
            currTick,
            tickLowerIndex,
            tickUpperIndex,
            tokenAmount,
          );

          const listener = ctx.program.addEventListener(
            "liquidityIncreased",
            (event, _slot) => {
              assert.ok(event.whirlpool.equals(whirlpoolPda.publicKey));
              assert.ok(event.position.equals(positionInitInfo.publicKey));
              assert.ok(event.liquidity.eq(expectedLiquidity));
              assert.ok(event.tickLowerIndex === tickLowerIndex);
              assert.ok(event.tickUpperIndex === tickUpperIndex);
              assert.ok(event.tokenAAmount.eq(tokenAmount.tokenA));
              assert.ok(event.tokenBAmount.eq(tokenAmount.tokenB));
              assert.ok(event.tokenATransferFee.isZero());
              assert.ok(event.tokenBTransferFee.isZero());
            },
          );

          await toTx(
            ctx,
            WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
              tokenMaxA: tokenAmount.tokenA,
              tokenMaxB: tokenAmount.tokenB,
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: positionInitInfo.publicKey,
              positionTokenAccount: positionInitInfo.tokenAccount,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
              tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
              tickArrayLower: positionInitInfo.tickArrayLower,
              tickArrayUpper: positionInitInfo.tickArrayUpper,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
            }),
          ).buildAndExecute();

          warpClock(2);
          const positionAfter = await fetcher.getPosition(
            positionInitInfo.publicKey,
            IGNORE_CACHE,
          );
          assert.ok(positionAfter !== null);
          assert.ok(positionAfter!.liquidity.gte(expectedLiquidity));
          ctx.program.removeEventListener(listener);
        });
      });
    });
  });

  describe("errors & validation (liquidity derivation and max bounds)", () => {
    it("fails when computed liquidity is zero", async () => {
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
        positions: [
          {
            tickLowerIndex: 7168,
            tickUpperIndex: 8960,
            liquidityAmount: ZERO_BN,
          },
        ],
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: new BN(0),
            tokenMaxB: new BN(0),
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /0x177c/, // LiquidityZero
      );
    });

    it("fails when token max a yields zero computed liquidity", async () => {
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
        initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
        positions: [
          {
            tickLowerIndex: 7168,
            tickUpperIndex: 8960,
            liquidityAmount: ZERO_BN,
          },
        ],
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: new BN(0),
            tokenMaxB: new BN(999_999_999),
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /0x177c/, // LiquidityZero
      );
    });

    it("fails when token max b yields zero computed liquidity", async () => {
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
        positions: [
          {
            tickLowerIndex: 7168,
            tickUpperIndex: 8960,
            liquidityAmount: ZERO_BN,
          },
        ],
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: new BN(999_999_999),
            tokenMaxB: new BN(0),
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /0x177c/, // LiquidityZero
      );
    });
  });

  describe("v2-specific account validations (program IDs, mints, and memo)", () => {
    it("fails when passed token_mint_a does not match whirlpool token_mint_a", async () => {
      const currTick = 500;
      const tickLowerIndex = 7168;
      const tickUpperIndex = 8960;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing: TickSpacing.Standard,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
        ],
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];
      const tokenAmount = toTokenAmount(1_000_000, 0);
      const otherMint = await createMintV2(provider, { isToken2022: true });

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: otherMint, // invalid
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /0x7dc/,
      );
    });

    it("fails when passed token_program_a is token_metadata", async () => {
      const currTick = 500;
      const tickLowerIndex = 7168;
      const tickUpperIndex = 8960;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing: TickSpacing.Standard,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
        ],
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];
      const tokenAmount = toTokenAmount(1_000_000, 0);

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: METADATA_PROGRAM_ADDRESS, // invalid
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /0xbc0/,
      );
    });
  });

  describe("v2 parity with increase_liquidity_v2 (dynamic arrays, authority, constraints)", () => {
    it("initialize and increase liquidity of a position in a single transaction", async () => {
      const currTick = 500;
      const tickLowerIndex = 7168;
      const tickUpperIndex = 8960;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
      });
      const { poolInitInfo, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const { whirlpoolPda, tickSpacing } = poolInitInfo;
      const poolBefore = (await fetcher.getPool(
        whirlpoolPda.publicKey,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      const tokenAmount = toTokenAmount(1_000_000, 0);
      const { params, mint } = await generateDefaultOpenPositionParams(
        ctx,
        whirlpoolPda.publicKey,
        tickLowerIndex,
        tickUpperIndex,
        ctx.wallet.publicKey,
      );

      const tickArrayLower = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpoolPda.publicKey,
        TickUtil.getStartTickIndex(tickLowerIndex, tickSpacing),
      ).publicKey;

      const tickArrayUpper = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpoolPda.publicKey,
        TickUtil.getStartTickIndex(tickUpperIndex, tickSpacing),
      ).publicKey;

      await new TransactionBuilder(
        ctx.provider.connection,
        ctx.provider.wallet,
        ctx.txBuilderOpts,
      )
        .addInstruction(
          WhirlpoolIx.initTickArrayIx(
            ctx.program,
            generateDefaultInitTickArrayParams(
              ctx,
              whirlpoolPda.publicKey,
              TickUtil.getStartTickIndex(tickLowerIndex, tickSpacing),
            ),
          ),
        )
        .addInstruction(WhirlpoolIx.openPositionIx(ctx.program, params))
        .addSigner(mint)
        .addInstruction(
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: params.positionPda.publicKey,
            positionTokenAccount: params.positionTokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower,
            tickArrayUpper,
          }),
        )
        .buildAndExecute();

      assert.equal(
        await getTokenBalance(
          provider,
          poolInitInfo.tokenVaultAKeypair.publicKey,
        ),
        tokenAmount.tokenA.toString(),
      );
      assert.equal(
        await getTokenBalance(
          provider,
          poolInitInfo.tokenVaultBKeypair.publicKey,
        ),
        tokenAmount.tokenB.toString(),
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
    });

    it("increase liquidity spanning two dynamic tick arrays and verify rent/resize", async () => {
      const currTick = 0;
      const tickLowerIndex = -1280;
      const tickUpperIndex = 1280;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
          { tickLowerIndex: 128, tickUpperIndex, liquidityAmount: new BN(1) },
        ],
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
        dynamicTickArrays: true,
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];
      const tokenAmount = toTokenAmount(167_000, 167_000);

      const positionInfoBefore = await ctx.connection.getAccountInfo(
        positionInitInfo.publicKey,
      );
      assert.ok(positionInfoBefore);
      const tickArrayLowerBefore = await ctx.connection.getAccountInfo(
        positionInitInfo.tickArrayLower,
      );
      assert.ok(tickArrayLowerBefore);
      const tickArrayUpperBefore = await ctx.connection.getAccountInfo(
        positionInitInfo.tickArrayUpper,
      );
      assert.ok(tickArrayUpperBefore);

      warpClock(3);

      await toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
          tokenMaxA: tokenAmount.tokenA,
          tokenMaxB: tokenAmount.tokenB,
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: positionInitInfo.tokenAccount,
          tokenMintA: poolInitInfo.tokenMintA,
          tokenMintB: poolInitInfo.tokenMintB,
          tokenProgramA: poolInitInfo.tokenProgramA,
          tokenProgramB: poolInitInfo.tokenProgramB,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: positionInitInfo.tickArrayLower,
          tickArrayUpper: positionInitInfo.tickArrayUpper,
        }),
      ).buildAndExecute();

      const positionInfoAfter = await ctx.connection.getAccountInfo(
        positionInitInfo.publicKey,
      );
      assert.ok(positionInfoAfter);
      const tickArrayLowerAfter = await ctx.connection.getAccountInfo(
        positionInitInfo.tickArrayLower,
      );
      assert.ok(tickArrayLowerAfter);
      const tickArrayUpperAfter = await ctx.connection.getAccountInfo(
        positionInitInfo.tickArrayUpper,
      );
      assert.ok(tickArrayUpperAfter);

      assert.equal(
        positionInfoBefore.lamports - TICK_RENT_AMOUNT * 2,
        positionInfoAfter.lamports,
      );
      assert.equal(
        tickArrayLowerBefore.lamports + TICK_RENT_AMOUNT,
        tickArrayLowerAfter.lamports,
      );
      assert.equal(
        tickArrayUpperBefore.lamports + TICK_RENT_AMOUNT,
        tickArrayUpperAfter.lamports,
      );
      assert.equal(
        tickArrayLowerAfter.data.length,
        tickArrayLowerBefore.data.length + TICK_INIT_SIZE,
      );
      assert.equal(
        tickArrayUpperAfter.data.length,
        tickArrayUpperBefore.data.length,
      );
    });

    it("increase liquidity contained in one dynamic tick array and verify resize", async () => {
      const currTick = 500;
      const tickLowerIndex = 7168;
      const tickUpperIndex = 8960;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
        ],
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
        dynamicTickArrays: true,
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];
      const tokenAmount = toTokenAmount(1_000_000, 0);

      const positionInfoBefore = await ctx.connection.getAccountInfo(
        positionInitInfo.publicKey,
      );
      assert.ok(positionInfoBefore);
      const tickArrayBefore = await ctx.connection.getAccountInfo(
        positionInitInfo.tickArrayLower,
      );
      assert.ok(tickArrayBefore);

      await toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
          tokenMaxA: tokenAmount.tokenA,
          tokenMaxB: tokenAmount.tokenB,
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: positionInitInfo.tokenAccount,
          tokenMintA: poolInitInfo.tokenMintA,
          tokenMintB: poolInitInfo.tokenMintB,
          tokenProgramA: poolInitInfo.tokenProgramA,
          tokenProgramB: poolInitInfo.tokenProgramB,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: positionInitInfo.tickArrayLower,
          tickArrayUpper: positionInitInfo.tickArrayUpper,
        }),
      )
        .addInstruction(useMaxCU())
        .buildAndExecute();

      const tickArrayAfter = await ctx.connection.getAccountInfo(
        positionInitInfo.tickArrayLower,
      );
      assert.ok(tickArrayAfter);
      assert.equal(
        tickArrayAfter.data.length,
        tickArrayBefore.data.length + TICK_INIT_SIZE * 2,
      );
    });

    it("increase liquidity with an approved position authority delegate", async () => {
      const currTick = 1300;
      const tickLowerIndex = -1280;
      const tickUpperIndex = 1280;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
        ],
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];
      const tokenAmount = toTokenAmount(0, 167_000);

      const delegate = anchor.web3.Keypair.generate();
      await approveTokenForPosition(
        provider,
        positionInitInfo.tokenAccount,
        delegate.publicKey,
        1,
      );
      await approveTokenV2(
        provider,
        { isToken2022: false },
        tokenAccountA,
        delegate.publicKey,
        1_000_000,
      );
      await approveTokenV2(
        provider,
        { isToken2022: false },
        tokenAccountB,
        delegate.publicKey,
        1_000_000,
      );

      await toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
          tokenMaxA: tokenAmount.tokenA,
          tokenMaxB: tokenAmount.tokenB,
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: delegate.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: positionInitInfo.tokenAccount,
          tokenMintA: poolInitInfo.tokenMintA,
          tokenMintB: poolInitInfo.tokenMintB,
          tokenProgramA: poolInitInfo.tokenProgramA,
          tokenProgramB: poolInitInfo.tokenProgramB,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: positionInitInfo.tickArrayLower,
          tickArrayUpper: positionInitInfo.tickArrayUpper,
        }),
      )
        .addSigner(delegate)
        .buildAndExecute();
    });

    it("fails when position authority was not a signer", async () => {
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
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
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];
      const delegate = anchor.web3.Keypair.generate();
      const tokenAmount = toTokenAmount(0, 167_000);

      await approveTokenForPosition(
        provider,
        positionInitInfo.tokenAccount,
        delegate.publicKey,
        1,
      );
      await approveTokenV2(
        provider,
        { isToken2022: false },
        tokenAccountA,
        delegate.publicKey,
        1_000_000,
      );
      await approveTokenV2(
        provider,
        { isToken2022: false },
        tokenAccountB,
        delegate.publicKey,
        1_000_000,
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: delegate.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /.*signature verification fail.*/i,
      );
    });

    it("fails when position authority is not approved for token owner accounts", async () => {
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
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
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];
      const delegate = anchor.web3.Keypair.generate();
      const tokenAmount = toTokenAmount(0, 167_000);

      await approveTokenForPosition(
        provider,
        positionInitInfo.tokenAccount,
        delegate.publicKey,
        1,
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: delegate.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        )
          .addSigner(delegate)
          .buildAndExecute(),
        /0x4/,
      );
    });

    it("fails when position token account mint does not match position mint", async () => {
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
        positions: [
          {
            tickLowerIndex: 7168,
            tickUpperIndex: 8960,
            liquidityAmount: ZERO_BN,
          },
        ],
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];

      const fakeMint = await createMintV2(provider, { isToken2022: false });
      const invalidPositionTokenAccount =
        await createAndMintToTokenAccountForPosition(provider, fakeMint, 1);
      const tokenAmount = toTokenAmount(0, 1_000_000);

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: invalidPositionTokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /0x7d3/,
      );
    });

    it("fails when position does not match whirlpool", async () => {
      const tickLowerIndex = 7168;
      const tickUpperIndex = 8960;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
        ],
      });
      const { poolInitInfo, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;

      const anotherFixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
      });
      const poolInitInfo2 = anotherFixture.getInfos().poolInitInfo;

      const positionInitInfo = await openPosition(
        ctx,
        poolInitInfo2.whirlpoolPda.publicKey,
        tickLowerIndex,
        tickUpperIndex,
      );
      const { positionPda, positionTokenAccount: positionTokenAccountAddress } =
        positionInitInfo.params;

      const {
        params: { tickArrayPda },
      } = await initTickArray(ctx, poolInitInfo2.whirlpoolPda.publicKey, 0);

      const tokenAmount = toTokenAmount(0, 1_000_000);

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
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
            tickArrayLower: tickArrayPda.publicKey,
            tickArrayUpper: tickArrayPda.publicKey,
          }),
        ).buildAndExecute(),
        /0x7d1/,
      );
    });

    it("fails when token vaults do not match whirlpool vaults", async () => {
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
        positions: [
          {
            tickLowerIndex: 7168,
            tickUpperIndex: 8960,
            liquidityAmount: ZERO_BN,
          },
        ],
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda, tokenMintA, tokenMintB } = poolInitInfo;
      const positionInitInfo = positions[0];
      const tokenAmount = toTokenAmount(0, 1_000_000);

      const fakeVaultA = await createAndMintToTokenAccountV2(
        provider,
        { isToken2022: false },
        tokenMintA,
        1_000,
      );
      const fakeVaultB = await createAndMintToTokenAccountV2(
        provider,
        { isToken2022: false },
        tokenMintB,
        1_000,
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: fakeVaultA,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /0x7d3/,
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: fakeVaultB,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /0x7d3/,
      );
    });

    it("fails when owner token account mint does not match whirlpool token mint", async () => {
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
        positions: [
          {
            tickLowerIndex: 7168,
            tickUpperIndex: 8960,
            liquidityAmount: ZERO_BN,
          },
        ],
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];
      const tokenAmount = toTokenAmount(0, 1_000_000);

      const invalidMintA = await createMintV2(provider, { isToken2022: false });
      const invalidTokenAccountA = await createAndMintToTokenAccountV2(
        provider,
        { isToken2022: false },
        invalidMintA,
        1_000_000,
      );
      const invalidMintB = await createMintV2(provider, { isToken2022: false });
      const invalidTokenAccountB = await createAndMintToTokenAccountV2(
        provider,
        { isToken2022: false },
        invalidMintB,
        1_000_000,
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: invalidTokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /0x7d3/,
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: invalidTokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /0x7d3/,
      );
    });

    it("fails when tick arrays do not match the position", async () => {
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
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
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];

      const {
        params: { tickArrayPda: tickArrayLowerPda },
      } = await initTickArray(ctx, whirlpoolPda.publicKey, 11264);
      const {
        params: { tickArrayPda: tickArrayUpperPda },
      } = await initTickArray(ctx, whirlpoolPda.publicKey, 22528);

      const tokenAmount = toTokenAmount(0, 167_000);

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
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
        /0x1779/,
      );
    });

    it("fails when the tick arrays are for a different whirlpool", async () => {
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
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
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];

      const anotherFixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
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

      const tokenAmount = toTokenAmount(0, 167_000);

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
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
        /0x17a8/,
      );
    });

    it("fails when passed token_program_a is not token program (token-2022 is passed)", async () => {
      const currTick = 500;
      const tickLowerIndex = 7168;
      const tickUpperIndex = 8960;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
        ],
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];
      const tokenAmount = toTokenAmount(1_000_000, 0);

      assert.ok(poolInitInfo.tokenProgramA.equals(TEST_TOKEN_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: TEST_TOKEN_2022_PROGRAM_ID, // invalid
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /0x7dc/,
      );
    });

    it("fails when passed token_program_a is not token-2022 program (token is passed)", async () => {
      const currTick = 500;
      const tickLowerIndex = 7168;
      const tickUpperIndex = 8960;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing: TickSpacing.Standard,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
        ],
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];
      const tokenAmount = toTokenAmount(1_000_000, 0);

      assert.ok(poolInitInfo.tokenProgramA.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: TEST_TOKEN_PROGRAM_ID, // invalid
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /0x7dc/,
      );
    });

    it("fails when passed token_program_b is not token program (token-2022 is passed)", async () => {
      const currTick = 500;
      const tickLowerIndex = 7168;
      const tickUpperIndex = 8960;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Standard,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
        ],
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];
      const tokenAmount = toTokenAmount(1_000_000, 0);

      assert.ok(poolInitInfo.tokenProgramB.equals(TEST_TOKEN_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: TEST_TOKEN_2022_PROGRAM_ID, // invalid
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /0x7dc/,
      );
    });

    it("fails when passed token_program_b is not token-2022 program (token is passed)", async () => {
      const currTick = 500;
      const tickLowerIndex = 7168;
      const tickUpperIndex = 8960;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing: TickSpacing.Standard,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
        ],
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];
      const tokenAmount = toTokenAmount(1_000_000, 0);

      assert.ok(poolInitInfo.tokenProgramB.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: TEST_TOKEN_PROGRAM_ID, // invalid
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /0x7dc/,
      );
    });

    it("fails when passed memo_program is token_metadata", async () => {
      const currTick = 500;
      const tickLowerIndex = 7168;
      const tickUpperIndex = 8960;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing: TickSpacing.Standard,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
        ],
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
      });
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const positionInitInfo = positions[0];

      const tokenAmount = toTokenAmount(1_000_000, 0);

      await assert.rejects(
        toTx(ctx, {
          cleanupInstructions: [],
          signers: [],
          instructions: [
            ctx.program.instruction.increaseLiquidityByTokenAmountsV2(
              tokenAmount.tokenA,
              tokenAmount.tokenB,
              { slices: [] },
              {
                accounts: {
                  whirlpool: whirlpoolPda.publicKey,
                  positionAuthority: provider.wallet.publicKey,
                  position: positionInitInfo.publicKey,
                  positionTokenAccount: positionInitInfo.tokenAccount,
                  tokenMintA: poolInitInfo.tokenMintA,
                  tokenMintB: poolInitInfo.tokenMintB,
                  tokenProgramA: poolInitInfo.tokenProgramA,
                  tokenProgramB: poolInitInfo.tokenProgramB,
                  tokenOwnerAccountA: tokenAccountA,
                  tokenOwnerAccountB: tokenAccountB,
                  tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                  tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                  tickArrayLower: positionInitInfo.tickArrayLower,
                  tickArrayUpper: positionInitInfo.tickArrayUpper,
                  memoProgram: METADATA_PROGRAM_ADDRESS,
                },
              },
            ),
          ],
        }).buildAndExecute(),
        /0xbc0/,
      );
    });

    it("add maximum amount of liquidity near minimum price", async () => {
      const currTick = -443621;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Stable,
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
        mintAmount: MAX_U64,
      });
      const { poolInitInfo } = fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;

      const {
        params: { tickArrayPda },
      } = await initTickArray(ctx, whirlpoolPda.publicKey, -444224);

      const tickLowerIndex = -443632;
      const tickUpperIndex = -443624;
      const positionInfo = await openPosition(
        ctx,
        whirlpoolPda.publicKey,
        tickLowerIndex,
        tickUpperIndex,
      );
      const { positionPda, positionTokenAccount: positionTokenAccountAddress } =
        positionInfo.params;

      const tokenAmount = { tokenA: new BN(0), tokenB: MAX_U64 };

      await toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
          tokenMaxA: tokenAmount.tokenA,
          tokenMaxB: tokenAmount.tokenB,
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positionPda.publicKey,
          positionTokenAccount: positionTokenAccountAddress,
          tokenMintA: poolInitInfo.tokenMintA,
          tokenMintB: poolInitInfo.tokenMintB,
          tokenProgramA: poolInitInfo.tokenProgramA,
          tokenProgramB: poolInitInfo.tokenProgramB,
          tokenOwnerAccountA: fixture.getInfos().tokenAccountA,
          tokenOwnerAccountB: fixture.getInfos().tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        }),
      ).buildAndExecute();

      const position = (await fetcher.getPosition(
        positionPda.publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      assert.ok(position.liquidity.gt(ZERO_BN));
    });

    it("add maximum amount of liquidity near maximum price", async () => {
      const currTick = 443635;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing: TickSpacing.Stable,
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
        mintAmount: MAX_U64,
      });
      const { poolInitInfo } = fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;

      const {
        params: { tickArrayPda },
      } = await initTickArray(ctx, whirlpoolPda.publicKey, 436480);

      const tickLowerIndex = 436488;
      const tickUpperIndex = 436496;
      const positionInfo = await openPosition(
        ctx,
        whirlpoolPda.publicKey,
        tickLowerIndex,
        tickUpperIndex,
      );
      const { positionPda, positionTokenAccount: positionTokenAccountAddress } =
        positionInfo.params;

      const tokenAmount = { tokenA: new BN(0), tokenB: MAX_U64 };

      await toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
          tokenMaxA: tokenAmount.tokenA,
          tokenMaxB: tokenAmount.tokenB,
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positionPda.publicKey,
          positionTokenAccount: positionTokenAccountAddress,
          tokenMintA: poolInitInfo.tokenMintA,
          tokenMintB: poolInitInfo.tokenMintB,
          tokenProgramA: poolInitInfo.tokenProgramA,
          tokenProgramB: poolInitInfo.tokenProgramB,
          tokenOwnerAccountA: fixture.getInfos().tokenAccountA,
          tokenOwnerAccountB: fixture.getInfos().tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        }),
      ).buildAndExecute();

      const position = (await fetcher.getPosition(
        positionPda.publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      assert.ok(position.liquidity.gt(ZERO_BN));
    });
  });
});
