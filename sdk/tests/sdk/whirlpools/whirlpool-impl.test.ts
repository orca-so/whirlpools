import * as anchor from "@coral-xyz/anchor";
import { MathUtil, Percentage, TransactionBuilder } from "@orca-so/common-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as assert from "assert";
import { BN } from "bn.js";
import Decimal from "decimal.js";
import {
  PDAUtil,
  PriceMath, TickUtil,
  WhirlpoolIx,
  buildWhirlpoolClient,
  collectFeesQuote,
  collectRewardsQuote,
  decreaseLiquidityQuoteByLiquidity,
  increaseLiquidityQuoteByInputToken,
  toTx
} from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import { PREFER_REFRESH } from "../../../src/network/public/account-fetcher";
import {
  ONE_SOL,
  TickSpacing,
  ZERO_BN,
  createAssociatedTokenAccount,
  getTokenBalance,
  sleep,
  systemTransferTx,
  transferToken
} from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import { initTestPool } from "../../utils/init-utils";
import { mintTokensToTestAccount } from "../../utils/test-builders";

describe("whirlpool-impl", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

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

    await initTickArrayTx.buildAndExecute();
    await openIx.buildAndExecute();

    // Verify position exists and numbers fit input parameters
    const positionAddress = PDAUtil.getPosition(ctx.program.programId, positionMint).publicKey;
    const position = await client.getPosition(positionAddress, PREFER_REFRESH);
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
    const txs = await pool.closePosition(positionAddress, Percentage.fromFraction(1, 100));

    for (const tx of txs) {
      await tx.buildAndExecute();
    }

    // Verify position is closed and owner wallet has the tokens back
    const postClosePosition = await fetcher.getPosition(positionAddress, PREFER_REFRESH);
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

    await initTickArrayTx.buildAndExecute();
    await openIx.buildAndExecute();

    // Verify position exists and numbers fit input parameters
    const positionAddress = PDAUtil.getPosition(ctx.program.programId, positionMint).publicKey;
    const position = await client.getPosition(positionAddress, PREFER_REFRESH);
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
    const walletPositionTokenAccount = getAssociatedTokenAddressSync(positionMint, ctx.wallet.publicKey);
    const newOwnerPositionTokenAccount = await createAssociatedTokenAccount(
      ctx.provider,
      positionMint,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );
    await transferToken(provider, walletPositionTokenAccount, newOwnerPositionTokenAccount, 1);

    // [Action] Close Position
    const expectationQuote = await decreaseLiquidityQuoteByLiquidity(
      positionData.liquidity,
      Percentage.fromDecimal(new Decimal(0)),
      position,
      pool
    );

    const destinationWallet = anchor.web3.Keypair.generate();

    const txs = await pool.closePosition(
      positionAddress,
      Percentage.fromFraction(1, 100),
      destinationWallet.publicKey,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );

    let ataTx: TransactionBuilder | undefined;
    let closeTx: TransactionBuilder;
    if (txs.length === 1) {
      closeTx = txs[0];
    } else if (txs.length === 2) {
      ataTx = txs[0];
      closeTx = txs[1];
    } else {
      throw new Error(`Invalid length for txs ${txs}`);
    }

    await ataTx?.buildAndExecute();
    await closeTx.addSigner(otherWallet).buildAndExecute();

    // Verify position is closed and owner wallet has the tokens back
    const postClosePosition = await fetcher.getPosition(positionAddress, PREFER_REFRESH);
    assert.ok(postClosePosition === null);

    const dWalletTokenAAccount = getAssociatedTokenAddressSync(poolData.tokenMintA, destinationWallet.publicKey,);
    const dWalletTokenBAccount = getAssociatedTokenAddressSync(poolData.tokenMintB, destinationWallet.publicKey);

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
    const vaultStartBalance = 1_000_000_000;
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
          vaultAmount: new BN(vaultStartBalance),
        },
        {
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(5)),
          vaultAmount: new BN(vaultStartBalance),
        },
        {
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
          vaultAmount: new BN(vaultStartBalance),
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
        amount: new BN(200_000),
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
        amount: new BN(200_000),
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

    // accrue rewards
    // closePosition does not attempt to create an ATA unless reward has accumulated.
    await sleep(1200);

    const [positionWithFees] = positions;

    // Transfer the position token to another wallet
    const otherWallet = anchor.web3.Keypair.generate();
    const walletPositionTokenAccount = getAssociatedTokenAddressSync(
      positionWithFees.mintKeypair.publicKey,
      ctx.wallet.publicKey,
    );

    const newOwnerPositionTokenAccount = await createAssociatedTokenAccount(
      ctx.provider,
      positionWithFees.mintKeypair.publicKey,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );

    await transferToken(provider, walletPositionTokenAccount, newOwnerPositionTokenAccount, 1);

    const pool = await client.getPool(whirlpoolPda.publicKey, PREFER_REFRESH);
    const position = await client.getPosition(positionWithFees.publicKey, PREFER_REFRESH);
    const positionData = position.getData();
    const poolData = pool.getData();
    const txs = await pool.closePosition(
      positionWithFees.publicKey,
      new Percentage(new BN(10), new BN(100)),
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

    const dWalletTokenAAccount = getAssociatedTokenAddressSync(poolData.tokenMintA, otherWallet.publicKey,);
    const dWalletTokenBAccount = getAssociatedTokenAddressSync(poolData.tokenMintB, otherWallet.publicKey,);
    const rewardAccount0 = getAssociatedTokenAddressSync(poolData.rewardInfos[0].mint, otherWallet.publicKey,);
    const rewardAccount1 = getAssociatedTokenAddressSync(poolData.rewardInfos[1].mint, otherWallet.publicKey,);
    const rewardAccount2 = getAssociatedTokenAddressSync(poolData.rewardInfos[2].mint, otherWallet.publicKey,);

    const feesQuote = collectFeesQuote({
      whirlpool: poolData,
      position: positionData,
      tickLower: position.getLowerTickData(),
      tickUpper: position.getUpperTickData(),
    });

    let ataTx: TransactionBuilder | undefined;
    let closeTx: TransactionBuilder;
    if (txs.length === 1) {
      closeTx = txs[0];
    } else if (txs.length === 2) {
      ataTx = txs[0];
      closeTx = txs[1];
    } else {
      throw new Error(`Invalid length for txs ${txs}`);
    }

    await ataTx?.buildAndExecute();
    const signature = await closeTx.addSigner(otherWallet).buildAndExecute();

    // To calculate the rewards that have accumulated up to the timing of the close,
    // the block time at transaction execution is used.
    // TODO: maxSupportedTransactionVersion needs to come from ctx
    const tx = await ctx.provider.connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0
    });
    const closeTimestampInSeconds = new anchor.BN(tx!.blockTime!.toString());
    const rewardsQuote = collectRewardsQuote({
      whirlpool: poolData,
      position: positionData,
      tickLower: position.getLowerTickData(),
      tickUpper: position.getUpperTickData(),
      timeStampInSeconds: closeTimestampInSeconds,
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

  it("open and add liquidity to a position with SOL as token A, trade against it, transfer position to another wallet, then close the tokens to another wallet", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;
    const vaultStartBalance = 1_000_000_000;
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        { tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000_000) }, // In range position
        { tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: new anchor.BN(1_000_000_000) }, // Out of range position
      ],
      rewards: [
        {
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
          vaultAmount: new BN(vaultStartBalance),
        },
        {
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
          vaultAmount: new BN(vaultStartBalance),
        },
        {
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
          vaultAmount: new BN(vaultStartBalance),
        },
      ],
      tokenAIsNative: true,
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
        amount: new BN(200_000_00),
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
        amount: new BN(200_000_00),
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

    // accrue rewards
    // closePosition does not attempt to create an ATA unless reward has accumulated.
    await sleep(1200);

    const [positionWithFees] = positions;

    // Transfer the position token to another wallet
    const otherWallet = anchor.web3.Keypair.generate();
    const walletPositionTokenAccount = getAssociatedTokenAddressSync(
      positionWithFees.mintKeypair.publicKey,
      ctx.wallet.publicKey,
    );

    const newOwnerPositionTokenAccount = await createAssociatedTokenAccount(
      ctx.provider,
      positionWithFees.mintKeypair.publicKey,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );

    await transferToken(provider, walletPositionTokenAccount, newOwnerPositionTokenAccount, 1);

    const pool = await client.getPool(whirlpoolPda.publicKey, PREFER_REFRESH);
    const position = await client.getPosition(positionWithFees.publicKey, PREFER_REFRESH);
    const positionData = position.getData();
    const poolData = pool.getData();

    const decreaseLiquidityQuote = decreaseLiquidityQuoteByLiquidity(
      position.getData().liquidity,
      Percentage.fromDecimal(new Decimal(0)),
      position,
      pool
    );

    const feesQuote = collectFeesQuote({
      whirlpool: poolData,
      position: positionData,
      tickLower: position.getLowerTickData(),
      tickUpper: position.getUpperTickData(),
    });

    const dWalletTokenBAccount = getAssociatedTokenAddressSync(poolData.tokenMintB, otherWallet.publicKey,);
    const rewardAccount0 = getAssociatedTokenAddressSync(poolData.rewardInfos[0].mint, otherWallet.publicKey,);
    const rewardAccount1 = getAssociatedTokenAddressSync(poolData.rewardInfos[1].mint, otherWallet.publicKey,);
    const rewardAccount2 = getAssociatedTokenAddressSync(poolData.rewardInfos[2].mint, otherWallet.publicKey,);

    const txs = await pool.closePosition(
      positionWithFees.publicKey,
      new Percentage(new BN(10), new BN(100)),
      otherWallet.publicKey,
      otherWallet.publicKey,
      ctx.wallet.publicKey
    );

    let ataTx: TransactionBuilder | undefined;
    let closeTx: TransactionBuilder;
    if (txs.length === 1) {
      closeTx = txs[0];
    } else if (txs.length === 2) {
      ataTx = txs[0];
      closeTx = txs[1];
    } else {
      throw new Error(`Invalid length for txs ${txs}`);
    }

    const otherWalletBalanceBefore = await ctx.connection.getBalance(otherWallet.publicKey);
    const positionAccountBalance = await ctx.connection.getBalance(positionWithFees.publicKey);

    await ataTx?.buildAndExecute();
    const signature = await closeTx.addSigner(otherWallet).buildAndExecute();

    // To calculate the rewards that have accumulated up to the timing of the close,
    // the block time at transaction execution is used.
    // TODO: maxSupportedTransactionVersion needs to come from ctx
    const tx = await ctx.provider.connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
    const closeTimestampInSeconds = new anchor.BN(tx!.blockTime!.toString());
    const rewardsQuote = collectRewardsQuote({
      whirlpool: poolData,
      position: positionData,
      tickLower: position.getLowerTickData(),
      tickUpper: position.getUpperTickData(),
      timeStampInSeconds: closeTimestampInSeconds,
    });

    const otherWalletBalanceAfter = await ctx.connection.getBalance(otherWallet.publicKey);

    const minAccountExempt = await ctx.fetcher.getAccountRentExempt();
    const solReceived = otherWalletBalanceAfter - otherWalletBalanceBefore;

    /**
     * Expected tokenA (SOL) returns on other wallet
     * 1. withdraw value from decrease_liq (decrease_quote, though not always accurate)
     * 2. accrrued fees from trade (fee_quote)
     * 3. Position PDA account rent return (balance from position address account)
     * 4. wSOL rent-exemption close (getAccountExemption)
     * 5. Position token account rent return (getAccountExemption)
     *
     * Other costs from payer, but not received by other wallet
     * 1. close_position tx cost
     * 2. ATA account initialization
     */
    const expectedtokenA = decreaseLiquidityQuote.tokenMinA
      .add(feesQuote.feeOwedA)
      .add(new BN(positionAccountBalance))
      .add(new BN(minAccountExempt))
      .add(new BN(minAccountExempt))
      .toNumber();
    assert.ok(solReceived === expectedtokenA);

    assert.equal(
      await getTokenBalance(ctx.provider, dWalletTokenBAccount),
      decreaseLiquidityQuote.tokenMinB.add(feesQuote.feeOwedB).toString()
    );

    assert.equal(await getTokenBalance(ctx.provider, rewardAccount0), rewardsQuote[0]?.toString());
    assert.equal(await getTokenBalance(ctx.provider, rewardAccount1), rewardsQuote[1]?.toString());
    assert.equal(await getTokenBalance(ctx.provider, rewardAccount2), rewardsQuote[2]?.toString());
  });
});
