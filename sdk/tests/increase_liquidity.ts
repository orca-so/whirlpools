import * as anchor from "@project-serum/anchor";
import { WhirlpoolClient } from "../src/client";
import { WhirlpoolContext } from "../src/context";
import * as assert from "assert";
import { initTestPool, initTickArray, openPosition } from "./utils/init-utils";
import {
  approveToken,
  createAndMintToTokenAccount,
  createMint,
  createTokenAccount,
  getTokenBalance,
  transfer,
} from "./utils/token";
import {
  estimateLiquidityFromTokenAmounts,
  getStartTickIndex,
  getTickArrayPda,
  tickIndexToSqrtPriceX64,
  toTokenAmount,
  toX64,
  TransactionBuilder,
} from "../src";
import Decimal from "decimal.js";
import { u64 } from "@solana/spl-token";
import { assertTick, MAX_U64, TickSpacing, ZERO_BN } from "./utils";
import { WhirlpoolTestFixture } from "./utils/fixture";
import { BN } from "@project-serum/anchor";
import { buildIncreaseLiquidityIx } from "../src/instructions/increase-liquidity-ix";
import {
  buildOpenPositionIx,
  buildOpenPositionWithMetadataIx,
} from "../src/instructions/open-position-ix";
import {
  generateDefaultInitTickArrayParams,
  generateDefaultOpenPositionParams,
} from "./utils/test-builders";
import { buildInitTickArrayIx } from "../src/instructions/initialize-tick-array-ix";

