import * as anchor from "@coral-xyz/anchor";
import { MathUtil, Percentage } from "@orca-so/common-sdk";
import * as assert from "assert";
import BN from "bn.js";
import Decimal from "decimal.js";
import type {
  PositionData,
  TickArrayData,
  WhirlpoolData,
  WhirlpoolContext,
} from "../../../src";
import { WhirlpoolIx, toTx } from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { decreaseLiquidityQuoteByLiquidityWithParams } from "../../../src/quotes/public/decrease-liquidity-quote";
import {
  TickSpacing,
  ZERO_BN,
  approveToken,
  assertTick,
  createAndMintToTokenAccount,
  createMint,
  createTokenAccount,
  transferToken,
  warpClock,
} from "../../utils";
import { TICK_INIT_SIZE, TICK_RENT_AMOUNT } from "../../utils/const";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import {
  initTestPool,
  initTickArray,
  openPosition,
  useMaxCU,
} from "../../utils/init-utils";
import { TokenExtensionUtil } from "../../../src/utils/public/token-extension-util";
import {
  initializeLiteSVMEnvironment,
  pollForCondition,
} from "../../utils/litesvm";

type LiquidityDecreasedEvent = {
  liquidity: anchor.BN;
  tokenAAmount: anchor.BN;
  tokenBAmount: anchor.BN;
  tokenATransferFee: anchor.BN;
  tokenBTransferFee: anchor.BN;
  tickLowerIndex: number;
  tickUpperIndex: number;
};

