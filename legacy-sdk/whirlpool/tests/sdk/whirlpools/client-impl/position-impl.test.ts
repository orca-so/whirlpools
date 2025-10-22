import * as anchor from "@coral-xyz/anchor";
import { Percentage } from "@orca-so/common-sdk";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  decreaseLiquidityQuoteByLiquidity,
  increaseLiquidityQuoteByInputTokenUsingPriceSlippage,
  LockConfigUtil,
  PriceMath,
  TickUtil,
} from "../../../../src";
import type { WhirlpoolContext } from "../../../../src/context";
import { IGNORE_CACHE } from "../../../../src/network/public/fetcher";
import {
  createAssociatedTokenAccount,
  TickSpacing,
  transferToken,
} from "../../../utils";
import { initPosition } from "../../../utils/test-builders";
import { TokenExtensionUtil } from "../../../../src/utils/public/token-extension-util";
import type { TokenTrait } from "../../../utils/v2/init-utils-v2";
import { initTestPoolV2, useMaxCU } from "../../../utils/v2/init-utils-v2";
import { mintTokensToTestAccountV2 } from "../../../utils/v2/token-2022";
import {
  initializeLiteSVMEnvironment,
  pollForCondition,
} from "../../../utils/litesvm";

describe("position-impl", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];
  let client: ReturnType<typeof buildWhirlpoolClient>;

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
    client = buildWhirlpoolClient(ctx);
    anchor.setProvider(provider);
  });

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
        )
          .prependInstruction(useMaxCU()) // TransferHook require much CU
          .buildAndExecute();

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
        )
          .prependInstruction(useMaxCU()) // TransferHook require much CU
          .buildAndExecute();

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
        )
          .prependInstruction(useMaxCU()) // TransferHook require much CU
          .buildAndExecute();

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
          .prependInstruction(useMaxCU()) // TransferHook require much CU
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
          .prependInstruction(useMaxCU()) // TransferHook require much CU
          .buildAndExecute();

        const postWithdrawData = await position.refreshData();
        const expectedPostWithdrawLiquidity =
          postSecondIncreaseData.liquidity.sub(decrease_quote.liquidityAmount);
        assert.equal(
          postWithdrawData.liquidity.toString(),
          expectedPostWithdrawLiquidity.toString(),
        );
      });

      it("increase and decrease liquidity on position (position with TokenExtensions)", async () => {
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
          undefined,
          true, // withTokenExtensions
        );

        // [Action] Increase liquidity by 70 tokens of tokenB
        const position = await client.getPosition(
          positionAddress.publicKey,
          IGNORE_CACHE,
        );

        // Verify position mint is owned by Token-2022
        const positionMint = await fetcher.getMintInfo(
          position.getData().positionMint,
          IGNORE_CACHE,
        );
        assert.ok(positionMint?.tokenProgram.equals(TOKEN_2022_PROGRAM_ID));

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
        )
          .prependInstruction(useMaxCU()) // TransferHook require much CU
          .buildAndExecute();

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
        )
          .prependInstruction(useMaxCU()) // TransferHook require much CU
          .buildAndExecute();

        const postWithdrawData = await position.refreshData();
        const expectedPostWithdrawLiquidity = postIncreaseData.liquidity.sub(
          decrease_quote.liquidityAmount,
        );
        assert.equal(
          postWithdrawData.liquidity.toString(),
          expectedPostWithdrawLiquidity.toString(),
        );
      });
    });
  });

  it("lock a TokenExtensions based position", async () => {
    const tokenTraitA = { isToken2022: true };
    const tokenTraitB = { isToken2022: false };
    const { poolInitInfo } = await initTestPoolV2(
      ctx,
      tokenTraitA,
      tokenTraitB,
      TickSpacing.Standard,
      PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
    );

    // Create and mint tokens in this wallet
    await mintTokensToTestAccountV2(
      ctx.provider,
      poolInitInfo.tokenMintA,
      tokenTraitA,
      10_500_000_000,
      poolInitInfo.tokenMintB,
      tokenTraitB,
      10_500_000_000,
    );

    const pool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);

    // [Action] Initialize Tick Arrays
    const [lowerTick, upperTick] = TickUtil.getFullRangeTickIndex(
      pool.getData().tickSpacing,
    );
    const initTickArrayTx = (await pool.initTickArrayForTicks([
      lowerTick,
      upperTick,
    ]))!;
    await initTickArrayTx.buildAndExecute();

    // [Action] Create a position (FullRange)
    const lowerPrice = PriceMath.tickIndexToPrice(
      lowerTick,
      pool.getTokenAInfo().decimals,
      pool.getTokenBInfo().decimals,
    );
    const upperPrice = PriceMath.tickIndexToPrice(
      upperTick,
      pool.getTokenAInfo().decimals,
      pool.getTokenBInfo().decimals,
    );
    const { positionAddress } = await initPosition(
      ctx,
      pool,
      lowerPrice,
      upperPrice,
      poolInitInfo.tokenMintA,
      50,
      undefined,
      true, // withTokenExtensions
    );

    const position = await client.getPosition(
      positionAddress.publicKey,
      IGNORE_CACHE,
    );

    // Wait for position to be fully initialized and synced
    const syncedPositionData = await pollForCondition(
      () => fetcher.getPosition(positionAddress.publicKey, IGNORE_CACHE),
      (p) =>
        !!p &&
        p.liquidity.gtn(0) &&
        p.tickLowerIndex === lowerTick &&
        p.tickUpperIndex === upperTick,
      {
        accountToReload: positionAddress.publicKey,
        connection: ctx.connection,
      },
    );

    // Position is not empty
    assert.ok(syncedPositionData!.liquidity.gtn(0));
    // Position ticks should match initializable ticks derived from prices
    const expectedLowerTickIndex = PriceMath.priceToInitializableTickIndex(
      lowerPrice,
      pool.getTokenAInfo().decimals,
      pool.getTokenBInfo().decimals,
      pool.getData().tickSpacing,
    );
    const expectedUpperTickIndex = PriceMath.priceToInitializableTickIndex(
      upperPrice,
      pool.getTokenAInfo().decimals,
      pool.getTokenBInfo().decimals,
      pool.getData().tickSpacing,
    );
    assert.ok(syncedPositionData!.tickLowerIndex === expectedLowerTickIndex);
    assert.ok(syncedPositionData!.tickUpperIndex === expectedUpperTickIndex);

    const positionTokenAccount = getAssociatedTokenAddressSync(
      position.getData().positionMint,
      ctx.wallet.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    const preState = await fetcher.getTokenInfo(
      positionTokenAccount,
      IGNORE_CACHE,
    );
    assert.ok(preState && !preState.isFrozen);

    const preLockConfig = await position.getLockConfigData();
    assert.ok(preLockConfig === null);

    // [Action] Lock the position
    await (
      await position.lock(
        LockConfigUtil.getPermanentLockType(),
        ctx.wallet.publicKey,
      )
    ).buildAndExecute();

    // Verify the position is locked
    const postState = await fetcher.getTokenInfo(
      positionTokenAccount,
      IGNORE_CACHE,
    );
    assert.ok(postState && postState.isFrozen);

    const postLockConfig = await position.getLockConfigData();
    assert.ok(postLockConfig);
    assert.ok(postLockConfig.position.equals(position.getAddress()));
  });
});
