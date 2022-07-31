import { MathUtil, Percentage } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import { web3 } from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  PDAUtil,
  PriceMath,
  SwapParams,
  swapQuoteByInputToken,
  TickArrayData,
  toTx,
  WhirlpoolContext,
  WhirlpoolIx,
} from "../../src";
import { getTokenBalance, MAX_U64, TickSpacing, ZERO_BN } from "../utils";
import {
  FundedPositionParams,
  fundPositions,
  initTestPool,
  initTestPoolWithLiquidity,
  initTestPoolWithTokens,
  initTickArrayRange,
  withdrawPositions,
} from "../utils/init-utils";

describe("swap", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);

  it("fail on token vault mint a does not match whirlpool token a", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPoolWithTokens(
      ctx,
      TickSpacing.Stable
    );

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: anotherPoolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
      ).buildAndExecute(),
      /0x7dc/ // ConstraintAddress
    );
  });

  it("fail on token vault mint b does not match whirlpool token b", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPoolWithTokens(
      ctx,
      TickSpacing.Stable
    );

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: anotherPoolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
      ).buildAndExecute(),
      /0x7dc/ // ConstraintAddress
    );
  });

  it("fail on token owner account a does not match vault a mint", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountB } = await initTestPoolWithTokens(
      ctx,
      TickSpacing.Standard
    );

    const { tokenAccountA: anotherTokenAccountA } = await initTestPoolWithTokens(
      ctx,
      TickSpacing.Stable
    );

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenOwnerAccountA: anotherTokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fail on token owner account b does not match vault b mint", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA } = await initTestPoolWithTokens(
      ctx,
      TickSpacing.Standard
    );

    const { tokenAccountB: anotherTokenAccountB } = await initTestPoolWithTokens(
      ctx,
      TickSpacing.Stable
    );

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: anotherTokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails to swap with incorrect token authority", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const otherTokenAuthority = web3.Keypair.generate();

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: otherTokenAuthority.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
      )
        .addSigner(otherTokenAuthority)
        .buildAndExecute(),
      /0x4/ // OwnerMismatch
    );
  });

  it("fails on passing in the wrong tick-array", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(
        ctx,
        TickSpacing.Standard,
        MathUtil.toX64(new Decimal(0.0242).sqrt())
      ); // Negative Tick

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(-50000),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
      ).buildAndExecute(),
      /0x1787/ // InvalidTickArraySequence
    );
  });

  it("fails on passing in the wrong whirlpool", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: anotherPoolInitInfo.whirlpoolPda.publicKey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails on passing in the tick-arrays from another whirlpool", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      ctx,
      anotherPoolInitInfo.whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: anotherPoolInitInfo.whirlpoolPda.publicKey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails on passing in an account of another type for the oracle", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: tickArrays[0].publicKey,
        })
      ).buildAndExecute(),
      /0x7d6/ // ConstraintSeeds
    );
  });

  it("fails on passing in an incorrectly hashed oracle PDA", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const anotherOraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      anotherPoolInitInfo.whirlpoolPda.publicKey
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: anotherOraclePda.publicKey,
        })
      ).buildAndExecute(),
      /0x7d6/ // ConstraintSeeds
    );
  });

  it("fail on passing in zero tradable amount", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      33792,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new u64(0),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
      ).buildAndExecute(),
      /0x1793/ // ZeroTradableAmount
    );
  });

  it("swaps across one tick array", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);
    const aToB = false;
    await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528, // to 33792
      3,
      TickSpacing.Standard,
      aToB
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(ctx, poolInitInfo, tokenAccountA, tokenAccountB, fundParams);

    const tokenVaultABefore = new anchor.BN(
      await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey)
    );
    const tokenVaultBBefore = new anchor.BN(
      await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey)
    );

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpool = await client.getPool(whirlpoolKey, true);
    const whirlpoolData = whirlpool.getData();
    const quote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      new u64(100000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      true
    );

    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        ...quote,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        oracle: oraclePda.publicKey,
      })
    ).buildAndExecute();

    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      tokenVaultABefore.sub(quote.estimatedAmountOut).toString()
    );
    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      tokenVaultBBefore.add(quote.estimatedAmountIn).toString()
    );
  });

  it("swaps across three tick arrays", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(
        ctx,
        TickSpacing.Stable,
        PriceMath.tickIndexToSqrtPriceX64(27500)
      );

    const aToB = false;
    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      27456, // to 28160, 28864
      5,
      TickSpacing.Stable,
      false
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(100_000_000),
        tickLowerIndex: 27456,
        tickUpperIndex: 27840,
      },
      {
        liquidityAmount: new anchor.BN(100_000_000),
        tickLowerIndex: 28864,
        tickUpperIndex: 28928,
      },
      {
        liquidityAmount: new anchor.BN(100_000_000),
        tickLowerIndex: 27712,
        tickUpperIndex: 28928,
      },
    ];

    await fundPositions(ctx, poolInitInfo, tokenAccountA, tokenAccountB, fundParams);

    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      "1977429"
    );
    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      "869058"
    );

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    // Tick
    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new u64(7051000),
        otherAmountThreshold: ZERO_BN,
        sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(28500),
        amountSpecifiedIsInput: true,
        aToB: aToB,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[2].publicKey,
        oracle: oraclePda.publicKey,
      })
    ).buildAndExecute();

    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      "1535201"
    );
    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      "7920058"
    );

    // TODO: Verify fees and other whirlpool params
  });

  it("Error on passing in uninitialized tick-array", async () => {
    const { poolInitInfo, tokenAccountA, tokenAccountB, tickArrays } =
      await initTestPoolWithLiquidity(ctx);
    const whirlpool = poolInitInfo.whirlpoolPda.publicKey;

    const uninitializedTickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpool, 0);

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, poolInitInfo.whirlpoolPda.publicKey);

    const params: SwapParams = {
      amount: new u64(10),
      otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: MathUtil.toX64(new Decimal(4294886578)),
      amountSpecifiedIsInput: true,
      aToB: true,
      whirlpool: whirlpool,
      tokenAuthority: ctx.wallet.publicKey,
      tokenOwnerAccountA: tokenAccountA,
      tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
      tokenOwnerAccountB: tokenAccountB,
      tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
      tickArray0: tickArrays[0].publicKey,
      tickArray1: uninitializedTickArrayPda.publicKey,
      tickArray2: tickArrays[2].publicKey,
      oracle: oraclePda.publicKey,
    };

    try {
      await toTx(ctx, WhirlpoolIx.swapIx(ctx.program, params)).buildAndExecute();
      assert.fail("should fail if a tick-array is uninitialized");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0xbbf/); // AccountOwnedByWrongProgram
    }
  });

  it("Error if sqrt_price_limit exceeds max", async () => {
    const { poolInitInfo, tokenAccountA, tokenAccountB, tickArrays } =
      await initTestPoolWithLiquidity(ctx);
    const whirlpool = poolInitInfo.whirlpoolPda.publicKey;

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, poolInitInfo.whirlpoolPda.publicKey);

    const params: SwapParams = {
      amount: new u64(10),
      otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: new anchor.BN(MAX_SQRT_PRICE).add(new anchor.BN(1)),
      amountSpecifiedIsInput: true,
      aToB: true,
      whirlpool: whirlpool,
      tokenAuthority: ctx.wallet.publicKey,
      tokenOwnerAccountA: tokenAccountA,
      tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
      tokenOwnerAccountB: tokenAccountB,
      tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
      tickArray0: tickArrays[0].publicKey,
      tickArray1: tickArrays[1].publicKey,
      tickArray2: tickArrays[2].publicKey,
      oracle: oraclePda.publicKey,
    };

    try {
      await toTx(ctx, WhirlpoolIx.swapIx(ctx.program, params)).buildAndExecute();
      assert.fail("should fail if sqrt_price exceeds maximum");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0x177b/); // SqrtPriceOutOfBounds
    }
  });

  it("Error if sqrt_price_limit subceed min", async () => {
    const { poolInitInfo, tokenAccountA, tokenAccountB, tickArrays } =
      await initTestPoolWithLiquidity(ctx);
    const whirlpool = poolInitInfo.whirlpoolPda.publicKey;

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, poolInitInfo.whirlpoolPda.publicKey);

    const params: SwapParams = {
      amount: new u64(10),
      otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: new anchor.BN(MIN_SQRT_PRICE).sub(new anchor.BN(1)),
      amountSpecifiedIsInput: true,
      aToB: true,
      whirlpool: whirlpool,
      tokenAuthority: ctx.wallet.publicKey,
      tokenOwnerAccountA: tokenAccountA,
      tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
      tokenOwnerAccountB: tokenAccountB,
      tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
      tickArray0: tickArrays[0].publicKey,
      tickArray1: tickArrays[1].publicKey,
      tickArray2: tickArrays[2].publicKey,
      oracle: oraclePda.publicKey,
    };

    try {
      await toTx(ctx, WhirlpoolIx.swapIx(ctx.program, params)).buildAndExecute();
      assert.fail("should fail if sqrt_price subceeds minimum");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0x177b/); // SqrtPriceOutOfBounds
    }
  });

  it("Error if a to b swap below minimum output", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528, // to 33792
      3,
      TickSpacing.Standard,
      false
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(100_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(ctx, poolInitInfo, tokenAccountA, tokenAccountB, fundParams);

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    const params = {
      amount: new u64(10),
      otherAmountThreshold: MAX_U64,
      sqrtPriceLimit: new anchor.BN(MIN_SQRT_PRICE),
      amountSpecifiedIsInput: true,
      aToB: true,
      whirlpool: whirlpoolPda.publicKey,
      tokenAuthority: ctx.wallet.publicKey,
      tokenOwnerAccountA: tokenAccountA,
      tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
      tokenOwnerAccountB: tokenAccountB,
      tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
      tickArray0: tickArrays[0].publicKey,
      tickArray1: tickArrays[0].publicKey,
      tickArray2: tickArrays[0].publicKey,
      oracle: oraclePda.publicKey,
    };

    try {
      await toTx(ctx, WhirlpoolIx.swapIx(ctx.program, params)).buildAndExecute();
      assert.fail("should fail if amount out is below threshold");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0x1794/); // AmountOutBelowMinimum
    }
  });

  it("Error if b to a swap below minimum output", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528, // to 33792
      3,
      TickSpacing.Standard,
      false
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(100_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(ctx, poolInitInfo, tokenAccountA, tokenAccountB, fundParams);

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    const params = {
      amount: new u64(10),
      otherAmountThreshold: MAX_U64,
      sqrtPriceLimit: new anchor.BN(MAX_SQRT_PRICE),
      amountSpecifiedIsInput: true,
      aToB: false,
      whirlpool: whirlpoolPda.publicKey,
      tokenAuthority: ctx.wallet.publicKey,
      tokenOwnerAccountA: tokenAccountA,
      tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
      tokenOwnerAccountB: tokenAccountB,
      tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
      tickArray0: tickArrays[0].publicKey,
      tickArray1: tickArrays[0].publicKey,
      tickArray2: tickArrays[0].publicKey,
      oracle: oraclePda.publicKey,
    };

    try {
      await toTx(ctx, WhirlpoolIx.swapIx(ctx.program, params)).buildAndExecute();
      assert.fail("should fail if amount out is below threshold");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0x1794/); // AmountOutBelowMinimum
    }
  });

  it("Error if a to b swap above maximum input", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528, // to 33792
      3,
      TickSpacing.Standard,
      false
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(100_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(ctx, poolInitInfo, tokenAccountA, tokenAccountB, fundParams);

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    const params = {
      amount: new u64(10),
      otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: new anchor.BN(MIN_SQRT_PRICE),
      amountSpecifiedIsInput: false,
      aToB: true,
      whirlpool: whirlpoolPda.publicKey,
      tokenAuthority: ctx.wallet.publicKey,
      tokenOwnerAccountA: tokenAccountA,
      tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
      tokenOwnerAccountB: tokenAccountB,
      tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
      tickArray0: tickArrays[0].publicKey,
      tickArray1: tickArrays[0].publicKey,
      tickArray2: tickArrays[0].publicKey,
      oracle: oraclePda.publicKey,
    };

    try {
      await toTx(ctx, WhirlpoolIx.swapIx(ctx.program, params)).buildAndExecute();
      assert.fail("should fail if amount out is below threshold");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0x1795/); // AmountInAboveMaximum
    }
  });

  it("Error if b to a swap below maximum input", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528, // to 33792
      3,
      TickSpacing.Standard,
      false
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(100_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(ctx, poolInitInfo, tokenAccountA, tokenAccountB, fundParams);

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    const params = {
      amount: new u64(10),
      otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: new anchor.BN(MAX_SQRT_PRICE),
      amountSpecifiedIsInput: false,
      aToB: false,
      whirlpool: whirlpoolPda.publicKey,
      tokenAuthority: ctx.wallet.publicKey,
      tokenOwnerAccountA: tokenAccountA,
      tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
      tokenOwnerAccountB: tokenAccountB,
      tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
      tickArray0: tickArrays[0].publicKey,
      tickArray1: tickArrays[0].publicKey,
      tickArray2: tickArrays[0].publicKey,
      oracle: oraclePda.publicKey,
    };

    try {
      await toTx(ctx, WhirlpoolIx.swapIx(ctx.program, params)).buildAndExecute();
      assert.fail("should fail if amount out is below threshold");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0x1795/); // AmountInAboveMaximum
    }
  });

  it("swaps across ten tick arrays", async () => {
    const {
      poolInitInfo,
      configInitInfo,
      configKeypairs,
      whirlpoolPda,
      tokenAccountA,
      tokenAccountB,
    } = await initTestPoolWithTokens(
      ctx,
      TickSpacing.Stable,
      PriceMath.tickIndexToSqrtPriceX64(27500)
    );

    const aToB = false;
    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      27456, // to 30528
      3,
      TickSpacing.Stable,
      aToB
    );

    // tick array range: 27658 to 29386
    // tick arrays: (27456, 28152), (28160, 28856), (28864, 29,560)
    // current tick: 27727
    // initialized ticks:
    //   27712, 27736, 27840, 28288, 28296, 28304, 28416, 28576, 28736, 29112, 29120, 29240, 29360

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 27712,
        tickUpperIndex: 29360,
      },
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 27736,
        tickUpperIndex: 29240,
      },
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 27840,
        tickUpperIndex: 29120,
      },
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 28288,
        tickUpperIndex: 29112,
      },
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 28416,
        tickUpperIndex: 29112,
      },
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 28288,
        tickUpperIndex: 28304,
      },
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 28296,
        tickUpperIndex: 29112,
      },
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 28576,
        tickUpperIndex: 28736,
      },
    ];

    const positionInfos = await fundPositions(
      ctx,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
      fundParams
    );

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => fetcher.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    // Tick
    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new u64(829996),
        otherAmountThreshold: MAX_U64,
        sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(29240),
        amountSpecifiedIsInput: false,
        aToB,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[2].publicKey,
        oracle: oraclePda.publicKey,
      })
    ).buildAndExecute();

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => fetcher.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new u64(14538074),
        otherAmountThreshold: MAX_U64,
        sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(27712),
        amountSpecifiedIsInput: false,
        aToB: true,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[2].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[0].publicKey,
        oracle: oraclePda.publicKey,
      })
    ).buildAndExecute();

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => fetcher.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new u64(829996),
        otherAmountThreshold: MAX_U64,
        sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(29240),
        amountSpecifiedIsInput: false,
        aToB,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[2].publicKey,
        oracle: oraclePda.publicKey,
      })
    ).buildAndExecute();

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => fetcher.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new u64(14538074),
        otherAmountThreshold: MAX_U64,
        sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(27712),
        amountSpecifiedIsInput: false,
        aToB: true,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[2].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[0].publicKey,
        oracle: oraclePda.publicKey,
      })
    ).buildAndExecute();

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => fetcher.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new u64(829996),
        otherAmountThreshold: MAX_U64,
        sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(29240),
        amountSpecifiedIsInput: false,
        aToB,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[2].publicKey,
        oracle: oraclePda.publicKey,
      })
    ).buildAndExecute();

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => fetcher.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new u64(14538074),
        otherAmountThreshold: MAX_U64,
        sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(27712),
        amountSpecifiedIsInput: false,
        aToB: true,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[2].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[0].publicKey,
        oracle: oraclePda.publicKey,
      })
    ).buildAndExecute();

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => fetcher.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    await withdrawPositions(ctx, positionInfos, tokenAccountA, tokenAccountB);

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => fetcher.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    await toTx(
      ctx,
      WhirlpoolIx.collectProtocolFeesIx(ctx.program, {
        whirlpoolsConfig: poolInitInfo.whirlpoolsConfig,
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        collectProtocolFeesAuthority: configKeypairs.collectProtocolFeesAuthorityKeypair.publicKey,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
      })
    )
      .addSigner(configKeypairs.collectProtocolFeesAuthorityKeypair)
      .buildAndExecute();

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));
  });
});
