import { deriveATA, MathUtil, Percentage, TransactionBuilder } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  collectFeesQuote,
  collectRewardsQuote,
  decreaseLiquidityQuoteByLiquidity,
  increaseLiquidityQuoteByInputToken,
  PDAUtil,
  PriceMath,
  TickArrayUtil,
  TickUtil,
  toTx,
  WhirlpoolIx,
} from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import {
  createAssociatedTokenAccount,
  getTokenBalance,
  ONE_SOL,
  systemTransferTx,
  TickSpacing,
  transfer,
  ZERO_BN,
} from "../../utils";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import { initTestPool } from "../../utils/init-utils";
import { mintTokensToTestAccount } from "../../utils/test-builders";

describe("whirlpool-impl", () => {
  // The default commitment of AnchorProvider is "processed".
  // But commitment of some Token operations is based on “confirmed”, and preflight simulation sometimes fail.
  // So use "confirmed" consistently.
  const provider = anchor.AnchorProvider.local(undefined, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);

  it("open and add liquidity to a position, then close", async () => {
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();

    const { poolInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
      PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6)
    );
    const pool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);

    // Verify token mint info is correct
    const tokenAInfo = pool.getTokenAInfo();
    const tokenBInfo = pool.getTokenBInfo();
    assert.ok(tokenAInfo.mint.equals(poolInitInfo.tokenMintA));
    assert.ok(tokenBInfo.mint.equals(poolInitInfo.tokenMintB));

    // Create and mint tokens in this wallet
    const mintedTokenAmount = 150_000_000;
    const [userTokenAAccount, userTokenBAccount] = await mintTokensToTestAccount(
      ctx.provider,
      tokenAInfo.mint,
      mintedTokenAmount,
      tokenBInfo.mint,
      mintedTokenAmount
    );

    // Open a position with no tick arrays initialized.
    const lowerPrice = new Decimal(96);
    const upperPrice = new Decimal(101);
    const poolData = pool.getData();
    const tokenADecimal = tokenAInfo.decimals;
    const tokenBDecimal = tokenBInfo.decimals;

    const tickLower = TickUtil.getInitializableTickIndex(
      PriceMath.priceToTickIndex(lowerPrice, tokenADecimal, tokenBDecimal),
      poolData.tickSpacing
    );
    const tickUpper = TickUtil.getInitializableTickIndex(
      PriceMath.priceToTickIndex(upperPrice, tokenADecimal, tokenBDecimal),
      poolData.tickSpacing
    );

    const inputTokenMint = poolData.tokenMintA;
    const quote = increaseLiquidityQuoteByInputToken(
      inputTokenMint,
      new Decimal(50),
      tickLower,
      tickUpper,
      Percentage.fromFraction(1, 100),
      pool
    );

    // [Action] Initialize Tick Arrays
    const initTickArrayTx = (
      await pool.initTickArrayForTicks([tickLower, tickUpper], funderKeypair.publicKey)
    )?.addSigner(funderKeypair);

    assert.ok(!!initTickArrayTx);

    // [Action] Open Position (and increase L)
    const { positionMint, tx: openIx } = await pool.openPosition(
      tickLower,
      tickUpper,
      quote,
      ctx.wallet.publicKey,
      funderKeypair.publicKey
    );
    openIx.addSigner(funderKeypair);

    // TODO: We should be using TransactionProcessor after we figure this out
    // https://app.asana.com/0/1200519991815470/1202452931559633/f
    await TransactionBuilder.sendAll(ctx.provider, [initTickArrayTx, openIx]);

    // Verify position exists and numbers fit input parameters
    const positionAddress = PDAUtil.getPosition(ctx.program.programId, positionMint).publicKey;
    const position = await client.getPosition(positionAddress);
    const positionData = position.getData();

    const tickLowerIndex = TickUtil.getInitializableTickIndex(
      PriceMath.priceToTickIndex(lowerPrice, tokenAInfo.decimals, tokenBInfo.decimals),
      poolData.tickSpacing
    );
    const tickUpperIndex = TickUtil.getInitializableTickIndex(
      PriceMath.priceToTickIndex(upperPrice, tokenAInfo.decimals, tokenBInfo.decimals),
      poolData.tickSpacing
    );
    assert.ok(positionData.liquidity.eq(quote.liquidityAmount));
    assert.ok(positionData.tickLowerIndex === tickLowerIndex);
    assert.ok(positionData.tickUpperIndex === tickUpperIndex);
    assert.ok(positionData.positionMint.equals(positionMint));
    assert.ok(positionData.whirlpool.equals(poolInitInfo.whirlpoolPda.publicKey));

    // [Action] Close Position
    const { ataTx, closeTx } = await pool.closePosition(
      positionAddress,
      Percentage.fromFraction(1, 100)
    );

    await ataTx?.buildAndExecute();
    await closeTx.buildAndExecute();

    // Verify position is closed and owner wallet has the tokens back
    const postClosePosition = await fetcher.getPosition(positionAddress, true);
    assert.ok(postClosePosition === null);

    // TODO: we are leaking 1 decimal place of token?
    assert.equal(await getTokenBalance(ctx.provider, userTokenAAccount), mintedTokenAmount - 1);
    assert.equal(await getTokenBalance(ctx.provider, userTokenBAccount), mintedTokenAmount - 1);
  });

  it("open and add liquidity to a position, transfer position to another wallet, then close the tokens to another wallet", async () => {
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();

    const { poolInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
      PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6)
    );
    const pool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);

    // Verify token mint info is correct
    const tokenAInfo = pool.getTokenAInfo();
    const tokenBInfo = pool.getTokenBInfo();
    assert.ok(tokenAInfo.mint.equals(poolInitInfo.tokenMintA));
    assert.ok(tokenBInfo.mint.equals(poolInitInfo.tokenMintB));

    // Create and mint tokens in this wallet
    const mintedTokenAmount = 150_000_000;
    await mintTokensToTestAccount(
      ctx.provider,
      tokenAInfo.mint,
      mintedTokenAmount,
      tokenBInfo.mint,
      mintedTokenAmount
    );

    // Open a position with no tick arrays initialized.
    const lowerPrice = new Decimal(96);
    const upperPrice = new Decimal(101);
    const poolData = pool.getData();
    const tokenADecimal = tokenAInfo.decimals;
    const tokenBDecimal = tokenBInfo.decimals;

    const tickLower = TickUtil.getInitializableTickIndex(
      PriceMath.priceToTickIndex(lowerPrice, tokenADecimal, tokenBDecimal),
      poolData.tickSpacing
    );
    const tickUpper = TickUtil.getInitializableTickIndex(
      PriceMath.priceToTickIndex(upperPrice, tokenADecimal, tokenBDecimal),
      poolData.tickSpacing
    );

    const inputTokenMint = poolData.tokenMintA;
    const depositAmount = new Decimal(50);
    const quote = increaseLiquidityQuoteByInputToken(
      inputTokenMint,
      depositAmount,
      tickLower,
      tickUpper,
      Percentage.fromFraction(1, 100),
      pool
    );

    // [Action] Initialize Tick Arrays
    const initTickArrayTx = (
      await pool.initTickArrayForTicks([tickLower, tickUpper], funderKeypair.publicKey)
    )?.addSigner(funderKeypair);

    assert.ok(!!initTickArrayTx);

    // [Action] Open Position (and increase L)
    const { positionMint, tx: openIx } = await pool.openPosition(
      tickLower,
      tickUpper,
      quote,
      ctx.wallet.publicKey,
      funderKeypair.publicKey
    );
    openIx.addSigner(funderKeypair);

    // TODO: We should be using TransactionProcessor after we figure this out
    // https://app.asana.com/0/1200519991815470/1202452931559633/f
    await TransactionBuilder.sendAll(ctx.provider, [initTickArrayTx, openIx]);

    // Verify position exists and numbers fit input parameters
    const positionAddress = PDAUtil.getPosition(ctx.program.programId, positionMint).publicKey;
    const position = await client.getPosition(positionAddress);
    const positionData = position.getData();

    const tickLowerIndex = TickUtil.getInitializableTickIndex(
      PriceMath.priceToTickIndex(lowerPrice, tokenAInfo.decimals, tokenBInfo.decimals),
      poolData.tickSpacing
    );
    const tickUpperIndex = TickUtil.getInitializableTickIndex(
      PriceMath.priceToTickIndex(upperPrice, tokenAInfo.decimals, tokenBInfo.decimals),
      poolData.tickSpacing
    );
    assert.ok(positionData.liquidity.eq(quote.liquidityAmount));
    assert.ok(positionData.tickLowerIndex === tickLowerIndex);
    assert.ok(positionData.tickUpperIndex === tickUpperIndex);
    assert.ok(positionData.positionMint.equals(positionMint));
    assert.ok(positionData.whirlpool.equals(poolInitInfo.whirlpoolPda.publicKey));

    // Transfer the position token to another wallet
    const otherWallet = anchor.web3.Keypair.generate();
    const walletPositionTokenAccount = await deriveATA(ctx.wallet.publicKey, positionMint);
    const newOwnerPositionTokenAccount = await createAssociatedTokenAccount(
      ctx.provider,
      positionMint,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );
    await transfer(provider, walletPositionTokenAccount, newOwnerPositionTokenAccount, 1);

    // [Action] Close Position
    const expectationQuote = await decreaseLiquidityQuoteByLiquidity(
      positionData.liquidity,
      Percentage.fromDecimal(new Decimal(0)),
      position,
      pool
    );

    const destinationWallet = anchor.web3.Keypair.generate();

    const { ataTx, closeTx } = await pool.closePosition(
      positionAddress,
      Percentage.fromFraction(1, 100),
      destinationWallet.publicKey,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );

    await ataTx?.buildAndExecute();
    await closeTx.addSigner(otherWallet).buildAndExecute();

    // Verify position is closed and owner wallet has the tokens back
    const postClosePosition = await fetcher.getPosition(positionAddress, true);
    assert.ok(postClosePosition === null);

    const dWalletTokenAAccount = await deriveATA(destinationWallet.publicKey, poolData.tokenMintA);
    const dWalletTokenBAccount = await deriveATA(destinationWallet.publicKey, poolData.tokenMintB);

    assert.equal(
      await getTokenBalance(ctx.provider, dWalletTokenAAccount),
      expectationQuote.tokenMinA.toString()
    );
    assert.equal(
      await getTokenBalance(ctx.provider, dWalletTokenBAccount),
      expectationQuote.tokenMinB.toString()
    );
  });

  it("open and add liquidity to a position, trade against it, transfer position to another wallet, then close the tokens to another wallet", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;
    const vaultStartBalance = 1_000_000;
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        { tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) }, // In range position
        { tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: new anchor.BN(1_000_000) }, // Out of range position
      ],
      rewards: [
        {
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
          vaultAmount: new u64(vaultStartBalance),
        },
        {
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
          vaultAmount: new u64(vaultStartBalance),
        },
        {
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
          vaultAmount: new u64(vaultStartBalance),
        },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();

    const tickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpoolPda.publicKey, 22528);
    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    // Accrue fees in token A
    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new u64(200_000),
        otherAmountThreshold: ZERO_BN,
        sqrtPriceLimit: MathUtil.toX64(new Decimal(4)),
        amountSpecifiedIsInput: true,
        aToB: true,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: tokenVaultBKeypair.publicKey,
        tickArray0: tickArrayPda.publicKey,
        tickArray1: tickArrayPda.publicKey,
        tickArray2: tickArrayPda.publicKey,
        oracle: oraclePda.publicKey,
      })
    ).buildAndExecute();

    // Accrue fees in token B
    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new u64(200_000),
        otherAmountThreshold: ZERO_BN,
        sqrtPriceLimit: MathUtil.toX64(new Decimal(5)),
        amountSpecifiedIsInput: true,
        aToB: false,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: tokenVaultBKeypair.publicKey,
        tickArray0: tickArrayPda.publicKey,
        tickArray1: tickArrayPda.publicKey,
        tickArray2: tickArrayPda.publicKey,
        oracle: oraclePda.publicKey,
      })
    ).buildAndExecute();

    const [positionWithFees] = positions;

    // Transfer the position token to another wallet
    const otherWallet = anchor.web3.Keypair.generate();
    const walletPositionTokenAccount = await deriveATA(
      ctx.wallet.publicKey,
      positionWithFees.mintKeypair.publicKey
    );

    const newOwnerPositionTokenAccount = await createAssociatedTokenAccount(
      ctx.provider,
      positionWithFees.mintKeypair.publicKey,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );

    await transfer(provider, walletPositionTokenAccount, newOwnerPositionTokenAccount, 1);

    const pool = await client.getPool(whirlpoolPda.publicKey, true);
    const position = await client.getPosition(positionWithFees.publicKey, true);
    const positionData = position.getData();
    const poolData = pool.getData();
    const { ataTx, closeTx } = await pool.closePosition(
      positionWithFees.publicKey,
      new Percentage(new u64(10), new u64(100)),
      otherWallet.publicKey,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );

    const expectationQuote = decreaseLiquidityQuoteByLiquidity(
      position.getData().liquidity,
      Percentage.fromDecimal(new Decimal(0)),
      position,
      pool
    );

    const dWalletTokenAAccount = await deriveATA(otherWallet.publicKey, poolData.tokenMintA);
    const dWalletTokenBAccount = await deriveATA(otherWallet.publicKey, poolData.tokenMintB);
    const rewardAccount0 = await deriveATA(otherWallet.publicKey, poolData.rewardInfos[0].mint);
    const rewardAccount1 = await deriveATA(otherWallet.publicKey, poolData.rewardInfos[1].mint);
    const rewardAccount2 = await deriveATA(otherWallet.publicKey, poolData.rewardInfos[2].mint);

    await ataTx?.buildAndExecute();
    await closeTx.addSigner(otherWallet).buildAndExecute();

    const tickLowerArrayData = await ctx.fetcher.getTickArray(
      positionWithFees.tickArrayLower,
      true
    );

    const tickUpperArrayData = await ctx.fetcher.getTickArray(
      positionWithFees.tickArrayUpper,
      true
    );

    const tickLower = TickArrayUtil.getTickFromArray(
      tickLowerArrayData!,
      tickLowerIndex,
      tickSpacing
    );

    const tickUpper = TickArrayUtil.getTickFromArray(
      tickUpperArrayData!,
      tickUpperIndex,
      tickSpacing
    );

    const feesQuote = collectFeesQuote({
      whirlpool: poolData,
      position: positionData,
      tickLower,
      tickUpper,
    });

    const rewardsQuote = collectRewardsQuote({
      whirlpool: await pool.refreshData(),
      position: await position.refreshData(),
      tickLower,
      tickUpper,
    });

    assert.equal(
      await getTokenBalance(ctx.provider, dWalletTokenAAccount),
      expectationQuote.tokenMinA.add(feesQuote.feeOwedA).toString()
    );

    assert.equal(
      await getTokenBalance(ctx.provider, dWalletTokenBAccount),
      expectationQuote.tokenMinB.add(feesQuote.feeOwedB).toString()
    );

    assert.equal(await getTokenBalance(ctx.provider, rewardAccount0), rewardsQuote[0]?.toString());
    assert.equal(await getTokenBalance(ctx.provider, rewardAccount1), rewardsQuote[1]?.toString());
    assert.equal(await getTokenBalance(ctx.provider, rewardAccount2), rewardsQuote[2]?.toString());
  });
});