describe("increase_liquidity", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  it("increase liquidity of a position spanning two tick arrays", async () => {
    const currTick = 0;
    const tickLowerIndex = -1280,
      tickUpperIndex = 1280;
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN }],
      initialSqrtPrice: tickIndexToSqrtPriceX64(currTick),
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const poolBefore = await client.getPool(whirlpoolPda.publicKey);
    const tokenAmount = toTokenAmount(167_000, 167_000);
    const liquidityAmount = estimateLiquidityFromTokenAmounts(
      currTick,
      tickLowerIndex,
      tickUpperIndex,
      tokenAmount
    );

    await client
      .increaseLiquidityTx({
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
      .buildAndExecute();

    const position = await client.getPosition(positionInitInfo.publicKey);
    assert.ok(position.liquidity.eq(liquidityAmount));

    const poolAfter = await client.getPool(whirlpoolPda.publicKey);
    assert.ok(poolAfter.rewardLastUpdatedTimestamp.gte(poolBefore.rewardLastUpdatedTimestamp));
    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      tokenAmount.tokenA.toString()
    );
    assert.equal(
      await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      tokenAmount.tokenB.toString()
    );
    assert.ok(poolAfter.liquidity.eq(new BN(liquidityAmount)));

    const tickArrayLower = await client.getTickArray(positionInitInfo.tickArrayLower);
    assertTick(tickArrayLower.ticks[78], true, liquidityAmount, liquidityAmount);
    const tickArrayUpper = await client.getTickArray(positionInitInfo.tickArrayUpper);
    assertTick(tickArrayUpper.ticks[10], true, liquidityAmount, liquidityAmount.neg());
  });

  it("increase liquidity of a position contained in one tick array", async () => {
    const currTick = 500;
    const tickLowerIndex = 7168;
    const tickUpperIndex = 8960;
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN }],
      initialSqrtPrice: tickIndexToSqrtPriceX64(currTick),
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];
    const poolBefore = await client.getPool(whirlpoolPda.publicKey);

    const tokenAmount = toTokenAmount(1_000_000, 0);
    const liquidityAmount = estimateLiquidityFromTokenAmounts(
      currTick,
      tickLowerIndex,
      tickUpperIndex,
      tokenAmount
    );

    await client
      .increaseLiquidityTx({
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
    const position = await client.getPosition(positionInitInfo.publicKey);
    assert.ok(position.liquidity.eq(expectedLiquidity));

    const tickArray = await client.getTickArray(positionInitInfo.tickArrayLower);

    assertTick(tickArray.ticks[56], true, expectedLiquidity, expectedLiquidity);
    assertTick(tickArray.ticks[70], true, expectedLiquidity, expectedLiquidity.neg());

    const poolAfter = await client.getPool(whirlpoolPda.publicKey);
    assert.ok(poolAfter.rewardLastUpdatedTimestamp.gte(poolBefore.rewardLastUpdatedTimestamp));
    assert.equal(poolAfter.liquidity, 0);
  });

  it("initialize and increase liquidity of a position in a single transaction", async () => {
    const currTick = 500;
    const tickLowerIndex = 7168;
    const tickUpperIndex = 8960;
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: tickIndexToSqrtPriceX64(currTick),
    });
    const { poolInitInfo, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda, tickSpacing } = poolInitInfo;
    const poolBefore = await client.getPool(whirlpoolPda.publicKey);

    const tokenAmount = toTokenAmount(1_000_000, 0);
    const liquidityAmount = estimateLiquidityFromTokenAmounts(
      currTick,
      tickLowerIndex,
      tickUpperIndex,
      tokenAmount
    );

    const { params, mint } = await generateDefaultOpenPositionParams(
      client.context,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
      context.wallet.publicKey
    );

    const tickArrayLower = getTickArrayPda(
      client.context.program.programId,
      whirlpoolPda.publicKey,
      getStartTickIndex(tickLowerIndex, tickSpacing)
    ).publicKey;

    const tickArrayUpper = getTickArrayPda(
      client.context.program.programId,
      whirlpoolPda.publicKey,
      getStartTickIndex(tickUpperIndex, tickSpacing)
    ).publicKey;

    await new TransactionBuilder(client.context.provider)
      // TODO: create a ComputeBudgetInstruction to request more compute
      .addInstruction(
        buildInitTickArrayIx(
          client.context,
          generateDefaultInitTickArrayParams(
            client.context,
            whirlpoolPda.publicKey,
            getStartTickIndex(tickLowerIndex, tickSpacing)
          )
        )
      )
      // .addInstruction(
      //   buildInitTickArrayIx(client.context, generateDefaultInitTickArrayParams(
      //     client.context,
      //     whirlpoolPda.publicKey,
      //     getStartTickIndex(pos[0].tickLowerIndex + TICK_ARRAY_SIZE * tickSpacing, tickSpacing),
      //   ))
      // )
      .addInstruction(buildOpenPositionIx(client.context, params))
      // .addInstruction(
      //   buildOpenPositionWithMetadataIx(client.context, params)
      // )
      .addSigner(mint)
      .addInstruction(
        buildIncreaseLiquidityIx(client.context, {
          liquidityAmount,
          tokenMaxA: tokenAmount.tokenA,
          tokenMaxB: tokenAmount.tokenB,
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: params.positionPda.publicKey,
          positionTokenAccount: params.positionTokenAccountAddress,
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
    const position = await client.getPosition(params.positionPda.publicKey);
    assert.ok(position.liquidity.eq(expectedLiquidity));

    const tickArray = await client.getTickArray(tickArrayLower);

    assertTick(tickArray.ticks[56], true, expectedLiquidity, expectedLiquidity);
    assertTick(tickArray.ticks[70], true, expectedLiquidity, expectedLiquidity.neg());

    const poolAfter = await client.getPool(whirlpoolPda.publicKey);
    assert.ok(poolAfter.rewardLastUpdatedTimestamp.gte(poolBefore.rewardLastUpdatedTimestamp));
    assert.equal(poolAfter.liquidity, 0);
  });

  it("increase liquidity of a position with an approved position authority delegate", async () => {
    const currTick = 1300;
    const tickLowerIndex = -1280,
      tickUpperIndex = 1280;
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN }],
      initialSqrtPrice: tickIndexToSqrtPriceX64(currTick),
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const poolBefore = await client.getPool(whirlpoolPda.publicKey);
    const tokenAmount = toTokenAmount(0, 167_000);
    const liquidityAmount = estimateLiquidityFromTokenAmounts(
      currTick,
      tickLowerIndex,
      tickUpperIndex,
      tokenAmount
    );

    const delegate = anchor.web3.Keypair.generate();
    await approveToken(provider, positionInitInfo.tokenAccount, delegate.publicKey, 1);
    await approveToken(provider, tokenAccountA, delegate.publicKey, 1_000_000);
    await approveToken(provider, tokenAccountB, delegate.publicKey, 1_000_000);

    await client
      .increaseLiquidityTx({
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
      .addSigner(delegate)
      .buildAndExecute();

    const position = await client.getPosition(positionInitInfo.publicKey);
    assert.ok(position.liquidity.eq(liquidityAmount));

    const poolAfter = await client.getPool(whirlpoolPda.publicKey);
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

    const tickArrayLower = await client.getTickArray(positionInitInfo.tickArrayLower);
    assertTick(tickArrayLower.ticks[78], true, liquidityAmount, liquidityAmount);
    const tickArrayUpper = await client.getTickArray(positionInitInfo.tickArrayUpper);
    assertTick(tickArrayUpper.ticks[10], true, liquidityAmount, liquidityAmount.neg());
  });

  it("add maximum amount of liquidity near minimum price", async () => {
    const currTick = -443621;
    const { poolInitInfo } = await initTestPool(
      client,
      TickSpacing.Stable,
      tickIndexToSqrtPriceX64(currTick)
    );

    const { tokenMintA, tokenMintB, whirlpoolPda } = poolInitInfo;
    const tokenAccountA = await createAndMintToTokenAccount(provider, tokenMintA, MAX_U64);
    const tokenAccountB = await createAndMintToTokenAccount(provider, tokenMintB, MAX_U64);

    const {
      params: { tickArrayPda },
    } = await initTickArray(client, whirlpoolPda.publicKey, -444224);

    const tickLowerIndex = -443632;
    const tickUpperIndex = -443624;
    const positionInfo = await openPosition(
      client,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex
    );
    const { positionPda, positionTokenAccountAddress } = positionInfo.params;

    const tokenAmount = {
      tokenA: new u64(0),
      tokenB: MAX_U64,
    };
    const estLiquidityAmount = estimateLiquidityFromTokenAmounts(
      currTick,
      tickLowerIndex,
      tickUpperIndex,
      tokenAmount
    );

    await client
      .increaseLiquidityTx({
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
      .buildAndExecute();

    const position = await client.getPosition(positionPda.publicKey);
    assert.ok(position.liquidity.eq(estLiquidityAmount));
  });

  it("add maximum amount of liquidity near maximum price", async () => {
    const currTick = 443635;
    const { poolInitInfo } = await initTestPool(
      client,
      TickSpacing.Stable,
      tickIndexToSqrtPriceX64(currTick)
    );

    const { tokenMintA, tokenMintB, whirlpoolPda } = poolInitInfo;
    const tokenAccountA = await createAndMintToTokenAccount(provider, tokenMintA, MAX_U64);
    const tokenAccountB = await createAndMintToTokenAccount(provider, tokenMintB, MAX_U64);

    const {
      params: { tickArrayPda },
    } = await initTickArray(client, whirlpoolPda.publicKey, 436480);

    const tickLowerIndex = 436488;
    const tickUpperIndex = 436496;
    const positionInfo = await openPosition(
      client,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex
    );
    const { positionPda, positionTokenAccountAddress } = positionInfo.params;

    const tokenAmount = {
      tokenA: new u64(0),
      tokenB: MAX_U64,
    };
    const estLiquidityAmount = estimateLiquidityFromTokenAmounts(
      currTick,
      tickLowerIndex,
      tickUpperIndex,
      tokenAmount
    );

    await client
      .increaseLiquidityTx({
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
      .buildAndExecute();

    const position = await client.getPosition(positionPda.publicKey);
    assert.ok(position.liquidity.eq(estLiquidityAmount));
  });

  it("fails with zero liquidity amount", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .buildAndExecute(),
      /0x177c/ // LiquidityZero
    );
  });

  it("fails when token max a exceeded", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: toX64(new Decimal(1)),
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const liquidityAmount = new u64(6_500_000);

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .buildAndExecute(),
      /0x1781/ // TokenMaxExceeded
    );
  });

  it("fails when token max b exceeded", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const liquidityAmount = new u64(6_500_000);

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .buildAndExecute(),
      /0x1781/ // TokenMaxExceeded
    );
  });

  it("fails when position account does not have exactly 1 token", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
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

    const liquidityAmount = new u64(6_500_000);

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );

    // Send position token to other position token account
    await transfer(provider, positionInitInfo.tokenAccount, newPositionTokenAccount, 1);

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails when position token account mint does not match position mint", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda, tokenMintA } = poolInitInfo;
    const positionInitInfo = positions[0];

    // Create a position token account that contains 0 tokens
    const invalidPositionTokenAccount = await createAndMintToTokenAccount(provider, tokenMintA, 1);

    const liquidityAmount = new u64(6_500_000);

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .buildAndExecute(),
      /0x7d3/ // A raw constraint was violated
    );
  });

  it("fails when position does not match whirlpool", async () => {
    const tickLowerIndex = 7168;
    const tickUpperIndex = 8960;
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;

    const { poolInitInfo: poolInitInfo2 } = await initTestPool(client, TickSpacing.Standard);
    const positionInitInfo = await openPosition(
      client,
      poolInitInfo2.whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex
    );
    const { positionPda, positionTokenAccountAddress } = positionInitInfo.params;

    const {
      params: { tickArrayPda },
    } = await initTickArray(client, poolInitInfo2.whirlpoolPda.publicKey, 0);

    const liquidityAmount = new u64(6_500_000);

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .buildAndExecute(),
      /0x7d1/ // A has_one constraint was violated
    );
  });

  it("fails when token vaults do not match whirlpool vaults", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda, tokenMintA, tokenMintB } = poolInitInfo;
    const positionInitInfo = positions[0];
    const liquidityAmount = new u64(6_500_000);

    const fakeVaultA = await createAndMintToTokenAccount(provider, tokenMintA, 1_000);
    const fakeVaultB = await createAndMintToTokenAccount(provider, tokenMintB, 1_000);

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails when owner token account mint does not match whirlpool token mint", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: 7168, tickUpperIndex: 8960, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];
    const liquidityAmount = new u64(6_500_000);

    const invalidMint = await createMint(provider);
    const invalidTokenAccount = await createAndMintToTokenAccount(provider, invalidMint, 1_000_000);

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails when position authority is not approved delegate for position token account", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const delegate = anchor.web3.Keypair.generate();

    const liquidityAmount = new u64(1_250_000);

    await approveToken(provider, tokenAccountA, delegate.publicKey, 1_000_000);
    await approveToken(provider, tokenAccountB, delegate.publicKey, 1_000_000);

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .addSigner(delegate)
        .buildAndExecute(),
      /0x1783/ // MissingOrInvalidDelegate
    );
  });

  it("fails when position authority is not authorized for exactly 1 token", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const delegate = anchor.web3.Keypair.generate();

    const liquidityAmount = new u64(1_250_000);

    await approveToken(provider, positionInitInfo.tokenAccount, delegate.publicKey, 0);
    await approveToken(provider, tokenAccountA, delegate.publicKey, 1_000_000);
    await approveToken(provider, tokenAccountB, delegate.publicKey, 1_000_000);

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .addSigner(delegate)
        .buildAndExecute(),
      /0x1784/ // InvalidPositionTokenAmount
    );
  });

  it("fails when position authority was not a signer", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const delegate = anchor.web3.Keypair.generate();

    const liquidityAmount = new u64(1_250_000);

    await approveToken(provider, positionInitInfo.tokenAccount, delegate.publicKey, 1);
    await approveToken(provider, tokenAccountA, delegate.publicKey, 1_000_000);
    await approveToken(provider, tokenAccountB, delegate.publicKey, 1_000_000);

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .buildAndExecute(),
      /Signature verification failed/
    );
  });

  it("fails when position authority is not approved for token owner accounts", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const delegate = anchor.web3.Keypair.generate();

    const liquidityAmount = new u64(1_250_000);

    await approveToken(provider, positionInitInfo.tokenAccount, delegate.publicKey, 1);

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .addSigner(delegate)
        .buildAndExecute(),
      /0x4/ // owner does not match
    );
  });

  it("fails when tick arrays do not match the position", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const {
      params: { tickArrayPda: tickArrayLowerPda },
    } = await initTickArray(client, whirlpoolPda.publicKey, 11264);

    const {
      params: { tickArrayPda: tickArrayUpperPda },
    } = await initTickArray(client, whirlpoolPda.publicKey, 22528);

    const liquidityAmount = new u64(1_250_000);

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .buildAndExecute(),
      /0x1779/ // TicKNotFound
    );
  });

  it("fails when the tick arrays are for a different whirlpool", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: ZERO_BN }],
    });
    const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;
    const positionInitInfo = positions[0];

    const { poolInitInfo: poolInitInfo2 } = await initTestPool(client, TickSpacing.Standard);

    const {
      params: { tickArrayPda: tickArrayLowerPda },
    } = await initTickArray(client, poolInitInfo2.whirlpoolPda.publicKey, -11264);

    const {
      params: { tickArrayPda: tickArrayUpperPda },
    } = await initTickArray(client, poolInitInfo2.whirlpoolPda.publicKey, 0);

    const liquidityAmount = new u64(1_250_000);

    await assert.rejects(
      client
        .increaseLiquidityTx({
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
        .buildAndExecute(),
      /0x7d1/ // A has one constraint was violated
    );
  });
});