describe("decrease_liquidity", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  it("successfully decrease liquidity (partial) from position in one fixed tick array", async () => {
    const liquidityAmount = new anchor.BN(1_250_000);
    const tickLower = 7168,
      tickUpper = 8960;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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

    // To check if rewardLastUpdatedTimestamp is updated
    warpClock(2);

    const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
      liquidity: new anchor.BN(1_000_000),
      sqrtPrice: poolBefore.sqrtPrice,
      slippageTolerance: Percentage.fromFraction(1, 100),
      tickCurrentIndex: poolBefore.tickCurrentIndex,
      tickLowerIndex: tickLower,
      tickUpperIndex: tickUpper,
      tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
        fetcher,
        poolBefore,
        IGNORE_CACHE,
      ),
    });

    const positionInfoBefore = await ctx.connection.getAccountInfo(
      positions[0].publicKey,
    );
    assert.ok(positionInfoBefore);
    await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
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
      }),
    ).buildAndExecute();

    const remainingLiquidity = liquidityAmount.sub(
      removalQuote.liquidityAmount,
    );
    const poolAfter = (await pollForCondition(
      () => fetcher.getPool(whirlpoolPda.publicKey, IGNORE_CACHE),
      (p) => !!p && p.liquidity.eq(new BN(0)),
      { accountToReload: whirlpoolPda.publicKey, connection: ctx.connection },
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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

    // To check if rewardLastUpdatedTimestamp is updated
    warpClock(2);

    const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
      liquidity: liquidityAmount,
      sqrtPrice: poolBefore.sqrtPrice,
      slippageTolerance: Percentage.fromFraction(1, 100),
      tickCurrentIndex: poolBefore.tickCurrentIndex,
      tickLowerIndex: tickLower,
      tickUpperIndex: tickUpper,
      tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
        fetcher,
        poolBefore,
        IGNORE_CACHE,
      ),
    });

    const positionInfoBefore = await ctx.connection.getAccountInfo(
      positions[0].publicKey,
    );
    assert.ok(positionInfoBefore);
    await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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

    const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
      liquidity: new anchor.BN(1_000_000),
      sqrtPrice: poolBefore.sqrtPrice,
      slippageTolerance: Percentage.fromFraction(1, 100),
      tickCurrentIndex: poolBefore.tickCurrentIndex,
      tickLowerIndex: tickLower,
      tickUpperIndex: tickUpper,
      tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
        fetcher,
        poolBefore,
        IGNORE_CACHE,
      ),
    });

    const positionInfoBefore = await ctx.connection.getAccountInfo(
      positions[0].publicKey,
    );
    assert.ok(positionInfoBefore);

    await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
        ...removalQuote,
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: provider.wallet.publicKey,
        position: position.publicKey,
        positionTokenAccount: position.tokenAccount,
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
    const poolAfter = (await pollForCondition(
      () => fetcher.getPool(whirlpoolPda.publicKey, IGNORE_CACHE),
      (p) => !!p && p.liquidity.eq(remainingLiquidity),
      { accountToReload: whirlpoolPda.publicKey, connection: ctx.connection },
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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

    const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
      liquidity: liquidityAmount,
      sqrtPrice: poolBefore.sqrtPrice,
      slippageTolerance: Percentage.fromFraction(1, 100),
      tickCurrentIndex: poolBefore.tickCurrentIndex,
      tickLowerIndex: tickLower,
      tickUpperIndex: tickUpper,
      tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
        fetcher,
        poolBefore,
        IGNORE_CACHE,
      ),
    });

    const positionInfoBefore = await ctx.connection.getAccountInfo(
      positions[0].publicKey,
    );
    assert.ok(positionInfoBefore);

    await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
        ...removalQuote,
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: provider.wallet.publicKey,
        position: position.publicKey,
        positionTokenAccount: position.tokenAccount,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenVaultB: tokenVaultBKeypair.publicKey,
        tickArrayLower: position.tickArrayLower,
        tickArrayUpper: position.tickArrayUpper,
      }),
    ).buildAndExecute();

    const poolAfter = (await pollForCondition(
      () => fetcher.getPool(whirlpoolPda.publicKey, IGNORE_CACHE),
      (p) => !!p && p.liquidity.eq(new BN(0)),
      { accountToReload: whirlpoolPda.publicKey, connection: ctx.connection },
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1.48)),
      positions: [
        {
          tickLowerIndex: tickLower,
          tickUpperIndex: tickUpper,
          liquidityAmount,
        },
      ],
      dynamicTickArray: true,
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
    warpClock(2);

    const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
      liquidity: liquidityAmount,
      sqrtPrice: poolBefore.sqrtPrice,
      slippageTolerance: Percentage.fromFraction(1, 100),
      tickCurrentIndex: poolBefore.tickCurrentIndex,
      tickLowerIndex: tickLower,
      tickUpperIndex: tickUpper,
      tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
        fetcher,
        poolBefore,
        IGNORE_CACHE,
      ),
    });

    await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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
      dynamicTickArray: true,
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

    const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
      liquidity: liquidityAmount,
      sqrtPrice: poolBefore.sqrtPrice,
      slippageTolerance: Percentage.fromFraction(1, 100),
      tickCurrentIndex: poolBefore.tickCurrentIndex,
      tickLowerIndex: tickLower,
      tickUpperIndex: tickUpper,
      tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
        fetcher,
        poolBefore,
        IGNORE_CACHE,
      ),
    });

    const positionInfoBefore = await ctx.connection.getAccountInfo(
      positions[0].publicKey,
    );
    assert.ok(positionInfoBefore);
    const tickArrayLowerBefore = await ctx.connection.getAccountInfo(
      positions[0].tickArrayLower,
    );
    assert.ok(tickArrayLowerBefore);
    const tickArrayUpperBefore = await ctx.connection.getAccountInfo(
      positions[0].tickArrayUpper,
    );
    assert.ok(tickArrayUpperBefore);

    await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
        ...removalQuote,
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: provider.wallet.publicKey,
        position: position.publicKey,
        positionTokenAccount: position.tokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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

    await approveToken(
      provider,
      positions[0].tokenAccount,
      delegate.publicKey,
      1,
    );
    await approveToken(provider, tokenAccountA, delegate.publicKey, 1_000_000);
    await approveToken(provider, tokenAccountB, delegate.publicKey, 1_000_000);

    const removeAmount = new anchor.BN(1_000_000);

    await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
        liquidityAmount: removeAmount,
        tokenMinA: new BN(0),
        tokenMinB: new BN(0),
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: delegate.publicKey,
        position: position.publicKey,
        positionTokenAccount: position.tokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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

    await approveToken(
      provider,
      positions[0].tokenAccount,
      delegate.publicKey,
      1,
    );
    await approveToken(provider, tokenAccountA, delegate.publicKey, 1_000_000);
    await approveToken(provider, tokenAccountB, delegate.publicKey, 1_000_000);

    const removeAmount = new anchor.BN(1_000_000);

    await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
        liquidityAmount: removeAmount,
        tokenMinA: new BN(0),
        tokenMinB: new BN(0),
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: provider.wallet.publicKey,
        position: position.publicKey,
        positionTokenAccount: position.tokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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
    const newOwnerPositionTokenAccount = await createTokenAccount(
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
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
        liquidityAmount: removeAmount,
        tokenMinA: new BN(0),
        tokenMinB: new BN(0),
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: newOwner.publicKey,
        position: position.publicKey,
        positionTokenAccount: newOwnerPositionTokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount: new anchor.BN(0),
          tokenMinA: new BN(0),
          tokenMinB: new BN(0),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: position.publicKey,
          positionTokenAccount: position.tokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount: new anchor.BN(1_000),
          tokenMinA: new BN(0),
          tokenMinB: new BN(0),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: position.publicKey,
          positionTokenAccount: position.tokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new BN(1_000_000),
          tokenMinB: new BN(0),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: position.publicKey,
          positionTokenAccount: position.tokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new BN(0),
          tokenMinB: new BN(1_000_000),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: position.publicKey,
          positionTokenAccount: position.tokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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
    const newPositionTokenAccount = await createTokenAccount(
      provider,
      positions[0].mintKeypair.publicKey,
      provider.wallet.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new BN(0),
          tokenMinB: new BN(0),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: position.publicKey,
          positionTokenAccount: newPositionTokenAccount,
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
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new BN(0),
          tokenMinB: new BN(0),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: position.publicKey,
          positionTokenAccount: position.tokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
      positions: [
        { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
      ],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
      fixture.getInfos();
    const { whirlpoolPda, tokenMintA } = poolInitInfo;
    const position = positions[0];

    const invalidPositionTokenAccount = await createAndMintToTokenAccount(
      provider,
      tokenMintA,
      1,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new BN(0),
          tokenMinB: new BN(0),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: position.publicKey,
          positionTokenAccount: invalidPositionTokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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

    const { poolInitInfo: poolInitInfo2 } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const {
      params: {
        positionPda,
        positionTokenAccount: positionTokenAccountAddress,
      },
    } = await openPosition(
      ctx,
      poolInitInfo2.whirlpoolPda.publicKey,
      7168,
      8960,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new BN(0),
          tokenMinB: new BN(0),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positionPda.publicKey,
          positionTokenAccount: positionTokenAccountAddress,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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

    const fakeVaultA = await createAndMintToTokenAccount(
      provider,
      tokenMintA,
      1_000,
    );
    const fakeVaultB = await createAndMintToTokenAccount(
      provider,
      tokenMintB,
      1_000,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new BN(0),
          tokenMinB: new BN(0),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: position.publicKey,
          positionTokenAccount: position.tokenAccount,
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
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new BN(0),
          tokenMinB: new BN(0),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: position.publicKey,
          positionTokenAccount: position.tokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
      positions: [
        { tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount },
      ],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
      fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const invalidMint = await createMint(provider);
    const invalidTokenAccount = await createAndMintToTokenAccount(
      provider,
      invalidMint,
      1_000_000,
    );
    const position = positions[0];

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new BN(0),
          tokenMinB: new BN(0),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: position.publicKey,
          positionTokenAccount: position.tokenAccount,
          tokenOwnerAccountA: invalidTokenAccount,
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
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new BN(0),
          tokenMinB: new BN(0),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: position.publicKey,
          positionTokenAccount: position.tokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: invalidTokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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

    await approveToken(provider, tokenAccountA, delegate.publicKey, 1_000_000);
    await approveToken(provider, tokenAccountB, delegate.publicKey, 1_000_000);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new BN(0),
          tokenMinB: new BN(0),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: delegate.publicKey,
          position: position.publicKey,
          positionTokenAccount: position.tokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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

    await approveToken(provider, position.tokenAccount, delegate.publicKey, 0);
    await approveToken(provider, tokenAccountA, delegate.publicKey, 1_000_000);
    await approveToken(provider, tokenAccountB, delegate.publicKey, 1_000_000);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new BN(0),
          tokenMinB: new BN(0),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: delegate.publicKey,
          position: position.publicKey,
          positionTokenAccount: position.tokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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

    await approveToken(provider, position.tokenAccount, delegate.publicKey, 1);
    await approveToken(provider, tokenAccountA, delegate.publicKey, 1_000_000);
    await approveToken(provider, tokenAccountB, delegate.publicKey, 1_000_000);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new BN(0),
          tokenMinB: new BN(167_000),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: delegate.publicKey,
          position: position.publicKey,
          positionTokenAccount: position.tokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new BN(0),
          tokenMinB: new BN(0),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: position.publicKey,
          positionTokenAccount: position.tokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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

    const { poolInitInfo: poolInitInfo2 } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    const {
      params: { tickArrayPda: tickArrayLowerPda },
    } = await initTickArray(ctx, poolInitInfo2.whirlpoolPda.publicKey, -11264);

    const {
      params: { tickArrayPda: tickArrayUpperPda },
    } = await initTickArray(ctx, poolInitInfo2.whirlpoolPda.publicKey, 0);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new BN(0),
          tokenMinB: new BN(0),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: position.publicKey,
          positionTokenAccount: position.tokenAccount,
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
    const fixture = await new WhirlpoolTestFixture(ctx).init({
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
      tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
        fetcher,
        poolBefore,
        IGNORE_CACHE,
      ),
    });

    // event verification
    let eventVerified = false;
    let detectedSignature: string | null = null;
    let observedEvent: LiquidityDecreasedEvent | null = null;
    const listener = ctx.program.addEventListener(
      "liquidityDecreased",
      (event: LiquidityDecreasedEvent, _slot, signature) => {
        detectedSignature = signature;
        observedEvent = event;
        eventVerified = true;
      },
    );

    const signature = await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
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
      }),
    ).buildAndExecute();

    await pollForCondition(
      async () => ({ detectedSignature, eventVerified }),
      (r) => r.detectedSignature === signature && r.eventVerified,
      { maxRetries: 200, delayMs: 5 },
    );
    assert.equal(signature, detectedSignature);
    assert.ok(eventVerified);
    assert.ok(observedEvent);

    // Type assertion after null check
    const event = observedEvent as LiquidityDecreasedEvent;
    assert.ok(event.liquidity.eq(removalQuote.liquidityAmount));
    assert.ok(event.tokenAAmount.gte(removalQuote.tokenMinA));
    assert.ok(event.tokenBAmount.gte(removalQuote.tokenMinB));
    assert.ok(event.tickLowerIndex === tickLower);
    assert.ok(event.tickUpperIndex === tickUpper);
    assert.ok(event.tokenATransferFee.isZero());
    assert.ok(event.tokenBTransferFee.isZero());

    ctx.program.removeEventListener(listener);
  });
});
