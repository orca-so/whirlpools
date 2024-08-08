import * as anchor from "@coral-xyz/anchor";
import { MathUtil, TransactionBuilder } from "@orca-so/common-sdk";
import * as assert from "assert";
import BN from "bn.js";
import Decimal from "decimal.js";
import type { PositionData, TickArrayData, WhirlpoolData } from "../../../src";
import {
  METADATA_PROGRAM_ADDRESS,
  PDAUtil,
  PriceMath,
  TickUtil,
  WhirlpoolContext,
  WhirlpoolIx,
  toTx,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { PoolUtil, toTokenAmount } from "../../../src/utils/public/pool-utils";
import {
  MAX_U64,
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TOKEN_PROGRAM_ID,
  TickSpacing,
  ZERO_BN,
  approveToken as approveTokenForPosition,
  assertTick,
  getTokenBalance,
  sleep,
  transferToken,
} from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { WhirlpoolTestFixtureV2 } from "../../utils/v2/fixture-v2";
import { initTickArray, openPosition } from "../../utils/init-utils";
import type { TokenTrait } from "../../utils/v2/init-utils-v2";
import {
  createMintV2,
  createAndMintToTokenAccountV2,
  approveTokenV2,
} from "../../utils/v2/token-2022";
import {
  createTokenAccount as createTokenAccountForPosition,
  createAndMintToTokenAccount as createAndMintToTokenAccountForPosition,
} from "../../utils/token";
import {
  generateDefaultInitTickArrayParams,
  generateDefaultOpenPositionParams,
} from "../../utils/test-builders";

describe("increase_liquidity_v2", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

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
        it("increase liquidity of a position spanning two tick arrays", async () => {
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
          const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
            currTick,
            tickLowerIndex,
            tickUpperIndex,
            tokenAmount,
          );

          // To check if rewardLastUpdatedTimestamp is updated
          await sleep(3000);

          await toTx(
            ctx,
            WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
              liquidityAmount,
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
          assert.ok(position.liquidity.eq(liquidityAmount));

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
          assert.ok(poolAfter.liquidity.eq(new anchor.BN(liquidityAmount)));

          const tickArrayLower = (await fetcher.getTickArray(
            positionInitInfo.tickArrayLower,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(
            tickArrayLower.ticks[78],
            true,
            liquidityAmount,
            liquidityAmount,
          );
          const tickArrayUpper = (await fetcher.getTickArray(
            positionInitInfo.tickArrayUpper,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(
            tickArrayUpper.ticks[10],
            true,
            liquidityAmount,
            liquidityAmount.neg(),
          );
        });

        it("increase liquidity of a position contained in one tick array", async () => {
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
          const poolBefore = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const tokenAmount = toTokenAmount(1_000_000, 0);
          const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
            currTick,
            tickLowerIndex,
            tickUpperIndex,
            tokenAmount,
          );

          await toTx(
            ctx,
            WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
              liquidityAmount,
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

          const expectedLiquidity = new anchor.BN(liquidityAmount);
          const position = (await fetcher.getPosition(
            positionInitInfo.publicKey,
            IGNORE_CACHE,
          )) as PositionData;
          assert.ok(position.liquidity.eq(expectedLiquidity));

          const tickArray = (await fetcher.getTickArray(
            positionInitInfo.tickArrayLower,
            IGNORE_CACHE,
          )) as TickArrayData;

          assertTick(
            tickArray.ticks[56],
            true,
            expectedLiquidity,
            expectedLiquidity,
          );
          assertTick(
            tickArray.ticks[70],
            true,
            expectedLiquidity,
            expectedLiquidity.neg(),
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
          assert.equal(poolAfter.liquidity, 0);
        });

        it("initialize and increase liquidity of a position in a single transaction", async () => {
          const currTick = 500;
          const tickLowerIndex = 7168;
          const tickUpperIndex = 8960;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
          });
          const { poolInitInfo, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda, tickSpacing } = poolInitInfo;
          const poolBefore = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const tokenAmount = toTokenAmount(1_000_000, 0);
          const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
            currTick,
            tickLowerIndex,
            tickUpperIndex,
            tokenAmount,
          );

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
            // TODO: create a ComputeBudgetInstruction to request more compute
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
            // .addInstruction(
            //   buildtoTx(ctx, WhirlpoolIx.initTickArrayIx(generateDefaultInitTickArrayParams(
            //     ctx,
            //     whirlpoolPda.publicKey,
            //     getStartTickIndex(pos[0].tickLowerIndex + TICK_ARRAY_SIZE * tickSpacing, tickSpacing),
            //   ))
            // )
            .addInstruction(WhirlpoolIx.openPositionIx(ctx.program, params))
            // .addInstruction(
            //   buildWhirlpoolIx.openPositionWithMetadataIx(ctx.program, params)
            // )
            .addSigner(mint)
            .addInstruction(
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
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
                tickArrayLower: tickArrayLower,
                tickArrayUpper: tickArrayUpper,
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

          const expectedLiquidity = new anchor.BN(liquidityAmount);
          const position = (await fetcher.getPosition(
            params.positionPda.publicKey,
            IGNORE_CACHE,
          )) as PositionData;
          assert.ok(position.liquidity.eq(expectedLiquidity));

          const tickArray = (await fetcher.getTickArray(
            tickArrayLower,
            IGNORE_CACHE,
          )) as TickArrayData;

          assertTick(
            tickArray.ticks[56],
            true,
            expectedLiquidity,
            expectedLiquidity,
          );
          assertTick(
            tickArray.ticks[70],
            true,
            expectedLiquidity,
            expectedLiquidity.neg(),
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
          assert.equal(poolAfter.liquidity, 0);
        });

        it("increase liquidity of a position with an approved position authority delegate", async () => {
          const currTick = 1300;
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
          const tokenAmount = toTokenAmount(0, 167_000);
          const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
            currTick,
            tickLowerIndex,
            tickUpperIndex,
            tokenAmount,
          );

          const delegate = anchor.web3.Keypair.generate();
          await approveTokenForPosition(
            provider,
            positionInitInfo.tokenAccount,
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

          await toTx(
            ctx,
            WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
              liquidityAmount,
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

          const position = (await fetcher.getPosition(
            positionInitInfo.publicKey,
            IGNORE_CACHE,
          )) as PositionData;
          assert.ok(position.liquidity.eq(liquidityAmount));

          const poolAfter = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          assert.ok(
            poolAfter.rewardLastUpdatedTimestamp.gte(
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
          assert.equal(poolAfter.liquidity, 0);

          const tickArrayLower = (await fetcher.getTickArray(
            positionInitInfo.tickArrayLower,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(
            tickArrayLower.ticks[78],
            true,
            liquidityAmount,
            liquidityAmount,
          );
          const tickArrayUpper = (await fetcher.getTickArray(
            positionInitInfo.tickArrayUpper,
            IGNORE_CACHE,
          )) as TickArrayData;
          assertTick(
            tickArrayUpper.ticks[10],
            true,
            liquidityAmount,
            liquidityAmount.neg(),
          );
        });

        it("add maximum amount of liquidity near minimum price", async () => {
          const currTick = -443621;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Stable,
            initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
            mintAmount: MAX_U64,
          });
          const { poolInitInfo, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
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
          const {
            positionPda,
            positionTokenAccount: positionTokenAccountAddress,
          } = positionInfo.params;

          const tokenAmount = {
            tokenA: new BN(0),
            tokenB: MAX_U64,
          };
          const estLiquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
            currTick,
            tickLowerIndex,
            tickUpperIndex,
            tokenAmount,
          );

          await toTx(
            ctx,
            WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
              liquidityAmount: estLiquidityAmount,
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
          ).buildAndExecute();

          const position = (await fetcher.getPosition(
            positionPda.publicKey,
            IGNORE_CACHE,
          )) as PositionData;
          assert.ok(position.liquidity.eq(estLiquidityAmount));
        });

        it("add maximum amount of liquidity near maximum price", async () => {
          const currTick = 443635;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Stable,
            initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
            mintAmount: MAX_U64,
          });
          const { poolInitInfo, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
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
          const {
            positionPda,
            positionTokenAccount: positionTokenAccountAddress,
          } = positionInfo.params;

          const tokenAmount = {
            tokenA: new BN(0),
            tokenB: MAX_U64,
          };
          const estLiquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
            currTick,
            tickLowerIndex,
            tickUpperIndex,
            tokenAmount,
          );

          await toTx(
            ctx,
            WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
              liquidityAmount: estLiquidityAmount,
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
          ).buildAndExecute();

          const position = (await fetcher.getPosition(
            positionPda.publicKey,
            IGNORE_CACHE,
          )) as PositionData;
          assert.ok(position.liquidity.eq(estLiquidityAmount));
        });

        it("fails with zero liquidity amount", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
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
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount: ZERO_BN,
                tokenMaxA: new BN(0),
                tokenMaxB: new BN(1_000_000),
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

        it("fails when token max a exceeded", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
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

          const liquidityAmount = new anchor.BN(6_500_000);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
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
            /0x1781/, // TokenMaxExceeded
          );
        });

        it("fails when token max b exceeded", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
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

          const liquidityAmount = new anchor.BN(6_500_000);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
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
            /0x1781/, // TokenMaxExceeded
          );
        });

        it("fails when position account does not have exactly 1 token", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
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

          // Create a position token account that contains 0 tokens
          const newPositionTokenAccount = await createTokenAccountForPosition(
            provider,
            positionInitInfo.mintKeypair.publicKey,
            provider.wallet.publicKey,
          );

          const liquidityAmount = new anchor.BN(6_500_000);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMaxA: new BN(0),
                tokenMaxB: new BN(1_000_000),
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positionInitInfo.publicKey,
                positionTokenAccount: newPositionTokenAccount,
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
            /0x7d3/, // ConstraintRaw
          );

          // Send position token to other position token account
          await transferToken(
            provider,
            positionInitInfo.tokenAccount,
            newPositionTokenAccount,
            1,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMaxA: new BN(0),
                tokenMaxB: new BN(1_000_000),
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
            /0x7d3/, // ConstraintRaw
          );
        });

        it("fails when position token account mint does not match position mint", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
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

          // Create a position token account that contains 0 tokens
          const fakeMint = await createMintV2(provider, { isToken2022: false });
          const invalidPositionTokenAccount =
            await createAndMintToTokenAccountForPosition(provider, fakeMint, 1);

          const liquidityAmount = new anchor.BN(6_500_000);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMaxA: new BN(0),
                tokenMaxB: new BN(1_000_000),
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
            /0x7d3/, // A raw constraint was violated
          );
        });

        it("fails when position does not match whirlpool", async () => {
          const tickLowerIndex = 7168;
          const tickUpperIndex = 8960;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            positions: [
              { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
            ],
          });
          const { poolInitInfo, tokenAccountA, tokenAccountB } =
            fixture.getInfos();
          const { whirlpoolPda } = poolInitInfo;

          const anotherFixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
          });
          const poolInitInfo2 = anotherFixture.getInfos().poolInitInfo;

          const positionInitInfo = await openPosition(
            ctx,
            poolInitInfo2.whirlpoolPda.publicKey,
            tickLowerIndex,
            tickUpperIndex,
          );
          const {
            positionPda,
            positionTokenAccount: positionTokenAccountAddress,
          } = positionInitInfo.params;

          const {
            params: { tickArrayPda },
          } = await initTickArray(ctx, poolInitInfo2.whirlpoolPda.publicKey, 0);

          const liquidityAmount = new anchor.BN(6_500_000);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMaxA: new BN(0),
                tokenMaxB: new BN(1_000_000),
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
            /0x7d1/, // A has_one constraint was violated
          );
        });

        it("fails when token vaults do not match whirlpool vaults", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
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
          const liquidityAmount = new anchor.BN(6_500_000);

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
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMaxA: new BN(0),
                tokenMaxB: new BN(1_000_000),
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
            /0x7d3/, // ConstraintRaw
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMaxA: new BN(0),
                tokenMaxB: new BN(1_000_000),
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
            /0x7d3/, // ConstraintRaw
          );
        });

        it("fails when owner token account mint does not match whirlpool token mint", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
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
          const liquidityAmount = new anchor.BN(6_500_000);

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

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMaxA: new BN(0),
                tokenMaxB: new BN(1_000_000),
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
            /0x7d3/, // ConstraintRaw
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMaxA: new BN(0),
                tokenMaxB: new BN(1_000_000),
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
            /0x7d3/, // ConstraintRaw
          );
        });

        it("fails when position authority is not approved delegate for position token account", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
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

          const liquidityAmount = new anchor.BN(1_250_000);

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
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMaxA: new BN(0),
                tokenMaxB: new BN(167_000),
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
            /0x1783/, // MissingOrInvalidDelegate
          );
        });

        it("fails when position authority is not authorized for exactly 1 token", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
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

          const liquidityAmount = new anchor.BN(1_250_000);

          await approveTokenForPosition(
            provider,
            positionInitInfo.tokenAccount,
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
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMaxA: new BN(0),
                tokenMaxB: new BN(167_000),
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
            /0x1784/, // InvalidPositionTokenAmount
          );
        });

        it("fails when position authority was not a signer", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
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

          const liquidityAmount = new anchor.BN(1_250_000);

          await approveTokenForPosition(
            provider,
            positionInitInfo.tokenAccount,
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
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMaxA: new BN(0),
                tokenMaxB: new BN(167_000),
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
            ...tokenTraits,
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

          const liquidityAmount = new anchor.BN(1_250_000);

          await approveTokenForPosition(
            provider,
            positionInitInfo.tokenAccount,
            delegate.publicKey,
            1,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMaxA: new BN(0),
                tokenMaxB: new BN(167_000),
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
            /0x4/, // owner does not match
          );
        });

        it("fails when tick arrays do not match the position", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
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

          const liquidityAmount = new anchor.BN(1_250_000);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMaxA: new BN(0),
                tokenMaxB: new BN(167_000),
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
            /0x1779/, // TicKNotFound
          );
        });

        it("fails when the tick arrays are for a different whirlpool", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
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

          const liquidityAmount = new anchor.BN(1_250_000);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
                liquidityAmount,
                tokenMaxA: new BN(0),
                tokenMaxB: new BN(167_000),
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
            /0x7d1/, // A has one constraint was violated
          );
        });
      });
    });
  });

  describe("v2 specific accounts", () => {
    it("fails when passed token_mint_a does not match whirlpool's token_mint_a", async () => {
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
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount,
      );

      const otherTokenPublicKey = await createMintV2(provider, {
        isToken2022: true,
      });

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: otherTokenPublicKey, // invalid
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
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed token_mint_b does not match whirlpool's token_mint_b", async () => {
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
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount,
      );

      const otherTokenPublicKey = await createMintV2(provider, {
        isToken2022: true,
      });

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: otherTokenPublicKey, // invalid
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
        /0x7dc/, // ConstraintAddress
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
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount,
      );

      assert.ok(poolInitInfo.tokenProgramA.equals(TEST_TOKEN_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
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
        /0x7d3/, // ConstraintRaw
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
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount,
      );

      assert.ok(poolInitInfo.tokenProgramA.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
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
        /0x7d3/, // ConstraintRaw
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
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount,
      );

      assert.ok(poolInitInfo.tokenProgramA.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
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
        /0xbc0/, // InvalidProgramId
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
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount,
      );

      assert.ok(poolInitInfo.tokenProgramB.equals(TEST_TOKEN_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
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
        /0x7d3/, // ConstraintRaw
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
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount,
      );

      assert.ok(poolInitInfo.tokenProgramB.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
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
        /0x7d3/, // ConstraintRaw
      );
    });

    it("fails when passed token_program_b is token_metadata", async () => {
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
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount,
      );

      assert.ok(poolInitInfo.tokenProgramB.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
            tokenMaxA: tokenAmount.tokenA,
            tokenMaxB: tokenAmount.tokenB,
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positionInitInfo.publicKey,
            positionTokenAccount: positionInitInfo.tokenAccount,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: METADATA_PROGRAM_ADDRESS, // invalid
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArrayLower: positionInitInfo.tickArrayLower,
            tickArrayUpper: positionInitInfo.tickArrayUpper,
          }),
        ).buildAndExecute(),
        /0xbc0/, // InvalidProgramId
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
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount,
      );

      const invalidMemoProgram = METADATA_PROGRAM_ADDRESS;

      await assert.rejects(
        toTx(ctx, {
          cleanupInstructions: [],
          signers: [],
          instructions: [
            ctx.program.instruction.increaseLiquidityV2(
              liquidityAmount,
              tokenAmount.tokenA, // maxA
              tokenAmount.tokenB, // maxB
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
