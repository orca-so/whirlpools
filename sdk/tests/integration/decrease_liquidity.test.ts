import * as anchor from "@coral-xyz/anchor";
import { MathUtil, Percentage } from "@orca-so/common-sdk";
import { u64 } from "@solana/spl-token";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  PositionData,
  TickArrayData,
  WhirlpoolContext,
  WhirlpoolData,
  WhirlpoolIx,
  toTx
} from "../../src";
import { decreaseLiquidityQuoteByLiquidityWithParams } from "../../src/quotes/public/decrease-liquidity-quote";
import {
  TickSpacing,
  ZERO_BN,
  approveToken,
  assertTick,
  createAndMintToTokenAccount,
  createMint,
  createTokenAccount,
  sleep,
  transfer
} from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { WhirlpoolTestFixture } from "../utils/fixture";
import { initTestPool, initTickArray, openPosition } from "../utils/init-utils";

describe("decrease_liquidity", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  it("successfully decrease liquidity from position in one tick array", async () => {
    const liquidityAmount = new anchor.BN(1_250_000);
    const tickLower = 7168,
      tickUpper = 8960;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1.48)),
      positions: [{ tickLowerIndex: tickLower, tickUpperIndex: tickUpper, liquidityAmount }],
    });
    const { poolInitInfo, tokenAccountA, tokenAccountB, positions } = fixture.getInfos();
    const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } = poolInitInfo;
    const poolBefore = (await fetcher.getPool(whirlpoolPda.publicKey, true)) as WhirlpoolData;

    // To check if rewardLastUpdatedTimestamp is updated
    await sleep(1200);

    const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
      liquidity: new anchor.BN(1_000_000),
      sqrtPrice: poolBefore.sqrtPrice,
      slippageTolerance: Percentage.fromFraction(1, 100),
      tickCurrentIndex: poolBefore.tickCurrentIndex,
      tickLowerIndex: tickLower,
      tickUpperIndex: tickUpper,
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
      })
    ).buildAndExecute();

    const remainingLiquidity = liquidityAmount.sub(removalQuote.liquidityAmount);
    const poolAfter = (await fetcher.getPool(whirlpoolPda.publicKey, true)) as WhirlpoolData;
    assert.ok(poolAfter.rewardLastUpdatedTimestamp.gt(poolBefore.rewardLastUpdatedTimestamp));
    assert.ok(poolAfter.liquidity.eq(remainingLiquidity));

    const position = await fetcher.getPosition(positions[0].publicKey, true);
    assert.ok(position?.liquidity.eq(remainingLiquidity));

    const tickArray = (await fetcher.getTickArray(
      positions[0].tickArrayLower,
      true
    )) as TickArrayData;
    assertTick(tickArray.ticks[56], true, remainingLiquidity, remainingLiquidity);
    assertTick(tickArray.ticks[70], true, remainingLiquidity, remainingLiquidity.neg());
  });

  it("successfully decrease liquidity from position in two tick arrays", async () => {
    const liquidityAmount = new anchor.BN(1_250_000);
    const tickLower = -1280,
      tickUpper = 1280;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } = poolInitInfo;
    const position = positions[0];
    const poolBefore = (await fetcher.getPool(whirlpoolPda.publicKey, true)) as WhirlpoolData;

    const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
      liquidity: new anchor.BN(1_000_000),
      sqrtPrice: poolBefore.sqrtPrice,
      slippageTolerance: Percentage.fromFraction(1, 100),
      tickCurrentIndex: poolBefore.tickCurrentIndex,
      tickLowerIndex: tickLower,
      tickUpperIndex: tickUpper,
    });

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
      })
    ).buildAndExecute();

    const remainingLiquidity = liquidityAmount.sub(removalQuote.liquidityAmount);
    const poolAfter = (await fetcher.getPool(whirlpoolPda.publicKey, true)) as WhirlpoolData;

    assert.ok(poolAfter.rewardLastUpdatedTimestamp.gte(poolBefore.rewardLastUpdatedTimestamp));
    assert.ok(poolAfter.liquidity.eq(remainingLiquidity));

    const positionAfter = (await fetcher.getPosition(position.publicKey, true)) as PositionData;
    assert.ok(positionAfter.liquidity.eq(remainingLiquidity));

    const tickArrayLower = (await fetcher.getTickArray(
      position.tickArrayLower,
      true
    )) as TickArrayData;
    assertTick(tickArrayLower.ticks[78], true, remainingLiquidity, remainingLiquidity);
    const tickArrayUpper = (await fetcher.getTickArray(
      position.tickArrayUpper,
      true
    )) as TickArrayData;
    assertTick(tickArrayUpper.ticks[10], true, remainingLiquidity, remainingLiquidity.neg());
  });

  it("successfully decrease liquidity with approved delegate", async () => {
    const liquidityAmount = new anchor.BN(1_250_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const position = positions[0];

    const delegate = anchor.web3.Keypair.generate();

    await approveToken(provider, positions[0].tokenAccount, delegate.publicKey, 1);
    await approveToken(provider, tokenAccountA, delegate.publicKey, 1_000_000);
    await approveToken(provider, tokenAccountB, delegate.publicKey, 1_000_000);

    const removeAmount = new anchor.BN(1_000_000);

    await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
        liquidityAmount: removeAmount,
        tokenMinA: new u64(0),
        tokenMinB: new u64(0),
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
      })
    )
      .addSigner(delegate)
      .buildAndExecute();
  });

  it("successfully decrease liquidity with owner even if there is approved delegate", async () => {
    const liquidityAmount = new anchor.BN(1_250_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1.48)),
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const position = positions[0];

    const delegate = anchor.web3.Keypair.generate();

    await approveToken(provider, positions[0].tokenAccount, delegate.publicKey, 1);
    await approveToken(provider, tokenAccountA, delegate.publicKey, 1_000_000);
    await approveToken(provider, tokenAccountB, delegate.publicKey, 1_000_000);

    const removeAmount = new anchor.BN(1_000_000);

    await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
        liquidityAmount: removeAmount,
        tokenMinA: new u64(0),
        tokenMinB: new u64(0),
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
      })
    ).buildAndExecute();
  });

  it("successfully decrease liquidity with transferred position token", async () => {
    const liquidityAmount = new anchor.BN(1_250_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1.48)),
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const position = positions[0];

    const removeAmount = new anchor.BN(1_000_000);
    const newOwner = anchor.web3.Keypair.generate();
    const newOwnerPositionTokenAccount = await createTokenAccount(
      provider,
      position.mintKeypair.publicKey,
      newOwner.publicKey
    );
    await transfer(provider, position.tokenAccount, newOwnerPositionTokenAccount, 1);

    await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
        liquidityAmount: removeAmount,
        tokenMinA: new u64(0),
        tokenMinB: new u64(0),
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
      })
    )
      .addSigner(newOwner)
      .buildAndExecute();
  });

  it("fails when liquidity amount is zero", async () => {
    const liquidityAmount = new anchor.BN(1_250_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } = poolInitInfo;
    const position = positions[0];

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount: new anchor.BN(0),
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
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
        })
      ).buildAndExecute(),
      /0x177c/ // LiquidityZero
    );
  });

  it("fails when position has insufficient liquidity for the withdraw amount", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } = poolInitInfo;
    const position = positions[0];

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount: new anchor.BN(1_000),
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
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
        })
      ).buildAndExecute(),
      /0x177f/ // LiquidityUnderflow
    );
  });

  it("fails when token min a subceeded", async () => {
    const liquidityAmount = new anchor.BN(1_250_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(0.005)),
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } = poolInitInfo;
    const position = positions[0];

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new u64(1_000_000),
          tokenMinB: new u64(0),
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
        })
      ).buildAndExecute(),
      /0x1782/ // TokenMinSubceeded
    );
  });

  it("fails when token min b subceeded", async () => {
    const liquidityAmount = new anchor.BN(1_250_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(5)),
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } = poolInitInfo;
    const position = positions[0];
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new u64(0),
          tokenMinB: new u64(1_000_000),
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
        })
      ).buildAndExecute(),
      /0x1782/ // TokenMinSubceeded
    );
  });

  it("fails when position account does not have exactly 1 token", async () => {
    const liquidityAmount = new anchor.BN(1_250_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const position = positions[0];

    // Create a position token account that contains 0 tokens
    const newPositionTokenAccount = await createTokenAccount(
      provider,
      positions[0].mintKeypair.publicKey,
      provider.wallet.publicKey
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
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
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );

    // Send position token to other position token account
    await transfer(provider, position.tokenAccount, newPositionTokenAccount, 1);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
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
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails when position token account mint does not match position mint", async () => {
    const liquidityAmount = new anchor.BN(6_500_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda, tokenMintA } = poolInitInfo;
    const position = positions[0];

    const invalidPositionTokenAccount = await createAndMintToTokenAccount(provider, tokenMintA, 1);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
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
        })
      ).buildAndExecute(),
      /0x7d3/ // A raw constraint was violated
    );
  });

  it("fails when position does not match whirlpool", async () => {
    const liquidityAmount = new anchor.BN(6_500_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const tickArray = positions[0].tickArrayLower;

    const { poolInitInfo: poolInitInfo2 } = await initTestPool(ctx, TickSpacing.Standard);
    const {
      params: { positionPda, positionTokenAccount: positionTokenAccountAddress },
    } = await openPosition(ctx, poolInitInfo2.whirlpoolPda.publicKey, 7168, 8960);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
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
        })
      ).buildAndExecute(),
      /0x7d1/ // A has_one constraint was violated
    );
  });

  it("fails when token vaults do not match whirlpool vaults", async () => {
    const liquidityAmount = new anchor.BN(6_500_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda, tokenMintA, tokenMintB } = poolInitInfo;
    const position = positions[0];

    const fakeVaultA = await createAndMintToTokenAccount(provider, tokenMintA, 1_000);
    const fakeVaultB = await createAndMintToTokenAccount(provider, tokenMintB, 1_000);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
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
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
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
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails when owner token account mint does not match whirlpool token mint", async () => {
    const liquidityAmount = new anchor.BN(6_500_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const invalidMint = await createMint(provider);
    const invalidTokenAccount = await createAndMintToTokenAccount(provider, invalidMint, 1_000_000);
    const position = positions[0];

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
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
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount,
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
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
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails when position authority is not approved delegate for position token account", async () => {
    const liquidityAmount = new anchor.BN(6_500_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
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
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
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
        })
      )
        .addSigner(delegate)
        .buildAndExecute(),
      /0x1783/ // MissingOrInvalidDelegate
    );
  });

  it("fails when position authority is not authorized for exactly 1 token", async () => {
    const liquidityAmount = new anchor.BN(6_500_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
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
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
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
        })
      )
        .addSigner(delegate)
        .buildAndExecute(),
      /0x1784/ // InvalidPositionTokenAmount
    );
  });

  it("fails when position authority was not a signer", async () => {
    const liquidityAmount = new anchor.BN(6_500_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
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
          tokenMinA: new u64(0),
          tokenMinB: new u64(167_000),
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
        })
      ).buildAndExecute(),
      /.*signature verification fail.*/i
    );
  });

  it("fails when tick arrays do not match the position", async () => {
    const liquidityAmount = new anchor.BN(6_500_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
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
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
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
        })
      ).buildAndExecute(),
      /0x1779/ // TicKNotFound
    );
  });

  it("fails when the tick arrays are for a different whirlpool", async () => {
    const liquidityAmount = new anchor.BN(6_500_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(2.2)),
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const position = positions[0];

    const { poolInitInfo: poolInitInfo2 } = await initTestPool(ctx, TickSpacing.Standard);

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
          tokenMinA: new u64(0),
          tokenMinB: new u64(0),
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
        })
      ).buildAndExecute(),
      /0x7d1/ // A has one constraint was violated
    );
  });
});
