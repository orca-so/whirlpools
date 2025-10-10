import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import { MathUtil, Percentage } from "@orca-so/common-sdk";
import type { PDA } from "@orca-so/common-sdk";
import * as assert from "assert";
import BN from "bn.js";
import Decimal from "decimal.js";
import type { InitPoolParams, SwapParams, TickArrayData } from "../../../src";
import {
  MAX_SQRT_PRICE,
  MAX_SQRT_PRICE_BN,
  MIN_SQRT_PRICE,
  MIN_SQRT_PRICE_BN,
  PDAUtil,
  PriceMath,
  TICK_ARRAY_SIZE,
  TickUtil,
  WhirlpoolContext,
  WhirlpoolIx,
  buildWhirlpoolClient,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
  toTx,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import {
  MAX_U64,
  TickSpacing,
  ZERO_BN,
  getTokenBalance,
  sleep,
} from "../../utils";
import { startLiteSVM, createLiteSVMProvider } from "../../utils/litesvm";
import type { FundedPositionParams } from "../../utils/init-utils";
import {
  fundPositions,
  initTestPool,
  initTestPoolWithLiquidity,
  initTestPoolWithTokens,
  initTickArrayRange,
  withdrawPositions,
} from "../../utils/init-utils";
import type { PublicKey } from "@solana/web3.js";
import { PROTOCOL_FEE_RATE_MUL_VALUE } from "../../../dist/types/public/constants";

describe("swap (litesvm)", () => {
  let provider: anchor.AnchorProvider;

  let program: anchor.Program;

  let ctx: WhirlpoolContext;

  let fetcher: any;


  beforeAll(async () => {

    await startLiteSVM();

    provider = await createLiteSVMProvider();

    const programId = new anchor.web3.PublicKey(

      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"

    );

    const idl = require("../../../src/artifacts/whirlpool.json");

    program = new anchor.Program(idl, programId, provider);

  // program initialized in beforeAll
  ctx = WhirlpoolContext.fromWorkspace(provider, program);
  fetcher = ctx.fetcher;

  });
  const client = buildWhirlpoolClient(ctx);

  it("fail on token vault mint a does not match whirlpool token a", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPoolWithTokens(
      ctx,
      TickSpacing.Stable,
    );

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false,
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(10),
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
        }),
      ).buildAndExecute(),
      /0x7dc/, // ConstraintAddress
    );
  });

  it("fail on token vault mint b does not match whirlpool token b", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPoolWithTokens(
      ctx,
      TickSpacing.Stable,
    );

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false,
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(10),
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
        }),
      ).buildAndExecute(),
      /0x7dc/, // ConstraintAddress
    );
  });

  it("fail on token owner account a does not match vault a mint", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const { tokenAccountA: anotherTokenAccountA } =
      await initTestPoolWithTokens(ctx, TickSpacing.Stable);

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false,
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(10),
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
        }),
      ).buildAndExecute(),
      /0x7d3/, // ConstraintRaw
    );
  });

  it("fail on token owner account b does not match vault b mint", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const { tokenAccountB: anotherTokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Stable);

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false,
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(10),
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
        }),
      ).buildAndExecute(),
      /0x7d3/, // ConstraintRaw
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
      false,
    );

    const otherTokenAuthority = web3.Keypair.generate();

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(10),
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
        }),
      )
        .addSigner(otherTokenAuthority)
        .buildAndExecute(),
      /0x4/, // OwnerMismatch
    );
  });

  it("fails on passing in the wrong tick-array", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(
        ctx,
        TickSpacing.Standard,
        MathUtil.toX64(new Decimal(0.0242).sqrt()),
      ); // Negative Tick

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false,
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(10),
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
        }),
      ).buildAndExecute(),
      /0x1787/, // InvalidTickArraySequence
    );
  });

  it("fails on passing in the wrong whirlpool", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false,
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(10),
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
        }),
      ).buildAndExecute(),
      /0x7d3/, // ConstraintRaw
    );
  });

  it("fails on passing in the tick-arrays from another whirlpool", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    const tickArrays = await initTickArrayRange(
      ctx,
      anotherPoolInitInfo.whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false,
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(10),
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
        }),
      ).buildAndExecute(),
      // This test case violates the constraint on vault (before tickarray)
      /0x7d3/, // ConstraintRaw
    );
  });

  it("fails on passing in the tick-arrays from another whirlpool (tickarray only)", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    const tickArrays = await initTickArrayRange(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false,
    );

    const anotherTickArrays = await initTickArrayRange(
      ctx,
      anotherPoolInitInfo.whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false,
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    // invalid tickArrays[0]
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(10),
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
          tickArray0: anotherTickArrays[0].publicKey, // invalid
          tickArray1: tickArrays[0].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        }),
      ).buildAndExecute(),
      // sparse-swap changes error code (has_one constraint -> check in the handler)
      /0x17a8/, // DifferentWhirlpoolTickArrayAccount
    );

    // invalid tickArrays[1]
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(10),
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
          tickArray1: anotherTickArrays[1].publicKey,
          tickArray2: tickArrays[0].publicKey,
          oracle: oraclePda.publicKey,
        }),
      ).buildAndExecute(),
      /0x17a8/, // DifferentWhirlpoolTickArrayAccount
    );

    // invalid tickArrays[2]
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(10),
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
          tickArray1: tickArrays[1].publicKey,
          tickArray2: anotherTickArrays[2].publicKey, // invalid
          oracle: oraclePda.publicKey,
        }),
      ).buildAndExecute(),
      /0x17a8/, // DifferentWhirlpoolTickArrayAccount
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
      false,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(10),
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
        }),
      ).buildAndExecute(),
      /0x7d6/, // ConstraintSeeds
    );
  });

  it("fails on passing in an incorrectly hashed oracle PDA", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const { poolInitInfo: anotherPoolInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528,
      3,
      TickSpacing.Standard,
      false,
    );

    const anotherOraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      anotherPoolInitInfo.whirlpoolPda.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(10),
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
        }),
      ).buildAndExecute(),
      /0x7d6/, // ConstraintSeeds
    );
  });

  it("fail on passing in zero tradable amount", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);

    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      // sparse-swap: We didn't provide valid initialized tick arrays.
      // The current pool tick index is 32190, so we need to provide tick array with start_tick_index 22528.
      // Using sparse-swap, the validity of provided tick arrays will be evaluated before evaluating trade amount.
      22528,
      3,
      TickSpacing.Standard,
      true,
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(0),
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
        }),
      ).buildAndExecute(),
      /0x1793/, // ZeroTradableAmount
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
      aToB,
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(
      ctx,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
      fundParams,
    );

    const tokenVaultABefore = new anchor.BN(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      ),
    );
    const tokenVaultBBefore = new anchor.BN(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      ),
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
    const whirlpoolData = whirlpool.getData();
    const quote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      new BN(100000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
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
      }),
    ).buildAndExecute();

    assert.equal(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      ),
      tokenVaultABefore.sub(quote.estimatedAmountOut).toString(),
    );
    assert.equal(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      ),
      tokenVaultBBefore.add(quote.estimatedAmountIn).toString(),
    );
  });

  it("swaps across one dynamic tick array", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);
    const aToB = false;
    await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528, // to 33792
      3,
      TickSpacing.Standard,
      aToB,
      true,
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(
      ctx,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
      fundParams,
    );

    const tokenVaultABefore = new anchor.BN(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      ),
    );
    const tokenVaultBBefore = new anchor.BN(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      ),
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
    const whirlpoolData = whirlpool.getData();
    const quote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      new BN(100000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
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
      }),
    ).buildAndExecute();

    assert.equal(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      ),
      tokenVaultABefore.sub(quote.estimatedAmountOut).toString(),
    );
    assert.equal(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      ),
      tokenVaultBBefore.add(quote.estimatedAmountIn).toString(),
    );
  });

  it("swaps aToB across initialized tick with no movement", async () => {
    const startingTick = 91720;
    const tickSpacing = TickSpacing.Stable;
    const startingTickArrayStartIndex = TickUtil.getStartTickIndex(
      startingTick,
      tickSpacing,
    );
    const aToB = true;
    const startSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(startingTick);
    const initialLiquidity = new anchor.BN(10_000_000);
    const additionalLiquidity = new anchor.BN(2_000_000);

    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Stable, startSqrtPrice);
    await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      startingTickArrayStartIndex + TICK_ARRAY_SIZE * tickSpacing * 2,
      5,
      TickSpacing.Stable,
      aToB,
    );
    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    const initialParams: FundedPositionParams[] = [
      {
        liquidityAmount: initialLiquidity,
        tickLowerIndex: startingTickArrayStartIndex + tickSpacing,
        tickUpperIndex:
          startingTickArrayStartIndex +
          TICK_ARRAY_SIZE * tickSpacing * 2 -
          tickSpacing,
      },
    ];

    await fundPositions(
      ctx,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
      initialParams,
    );

    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    let whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
    let whirlpoolData = whirlpool.getData();

    // Position covers the current price, so liquidity should be equal to the initial funded position
    assert.ok(whirlpoolData.liquidity.eq(new anchor.BN(10_000_000)));

    const nextParams: FundedPositionParams[] = [
      {
        liquidityAmount: additionalLiquidity,
        tickLowerIndex: startingTick - tickSpacing * 2,
        tickUpperIndex: startingTick,
      },
    ];

    await fundPositions(
      ctx,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
      nextParams,
    );

    whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
    whirlpoolData = whirlpool.getData();
    // Whirlpool.currentTick is 91720, so the newly funded position's upper tick is not
    // strictly less than 91720 so the liquidity is not added.
    assert.ok(whirlpoolData.liquidity.eq(initialLiquidity));
    assert.ok(whirlpoolData.sqrtPrice.eq(startSqrtPrice));
    assert.equal(whirlpoolData.tickCurrentIndex, startingTick);

    const quote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new BN(1),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
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
      }),
    ).buildAndExecute();

    whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
    whirlpoolData = whirlpool.getData();

    // After the above swap, since the amount is so low, it is completely taken by fees
    // thus, the sqrt price will remain the same, the starting tick will decrement since it
    // is an aToB swap ending on initialized tick, and since the tick is crossed,
    // the liquidity will be added
    assert.equal(whirlpoolData.tickCurrentIndex, startingTick - 1);
    assert.ok(whirlpoolData.sqrtPrice.eq(startSqrtPrice));
    assert.ok(
      whirlpoolData.liquidity.eq(initialLiquidity.add(additionalLiquidity)),
    );

    const quote2 = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new BN(1),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
    );

    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        ...quote2,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        oracle: oraclePda.publicKey,
      }),
    ).buildAndExecute();

    whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
    whirlpoolData = whirlpool.getData();

    // After the above swap, since the amount is so low, it is completely taken by fees
    // thus, the sqrt price will remaing the same, the starting tick will not decrement
    // since it is an aToB swap ending on an uninitialized tick, no tick is crossed
    assert.equal(whirlpoolData.tickCurrentIndex, startingTick - 1);
    assert.ok(whirlpoolData.sqrtPrice.eq(startSqrtPrice));
    assert.ok(
      whirlpoolData.liquidity.eq(initialLiquidity.add(additionalLiquidity)),
    );
  });

  it("swaps aToB with small remainder across initialized tick", async () => {
    const startingTick = 91728;
    const tickSpacing = TickSpacing.Stable;
    const startingTickArrayStartIndex = TickUtil.getStartTickIndex(
      startingTick,
      tickSpacing,
    );
    const aToB = true;
    const startSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(startingTick);
    const initialLiquidity = new anchor.BN(10_000_000);
    const additionalLiquidity = new anchor.BN(2_000_000);

    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Stable, startSqrtPrice);
    await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      startingTickArrayStartIndex + TICK_ARRAY_SIZE * tickSpacing * 2,
      5,
      TickSpacing.Stable,
      aToB,
    );
    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    const initialParams: FundedPositionParams[] = [
      {
        liquidityAmount: initialLiquidity,
        tickLowerIndex: startingTickArrayStartIndex + tickSpacing,
        tickUpperIndex:
          startingTickArrayStartIndex +
          TICK_ARRAY_SIZE * tickSpacing * 2 -
          tickSpacing,
      },
    ];

    await fundPositions(
      ctx,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
      initialParams,
    );

    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    let whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
    let whirlpoolData = whirlpool.getData();

    // Position covers the current price, so liquidity should be equal to the initial funded position
    assert.ok(whirlpoolData.liquidity.eq(new anchor.BN(10_000_000)));

    const nextParams: FundedPositionParams[] = [
      {
        liquidityAmount: additionalLiquidity,
        tickLowerIndex: startingTick - tickSpacing * 3,
        tickUpperIndex: startingTick - tickSpacing,
      },
    ];

    await fundPositions(
      ctx,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
      nextParams,
    );

    whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
    whirlpoolData = whirlpool.getData();
    // Whirlpool.currentTick is 91720, so the newly funded position's upper tick is not
    // strictly less than 91720 so the liquidity is not added.
    assert.ok(whirlpoolData.liquidity.eq(initialLiquidity));
    assert.ok(whirlpoolData.sqrtPrice.eq(startSqrtPrice));
    assert.equal(whirlpoolData.tickCurrentIndex, startingTick);

    const quote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new BN(1),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
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
      }),
    ).buildAndExecute();

    whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
    whirlpoolData = whirlpool.getData();

    // After the above swap, since the amount is so low, it is completely taken by fees
    // thus, the sqrt price will remain the same, the starting tick will stay the same since it
    // is an aToB swap ending on initialized tick and no tick is crossed
    assert.equal(whirlpoolData.tickCurrentIndex, startingTick);
    assert.ok(whirlpoolData.sqrtPrice.eq(startSqrtPrice));
    assert.ok(whirlpoolData.liquidity.eq(initialLiquidity));

    const quote2 = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new BN(43),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
    );

    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        ...quote2,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        oracle: oraclePda.publicKey,
      }),
    ).buildAndExecute();

    whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
    whirlpoolData = whirlpool.getData();

    // After the above swap, there will be a small amount remaining that crosses
    // an initialized tick index, but isn't enough to move the sqrt price.
    assert.equal(
      whirlpoolData.tickCurrentIndex,
      startingTick - tickSpacing - 1,
    );
    assert.ok(
      whirlpoolData.sqrtPrice.eq(
        PriceMath.tickIndexToSqrtPriceX64(startingTick - tickSpacing),
      ),
    );
    assert.ok(
      whirlpoolData.liquidity.eq(initialLiquidity.add(additionalLiquidity)),
    );
  });

  it("swaps across three tick arrays", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(
        ctx,
        TickSpacing.Stable,
        PriceMath.tickIndexToSqrtPriceX64(27500),
      );

    const aToB = false;
    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      27456, // to 28160, 28864
      5,
      TickSpacing.Stable,
      false,
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

    await fundPositions(
      ctx,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
      fundParams,
    );

    assert.equal(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      ),
      "1977429",
    );
    assert.equal(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      ),
      "869058",
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    // Tick
    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new BN(7051000),
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
      }),
    ).buildAndExecute();

    assert.equal(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      ),
      "1535201",
    );
    assert.equal(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      ),
      "7920058",
    );

    // TODO: Verify fees and other whirlpool params
  });

  it("emit Traded event", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(ctx, TickSpacing.Standard);
    const aToB = false;
    await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528, // to 33792
      3,
      TickSpacing.Standard,
      aToB,
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(
      ctx,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
      fundParams,
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
    const whirlpoolDataPre = whirlpool.getData();
    const quote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolDataPre.tokenMintB,
      new BN(100000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
    );

    const preSqrtPrice = whirlpoolDataPre.sqrtPrice;
    // event verification
    let eventVerified = false;
    let detectedSignature = null;
    const listener = ctx.program.addEventListener(
      "Traded",
      (event, _slot, signature) => {
        detectedSignature = signature;
        // verify
        assert.ok(event.whirlpool.equals(whirlpoolPda.publicKey));
        assert.ok(event.aToB === aToB);
        assert.ok(event.preSqrtPrice.eq(preSqrtPrice));
        assert.ok(event.postSqrtPrice.eq(quote.estimatedEndSqrtPrice));
        assert.ok(event.inputAmount.eq(quote.estimatedAmountIn));
        assert.ok(event.outputAmount.eq(quote.estimatedAmountOut));
        assert.ok(event.inputTransferFee.isZero()); // v1 doesn't handle TransferFee extension
        assert.ok(event.outputTransferFee.isZero()); // v1 doesn't handle TransferFee extension

        const protocolFee = quote.estimatedFeeAmount
          .muln(whirlpool.getData().protocolFeeRate)
          .div(PROTOCOL_FEE_RATE_MUL_VALUE);
        const lpFee = quote.estimatedFeeAmount.sub(protocolFee);
        assert.ok(event.lpFee.eq(lpFee));
        assert.ok(event.protocolFee.eq(protocolFee));

        eventVerified = true;
      },
    );

    const signature = await toTx(
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
      }),
    ).buildAndExecute();

    await sleep(2000);
    assert.equal(signature, detectedSignature);
    assert.ok(eventVerified);

    ctx.program.removeEventListener(listener);
  });

  /* using sparse-swap, we can handle uninitialized tick-array. so this test is no longer needed.

  it("Error on passing in uninitialized tick-array", async () => {
    const { poolInitInfo, tokenAccountA, tokenAccountB, tickArrays } =
      await initTestPoolWithLiquidity(ctx);
    const whirlpool = poolInitInfo.whirlpoolPda.publicKey;

    const uninitializedTickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpool, 0);

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, poolInitInfo.whirlpoolPda.publicKey);

    const params: SwapParams = {
      amount: new BN(10),
      otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(true),
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
  */

  it("Error if sqrt_price_limit exceeds max", async () => {
    const { poolInitInfo, tokenAccountA, tokenAccountB, tickArrays } =
      await initTestPoolWithLiquidity(ctx);
    const whirlpool = poolInitInfo.whirlpoolPda.publicKey;

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      poolInitInfo.whirlpoolPda.publicKey,
    );

    const params: SwapParams = {
      amount: new BN(10),
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
      await toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, params),
      ).buildAndExecute();
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

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      poolInitInfo.whirlpoolPda.publicKey,
    );

    const params: SwapParams = {
      amount: new BN(10),
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
      await toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, params),
      ).buildAndExecute();
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
      false,
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(100_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(
      ctx,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
      fundParams,
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    const params = {
      amount: new BN(10),
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
      await toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, params),
      ).buildAndExecute();
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
      false,
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(100_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(
      ctx,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
      fundParams,
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    const params = {
      amount: new BN(10),
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
      await toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, params),
      ).buildAndExecute();
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
      false,
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(100_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(
      ctx,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
      fundParams,
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    const params = {
      amount: new BN(10),
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
      await toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, params),
      ).buildAndExecute();
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
      false,
    );

    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(100_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositions(
      ctx,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
      fundParams,
    );

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    const params = {
      amount: new BN(10),
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
      await toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, params),
      ).buildAndExecute();
      assert.fail("should fail if amount out is below threshold");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0x1795/); // AmountInAboveMaximum
    }
  });

  it("swaps across ten tick arrays", async () => {
    const {
      poolInitInfo,
      configKeypairs,
      whirlpoolPda,
      tokenAccountA,
      tokenAccountB,
    } = await initTestPoolWithTokens(
      ctx,
      TickSpacing.Stable,
      PriceMath.tickIndexToSqrtPriceX64(27500),
    );

    const aToB = false;
    const tickArrays = await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      27456, // to 30528
      3,
      TickSpacing.Stable,
      aToB,
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
      fundParams,
    );

    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      ),
    );
    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      ),
    );

    (
      await Promise.all(
        tickArrays.map((tickArray) =>
          fetcher.getTickArray(tickArray.publicKey),
        ),
      )
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.info(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString(),
        );
      });
    });

    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    // Tick
    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new BN(829996),
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
      }),
    ).buildAndExecute();

    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      ),
    );
    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      ),
    );

    (
      await Promise.all(
        tickArrays.map((tickArray) =>
          fetcher.getTickArray(tickArray.publicKey),
        ),
      )
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.info(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString(),
        );
      });
    });

    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new BN(14538074),
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
      }),
    ).buildAndExecute();

    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      ),
    );
    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      ),
    );

    (
      await Promise.all(
        tickArrays.map((tickArray) =>
          fetcher.getTickArray(tickArray.publicKey),
        ),
      )
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.info(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString(),
        );
      });
    });

    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new BN(829996),
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
      }),
    ).buildAndExecute();

    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      ),
    );
    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      ),
    );

    (
      await Promise.all(
        tickArrays.map((tickArray) =>
          fetcher.getTickArray(tickArray.publicKey),
        ),
      )
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.info(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString(),
        );
      });
    });

    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new BN(14538074),
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
      }),
    ).buildAndExecute();

    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      ),
    );
    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      ),
    );

    (
      await Promise.all(
        tickArrays.map((tickArray) =>
          fetcher.getTickArray(tickArray.publicKey),
        ),
      )
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.info(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString(),
        );
      });
    });

    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new BN(829996),
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
      }),
    ).buildAndExecute();

    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      ),
    );
    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      ),
    );

    (
      await Promise.all(
        tickArrays.map((tickArray) =>
          fetcher.getTickArray(tickArray.publicKey),
        ),
      )
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.info(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString(),
        );
      });
    });

    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new BN(14538074),
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
      }),
    ).buildAndExecute();

    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      ),
    );
    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      ),
    );

    (
      await Promise.all(
        tickArrays.map((tickArray) =>
          fetcher.getTickArray(tickArray.publicKey),
        ),
      )
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.info(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString(),
        );
      });
    });

    await withdrawPositions(ctx, positionInfos, tokenAccountA, tokenAccountB);

    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      ),
    );
    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      ),
    );

    (
      await Promise.all(
        tickArrays.map((tickArray) =>
          fetcher.getTickArray(tickArray.publicKey),
        ),
      )
    ).map((tickArray) => {
      const ta = tickArray as TickArrayData;
      ta.ticks.forEach((tick, index) => {
        if (!tick.initialized) {
          return;
        }

        console.info(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString(),
        );
      });
    });

    await toTx(
      ctx,
      WhirlpoolIx.collectProtocolFeesIx(ctx.program, {
        whirlpoolsConfig: poolInitInfo.whirlpoolsConfig,
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        collectProtocolFeesAuthority:
          configKeypairs.collectProtocolFeesAuthorityKeypair.publicKey,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
      }),
    )
      .addSigner(configKeypairs.collectProtocolFeesAuthorityKeypair)
      .buildAndExecute();

    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      ),
    );
    console.info(
      await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      ),
    );
  });

  describe("partial fill, b to a (litesvm)", () => {
    const tickSpacing = 128;
    const aToB = false;
    let poolInitInfo: InitPoolParams;
    let whirlpoolPda: PDA;
    let tokenAccountA: PublicKey;
    let tokenAccountB: PublicKey;
    let whirlpoolKey: PublicKey;
    let oraclePda: PDA;

    beforeEach(async () => {
      const init = await initTestPoolWithTokens(
        ctx,
        tickSpacing,
        PriceMath.tickIndexToSqrtPriceX64(439296 + 1),
        new BN("10000000000000000000000"),
      );

      poolInitInfo = init.poolInitInfo;
      whirlpoolPda = poolInitInfo.whirlpoolPda;
      tokenAccountA = init.tokenAccountA;
      tokenAccountB = init.tokenAccountB;
      whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
      oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolKey);

      await initTickArrayRange(
        ctx,
        whirlpoolPda.publicKey,
        439296, // right most TickArray
        1,
        tickSpacing,
        aToB,
      );

      // a: 1 (round up)
      // b: 223379095563402706 (to get 1, need >= 223379095563402706)
      const fundParams: FundedPositionParams[] = [
        {
          liquidityAmount: new anchor.BN(10_000_000_000),
          tickLowerIndex: 439424,
          tickUpperIndex: 439552,
        },
      ];

      await fundPositions(
        ctx,
        poolInitInfo,
        tokenAccountA,
        tokenAccountB,
        fundParams,
      );
    });

    async function getTokenBalances(): Promise<[BN, BN]> {
      const tokenVaultA = new anchor.BN(
        await getTokenBalance(provider, tokenAccountA),
      );
      const tokenVaultB = new anchor.BN(
        await getTokenBalance(provider, tokenAccountB),
      );
      return [tokenVaultA, tokenVaultB];
    }

    // |-S-***-------T,max----|  (*: liquidity, S: start, T: end)
    it("ExactIn, sqrt_price_limit = 0", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("223379095563402706");
      const quote = await swapQuoteByInputToken(
        whirlpool,
        whirlpoolData.tokenMintB,
        amount.muln(2), // x2 input
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      const [preA, preB] = await getTokenBalances();

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

          // sqrt_price_limit = 0
          sqrtPriceLimit: ZERO_BN,
          otherAmountThreshold: new BN(0),
        }),
      ).buildAndExecute();

      const postWhirlpoolData = await whirlpool.refreshData();
      const [postA, postB] = await getTokenBalances();
      const diffA = postA.sub(preA);
      const diffB = postB.sub(preB);

      assert.ok(diffA.isZero()); // no output (round up is not used to calculate output)
      assert.ok(diffB.neg().gte(amount) && diffB.neg().lt(amount.muln(2))); // partial
      assert.ok(postWhirlpoolData.sqrtPrice.eq(MAX_SQRT_PRICE_BN)); // hit max
    });

    // |-S-***-------T,max----|  (*: liquidity, S: start, T: end)
    it("ExactIn, sqrt_price_limit = MAX_SQRT_PRICE", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("223379095563402706");
      const quote = await swapQuoteByInputToken(
        whirlpool,
        whirlpoolData.tokenMintB,
        amount.muln(2), // x2 input
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      const [preA, preB] = await getTokenBalances();

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

          // sqrt_price_limit = MAX_SQRT_PRICE
          sqrtPriceLimit: MAX_SQRT_PRICE_BN,
          otherAmountThreshold: new BN(0),
        }),
      ).buildAndExecute();

      const postWhirlpoolData = await whirlpool.refreshData();
      const [postA, postB] = await getTokenBalances();
      const diffA = postA.sub(preA);
      const diffB = postB.sub(preB);

      assert.ok(diffA.isZero()); // no output (round up is not used to calculate output)
      assert.ok(diffB.neg().gte(amount) && diffB.neg().lt(amount.muln(2))); // partial
      assert.ok(postWhirlpoolData.sqrtPrice.eq(MAX_SQRT_PRICE_BN)); // hit max
    });

    // |-S-***-------T,max----|  (*: liquidity, S: start, T: end)
    it("Fails ExactOut, sqrt_price_limit = 0", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("1");
      const quote = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintA,
        amount,
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      await assert.rejects(
        toTx(
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

            // sqrt_price_limit = 0
            sqrtPriceLimit: ZERO_BN,
            amount, // 1
            otherAmountThreshold: quote.estimatedAmountIn,
          }),
        ).buildAndExecute(),
        /0x17a9/, // PartialFillError
      );
    });

    // |-S-***-------T,max----|  (*: liquidity, S: start, T: end)
    it("ExactOut, sqrt_price_limit = MAX_SQRT_PRICE", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("1");
      const quote = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintA,
        amount,
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      const [preA, preB] = await getTokenBalances();

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

          // sqrt_price_limit = MAX_SQRT_PRICE
          sqrtPriceLimit: MAX_SQRT_PRICE_BN,
          amount, // 1
          otherAmountThreshold: quote.estimatedAmountIn,
        }),
      ).buildAndExecute();

      const postWhirlpoolData = await whirlpool.refreshData();
      const [postA, postB] = await getTokenBalances();
      const diffA = postA.sub(preA);
      const diffB = postB.sub(preB);

      assert.ok(diffA.isZero()); // no output (round up is not used to calculate output)
      assert.ok(diffB.neg().eq(quote.estimatedAmountIn)); // partial
      assert.ok(postWhirlpoolData.sqrtPrice.eq(MAX_SQRT_PRICE_BN)); // hit max
    });
  });

  describe("partial fill, a to b (litesvm)", () => {
    const tickSpacing = 128;
    const aToB = true;
    let poolInitInfo: InitPoolParams;
    let whirlpoolPda: PDA;
    let tokenAccountA: PublicKey;
    let tokenAccountB: PublicKey;
    let whirlpoolKey: PublicKey;
    let oraclePda: PDA;

    beforeEach(async () => {
      const init = await initTestPoolWithTokens(
        ctx,
        tickSpacing,
        PriceMath.tickIndexToSqrtPriceX64(-439296 - 1),
        new BN("10000000000000000000000"),
      );

      poolInitInfo = init.poolInitInfo;
      whirlpoolPda = poolInitInfo.whirlpoolPda;
      tokenAccountA = init.tokenAccountA;
      tokenAccountB = init.tokenAccountB;
      whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
      oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolKey);

      await initTickArrayRange(
        ctx,
        whirlpoolPda.publicKey,
        -450560, // left most TickArray
        1,
        tickSpacing,
        aToB,
      );

      // a: 223379098170764880 (to get 1, need >= 223379098170764880)
      // b: 1 (round up)
      const fundParams: FundedPositionParams[] = [
        {
          liquidityAmount: new anchor.BN(10_000_000_000),
          tickLowerIndex: -439552,
          tickUpperIndex: -439424,
        },
      ];

      await fundPositions(
        ctx,
        poolInitInfo,
        tokenAccountA,
        tokenAccountB,
        fundParams,
      );
    });

    async function getTokenBalances(): Promise<[BN, BN]> {
      const tokenVaultA = new anchor.BN(
        await getTokenBalance(provider, tokenAccountA),
      );
      const tokenVaultB = new anchor.BN(
        await getTokenBalance(provider, tokenAccountB),
      );
      return [tokenVaultA, tokenVaultB];
    }

    // |-min,T---------***-S-|  (*: liquidity, S: start, T: end)
    it("ExactIn, sqrt_price_limit = 0", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("223379098170764880");
      const quote = await swapQuoteByInputToken(
        whirlpool,
        whirlpoolData.tokenMintA,
        amount.muln(2), // x2 input
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      const [preA, preB] = await getTokenBalances();

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

          // sqrt_price_limit = 0
          sqrtPriceLimit: ZERO_BN,
          otherAmountThreshold: new BN(0),
        }),
      ).buildAndExecute();

      const postWhirlpoolData = await whirlpool.refreshData();
      const [postA, postB] = await getTokenBalances();
      const diffA = postA.sub(preA);
      const diffB = postB.sub(preB);

      assert.ok(diffA.neg().gte(amount) && diffA.neg().lt(amount.muln(2))); // partial
      assert.ok(diffB.isZero()); // no output (round up is not used to calculate output)
      assert.ok(postWhirlpoolData.sqrtPrice.eq(MIN_SQRT_PRICE_BN)); // hit min
    });

    // |-min,T---------***-S-|  (*: liquidity, S: start, T: end)
    it("ExactIn, sqrt_price_limit = MIN_SQRT_PRICE", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("223379098170764880");
      const quote = await swapQuoteByInputToken(
        whirlpool,
        whirlpoolData.tokenMintA,
        amount.muln(2), // x2 input
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      const [preA, preB] = await getTokenBalances();

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

          // sqrt_price_limit = MIN_SQRT_PRICE
          sqrtPriceLimit: MIN_SQRT_PRICE_BN,
          otherAmountThreshold: new BN(0),
        }),
      ).buildAndExecute();

      const postWhirlpoolData = await whirlpool.refreshData();
      const [postA, postB] = await getTokenBalances();
      const diffA = postA.sub(preA);
      const diffB = postB.sub(preB);

      assert.ok(diffA.neg().gte(amount) && diffA.neg().lt(amount.muln(2))); // partial
      assert.ok(diffB.isZero()); // no output (round up is not used to calculate output)
      assert.ok(postWhirlpoolData.sqrtPrice.eq(MIN_SQRT_PRICE_BN)); // hit min
    });

    // |-min,T---------***-S-|  (*: liquidity, S: start, T: end)
    it("Fails ExactOut, sqrt_price_limit = 0", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("1");
      const quote = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintB,
        amount,
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      await assert.rejects(
        toTx(
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

            // sqrt_price_limit = 0
            sqrtPriceLimit: ZERO_BN,
            amount, // 1
            otherAmountThreshold: quote.estimatedAmountIn,
          }),
        ).buildAndExecute(),
        /0x17a9/, // PartialFillError
      );
    });

    // |-min,T---------***-S-|  (*: liquidity, S: start, T: end)
    it("ExactOut, sqrt_price_limit = MAX_SQRT_PRICE", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("1");
      const quote = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintB,
        amount,
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      const [preA, preB] = await getTokenBalances();

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

          // sqrt_price_limit = MIN_SQRT_PRICE
          sqrtPriceLimit: MIN_SQRT_PRICE_BN,
          amount, // 1
          otherAmountThreshold: quote.estimatedAmountIn,
        }),
      ).buildAndExecute();

      const postWhirlpoolData = await whirlpool.refreshData();
      const [postA, postB] = await getTokenBalances();
      const diffA = postA.sub(preA);
      const diffB = postB.sub(preB);

      assert.ok(diffA.neg().eq(quote.estimatedAmountIn)); // partial
      assert.ok(diffB.isZero()); // no output (round up is not used to calculate output)
      assert.ok(postWhirlpoolData.sqrtPrice.eq(MIN_SQRT_PRICE_BN)); // hit min
    });
  });
});
