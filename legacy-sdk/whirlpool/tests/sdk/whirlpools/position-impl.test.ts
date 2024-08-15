import * as anchor from "@coral-xyz/anchor";
import { Percentage } from "@orca-so/common-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  decreaseLiquidityQuoteByLiquidity,
  increaseLiquidityQuoteByInputTokenUsingPriceSlippage,
  PriceMath,
} from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import {
  createAssociatedTokenAccount,
  TickSpacing,
  transferToken,
} from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { initPosition } from "../../utils/test-builders";
import { TokenExtensionUtil } from "../../../src/utils/public/token-extension-util";
import type { TokenTrait } from "../../utils/v2/init-utils-v2";
import { initTestPoolV2 } from "../../utils/v2/init-utils-v2";
import { mintTokensToTestAccountV2 } from "../../utils/v2/token-2022";

describe("position-impl", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);

  const tokenTraitVariations: {
    tokenTraitA: TokenTrait;
    tokenTraitB: TokenTrait;
  }[] = [
    {
      tokenTraitA: { isToken2022: false },
      tokenTraitB: { isToken2022: false },
    },
    {
      tokenTraitA: { isToken2022: true },
      tokenTraitB: { isToken2022: false },
    },
    {
      tokenTraitA: { isToken2022: false },
      tokenTraitB: { isToken2022: true },
    },
    {
      // TransferHook is most difficult extension in transaction size
      tokenTraitA: { isToken2022: true, hasTransferHookExtension: true },
      tokenTraitB: { isToken2022: true, hasTransferHookExtension: true },
    },
  ];
  tokenTraitVariations.forEach((tokenTraits) => {
    describe(`tokenTraitA: ${
      tokenTraits.tokenTraitA.isToken2022 ? "Token2022" : "Token"
    }, tokenTraitB: ${
      tokenTraits.tokenTraitB.isToken2022 ? "Token2022" : "Token"
    }`, () => {
      it("increase and decrease liquidity on position", async () => {
        const { poolInitInfo } = await initTestPoolV2(
          ctx,
          tokenTraits.tokenTraitA,
          tokenTraits.tokenTraitB,
          TickSpacing.Standard,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
        );

        // Create and mint tokens in this wallet
        await mintTokensToTestAccountV2(
          ctx.provider,
          poolInitInfo.tokenMintA,
          tokenTraits.tokenTraitA,
          10_500_000_000,
          poolInitInfo.tokenMintB,
          tokenTraits.tokenTraitB,
          10_500_000_000,
        );

        const pool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);
        const lowerTick = PriceMath.priceToTickIndex(
          new Decimal(89),
          pool.getTokenAInfo().decimals,
          pool.getTokenBInfo().decimals,
        );
        const upperTick = PriceMath.priceToTickIndex(
          new Decimal(120),
          pool.getTokenAInfo().decimals,
          pool.getTokenBInfo().decimals,
        );

        // [Action] Initialize Tick Arrays
        const initTickArrayTx = (await pool.initTickArrayForTicks([
          lowerTick,
          upperTick,
        ]))!;
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
          50,
        );

        // [Action] Increase liquidity by 70 tokens of tokenB
        const position = await client.getPosition(
          positionAddress.publicKey,
          IGNORE_CACHE,
        );
        const preIncreaseData = position.getData();
        const increase_quote =
          increaseLiquidityQuoteByInputTokenUsingPriceSlippage(
            poolInitInfo.tokenMintB,
            new Decimal(70),
            lowerTick,
            upperTick,
            Percentage.fromFraction(1, 100),
            pool,
            await TokenExtensionUtil.buildTokenExtensionContext(
              fetcher,
              pool.getData(),
              IGNORE_CACHE,
            ),
          );

        await (
          await position.increaseLiquidity(
            increase_quote,
            false,
            ctx.wallet.publicKey,
          )
        ).buildAndExecute();

        const postIncreaseData = await position.refreshData();
        const expectedPostIncreaseLiquidity = preIncreaseData.liquidity.add(
          increase_quote.liquidityAmount,
        );
        assert.equal(
          postIncreaseData.liquidity.toString(),
          expectedPostIncreaseLiquidity.toString(),
        );

        // [Action] Withdraw half of the liquidity away from the position and verify
        const withdrawHalf = postIncreaseData.liquidity.div(new anchor.BN(2));
        const decrease_quote = decreaseLiquidityQuoteByLiquidity(
          withdrawHalf,
          Percentage.fromFraction(0, 100),
          position,
          pool,
          await TokenExtensionUtil.buildTokenExtensionContext(
            fetcher,
            pool.getData(),
            IGNORE_CACHE,
          ),
        );

        await (
          await position.decreaseLiquidity(decrease_quote, false)
        ).buildAndExecute();

        const postWithdrawData = await position.refreshData();
        const expectedPostWithdrawLiquidity = postIncreaseData.liquidity.sub(
          decrease_quote.liquidityAmount,
        );
        assert.equal(
          postWithdrawData.liquidity.toString(),
          expectedPostWithdrawLiquidity.toString(),
        );
      });

      it("increase & decrease liquidity on position with a different destination, position wallet", async () => {
        const { poolInitInfo } = await initTestPoolV2(
          ctx,
          tokenTraits.tokenTraitA,
          tokenTraits.tokenTraitB,
          TickSpacing.Standard,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
        );

        // Create and mint tokens in this wallet
        await mintTokensToTestAccountV2(
          ctx.provider,
          poolInitInfo.tokenMintA,
          tokenTraits.tokenTraitA,
          10_500_000_000,
          poolInitInfo.tokenMintB,
          tokenTraits.tokenTraitB,
          10_500_000_000,
        );

        const pool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);
        const lowerTick = PriceMath.priceToTickIndex(
          new Decimal(89),
          pool.getTokenAInfo().decimals,
          pool.getTokenBInfo().decimals,
        );
        const upperTick = PriceMath.priceToTickIndex(
          new Decimal(120),
          pool.getTokenAInfo().decimals,
          pool.getTokenBInfo().decimals,
        );

        // [Action] Initialize Tick Arrays
        const initTickArrayTx = (await pool.initTickArrayForTicks([
          lowerTick,
          upperTick,
        ]))!;
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
          50,
        );

        // [Action] Increase liquidity by 70 tokens of tokenB & create the ATA in the new source Wallet
        const position = await client.getPosition(
          positionAddress.publicKey,
          IGNORE_CACHE,
        );
        const preIncreaseData = position.getData();
        const increase_quote =
          increaseLiquidityQuoteByInputTokenUsingPriceSlippage(
            poolInitInfo.tokenMintB,
            new Decimal(70),
            lowerTick,
            upperTick,
            Percentage.fromFraction(1, 100),
            pool,
            await TokenExtensionUtil.buildTokenExtensionContext(
              fetcher,
              pool.getData(),
              IGNORE_CACHE,
            ),
          );

        await (
          await position.increaseLiquidity(increase_quote, false)
        ).buildAndExecute();

        const postIncreaseData = await position.refreshData();
        const expectedPostIncreaseLiquidity = preIncreaseData.liquidity.add(
          increase_quote.liquidityAmount,
        );
        assert.equal(
          postIncreaseData.liquidity.toString(),
          expectedPostIncreaseLiquidity.toString(),
        );

        // [Action] Withdraw half of the liquidity away from the position and verify
        const withdrawHalf = postIncreaseData.liquidity.div(new anchor.BN(2));
        const decrease_quote = await decreaseLiquidityQuoteByLiquidity(
          withdrawHalf,
          Percentage.fromFraction(0, 100),
          position,
          pool,
          await TokenExtensionUtil.buildTokenExtensionContext(
            fetcher,
            pool.getData(),
            IGNORE_CACHE,
          ),
        );

        // Transfer the position token to another wallet
        const otherWallet = anchor.web3.Keypair.generate();
        const walletPositionTokenAccount = getAssociatedTokenAddressSync(
          positionMint,
          ctx.wallet.publicKey,
        );
        const newOwnerPositionTokenAccount = await createAssociatedTokenAccount(
          ctx.provider,
          positionMint,
          otherWallet.publicKey,
          ctx.wallet.publicKey,
        );
        await transferToken(
          provider,
          walletPositionTokenAccount,
          newOwnerPositionTokenAccount,
          1,
        );

        // Mint to this other wallet and increase more tokens
        await mintTokensToTestAccountV2(
          ctx.provider,
          poolInitInfo.tokenMintA,
          tokenTraits.tokenTraitA,
          10_500_000_000,
          poolInitInfo.tokenMintB,
          tokenTraits.tokenTraitB,
          10_500_000_000,
          otherWallet.publicKey,
        );
        const increaseQuoteFromOtherWallet =
          increaseLiquidityQuoteByInputTokenUsingPriceSlippage(
            poolInitInfo.tokenMintB,
            new Decimal(80),
            lowerTick,
            upperTick,
            Percentage.fromFraction(1, 100),
            pool,
            await TokenExtensionUtil.buildTokenExtensionContext(
              fetcher,
              pool.getData(),
              IGNORE_CACHE,
            ),
          );
        await (
          await position.increaseLiquidity(
            increaseQuoteFromOtherWallet,
            true,
            otherWallet.publicKey,
            otherWallet.publicKey,
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
            otherWallet.publicKey,
          )
        )
          .addSigner(otherWallet)
          .buildAndExecute();

        const postWithdrawData = await position.refreshData();
        const expectedPostWithdrawLiquidity =
          postSecondIncreaseData.liquidity.sub(decrease_quote.liquidityAmount);
        assert.equal(
          postWithdrawData.liquidity.toString(),
          expectedPostWithdrawLiquidity.toString(),
        );
      });
    });
  });
});
