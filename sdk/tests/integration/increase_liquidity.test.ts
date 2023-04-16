import * as anchor from "@coral-xyz/anchor";
import { MathUtil, TransactionBuilder } from "@orca-so/common-sdk";
import { u64 } from "@solana/spl-token";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  PDAUtil,
  PositionData,
  PriceMath,
  TickArrayData,
  TickUtil,
  WhirlpoolContext,
  WhirlpoolData,
  WhirlpoolIx,
  toTx
} from "../../src";
import { PoolUtil, toTokenAmount } from "../../src/utils/public/pool-utils";
import { contextToBuilderOptions } from "../../src/utils/txn-utils";
import {
  MAX_U64,
  TickSpacing,
  ZERO_BN,
  approveToken,
  assertTick,
  createAndMintToTokenAccount,
  createMint,
  createTokenAccount,
  getTokenBalance,
  transfer
} from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { WhirlpoolTestFixture } from "../utils/fixture";
import { initTestPool, initTickArray, openPosition } from "../utils/init-utils";
import {
  generateDefaultInitTickArrayParams,
  generateDefaultOpenPositionParams
} from "../utils/test-builders";

describe("increase_liquidity", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  it("increase liquidity of a position spanning two tick arrays", async () => {
    const currTick = 0;
    const tickLowerIndex = -1280,
      tickUpperIndex = 1280;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN }],
      initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const poolBefore = (await fetcher.getPool(whirlpoolPda.publicKey, true)) as WhirlpoolData;
    const tokenAmount = toTokenAmount(167_000, 167_000);
    const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
      currTick,
      tickLowerIndex,
      tickUpperIndex,
      tokenAmount
    );

    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityIx(ctx.program, {
        liquidityAmount,
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
      })
    ).buildAndExecute();

    const position = (await fetcher.getPosition(positionInitInfo.publicKey, true)) as PositionData;
    assert.ok(position.liquidity.eq(liquidityAmount));

    const poolAfter = (await fetcher.getPool(whirlpoolPda.publicKey, true)) as WhirlpoolData;
    assert.ok(poolAfter.rewardLastUpdatedTimestamp.gte(poolBefore.rewardLastUpdatedTimestamp));
    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      tokenAmount.tokenA.toString()
    );
    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      tokenAmount.tokenB.toString()
    );
    assert.ok(poolAfter.liquidity.eq(new anchor.BN(liquidityAmount)));

    const tickArrayLower = (await fetcher.getTickArray(
      positionInitInfo.tickArrayLower,
      true
    )) as TickArrayData;
    assertTick(tickArrayLower.ticks[78], true, liquidityAmount, liquidityAmount);
    const tickArrayUpper = (await fetcher.getTickArray(
      positionInitInfo.tickArrayUpper,
      true
    )) as TickArrayData;
    assertTick(tickArrayUpper.ticks[10], true, liquidityAmount, liquidityAmount.neg());
  });

  it("increase liquidity of a position contained in one tick array", async () => {
    const currTick = 500;
    const tickLowerIndex = 7168;
    const tickUpperIndex = 8960;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN }],
      initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];
    const poolBefore = (await fetcher.getPool(whirlpoolPda.publicKey, true)) as WhirlpoolData;

    const tokenAmount = toTokenAmount(1_000_000, 0);
    const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
      currTick,
      tickLowerIndex,
      tickUpperIndex,
      tokenAmount
    );

    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityIx(ctx.program, {
        liquidityAmount,
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
      })
    ).buildAndExecute();

    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      tokenAmount.tokenA.toString()
    );

    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      tokenAmount.tokenB.toString()
    );

    const expectedLiquidity = new anchor.BN(liquidityAmount);
    const position = (await fetcher.getPosition(positionInitInfo.publicKey, true)) as PositionData;
    assert.ok(position.liquidity.eq(expectedLiquidity));

    const tickArray = (await fetcher.getTickArray(
      positionInitInfo.tickArrayLower,
      true
    )) as TickArrayData;

    assertTick(tickArray.ticks[56], true, expectedLiquidity, expectedLiquidity);
    assertTick(tickArray.ticks[70], true, expectedLiquidity, expectedLiquidity.neg());

    const poolAfter = (await fetcher.getPool(whirlpoolPda.publicKey, true)) as WhirlpoolData;
    assert.ok(poolAfter.rewardLastUpdatedTimestamp.gte(poolBefore.rewardLastUpdatedTimestamp));
    assert.equal(poolAfter.liquidity, 0);
  });

  it("initialize and increase liquidity of a position in a single transaction", async () => {
    const currTick = 500;
    const tickLowerIndex = 7168;
    const tickUpperIndex = 8960;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
    });
    const { poolInitInfo, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda, tickSpacing } = poolInitInfo;
    const poolBefore = (await fetcher.getPool(whirlpoolPda.publicKey, true)) as WhirlpoolData;

    const tokenAmount = toTokenAmount(1_000_000, 0);
    const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
      currTick,
      tickLowerIndex,
      tickUpperIndex,
      tokenAmount
    );

    const { params, mint } = await generateDefaultOpenPositionParams(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
      ctx.wallet.publicKey
    );

    const tickArrayLower = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpoolPda.publicKey,
      TickUtil.getStartTickIndex(tickLowerIndex, tickSpacing)
    ).publicKey;

    const tickArrayUpper = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpoolPda.publicKey,
      TickUtil.getStartTickIndex(tickUpperIndex, tickSpacing)
    ).publicKey;

    await new TransactionBuilder(ctx.provider.connection, ctx.provider.wallet, contextToBuilderOptions(ctx.opts))
      // TODO: create a ComputeBudgetInstruction to request more compute
      .addInstruction(
        WhirlpoolIx.initTickArrayIx(
          ctx.program,
          generateDefaultInitTickArrayParams(
            ctx,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(tickLowerIndex, tickSpacing)
          )
        )
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
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: tokenAmount.tokenA,
          tokenMaxB: tokenAmount.tokenB,
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: params.positionPda.publicKey,
          positionTokenAccount: params.positionTokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: tickArrayLower,
          tickArrayUpper: tickArrayUpper,
        })
      )
      .buildAndExecute();

    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      tokenAmount.tokenA.toString()
    );

    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      tokenAmount.tokenB.toString()
    );

    const expectedLiquidity = new anchor.BN(liquidityAmount);
    const position = (await fetcher.getPosition(
      params.positionPda.publicKey,
      true
    )) as PositionData;
    assert.ok(position.liquidity.eq(expectedLiquidity));

    const tickArray = (await fetcher.getTickArray(tickArrayLower, true)) as TickArrayData;

    assertTick(tickArray.ticks[56], true, expectedLiquidity, expectedLiquidity);
    assertTick(tickArray.ticks[70], true, expectedLiquidity, expectedLiquidity.neg());

    const poolAfter = (await fetcher.getPool(whirlpoolPda.publicKey, true)) as WhirlpoolData;
    assert.ok(poolAfter.rewardLastUpdatedTimestamp.gte(poolBefore.rewardLastUpdatedTimestamp));
    assert.equal(poolAfter.liquidity, 0);
  });

  it("increase liquidity of a position with an approved position authority delegate", async () => {
    const currTick = 1300;
    const tickLowerIndex = -1280,
      tickUpperIndex = 1280;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN }],
      initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const poolBefore = (await fetcher.getPool(whirlpoolPda.publicKey, true)) as WhirlpoolData;
    const tokenAmount = toTokenAmount(0, 167_000);
    const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
      currTick,
      tickLowerIndex,
      tickUpperIndex,
      tokenAmount
    );

    const delegate = anchor.web3.Keypair.generate();
    await approveToken(provider, positionInitInfo.tokenAccount, delegate.publicKey, 1);
    await approveToken(provider, tokenAccountA, delegate.publicKey, 1_000_000);
    await approveToken(provider, tokenAccountB, delegate.publicKey, 1_000_000);

    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityIx(ctx.program, {
        liquidityAmount,
        tokenMaxA: tokenAmount.tokenA,
        tokenMaxB: tokenAmount.tokenB,
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: delegate.publicKey,
        position: positionInitInfo.publicKey,
        positionTokenAccount: positionInitInfo.tokenAccount,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArrayLower: positionInitInfo.tickArrayLower,
        tickArrayUpper: positionInitInfo.tickArrayUpper,
      })
    )
      .addSigner(delegate)
      .buildAndExecute();

    const position = (await fetcher.getPosition(positionInitInfo.publicKey, true)) as PositionData;
    assert.ok(position.liquidity.eq(liquidityAmount));

    const poolAfter = (await fetcher.getPool(whirlpoolPda.publicKey, true)) as WhirlpoolData;
    assert.ok(poolAfter.rewardLastUpdatedTimestamp.gte(poolBefore.rewardLastUpdatedTimestamp));
    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      tokenAmount.tokenA.toString()
    );
    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      tokenAmount.tokenB.toString()
    );
    assert.equal(poolAfter.liquidity, 0);

    const tickArrayLower = (await fetcher.getTickArray(
      positionInitInfo.tickArrayLower,
      true
    )) as TickArrayData;
    assertTick(tickArrayLower.ticks[78], true, liquidityAmount, liquidityAmount);
    const tickArrayUpper = (await fetcher.getTickArray(
      positionInitInfo.tickArrayUpper,
      true
    )) as TickArrayData;
    assertTick(tickArrayUpper.ticks[10], true, liquidityAmount, liquidityAmount.neg());
  });

  it("add maximum amount of liquidity near minimum price", async () => {
    const currTick = -443621;
    const { poolInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Stable,
      PriceMath.tickIndexToSqrtPriceX64(currTick)
    );

    const { tokenMintA, tokenMintB, whirlpoolPda } = poolInitInfo;
    const tokenAccountA = await createAndMintToTokenAccount(provider, tokenMintA, MAX_U64);
    const tokenAccountB = await createAndMintToTokenAccount(provider, tokenMintB, MAX_U64);

    const {
      params: { tickArrayPda },
    } = await initTickArray(ctx, whirlpoolPda.publicKey, -444224);

    const tickLowerIndex = -443632;
    const tickUpperIndex = -443624;
    const positionInfo = await openPosition(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex
    );
    const { positionPda, positionTokenAccount: positionTokenAccountAddress } = positionInfo.params;

    const tokenAmount = {
      tokenA: new u64(0),
      tokenB: MAX_U64,
    };
    const estLiquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
      currTick,
      tickLowerIndex,
      tickUpperIndex,
      tokenAmount
    );

    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityIx(ctx.program, {
        liquidityAmount: estLiquidityAmount,
        tokenMaxA: tokenAmount.tokenA,
        tokenMaxB: tokenAmount.tokenB,
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: provider.wallet.publicKey,
        position: positionPda.publicKey,
        positionTokenAccount: positionTokenAccountAddress,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArrayLower: tickArrayPda.publicKey,
        tickArrayUpper: tickArrayPda.publicKey,
      })
    ).buildAndExecute();

    const position = (await fetcher.getPosition(positionPda.publicKey, true)) as PositionData;
    assert.ok(position.liquidity.eq(estLiquidityAmount));
  });

  it("add maximum amount of liquidity near maximum price", async () => {
    const currTick = 443635;
    const { poolInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Stable,
      PriceMath.tickIndexToSqrtPriceX64(currTick)
    );

    const { tokenMintA, tokenMintB, whirlpoolPda } = poolInitInfo;
    const tokenAccountA = await createAndMintToTokenAccount(provider, tokenMintA, MAX_U64);
    const tokenAccountB = await createAndMintToTokenAccount(provider, tokenMintB, MAX_U64);

    const {
      params: { tickArrayPda },
    } = await initTickArray(ctx, whirlpoolPda.publicKey, 436480);

    const tickLowerIndex = 436488;
    const tickUpperIndex = 436496;
    const positionInfo = await openPosition(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex
    );
    const { positionPda, positionTokenAccount: positionTokenAccountAddress } = positionInfo.params;

    const tokenAmount = {
      tokenA: new u64(0),
      tokenB: MAX_U64,
    };
    const estLiquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
      currTick,
      tickLowerIndex,
      tickUpperIndex,
      tokenAmount
    );

    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityIx(ctx.program, {
        liquidityAmount: estLiquidityAmount,
        tokenMaxA: tokenAmount.tokenA,
        tokenMaxB: tokenAmount.tokenB,
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: provider.wallet.publicKey,
        position: positionPda.publicKey,
        positionTokenAccount: positionTokenAccountAddress,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArrayLower: tickArrayPda.publicKey,
        tickArrayUpper: tickArrayPda.publicKey,
      })
    ).buildAndExecute();

    const position = (await fetcher.getPosition(positionPda.publicKey, true)) as PositionData;
    assert.ok(position.liquidity.eq(estLiquidityAmount));
  });

  it("fails with zero liquidity amount", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount: ZERO_BN,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(1_000_000),
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
        })
      ).buildAndExecute(),
      /0x177c/ // LiquidityZero
    );
  });

  it("fails when token max a exceeded", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const liquidityAmount = new anchor.BN(6_500_000);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(999_999_999),
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
        })
      ).buildAndExecute(),
      /0x1781/ // TokenMaxExceeded
    );
  });

  it("fails when token max b exceeded", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const liquidityAmount = new anchor.BN(6_500_000);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(999_999_999),
          tokenMaxB: new u64(0),
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
        })
      ).buildAndExecute(),
      /0x1781/ // TokenMaxExceeded
    );
  });

  it("fails when position account does not have exactly 1 token", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    // Create a position token account that contains 0 tokens
    const newPositionTokenAccount = await createTokenAccount(
      provider,
      positionInitInfo.mintKeypair.publicKey,
      provider.wallet.publicKey
    );

    const liquidityAmount = new anchor.BN(6_500_000);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(1_000_000),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: newPositionTokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: positionInitInfo.tickArrayLower,
          tickArrayUpper: positionInitInfo.tickArrayUpper,
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );

    // Send position token to other position token account
    await transfer(provider, positionInitInfo.tokenAccount, newPositionTokenAccount, 1);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(1_000_000),
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
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails when position token account mint does not match position mint", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda, tokenMintA } = poolInitInfo;
    const positionInitInfo = positions[0];

    // Create a position token account that contains 0 tokens
    const invalidPositionTokenAccount = await createAndMintToTokenAccount(provider, tokenMintA, 1);

    const liquidityAmount = new anchor.BN(6_500_000);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(1_000_000),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: invalidPositionTokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: positionInitInfo.tickArrayLower,
          tickArrayUpper: positionInitInfo.tickArrayUpper,
        })
      ).buildAndExecute(),
      /0x7d3/ // A raw constraint was violated
    );
  });

  it("fails when position does not match whirlpool", async () => {
    const tickLowerIndex = 7168;
    const tickUpperIndex = 8960;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;

    const { poolInitInfo: poolInitInfo2 } = await initTestPool(ctx, TickSpacing.Standard);
    const positionInitInfo = await openPosition(
      ctx,
      poolInitInfo2.whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex
    );
    const { positionPda, positionTokenAccount: positionTokenAccountAddress } =
      positionInitInfo.params;

    const {
      params: { tickArrayPda },
    } = await initTickArray(ctx, poolInitInfo2.whirlpoolPda.publicKey, 0);

    const liquidityAmount = new anchor.BN(6_500_000);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(1_000_000),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positionPda.publicKey,
          positionTokenAccount: positionTokenAccountAddress,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        })
      ).buildAndExecute(),
      /0x7d1/ // A has_one constraint was violated
    );
  });

  it("fails when token vaults do not match whirlpool vaults", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda, tokenMintA, tokenMintB } = poolInitInfo;
    const positionInitInfo = positions[0];
    const liquidityAmount = new anchor.BN(6_500_000);

    const fakeVaultA = await createAndMintToTokenAccount(provider, tokenMintA, 1_000);
    const fakeVaultB = await createAndMintToTokenAccount(provider, tokenMintB, 1_000);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(1_000_000),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: positionInitInfo.tokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: fakeVaultA,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: positionInitInfo.tickArrayLower,
          tickArrayUpper: positionInitInfo.tickArrayUpper,
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(1_000_000),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: positionInitInfo.tokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: fakeVaultB,
          tickArrayLower: positionInitInfo.tickArrayLower,
          tickArrayUpper: positionInitInfo.tickArrayUpper,
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails when owner token account mint does not match whirlpool token mint", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];
    const liquidityAmount = new anchor.BN(6_500_000);

    const invalidMint = await createMint(provider);
    const invalidTokenAccount = await createAndMintToTokenAccount(provider, invalidMint, 1_000_000);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(1_000_000),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: positionInitInfo.tokenAccount,
          tokenOwnerAccountA: invalidTokenAccount,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: positionInitInfo.tickArrayLower,
          tickArrayUpper: positionInitInfo.tickArrayUpper,
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(1_000_000),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: positionInitInfo.tokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: invalidTokenAccount,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: positionInitInfo.tickArrayLower,
          tickArrayUpper: positionInitInfo.tickArrayUpper,
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails when position authority is not approved delegate for position token account", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const delegate = anchor.web3.Keypair.generate();

    const liquidityAmount = new anchor.BN(1_250_000);

    await approveToken(provider, tokenAccountA, delegate.publicKey, 1_000_000);
    await approveToken(provider, tokenAccountB, delegate.publicKey, 1_000_000);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(167_000),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: delegate.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: positionInitInfo.tokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: positionInitInfo.tickArrayLower,
          tickArrayUpper: positionInitInfo.tickArrayUpper,
        })
      )
        .addSigner(delegate)
        .buildAndExecute(),
      /0x1783/ // MissingOrInvalidDelegate
    );
  });

  it("fails when position authority is not authorized for exactly 1 token", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const delegate = anchor.web3.Keypair.generate();

    const liquidityAmount = new anchor.BN(1_250_000);

    await approveToken(provider, positionInitInfo.tokenAccount, delegate.publicKey, 0);
    await approveToken(provider, tokenAccountA, delegate.publicKey, 1_000_000);
    await approveToken(provider, tokenAccountB, delegate.publicKey, 1_000_000);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(167_000),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: delegate.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: positionInitInfo.tokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: positionInitInfo.tickArrayLower,
          tickArrayUpper: positionInitInfo.tickArrayUpper,
        })
      )
        .addSigner(delegate)
        .buildAndExecute(),
      /0x1784/ // InvalidPositionTokenAmount
    );
  });

  it("fails when position authority was not a signer", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const delegate = anchor.web3.Keypair.generate();

    const liquidityAmount = new anchor.BN(1_250_000);

    await approveToken(provider, positionInitInfo.tokenAccount, delegate.publicKey, 1);
    await approveToken(provider, tokenAccountA, delegate.publicKey, 1_000_000);
    await approveToken(provider, tokenAccountB, delegate.publicKey, 1_000_000);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(167_000),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: delegate.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: positionInitInfo.tokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: positionInitInfo.tickArrayLower,
          tickArrayUpper: positionInitInfo.tickArrayUpper,
        })
      ).buildAndExecute(),
      /.*signature verification fail.*/i
    );
  });

  it("fails when position authority is not approved for token owner accounts", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const delegate = anchor.web3.Keypair.generate();

    const liquidityAmount = new anchor.BN(1_250_000);

    await approveToken(provider, positionInitInfo.tokenAccount, delegate.publicKey, 1);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(167_000),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: delegate.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: positionInitInfo.tokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: positionInitInfo.tickArrayLower,
          tickArrayUpper: positionInitInfo.tickArrayUpper,
        })
      )
        .addSigner(delegate)
        .buildAndExecute(),
      /0x4/ // owner does not match
    );
  });

  it("fails when tick arrays do not match the position", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
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
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(167_000),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: positionInitInfo.tokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: tickArrayLowerPda.publicKey,
          tickArrayUpper: tickArrayUpperPda.publicKey,
        })
      ).buildAndExecute(),
      /0x1779/ // TicKNotFound
    );
  });

  it("fails when the tick arrays are for a different whirlpool", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const { poolInitInfo: poolInitInfo2 } = await initTestPool(ctx, TickSpacing.Standard);

    const {
      params: { tickArrayPda: tickArrayLowerPda },
    } = await initTickArray(ctx, poolInitInfo2.whirlpoolPda.publicKey, -11264);

    const {
      params: { tickArrayPda: tickArrayUpperPda },
    } = await initTickArray(ctx, poolInitInfo2.whirlpoolPda.publicKey, 0);

    const liquidityAmount = new anchor.BN(1_250_000);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMaxA: new u64(0),
          tokenMaxB: new u64(167_000),
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: positionInitInfo.tokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: tickArrayLowerPda.publicKey,
          tickArrayUpper: tickArrayUpperPda.publicKey,
        })
      ).buildAndExecute(),
      /0x7d1/ // A has one constraint was violated
    );
  });
});
