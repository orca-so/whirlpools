import * as anchor from "@coral-xyz/anchor";
import { MathUtil, Percentage } from "@orca-so/common-sdk";
import {
  createBurnInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as assert from "assert";
import BN from "bn.js";
import Decimal from "decimal.js";
import {
  PDAUtil,
  PriceMath,
  TickUtil,
  WhirlpoolIx,
  buildWhirlpoolClient,
  collectFeesQuote,
  collectRewardsQuote,
  decreaseLiquidityQuoteByLiquidity,
  increaseLiquidityQuoteByInputToken,
  increaseLiquidityQuoteByInputTokenUsingPriceSlippage,
  swapQuoteByInputToken,
  toTx,
} from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import {
  ONE_SOL,
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TOKEN_PROGRAM_ID,
  TickSpacing,
  ZERO_BN,
  createAssociatedTokenAccount,
  getTokenBalance,
  sleep,
  systemTransferTx,
  transferToken,
} from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import { TokenExtensionUtil } from "../../../src/utils/public/token-extension-util";
import type { TokenTrait } from "../../utils/v2/init-utils-v2";
import { initTestPoolV2, useMaxCU } from "../../utils/v2/init-utils-v2";
import { mintTokensToTestAccountV2 } from "../../utils/v2/token-2022";
import { WhirlpoolTestFixtureV2 } from "../../utils/v2/fixture-v2";
import { ASSOCIATED_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";

describe("whirlpool-impl", () => {
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
      it("open and add liquidity to a position, then close [TokenAmount Slippage]", async () => {
        const funderKeypair = anchor.web3.Keypair.generate();
        await systemTransferTx(
          provider,
          funderKeypair.publicKey,
          ONE_SOL,
        ).buildAndExecute();

        const { poolInitInfo } = await initTestPoolV2(
          ctx,
          tokenTraits.tokenTraitA,
          tokenTraits.tokenTraitB,
          TickSpacing.Standard,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
        );
        const pool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);

        // Verify token mint info is correct
        const tokenAInfo = pool.getTokenAInfo();
        const tokenBInfo = pool.getTokenBInfo();
        assert.ok(tokenAInfo.mint.equals(poolInitInfo.tokenMintA));
        assert.ok(tokenBInfo.mint.equals(poolInitInfo.tokenMintB));

        // Create and mint tokens in this wallet
        const mintedTokenAmount = 150_000_000;
        const [userTokenAAccount, userTokenBAccount] =
          await mintTokensToTestAccountV2(
            ctx.provider,
            tokenAInfo.mint,
            tokenTraits.tokenTraitA,
            mintedTokenAmount,
            tokenBInfo.mint,
            tokenTraits.tokenTraitB,
            mintedTokenAmount,
          );

        // Open a position with no tick arrays initialized.
        const lowerPrice = new Decimal(96);
        const upperPrice = new Decimal(101);
        const poolData = pool.getData();
        const tokenADecimal = tokenAInfo.decimals;
        const tokenBDecimal = tokenBInfo.decimals;

        const tickLower = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(lowerPrice, tokenADecimal, tokenBDecimal),
          poolData.tickSpacing,
        );
        const tickUpper = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(upperPrice, tokenADecimal, tokenBDecimal),
          poolData.tickSpacing,
        );

        const inputTokenMint = poolData.tokenMintA;
        const quote = increaseLiquidityQuoteByInputToken(
          inputTokenMint,
          new Decimal(50),
          tickLower,
          tickUpper,
          Percentage.fromFraction(1, 100),
          pool,
          await TokenExtensionUtil.buildTokenExtensionContext(
            fetcher,
            poolData,
            IGNORE_CACHE,
          ),
        );

        // [Action] Initialize Tick Arrays
        const initTickArrayTx = (
          await pool.initTickArrayForTicks(
            [tickLower, tickUpper],
            funderKeypair.publicKey,
          )
        )?.addSigner(funderKeypair);

        assert.ok(!!initTickArrayTx);

        // [Action] Open Position (and increase L)
        const { positionMint, tx: openIx } = await pool.openPosition(
          tickLower,
          tickUpper,
          quote,
          ctx.wallet.publicKey,
          funderKeypair.publicKey,
        );
        openIx.addSigner(funderKeypair);

        await initTickArrayTx.buildAndExecute();
        await openIx.buildAndExecute();

        // Verify position exists and numbers fit input parameters
        const positionAddress = PDAUtil.getPosition(
          ctx.program.programId,
          positionMint,
        ).publicKey;
        const position = await client.getPosition(
          positionAddress,
          IGNORE_CACHE,
        );
        const positionData = position.getData();

        const tickLowerIndex = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(
            lowerPrice,
            tokenAInfo.decimals,
            tokenBInfo.decimals,
          ),
          poolData.tickSpacing,
        );
        const tickUpperIndex = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(
            upperPrice,
            tokenAInfo.decimals,
            tokenBInfo.decimals,
          ),
          poolData.tickSpacing,
        );
        assert.ok(positionData.liquidity.eq(quote.liquidityAmount));
        assert.ok(positionData.tickLowerIndex === tickLowerIndex);
        assert.ok(positionData.tickUpperIndex === tickUpperIndex);
        assert.ok(positionData.positionMint.equals(positionMint));
        assert.ok(
          positionData.whirlpool.equals(poolInitInfo.whirlpoolPda.publicKey),
        );

        // [Action] Close Position
        const txs = await pool.closePosition(
          positionAddress,
          Percentage.fromFraction(1, 100),
        );

        for (const tx of txs) {
          await tx.buildAndExecute();
        }

        // Verify position is closed and owner wallet has the tokens back
        const postClosePosition = await fetcher.getPosition(
          positionAddress,
          IGNORE_CACHE,
        );
        assert.ok(postClosePosition === null);

        // TODO: we are leaking 1 decimal place of token?
        assert.equal(
          await getTokenBalance(ctx.provider, userTokenAAccount),
          mintedTokenAmount - 1,
        );
        assert.equal(
          await getTokenBalance(ctx.provider, userTokenBAccount),
          mintedTokenAmount - 1,
        );
      });

      it("open and add liquidity to a position, transfer position to another wallet, then close the tokens to another wallet [TokenAmount Slippage]", async () => {
        const funderKeypair = anchor.web3.Keypair.generate();
        await systemTransferTx(
          provider,
          funderKeypair.publicKey,
          ONE_SOL,
        ).buildAndExecute();

        const { poolInitInfo } = await initTestPoolV2(
          ctx,
          tokenTraits.tokenTraitA,
          tokenTraits.tokenTraitB,
          TickSpacing.Standard,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
        );
        const pool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);

        // Verify token mint info is correct
        const tokenAInfo = pool.getTokenAInfo();
        const tokenBInfo = pool.getTokenBInfo();
        assert.ok(tokenAInfo.mint.equals(poolInitInfo.tokenMintA));
        assert.ok(tokenBInfo.mint.equals(poolInitInfo.tokenMintB));

        // Create and mint tokens in this wallet
        const mintedTokenAmount = 150_000_000;
        await mintTokensToTestAccountV2(
          ctx.provider,
          tokenAInfo.mint,
          tokenTraits.tokenTraitA,
          mintedTokenAmount,
          tokenBInfo.mint,
          tokenTraits.tokenTraitB,
          mintedTokenAmount,
        );

        // Open a position with no tick arrays initialized.
        const lowerPrice = new Decimal(96);
        const upperPrice = new Decimal(101);
        const poolData = pool.getData();
        const tokenADecimal = tokenAInfo.decimals;
        const tokenBDecimal = tokenBInfo.decimals;

        const tickLower = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(lowerPrice, tokenADecimal, tokenBDecimal),
          poolData.tickSpacing,
        );
        const tickUpper = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(upperPrice, tokenADecimal, tokenBDecimal),
          poolData.tickSpacing,
        );

        const inputTokenMint = poolData.tokenMintA;
        const depositAmount = new Decimal(50);
        const quote = increaseLiquidityQuoteByInputToken(
          inputTokenMint,
          depositAmount,
          tickLower,
          tickUpper,
          Percentage.fromFraction(1, 100),
          pool,
          await TokenExtensionUtil.buildTokenExtensionContext(
            fetcher,
            poolData,
            IGNORE_CACHE,
          ),
        );

        // [Action] Initialize Tick Arrays
        const initTickArrayTx = (
          await pool.initTickArrayForTicks(
            [tickLower, tickUpper],
            funderKeypair.publicKey,
          )
        )?.addSigner(funderKeypair);

        assert.ok(!!initTickArrayTx);

        // [Action] Open Position (and increase L)
        const { positionMint, tx: openIx } = await pool.openPosition(
          tickLower,
          tickUpper,
          quote,
          ctx.wallet.publicKey,
          funderKeypair.publicKey,
        );
        openIx.addSigner(funderKeypair);

        await initTickArrayTx.buildAndExecute();
        await openIx.buildAndExecute();

        // Verify position exists and numbers fit input parameters
        const positionAddress = PDAUtil.getPosition(
          ctx.program.programId,
          positionMint,
        ).publicKey;
        const position = await client.getPosition(
          positionAddress,
          IGNORE_CACHE,
        );
        const positionData = position.getData();

        const tickLowerIndex = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(
            lowerPrice,
            tokenAInfo.decimals,
            tokenBInfo.decimals,
          ),
          poolData.tickSpacing,
        );
        const tickUpperIndex = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(
            upperPrice,
            tokenAInfo.decimals,
            tokenBInfo.decimals,
          ),
          poolData.tickSpacing,
        );
        assert.ok(positionData.liquidity.eq(quote.liquidityAmount));
        assert.ok(positionData.tickLowerIndex === tickLowerIndex);
        assert.ok(positionData.tickUpperIndex === tickUpperIndex);
        assert.ok(positionData.positionMint.equals(positionMint));
        assert.ok(
          positionData.whirlpool.equals(poolInitInfo.whirlpoolPda.publicKey),
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

        // [Action] Close Position
        const expectationQuote = await decreaseLiquidityQuoteByLiquidity(
          positionData.liquidity,
          Percentage.fromDecimal(new Decimal(0)),
          position,
          pool,
          await TokenExtensionUtil.buildTokenExtensionContext(
            fetcher,
            poolData,
            IGNORE_CACHE,
          ),
        );

        const destinationWallet = anchor.web3.Keypair.generate();

        const txs = await pool.closePosition(
          positionAddress,
          Percentage.fromFraction(1, 100),
          destinationWallet.publicKey,
          otherWallet.publicKey,
          ctx.wallet.publicKey,
        );

        for (const tx of txs) {
          await tx.addSigner(otherWallet).buildAndExecute();
        }

        // Verify position is closed and owner wallet has the tokens back
        const postClosePosition = await fetcher.getPosition(
          positionAddress,
          IGNORE_CACHE,
        );
        assert.ok(postClosePosition === null);

        const tokenProgramA = tokenTraits.tokenTraitA.isToken2022
          ? TEST_TOKEN_2022_PROGRAM_ID
          : TEST_TOKEN_PROGRAM_ID;
        const tokenProgramB = tokenTraits.tokenTraitB.isToken2022
          ? TEST_TOKEN_2022_PROGRAM_ID
          : TEST_TOKEN_PROGRAM_ID;
        const dWalletTokenAAccount = getAssociatedTokenAddressSync(
          poolData.tokenMintA,
          destinationWallet.publicKey,
          undefined,
          tokenProgramA,
        );
        const dWalletTokenBAccount = getAssociatedTokenAddressSync(
          poolData.tokenMintB,
          destinationWallet.publicKey,
          undefined,
          tokenProgramB,
        );

        assert.equal(
          await getTokenBalance(ctx.provider, dWalletTokenAAccount),
          expectationQuote.tokenMinA.toString(),
        );
        assert.equal(
          await getTokenBalance(ctx.provider, dWalletTokenBAccount),
          expectationQuote.tokenMinB.toString(),
        );
      });

      it("open and add liquidity to a position, then close [Price Slippage]", async () => {
        const funderKeypair = anchor.web3.Keypair.generate();
        await systemTransferTx(
          provider,
          funderKeypair.publicKey,
          ONE_SOL,
        ).buildAndExecute();

        const { poolInitInfo } = await initTestPoolV2(
          ctx,
          tokenTraits.tokenTraitA,
          tokenTraits.tokenTraitB,
          TickSpacing.Standard,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
        );
        const pool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);

        // Verify token mint info is correct
        const tokenAInfo = pool.getTokenAInfo();
        const tokenBInfo = pool.getTokenBInfo();
        assert.ok(tokenAInfo.mint.equals(poolInitInfo.tokenMintA));
        assert.ok(tokenBInfo.mint.equals(poolInitInfo.tokenMintB));

        // Create and mint tokens in this wallet
        const mintedTokenAmount = 150_000_000;
        const [userTokenAAccount, userTokenBAccount] =
          await mintTokensToTestAccountV2(
            ctx.provider,
            tokenAInfo.mint,
            tokenTraits.tokenTraitA,
            mintedTokenAmount,
            tokenBInfo.mint,
            tokenTraits.tokenTraitB,
            mintedTokenAmount,
          );

        // Open a position with no tick arrays initialized.
        const lowerPrice = new Decimal(96);
        const upperPrice = new Decimal(101);
        const poolData = pool.getData();
        const tokenADecimal = tokenAInfo.decimals;
        const tokenBDecimal = tokenBInfo.decimals;

        const tickLower = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(lowerPrice, tokenADecimal, tokenBDecimal),
          poolData.tickSpacing,
        );
        const tickUpper = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(upperPrice, tokenADecimal, tokenBDecimal),
          poolData.tickSpacing,
        );

        const inputTokenMint = poolData.tokenMintA;
        const quote = increaseLiquidityQuoteByInputTokenUsingPriceSlippage(
          inputTokenMint,
          new Decimal(50),
          tickLower,
          tickUpper,
          Percentage.fromFraction(1, 100),
          pool,
          await TokenExtensionUtil.buildTokenExtensionContext(
            fetcher,
            poolData,
            IGNORE_CACHE,
          ),
        );

        // [Action] Initialize Tick Arrays
        const initTickArrayTx = (
          await pool.initTickArrayForTicks(
            [tickLower, tickUpper],
            funderKeypair.publicKey,
          )
        )?.addSigner(funderKeypair);

        assert.ok(!!initTickArrayTx);

        // [Action] Open Position (and increase L)
        const { positionMint, tx: openIx } = await pool.openPosition(
          tickLower,
          tickUpper,
          quote,
          ctx.wallet.publicKey,
          funderKeypair.publicKey,
        );
        openIx.addSigner(funderKeypair);

        await initTickArrayTx.buildAndExecute();
        await openIx.buildAndExecute();

        // Verify position exists and numbers fit input parameters
        const positionAddress = PDAUtil.getPosition(
          ctx.program.programId,
          positionMint,
        ).publicKey;
        const position = await client.getPosition(
          positionAddress,
          IGNORE_CACHE,
        );
        const positionData = position.getData();

        const tickLowerIndex = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(
            lowerPrice,
            tokenAInfo.decimals,
            tokenBInfo.decimals,
          ),
          poolData.tickSpacing,
        );
        const tickUpperIndex = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(
            upperPrice,
            tokenAInfo.decimals,
            tokenBInfo.decimals,
          ),
          poolData.tickSpacing,
        );
        assert.ok(positionData.liquidity.eq(quote.liquidityAmount));
        assert.ok(positionData.tickLowerIndex === tickLowerIndex);
        assert.ok(positionData.tickUpperIndex === tickUpperIndex);
        assert.ok(positionData.positionMint.equals(positionMint));
        assert.ok(
          positionData.whirlpool.equals(poolInitInfo.whirlpoolPda.publicKey),
        );

        // [Action] Close Position
        const txs = await pool.closePosition(
          positionAddress,
          Percentage.fromFraction(1, 100),
        );

        for (const tx of txs) {
          await tx.buildAndExecute();
        }

        // Verify position is closed and owner wallet has the tokens back
        const postClosePosition = await fetcher.getPosition(
          positionAddress,
          IGNORE_CACHE,
        );
        assert.ok(postClosePosition === null);

        // TODO: we are leaking 1 decimal place of token?
        assert.equal(
          await getTokenBalance(ctx.provider, userTokenAAccount),
          mintedTokenAmount - 1,
        );
        assert.equal(
          await getTokenBalance(ctx.provider, userTokenBAccount),
          mintedTokenAmount - 1,
        );
      });

      it("open and add liquidity to a position, transfer position to another wallet, then close the tokens to another wallet [Price Slippage]", async () => {
        const funderKeypair = anchor.web3.Keypair.generate();
        await systemTransferTx(
          provider,
          funderKeypair.publicKey,
          ONE_SOL,
        ).buildAndExecute();

        const { poolInitInfo } = await initTestPoolV2(
          ctx,
          tokenTraits.tokenTraitA,
          tokenTraits.tokenTraitB,
          TickSpacing.Standard,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
        );
        const pool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);

        // Verify token mint info is correct
        const tokenAInfo = pool.getTokenAInfo();
        const tokenBInfo = pool.getTokenBInfo();
        assert.ok(tokenAInfo.mint.equals(poolInitInfo.tokenMintA));
        assert.ok(tokenBInfo.mint.equals(poolInitInfo.tokenMintB));

        // Create and mint tokens in this wallet
        const mintedTokenAmount = 150_000_000;
        await mintTokensToTestAccountV2(
          ctx.provider,
          tokenAInfo.mint,
          tokenTraits.tokenTraitA,
          mintedTokenAmount,
          tokenBInfo.mint,
          tokenTraits.tokenTraitB,
          mintedTokenAmount,
        );

        // Open a position with no tick arrays initialized.
        const lowerPrice = new Decimal(96);
        const upperPrice = new Decimal(101);
        const poolData = pool.getData();
        const tokenADecimal = tokenAInfo.decimals;
        const tokenBDecimal = tokenBInfo.decimals;

        const tickLower = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(lowerPrice, tokenADecimal, tokenBDecimal),
          poolData.tickSpacing,
        );
        const tickUpper = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(upperPrice, tokenADecimal, tokenBDecimal),
          poolData.tickSpacing,
        );

        const inputTokenMint = poolData.tokenMintA;
        const depositAmount = new Decimal(50);
        const quote = increaseLiquidityQuoteByInputTokenUsingPriceSlippage(
          inputTokenMint,
          depositAmount,
          tickLower,
          tickUpper,
          Percentage.fromFraction(1, 100),
          pool,
          await TokenExtensionUtil.buildTokenExtensionContext(
            fetcher,
            poolData,
            IGNORE_CACHE,
          ),
        );

        // [Action] Initialize Tick Arrays
        const initTickArrayTx = (
          await pool.initTickArrayForTicks(
            [tickLower, tickUpper],
            funderKeypair.publicKey,
          )
        )?.addSigner(funderKeypair);

        assert.ok(!!initTickArrayTx);

        // [Action] Open Position (and increase L)
        const { positionMint, tx: openIx } = await pool.openPosition(
          tickLower,
          tickUpper,
          quote,
          ctx.wallet.publicKey,
          funderKeypair.publicKey,
        );
        openIx.addSigner(funderKeypair);

        await initTickArrayTx.buildAndExecute();
        await openIx.buildAndExecute();

        // Verify position exists and numbers fit input parameters
        const positionAddress = PDAUtil.getPosition(
          ctx.program.programId,
          positionMint,
        ).publicKey;
        const position = await client.getPosition(
          positionAddress,
          IGNORE_CACHE,
        );
        const positionData = position.getData();

        const tickLowerIndex = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(
            lowerPrice,
            tokenAInfo.decimals,
            tokenBInfo.decimals,
          ),
          poolData.tickSpacing,
        );
        const tickUpperIndex = TickUtil.getInitializableTickIndex(
          PriceMath.priceToTickIndex(
            upperPrice,
            tokenAInfo.decimals,
            tokenBInfo.decimals,
          ),
          poolData.tickSpacing,
        );
        assert.ok(positionData.liquidity.eq(quote.liquidityAmount));
        assert.ok(positionData.tickLowerIndex === tickLowerIndex);
        assert.ok(positionData.tickUpperIndex === tickUpperIndex);
        assert.ok(positionData.positionMint.equals(positionMint));
        assert.ok(
          positionData.whirlpool.equals(poolInitInfo.whirlpoolPda.publicKey),
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

        // [Action] Close Position
        const expectationQuote = await decreaseLiquidityQuoteByLiquidity(
          positionData.liquidity,
          Percentage.fromDecimal(new Decimal(0)),
          position,
          pool,
          await TokenExtensionUtil.buildTokenExtensionContext(
            fetcher,
            poolData,
            IGNORE_CACHE,
          ),
        );

        const destinationWallet = anchor.web3.Keypair.generate();

        const txs = await pool.closePosition(
          positionAddress,
          Percentage.fromFraction(1, 100),
          destinationWallet.publicKey,
          otherWallet.publicKey,
          ctx.wallet.publicKey,
        );

        for (const tx of txs) {
          await tx.addSigner(otherWallet).buildAndExecute();
        }

        // Verify position is closed and owner wallet has the tokens back
        const postClosePosition = await fetcher.getPosition(
          positionAddress,
          IGNORE_CACHE,
        );
        assert.ok(postClosePosition === null);

        const tokenProgramA = tokenTraits.tokenTraitA.isToken2022
          ? TEST_TOKEN_2022_PROGRAM_ID
          : TEST_TOKEN_PROGRAM_ID;
        const tokenProgramB = tokenTraits.tokenTraitB.isToken2022
          ? TEST_TOKEN_2022_PROGRAM_ID
          : TEST_TOKEN_PROGRAM_ID;
        const dWalletTokenAAccount = getAssociatedTokenAddressSync(
          poolData.tokenMintA,
          destinationWallet.publicKey,
          undefined,
          tokenProgramA,
        );
        const dWalletTokenBAccount = getAssociatedTokenAddressSync(
          poolData.tokenMintB,
          destinationWallet.publicKey,
          undefined,
          tokenProgramB,
        );

        assert.equal(
          await getTokenBalance(ctx.provider, dWalletTokenAAccount),
          expectationQuote.tokenMinA.toString(),
        );
        assert.equal(
          await getTokenBalance(ctx.provider, dWalletTokenBAccount),
          expectationQuote.tokenMinB.toString(),
        );
      });

      it("open and add liquidity to a position, trade against it, transfer position to another wallet, then close the tokens to another wallet", async () => {
        // In same tick array - start index 22528
        const tickLowerIndex = 29440;
        const tickUpperIndex = 33536;
        const vaultStartBalance = 1_000_000_000;
        const tickSpacing = TickSpacing.Standard;
        const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
          tokenTraitA: tokenTraits.tokenTraitA,
          tokenTraitB: tokenTraits.tokenTraitB,
          tickSpacing,
          positions: [
            {
              tickLowerIndex,
              tickUpperIndex,
              liquidityAmount: new anchor.BN(10_000_000),
            }, // In range position
            {
              tickLowerIndex: 0,
              tickUpperIndex: 128,
              liquidityAmount: new anchor.BN(1_000_000),
            }, // Out of range position
          ],
          rewards: [
            {
              rewardTokenTrait: { isToken2022: false },
              emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
              vaultAmount: new BN(vaultStartBalance),
            },
            {
              rewardTokenTrait: { isToken2022: false },
              emissionsPerSecondX64: MathUtil.toX64(new Decimal(5)),
              vaultAmount: new BN(vaultStartBalance),
            },
            {
              rewardTokenTrait: { isToken2022: false },
              emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
              vaultAmount: new BN(vaultStartBalance),
            },
          ],
        });
        const {
          poolInitInfo: {
            whirlpoolPda,
            tokenVaultAKeypair,
            tokenVaultBKeypair,
          },
          tokenAccountA,
          tokenAccountB,
          positions,
        } = fixture.getInfos();

        const tickArrayPda = PDAUtil.getTickArray(
          ctx.program.programId,
          whirlpoolPda.publicKey,
          22528,
        );
        const oraclePda = PDAUtil.getOracle(
          ctx.program.programId,
          whirlpoolPda.publicKey,
        );

        const tokenExtensionCtx =
          await TokenExtensionUtil.buildTokenExtensionContext(
            ctx.fetcher,
            (
              await client.getPool(whirlpoolPda.publicKey, IGNORE_CACHE)
            ).getData(),
            IGNORE_CACHE,
          );

        // Accrue fees in token A
        await toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
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
            tokenMintA: tokenExtensionCtx.tokenMintWithProgramA.address,
            tokenMintB: tokenExtensionCtx.tokenMintWithProgramB.address,
            tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
            tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
            ...(await TokenExtensionUtil.getExtraAccountMetasForTransferHookForPool(
              ctx.connection,
              tokenExtensionCtx,
              tokenAccountA,
              tokenVaultAKeypair.publicKey,
              ctx.wallet.publicKey,
              tokenVaultBKeypair.publicKey,
              tokenAccountB,
              whirlpoolPda.publicKey,
            )),
          }),
        )
        .prependInstruction(useMaxCU())  // TransferHook require much CU
        .buildAndExecute();

        // Accrue fees in token B
        await toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
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
            tokenMintA: tokenExtensionCtx.tokenMintWithProgramA.address,
            tokenMintB: tokenExtensionCtx.tokenMintWithProgramB.address,
            tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
            tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
            ...(await TokenExtensionUtil.getExtraAccountMetasForTransferHookForPool(
              ctx.connection,
              tokenExtensionCtx,
              tokenVaultAKeypair.publicKey,
              tokenAccountA,
              whirlpoolPda.publicKey,
              tokenAccountB,
              tokenVaultBKeypair.publicKey,
              ctx.wallet.publicKey,
            )),
          }),
        )
        .prependInstruction(useMaxCU())  // TransferHook require much CU
        .buildAndExecute();

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
          ctx.wallet.publicKey,
        );

        await transferToken(
          provider,
          walletPositionTokenAccount,
          newOwnerPositionTokenAccount,
          1,
        );

        const pool = await client.getPool(whirlpoolPda.publicKey, IGNORE_CACHE);
        const position = await client.getPosition(
          positionWithFees.publicKey,
          IGNORE_CACHE,
        );
        const positionData = position.getData();
        const poolData = pool.getData();
        const txs = await pool.closePosition(
          positionWithFees.publicKey,
          new Percentage(new BN(10), new BN(100)),
          otherWallet.publicKey,
          otherWallet.publicKey,
          ctx.wallet.publicKey,
        );

        const expectationQuote = decreaseLiquidityQuoteByLiquidity(
          position.getData().liquidity,
          Percentage.fromDecimal(new Decimal(0)),
          position,
          pool,
          await TokenExtensionUtil.buildTokenExtensionContext(
            fetcher,
            poolData,
            IGNORE_CACHE,
          ),
        );

        const dWalletTokenAAccount = getAssociatedTokenAddressSync(
          poolData.tokenMintA,
          otherWallet.publicKey,
          undefined,
          tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
        );
        const dWalletTokenBAccount = getAssociatedTokenAddressSync(
          poolData.tokenMintB,
          otherWallet.publicKey,
          undefined,
          tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
        );
        const rewardAccount0 = getAssociatedTokenAddressSync(
          poolData.rewardInfos[0].mint,
          otherWallet.publicKey,
          undefined,
          tokenExtensionCtx.rewardTokenMintsWithProgram[0]!.tokenProgram,
        );
        const rewardAccount1 = getAssociatedTokenAddressSync(
          poolData.rewardInfos[1].mint,
          otherWallet.publicKey,
          undefined,
          tokenExtensionCtx.rewardTokenMintsWithProgram[1]!.tokenProgram,
        );
        const rewardAccount2 = getAssociatedTokenAddressSync(
          poolData.rewardInfos[2].mint,
          otherWallet.publicKey,
          undefined,
          tokenExtensionCtx.rewardTokenMintsWithProgram[2]!.tokenProgram,
        );

        const feesQuote = collectFeesQuote({
          whirlpool: poolData,
          position: positionData,
          tickLower: position.getLowerTickData(),
          tickUpper: position.getUpperTickData(),
          tokenExtensionCtx:
            await TokenExtensionUtil.buildTokenExtensionContext(
              fetcher,
              poolData,
              IGNORE_CACHE,
            ),
        });

        const signatures: string[] = [];
        for (const tx of txs) {
          signatures.push(await tx.addSigner(otherWallet).buildAndExecute());
        }

        // To calculate the rewards that have accumulated up to the timing of the close (strictly, decreaseLiquidity),
        // the block time at transaction execution is used.
        // TODO: maxSupportedTransactionVersion needs to come from ctx
        const tx = await ctx.provider.connection.getTransaction(signatures[0], {
          maxSupportedTransactionVersion: 0,
        });
        const closeTimestampInSeconds = new anchor.BN(
          tx!.blockTime!.toString(),
        );
        const rewardsQuote = collectRewardsQuote({
          whirlpool: poolData,
          position: positionData,
          tickLower: position.getLowerTickData(),
          tickUpper: position.getUpperTickData(),
          tokenExtensionCtx:
            await TokenExtensionUtil.buildTokenExtensionContext(
              fetcher,
              poolData,
              IGNORE_CACHE,
            ),
          timeStampInSeconds: closeTimestampInSeconds,
        });

        assert.equal(
          await getTokenBalance(ctx.provider, dWalletTokenAAccount),
          expectationQuote.tokenMinA.add(feesQuote.feeOwedA).toString(),
        );

        assert.equal(
          await getTokenBalance(ctx.provider, dWalletTokenBAccount),
          expectationQuote.tokenMinB.add(feesQuote.feeOwedB).toString(),
        );

        assert.equal(
          await getTokenBalance(ctx.provider, rewardAccount0),
          rewardsQuote.rewardOwed[0]?.toString(),
        );
        assert.equal(
          await getTokenBalance(ctx.provider, rewardAccount1),
          rewardsQuote.rewardOwed[1]?.toString(),
        );
        assert.equal(
          await getTokenBalance(ctx.provider, rewardAccount2),
          rewardsQuote.rewardOwed[2]?.toString(),
        );
      });
    });
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
        {
          tickLowerIndex,
          tickUpperIndex,
          liquidityAmount: new anchor.BN(10_000_000_000),
        }, // In range position
        {
          tickLowerIndex: 0,
          tickUpperIndex: 128,
          liquidityAmount: new anchor.BN(1_000_000_000),
        }, // Out of range position
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

    const tickArrayPda = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpoolPda.publicKey,
      22528,
    );
    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

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
      }),
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
      }),
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
      ctx.wallet.publicKey,
    );

    await transferToken(
      provider,
      walletPositionTokenAccount,
      newOwnerPositionTokenAccount,
      1,
    );

    const pool = await client.getPool(whirlpoolPda.publicKey, IGNORE_CACHE);
    const position = await client.getPosition(
      positionWithFees.publicKey,
      IGNORE_CACHE,
    );
    const positionData = position.getData();
    const poolData = pool.getData();

    const decreaseLiquidityQuote = decreaseLiquidityQuoteByLiquidity(
      position.getData().liquidity,
      Percentage.fromDecimal(new Decimal(0)),
      position,
      pool,
      await TokenExtensionUtil.buildTokenExtensionContext(
        fetcher,
        poolData,
        IGNORE_CACHE,
      ),
    );

    const feesQuote = collectFeesQuote({
      whirlpool: poolData,
      position: positionData,
      tickLower: position.getLowerTickData(),
      tickUpper: position.getUpperTickData(),
      tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
        fetcher,
        poolData,
        IGNORE_CACHE,
      ),
    });

    const dWalletTokenBAccount = getAssociatedTokenAddressSync(
      poolData.tokenMintB,
      otherWallet.publicKey,
    );
    const rewardAccount0 = getAssociatedTokenAddressSync(
      poolData.rewardInfos[0].mint,
      otherWallet.publicKey,
    );
    const rewardAccount1 = getAssociatedTokenAddressSync(
      poolData.rewardInfos[1].mint,
      otherWallet.publicKey,
    );
    const rewardAccount2 = getAssociatedTokenAddressSync(
      poolData.rewardInfos[2].mint,
      otherWallet.publicKey,
    );

    const txs = await pool.closePosition(
      positionWithFees.publicKey,
      new Percentage(new BN(10), new BN(100)),
      otherWallet.publicKey,
      otherWallet.publicKey,
      ctx.wallet.publicKey,
    );

    // This test case is TokenProgram/TokenProgram, so at most 2 is appropriate
    if (txs.length > 2) {
      throw new Error(`Invalid length for txs ${txs}`);
    }

    const otherWalletBalanceBefore = await ctx.connection.getBalance(
      otherWallet.publicKey,
    );
    const positionAccountBalance = await ctx.connection.getBalance(
      positionWithFees.publicKey,
    );

    const signatures: string[] = [];
    for (const tx of txs) {
      signatures.push(await tx.addSigner(otherWallet).buildAndExecute());
    }

    // To calculate the rewards that have accumulated up to the timing of the close (strictly, decreaseLiquidity),
    // the block time at transaction execution is used.
    // TODO: maxSupportedTransactionVersion needs to come from ctx
    const tx = await ctx.provider.connection.getTransaction(signatures[0], {
      maxSupportedTransactionVersion: 0,
    });
    const closeTimestampInSeconds = new anchor.BN(tx!.blockTime!.toString());
    const rewardsQuote = collectRewardsQuote({
      whirlpool: poolData,
      position: positionData,
      tickLower: position.getLowerTickData(),
      tickUpper: position.getUpperTickData(),
      tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
        fetcher,
        poolData,
        IGNORE_CACHE,
      ),
      timeStampInSeconds: closeTimestampInSeconds,
    });

    const otherWalletBalanceAfter = await ctx.connection.getBalance(
      otherWallet.publicKey,
    );

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
      decreaseLiquidityQuote.tokenMinB.add(feesQuote.feeOwedB).toString(),
    );

    assert.equal(
      await getTokenBalance(ctx.provider, rewardAccount0),
      rewardsQuote.rewardOwed[0]?.toString(),
    );
    assert.equal(
      await getTokenBalance(ctx.provider, rewardAccount1),
      rewardsQuote.rewardOwed[1]?.toString(),
    );
    assert.equal(
      await getTokenBalance(ctx.provider, rewardAccount2),
      rewardsQuote.rewardOwed[2]?.toString(),
    );
  });

  it("swap with idempotent", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;
    const vaultStartBalance = 1_000_000_000;
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        {
          tickLowerIndex,
          tickUpperIndex,
          liquidityAmount: new anchor.BN(10_000_000),
        }, // In range position
        {
          tickLowerIndex: 0,
          tickUpperIndex: 128,
          liquidityAmount: new anchor.BN(1_000_000),
        }, // Out of range position
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
      poolInitInfo: { whirlpoolPda },
      tokenAccountB,
    } = fixture.getInfos();

    const pool = await client.getPool(whirlpoolPda.publicKey, IGNORE_CACHE);

    // close ATA for token B
    const balanceB = await getTokenBalance(ctx.provider, tokenAccountB);
    await toTx(ctx, {
      instructions: [
        createBurnInstruction(
          tokenAccountB,
          pool.getData().tokenMintB,
          ctx.wallet.publicKey,
          BigInt(balanceB.toString()),
        ),
        createCloseAccountInstruction(
          tokenAccountB,
          ctx.wallet.publicKey,
          ctx.wallet.publicKey,
        ),
      ],
      cleanupInstructions: [],
      signers: [],
    }).buildAndExecute();
    const tokenAccountBData = await ctx.connection.getAccountInfo(
      tokenAccountB,
      "confirmed",
    );
    assert.ok(tokenAccountBData === null);

    const quote = await swapQuoteByInputToken(
      pool,
      pool.getData().tokenMintA,
      new BN(200_000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      ctx.fetcher,
      IGNORE_CACHE,
    );

    const tx = await pool.swap(quote);

    // check generated instructions
    const instructions = tx.compressIx(true).instructions;
    const createIxs = instructions.filter((ix) =>
      ix.programId.equals(ASSOCIATED_PROGRAM_ID),
    );
    assert.ok(createIxs.length === 1);
    assert.ok(createIxs[0].keys[1].pubkey.equals(tokenAccountB));
    assert.ok(createIxs[0].data.length === 1);
    assert.ok(createIxs[0].data[0] === 1); // Idempotent
  });
});
