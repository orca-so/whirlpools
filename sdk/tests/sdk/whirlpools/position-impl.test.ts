import * as anchor from "@project-serum/anchor";
import * as assert from "assert";
import { WhirlpoolContext } from "../../../src/context";
import { initTestPool } from "../../utils/init-utils";
import { TickSpacing } from "../../utils";
import {
  AccountFetcher,
  buildWhirlpoolClient,
  decreaseLiquidityQuoteByLiquidity,
  increaseLiquidityQuoteByInputToken,
  PriceMath,
} from "../../../src";
import Decimal from "decimal.js";
import { Percentage } from "@orca-so/common-sdk";
import { initPosition, mintTokensToTestAccount } from "../../utils/test-builders";

describe("position-impl", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = new AccountFetcher(ctx.connection);
  const client = buildWhirlpoolClient(ctx, fetcher);

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
    const initTickArrayTx = await pool.initTickArrayForTicks([lowerTick, upperTick]);
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
    const position = await client.getPosition(positionAddress.publicKey);
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
      await position.increaseLiquidity(increase_quote, ctx.wallet.publicKey, ctx.wallet.publicKey)
    ).buildAndExecute();

    const postIncreaseData = await position.refreshData();
    const expectedPostIncreaseLiquidity = preIncreaseData.liquidity.add(
      increase_quote.liquidityAmount
    );
    assert.equal(postIncreaseData.liquidity.toString(), expectedPostIncreaseLiquidity.toString());

    // [Action] Withdraw half of the liquidity away from the position and verify
    const withdrawHalf = postIncreaseData.liquidity.div(new anchor.BN(2));
    const decrease_quote = await decreaseLiquidityQuoteByLiquidity(
      withdrawHalf,
      Percentage.fromFraction(1, 100),
      position,
      pool
    );

    await (
      await position.decreaseLiquidity(decrease_quote, ctx.wallet.publicKey, ctx.wallet.publicKey)
    ).buildAndExecute();

    const postWithdrawData = await position.refreshData();
    const expectedPostWithdrawLiquidity = postIncreaseData.liquidity.sub(
      decrease_quote.liquidityAmount
    );
    assert.equal(postWithdrawData.liquidity.toString(), expectedPostWithdrawLiquidity.toString());
  });
});
