import * as anchor from "@coral-xyz/anchor";
import { Percentage } from "@orca-so/common-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  decreaseLiquidityQuoteByLiquidity,
  increaseLiquidityQuoteByInputToken,
  PriceMath
} from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import { createAssociatedTokenAccount, TickSpacing, transferToken } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { initTestPool } from "../../utils/init-utils";
import { initPosition, mintTokensToTestAccount } from "../../utils/test-builders";

describe("position-impl", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);

  it("increase and decrease liquidity on position", async () => {
    const { poolInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
      PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6)
    );

    // Create and mint tokens in this wallet
    await mintTokensToTestAccount(
      ctx.provider,
      poolInitInfo.tokenMintA,
      10_500_000_000,
      poolInitInfo.tokenMintB,
      10_500_000_000
    );

    const pool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const lowerTick = PriceMath.priceToTickIndex(
      new Decimal(89),
      pool.getTokenAInfo().decimals,
      pool.getTokenBInfo().decimals
    );
    const upperTick = PriceMath.priceToTickIndex(
      new Decimal(120),
      pool.getTokenAInfo().decimals,
      pool.getTokenBInfo().decimals
    );

    // [Action] Initialize Tick Arrays
    const initTickArrayTx = (await pool.initTickArrayForTicks([lowerTick, upperTick]))!;
    await initTickArrayTx.buildAndExecute();

    // [Action] Create a position at price 89, 120 with 50 token A
    const lowerPrice = new Decimal(89);
    const upperPrice = new Decimal(120);
    const { positionAddress } = await initPosition(
      ctx,
      pool,
      lowerPrice,
      upperPrice,
      poolInitInfo.tokenMintA,
      50
    );

    // [Action] Increase liquidity by 70 tokens of tokenB
    const position = await client.getPosition(positionAddress.publicKey, true);
    const preIncreaseData = position.getData();
    const increase_quote = increaseLiquidityQuoteByInputToken(
      poolInitInfo.tokenMintB,
      new Decimal(70),
      lowerTick,
      upperTick,
      Percentage.fromFraction(1, 100),
      pool
    );

    await (
      await position.increaseLiquidity(increase_quote, false, ctx.wallet.publicKey)
    ).buildAndExecute();

    const postIncreaseData = await position.refreshData();
    const expectedPostIncreaseLiquidity = preIncreaseData.liquidity.add(
      increase_quote.liquidityAmount
    );
    assert.equal(postIncreaseData.liquidity.toString(), expectedPostIncreaseLiquidity.toString());

    // [Action] Withdraw half of the liquidity away from the position and verify
    const withdrawHalf = postIncreaseData.liquidity.div(new anchor.BN(2));
    const decrease_quote = decreaseLiquidityQuoteByLiquidity(
      withdrawHalf,
      Percentage.fromFraction(0, 100),
      position,
      pool
    );

    await (await position.decreaseLiquidity(decrease_quote, false)).buildAndExecute();

    const postWithdrawData = await position.refreshData();
    const expectedPostWithdrawLiquidity = postIncreaseData.liquidity.sub(
      decrease_quote.liquidityAmount
    );
    assert.equal(postWithdrawData.liquidity.toString(), expectedPostWithdrawLiquidity.toString());
  });

  it("increase & decrease liquidity on position with a different destination, position wallet", async () => {
    const { poolInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
      PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6)
    );

    // Create and mint tokens in this wallet
    await mintTokensToTestAccount(
      ctx.provider,
      poolInitInfo.tokenMintA,
      10_500_000_000,
      poolInitInfo.tokenMintB,
      10_500_000_000
    );

    const pool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const lowerTick = PriceMath.priceToTickIndex(
      new Decimal(89),
      pool.getTokenAInfo().decimals,
      pool.getTokenBInfo().decimals
    );
    const upperTick = PriceMath.priceToTickIndex(
      new Decimal(120),
      pool.getTokenAInfo().decimals,
      pool.getTokenBInfo().decimals
    );

    // [Action] Initialize Tick Arrays
    const initTickArrayTx = (await pool.initTickArrayForTicks([lowerTick, upperTick]))!;
    await initTickArrayTx.buildAndExecute();

    // [Action] Create a position at price 89, 120 with 50 token A
    const lowerPrice = new Decimal(89);
    const upperPrice = new Decimal(120);
    const { positionMint, positionAddress } = await initPosition(
      ctx,
      pool,
      lowerPrice,
      upperPrice,
      poolInitInfo.tokenMintA,
      50
    );

    // [Action] Increase liquidity by 70 tokens of tokenB & create the ATA in the new source Wallet
    const position = await client.getPosition(positionAddress.publicKey, true);
    const preIncreaseData = position.getData();
    const increase_quote = increaseLiquidityQuoteByInputToken(
      poolInitInfo.tokenMintB,
      new Decimal(70),
      lowerTick,
      upperTick,
      Percentage.fromFraction(1, 100),
      pool
    );

    await (await position.increaseLiquidity(increase_quote, false)).buildAndExecute();

    const postIncreaseData = await position.refreshData();
    const expectedPostIncreaseLiquidity = preIncreaseData.liquidity.add(
      increase_quote.liquidityAmount
    );
    assert.equal(postIncreaseData.liquidity.toString(), expectedPostIncreaseLiquidity.toString());

    // [Action] Withdraw half of the liquidity away from the position and verify
    const withdrawHalf = postIncreaseData.liquidity.div(new anchor.BN(2));
    const decrease_quote = await decreaseLiquidityQuoteByLiquidity(
      withdrawHalf,
      Percentage.fromFraction(0, 100),
      position,
      pool
    );

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

    // Mint to this other wallet and increase more tokens
    await mintTokensToTestAccount(
      ctx.provider,
      poolInitInfo.tokenMintA,
      10_500_000_000,
      poolInitInfo.tokenMintB,
      10_500_000_000,
      otherWallet.publicKey
    );
    const increaseQuoteFromOtherWallet = increaseLiquidityQuoteByInputToken(
      poolInitInfo.tokenMintB,
      new Decimal(80),
      lowerTick,
      upperTick,
      Percentage.fromFraction(1, 100),
      pool
    );
    await (
      await position.increaseLiquidity(
        increaseQuoteFromOtherWallet,
        true,
        otherWallet.publicKey,
        otherWallet.publicKey
      )
    )
      .addSigner(otherWallet)
      .buildAndExecute();

    const postSecondIncreaseData = await position.refreshData();

    // Withdraw liquidity into another wallet
    const destinationWallet = anchor.web3.Keypair.generate();
    await (
      await position.decreaseLiquidity(
        decrease_quote,
        true,
        destinationWallet.publicKey,
        otherWallet.publicKey
      )
    )
      .addSigner(otherWallet)
      .buildAndExecute();

    const postWithdrawData = await position.refreshData();
    const expectedPostWithdrawLiquidity = postSecondIncreaseData.liquidity.sub(
      decrease_quote.liquidityAmount
    );
    assert.equal(postWithdrawData.liquidity.toString(), expectedPostWithdrawLiquidity.toString());
  });
});
