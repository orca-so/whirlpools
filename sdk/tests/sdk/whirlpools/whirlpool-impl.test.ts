import { deriveATA, Percentage, TransactionBuilder } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  decreaseLiquidityQuoteByLiquidity,
  increaseLiquidityQuoteByInputToken,
  PDAUtil,
  PriceMath,
  TickUtil,
} from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import {
  createAssociatedTokenAccount,
  getTokenBalance,
  ONE_SOL,
  systemTransferTx,
  TickSpacing,
  transfer,
} from "../../utils";
import { initTestPool } from "../../utils/init-utils";
import { mintTokensToTestAccount } from "../../utils/test-builders";

describe("whirlpool-impl", () => {
  // The default commitment of AnchorProvider is "processed".
  // But commitment of some Token operations is based on “confirmed”, and preflight simulation sometimes fail.
  // So use "confirmed" consistently.
  const provider = anchor.AnchorProvider.local(undefined, {commitment: "confirmed", preflightCommitment: "confirmed"});
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
    await (
      await pool.closePosition(positionAddress, Percentage.fromFraction(1, 100))
    ).buildAndExecute();

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
    await (
      await pool.closePosition(
        positionAddress,
        Percentage.fromFraction(1, 100),
        destinationWallet.publicKey,
        otherWallet.publicKey,
        ctx.wallet.publicKey
      )
    )
      .addSigner(otherWallet)
      .buildAndExecute();

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
});
