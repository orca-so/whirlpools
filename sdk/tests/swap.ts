import * as anchor from "@project-serum/anchor";
import { web3 } from "@project-serum/anchor";
import Decimal from "decimal.js";
import {
  getTickArrayPda,
  SwapParams,
  tickIndexToSqrtPriceX64,
  MAX_SQRT_PRICE,
  toX64,
  MIN_SQRT_PRICE,
  getOraclePda,
} from "../src";
import { WhirlpoolClient } from "../src/client";
import { WhirlpoolContext } from "../src/context";
import {
  FundedPositionParams,
  fundPositions,
  initTestPoolWithLiquidity,
  initTestPoolWithTokens,
  initTickArrayRange,
  initTestPool,
  withdrawPositions,
} from "./utils/init-utils";
import * as assert from "assert";
import { getTokenBalance, MAX_U64, TickSpacing, ZERO_BN } from "./utils";
import { u64 } from "@solana/spl-token";

describe("swap", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  it("fail on token vault mint a does not match whirlpool token a", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(client, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPoolWithTokens(
      client,
      TickSpacing.Stable
    );

    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      client
        .swapTx({
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: context.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: anotherPoolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
        .buildAndExecute(),
      /0x7dc/ // ConstraintAddress
    );
  });

  it("fail on token vault mint b does not match whirlpool token b", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(client, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPoolWithTokens(
      client,
      TickSpacing.Stable
    );

    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      client
        .swapTx({
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: context.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: anotherPoolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
        .buildAndExecute(),
      /0x7dc/ // ConstraintAddress
    );
  });

  it("fail on token owner account a does not match vault a mint", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountB } = await initTestPoolWithTokens(
      client,
      TickSpacing.Standard
    );

    const { tokenAccountA: anotherTokenAccountA } = await initTestPoolWithTokens(
      client,
      TickSpacing.Stable
    );

    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      client
        .swapTx({
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: context.wallet.publicKey,
          tokenOwnerAccountA: anotherTokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fail on token owner account b does not match vault b mint", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA } = await initTestPoolWithTokens(
      client,
      TickSpacing.Standard
    );

    const { tokenAccountB: anotherTokenAccountB } = await initTestPoolWithTokens(
      client,
      TickSpacing.Stable
    );

    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      client
        .swapTx({
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: context.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: anotherTokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails to swap with incorrect token authority", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(client, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const otherTokenAuthority = web3.Keypair.generate();

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      client
        .swapTx({
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: toX64(new Decimal(4.95)),
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
        .addSigner(otherTokenAuthority)
        .buildAndExecute(),
      /0x4/ // OwnerMismatch
    );
  });

  it("fails on passing in the wrong tick-array", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(client, TickSpacing.Standard, toX64(new Decimal(0.0242).sqrt())); // Negative Tick

    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      client
        .swapTx({
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: tickIndexToSqrtPriceX64(-50000),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: context.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
        .buildAndExecute(),
      /0x1787/ // InvalidTickArraySequence
    );
  });

  it("fails on passing in the wrong whirlpool", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(client, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPool(client, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      client
        .swapTx({
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: anotherPoolInitInfo.whirlpoolPda.publicKey,
          tokenAuthority: context.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails on passing in the tick-arrays from another whirlpool", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(client, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPool(client, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      client,
      anotherPoolInitInfo.whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      client
        .swapTx({
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: anotherPoolInitInfo.whirlpoolPda.publicKey,
          tokenAuthority: context.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails on passing in an account of another type for the oracle", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(client, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    await assert.rejects(
      client
        .swapTx({
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          tokenAuthority: context.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: tickArrays[0].publicKey,
        })
        .buildAndExecute(),
      /0x7d6/ // ConstraintSeeds
    );
  });

  it("fails on passing in an incorrectly hashed oracle PDA", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(client, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPool(client, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false
    );

    const anotherOraclePda = getOraclePda(
      client.context.program.programId,
      anotherPoolInitInfo.whirlpoolPda.publicKey
    );

    await assert.rejects(
      client
        .swapTx({
          amount: new u64(10),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          tokenAuthority: context.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: anotherOraclePda.publicKey,
        })
        .buildAndExecute(),
      /0x7d6/ // ConstraintSeeds
    );
  });

  it("fail on passing in zero tradable amount", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(client, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      33792,
      3,
      TickSpacing.Standard,
      false
    );

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    await assert.rejects(
      client
        .swapTx({
          amount: new u64(0),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: toX64(new Decimal(4.95)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: context.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArray0: tickArrays[0].publicKey,
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        })
        .buildAndExecute(),
      /0x1793/ // ZeroTradableAmount
    );
  });

  it("swaps across one tick array", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(client, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      22528, // to 33792
      3,
      TickSpacing.Standard,
      false
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new u64(100_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(client, poolInitInfo, tokenAccountA, tokenAccountB, fundParams);

    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      "1302"
    );
    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      "64238"
    );

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    await client
      .swapTx({
        amount: new u64(10),
        otherAmountThreshold: ZERO_BN,
        sqrtPriceLimit: toX64(new Decimal(4.95)),
        amountSpecifiedIsInput: true,
        aToB: true,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: context.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[0].publicKey,
        tickArray2: tickArrays[0].publicKey,
        oracle: oraclePda.publicKey,
      })
      .buildAndExecute();
  });

  it("swaps across three tick arrays", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(client, TickSpacing.Stable, tickIndexToSqrtPriceX64(27500));

    const aToB = false;
    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      27456, // to 28160, 28864
      5,
      TickSpacing.Stable,
      false
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new u64(100_000_000),
        tickLowerIndex: 27456,
        tickUpperIndex: 27840,
      },
      {
        liquidityAmount: new u64(100_000_000),
        tickLowerIndex: 28864,
        tickUpperIndex: 28928,
      },
      {
        liquidityAmount: new u64(100_000_000),
        tickLowerIndex: 27712,
        tickUpperIndex: 28928,
      },
    ];

    await fundPositions(client, poolInitInfo, tokenAccountA, tokenAccountB, fundParams);

    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      "1977429"
    );
    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      "869058"
    );

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    // Tick
    await client
      .swapTx({
        amount: new u64(7051000),
        otherAmountThreshold: ZERO_BN,
        sqrtPriceLimit: tickIndexToSqrtPriceX64(28500),
        amountSpecifiedIsInput: true,
        aToB: aToB,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: context.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[2].publicKey,
        oracle: oraclePda.publicKey,
      })
      .buildAndExecute();

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
      await initTestPoolWithLiquidity(client);
    const whirlpool = poolInitInfo.whirlpoolPda.publicKey;

    const uninitializedTickArrayPda = getTickArrayPda(context.program.programId, whirlpool, 0);

    const oraclePda = getOraclePda(
      client.context.program.programId,
      poolInitInfo.whirlpoolPda.publicKey
    );

    const params: SwapParams = {
      amount: new u64(10),
      otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: toX64(new Decimal(4294886578)),
      amountSpecifiedIsInput: true,
      aToB: true,
      whirlpool: whirlpool,
      tokenAuthority: context.wallet.publicKey,
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
      await client.swapTx(params).buildAndExecute();
      assert.fail("should fail if a tick-array is uninitialized");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0xbbf/); // AccountOwnedByWrongProgram
    }
  });

  it("Error if sqrt_price_limit exceeds max", async () => {
    const { poolInitInfo, tokenAccountA, tokenAccountB, tickArrays } =
      await initTestPoolWithLiquidity(client);
    const whirlpool = poolInitInfo.whirlpoolPda.publicKey;

    const oraclePda = getOraclePda(
      client.context.program.programId,
      poolInitInfo.whirlpoolPda.publicKey
    );

    const params: SwapParams = {
      amount: new u64(10),
      otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: new u64(MAX_SQRT_PRICE).add(new u64(1)),
      amountSpecifiedIsInput: true,
      aToB: true,
      whirlpool: whirlpool,
      tokenAuthority: context.wallet.publicKey,
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
      await client.swapTx(params).buildAndExecute();
      assert.fail("should fail if sqrt_price exceeds maximum");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0x177b/); // SqrtPriceOutOfBounds
    }
  });

  it("Error if sqrt_price_limit subceed min", async () => {
    const { poolInitInfo, tokenAccountA, tokenAccountB, tickArrays } =
      await initTestPoolWithLiquidity(client);
    const whirlpool = poolInitInfo.whirlpoolPda.publicKey;

    const oraclePda = getOraclePda(
      client.context.program.programId,
      poolInitInfo.whirlpoolPda.publicKey
    );

    const params: SwapParams = {
      amount: new u64(10),
      otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: new u64(MIN_SQRT_PRICE).sub(new u64(1)),
      amountSpecifiedIsInput: true,
      aToB: true,
      whirlpool: whirlpool,
      tokenAuthority: context.wallet.publicKey,
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
      await client.swapTx(params).buildAndExecute();
      assert.fail("should fail if sqrt_price subceeds minimum");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0x177b/); // SqrtPriceOutOfBounds
    }
  });

  it("Error if a to b swap below minimum output", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(client, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      22528, // to 33792
      3,
      TickSpacing.Standard,
      false
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new u64(100_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(client, poolInitInfo, tokenAccountA, tokenAccountB, fundParams);

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    const params = {
      amount: new u64(10),
      otherAmountThreshold: MAX_U64,
      sqrtPriceLimit: new anchor.BN(MIN_SQRT_PRICE),
      amountSpecifiedIsInput: true,
      aToB: true,
      whirlpool: whirlpoolPda.publicKey,
      tokenAuthority: context.wallet.publicKey,
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
      await client.swapTx(params).buildAndExecute();
      assert.fail("should fail if amount out is below threshold");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0x1794/); // AmountOutBelowMinimum
    }
  });

  it("Error if b to a swap below minimum output", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(client, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      22528, // to 33792
      3,
      TickSpacing.Standard,
      false
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new u64(100_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(client, poolInitInfo, tokenAccountA, tokenAccountB, fundParams);

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    const params = {
      amount: new u64(10),
      otherAmountThreshold: MAX_U64,
      sqrtPriceLimit: new anchor.BN(MAX_SQRT_PRICE),
      amountSpecifiedIsInput: true,
      aToB: false,
      whirlpool: whirlpoolPda.publicKey,
      tokenAuthority: context.wallet.publicKey,
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
      await client.swapTx(params).buildAndExecute();
      assert.fail("should fail if amount out is below threshold");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0x1794/); // AmountOutBelowMinimum
    }
  });

  it("Error if a to b swap above maximum input", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(client, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      22528, // to 33792
      3,
      TickSpacing.Standard,
      false
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new u64(100_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(client, poolInitInfo, tokenAccountA, tokenAccountB, fundParams);

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    const params = {
      amount: new u64(10),
      otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: new anchor.BN(MIN_SQRT_PRICE),
      amountSpecifiedIsInput: false,
      aToB: true,
      whirlpool: whirlpoolPda.publicKey,
      tokenAuthority: context.wallet.publicKey,
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
      await client.swapTx(params).buildAndExecute();
      assert.fail("should fail if amount out is below threshold");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0x1795/); // AmountInAboveMaximum
    }
  });

  it("Error if b to a swap below maximum input", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(client, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      client,
      whirlpoolPda.publicKey,
      22528, // to 33792
      3,
      TickSpacing.Standard,
      false
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new u64(100_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(client, poolInitInfo, tokenAccountA, tokenAccountB, fundParams);

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    const params = {
      amount: new u64(10),
      otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: new anchor.BN(MAX_SQRT_PRICE),
      amountSpecifiedIsInput: false,
      aToB: false,
      whirlpool: whirlpoolPda.publicKey,
      tokenAuthority: context.wallet.publicKey,
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
      await client.swapTx(params).buildAndExecute();
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
    } = await initTestPoolWithTokens(client, TickSpacing.Stable, tickIndexToSqrtPriceX64(27500));

    const aToB = false;
    const tickArrays = await initTickArrayRange(
      client,
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
        liquidityAmount: new u64(10_000_000),
        tickLowerIndex: 27712,
        tickUpperIndex: 29360,
      },
      {
        liquidityAmount: new u64(10_000_000),
        tickLowerIndex: 27736,
        tickUpperIndex: 29240,
      },
      {
        liquidityAmount: new u64(10_000_000),
        tickLowerIndex: 27840,
        tickUpperIndex: 29120,
      },
      {
        liquidityAmount: new u64(10_000_000),
        tickLowerIndex: 28288,
        tickUpperIndex: 29112,
      },
      {
        liquidityAmount: new u64(10_000_000),
        tickLowerIndex: 28416,
        tickUpperIndex: 29112,
      },
      {
        liquidityAmount: new u64(10_000_000),
        tickLowerIndex: 28288,
        tickUpperIndex: 28304,
      },
      {
        liquidityAmount: new u64(10_000_000),
        tickLowerIndex: 28296,
        tickUpperIndex: 29112,
      },
      {
        liquidityAmount: new u64(10_000_000),
        tickLowerIndex: 28576,
        tickUpperIndex: 28736,
      },
    ];

    const positionInfos = await fundPositions(
      client,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
      fundParams
    );

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => client.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      tickArray.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          tickArray.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    // Tick
    await client
      .swapTx({
        amount: new u64(829996),
        otherAmountThreshold: MAX_U64,
        sqrtPriceLimit: tickIndexToSqrtPriceX64(29240),
        amountSpecifiedIsInput: false,
        aToB,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: context.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[2].publicKey,
        oracle: oraclePda.publicKey,
      })
      .buildAndExecute();

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => client.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      tickArray.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          tickArray.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    await client
      .swapTx({
        amount: new u64(14538074),
        otherAmountThreshold: MAX_U64,
        sqrtPriceLimit: tickIndexToSqrtPriceX64(27712),
        amountSpecifiedIsInput: false,
        aToB: true,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: context.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[2].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[0].publicKey,
        oracle: oraclePda.publicKey,
      })
      .buildAndExecute();

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => client.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      tickArray.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          tickArray.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    await client
      .swapTx({
        amount: new u64(829996),
        otherAmountThreshold: MAX_U64,
        sqrtPriceLimit: tickIndexToSqrtPriceX64(29240),
        amountSpecifiedIsInput: false,
        aToB,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: context.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[2].publicKey,
        oracle: oraclePda.publicKey,
      })
      .buildAndExecute();

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => client.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      tickArray.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          tickArray.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    await client
      .swapTx({
        amount: new u64(14538074),
        otherAmountThreshold: MAX_U64,
        sqrtPriceLimit: tickIndexToSqrtPriceX64(27712),
        amountSpecifiedIsInput: false,
        aToB: true,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: context.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[2].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[0].publicKey,
        oracle: oraclePda.publicKey,
      })
      .buildAndExecute();

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => client.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      tickArray.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          tickArray.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    await client
      .swapTx({
        amount: new u64(829996),
        otherAmountThreshold: MAX_U64,
        sqrtPriceLimit: tickIndexToSqrtPriceX64(29240),
        amountSpecifiedIsInput: false,
        aToB,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: context.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[2].publicKey,
        oracle: oraclePda.publicKey,
      })
      .buildAndExecute();

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => client.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      tickArray.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          tickArray.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    await client
      .swapTx({
        amount: new u64(14538074),
        otherAmountThreshold: MAX_U64,
        sqrtPriceLimit: tickIndexToSqrtPriceX64(27712),
        amountSpecifiedIsInput: false,
        aToB: true,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: context.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[2].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[0].publicKey,
        oracle: oraclePda.publicKey,
      })
      .buildAndExecute();

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => client.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      tickArray.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          tickArray.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    await withdrawPositions(client, positionInfos, tokenAccountA, tokenAccountB);

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

    (
      await Promise.all(tickArrays.map((tickArray) => client.getTickArray(tickArray.publicKey)))
    ).map((tickArray) => {
      tickArray.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.log(
          tickArray.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
      });
    });

    await client
      .collectProtocolFeesTx({
        whirlpoolsConfig: poolInitInfo.whirlpoolConfigKey,
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        collectProtocolFeesAuthority: configKeypairs.collectProtocolFeesAuthorityKeypair.publicKey,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tokenDestinationA: tokenAccountA,
        tokenDestinationB: tokenAccountB,
      })
      .addSigner(configKeypairs.collectProtocolFeesAuthorityKeypair)
      .buildAndExecute();

    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
    console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));
  });
});
