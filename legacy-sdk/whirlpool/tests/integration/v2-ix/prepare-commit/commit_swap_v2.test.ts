import type * as anchor from "@coral-xyz/anchor";
import { MathUtil, Percentage, U64_MAX } from "@orca-so/common-sdk";
import type { PDA } from "@orca-so/common-sdk";
import * as assert from "assert";
import { BN } from "bn.js";
import Decimal from "decimal.js";
import type {
  InitPoolV2Params,
  WhirlpoolData,
  WhirlpoolContext,
  SwapQuote,
  CommitSwapV2Params,
} from "../../../../src";
import {
  MAX_PREPARED_SWAP_NONCE,
  MAX_SQRT_PRICE_BN,
  MEMO_PROGRAM_ADDRESS,
  MIN_SQRT_PRICE_BN,
  NO_ORACLE_DATA,
  PDAUtil,
  PriceMath,
  SwapUtils,
  WhirlpoolIx,
  buildWhirlpoolClient,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
  swapQuoteWithParams,
  toTx,
} from "../../../../src";
import { IGNORE_CACHE } from "../../../../src/network/public/fetcher";
import {
  TickSpacing,
  ZERO_BN,
  initializeLiteSVMEnvironment,
} from "../../../utils";
import { initTickArrayRange } from "../../../utils/init-utils";
import type { FundedPositionV2Params } from "../../../utils/v2/init-utils-v2";
import {
  fundPositionsV2,
  initTestPoolWithTokensV2,
} from "../../../utils/v2/init-utils-v2";
import { createMintV2 } from "../../../utils/v2/token-2022";
import { TokenExtensionUtil } from "../../../../src/utils/public/token-extension-util";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  parsePrepareSwapV2ReturnData,
  simulateTransaction,
} from "../../../utils/prepare-commit-test-utils";
import type { PrepareSwapV2Params } from "../../../../dist";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("commit_swap_v2", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];
  let client: ReturnType<typeof buildWhirlpoolClient>;

  const tokenTraits = {
    tokenTraitA: { isToken2022: true },
    tokenTraitB: { isToken2022: true },
    tokenTraitR: { isToken2022: true },
  };
  const initializedPreparedSwapNonce = 0;

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
    client = buildWhirlpoolClient(ctx);

    const preparedSwapPda = PDAUtil.getPreparedSwap(
      ctx.program.programId,
      initializedPreparedSwapNonce,
    );
    await toTx(
      ctx,
      WhirlpoolIx.initializePreparedSwapIx(ctx.program, {
        funder: ctx.wallet.publicKey,
        nonce: initializedPreparedSwapNonce,
        preparedSwapPda,
      }),
    ).buildAndExecute();
  });

  describe("invalid accounts", () => {
    async function setup() {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokensV2(
          ctx,
          tokenTraits.tokenTraitA,
          tokenTraits.tokenTraitB,
          TickSpacing.Standard,
        );

      const tickArrays = await initTickArrayRange(
        ctx,
        whirlpoolPda.publicKey,
        22528,
        3,
        TickSpacing.Standard,
        false,
      );
      const oraclePda = PDAUtil.getOracle(
        ctx.program.programId,
        whirlpoolPda.publicKey,
      );

      const preparedSwapPda = PDAUtil.getPreparedSwap(
        ctx.program.programId,
        initializedPreparedSwapNonce,
      );

      const params: CommitSwapV2Params = {
        preparedSwap: preparedSwapPda.publicKey,
        amount: new BN(10),
        sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
        amountSpecifiedIsInput: true,
        aToB: true,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenMintA: poolInitInfo.tokenMintA,
        tokenMintB: poolInitInfo.tokenMintB,
        tokenProgramA: poolInitInfo.tokenProgramA,
        tokenProgramB: poolInitInfo.tokenProgramB,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[0].publicKey,
        tickArray2: tickArrays[0].publicKey,
        oracle: oraclePda.publicKey,
      };

      await toTx(
        ctx,
        WhirlpoolIx.prepareSwapV2Ix(ctx.program, params), // CommitSwapV2Params works as PrepareSwapV2Params
      ).buildAndExecute();

      return {
        params,
        poolInitInfo,
        tokenAccountA,
        tokenAccountB,
      };
    }

    it("fails when the PreparedSwap account is not initialized", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokensV2(
          ctx,
          tokenTraits.tokenTraitA,
          tokenTraits.tokenTraitB,
          TickSpacing.Standard,
        );

      const tickArrays = await initTickArrayRange(
        ctx,
        whirlpoolPda.publicKey,
        22528,
        3,
        TickSpacing.Standard,
        false,
      );
      const oraclePda = PDAUtil.getOracle(
        ctx.program.programId,
        whirlpoolPda.publicKey,
      );

      const preparedSwapPda = PDAUtil.getPreparedSwap(
        ctx.program.programId,
        MAX_PREPARED_SWAP_NONCE,
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            preparedSwap: preparedSwapPda.publicKey, // not initialized
            amount: new BN(10),
            sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
            amountSpecifiedIsInput: true,
            aToB: true,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[0].publicKey,
            tickArray2: tickArrays[0].publicKey,
            oracle: oraclePda.publicKey,
          }),
        ).buildAndExecute(),
        /0xbbf/, // AccountOwnedByWrongProgram (The owner program is system (= uninitialized account))
      );
    });

    it("fails when the PreparedSwap account is not in Prepared state", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokensV2(
          ctx,
          tokenTraits.tokenTraitA,
          tokenTraits.tokenTraitB,
          TickSpacing.Standard,
        );

      const tickArrays = await initTickArrayRange(
        ctx,
        whirlpoolPda.publicKey,
        22528,
        3,
        TickSpacing.Standard,
        false,
      );
      const oraclePda = PDAUtil.getOracle(
        ctx.program.programId,
        whirlpoolPda.publicKey,
      );

      const preparedSwapPda = PDAUtil.getPreparedSwap(
        ctx.program.programId,
        initializedPreparedSwapNonce,
      );

      // no prepareSwapV2 call = not in Prepared state

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            preparedSwap: preparedSwapPda.publicKey,
            amount: new BN(10),
            sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
            amountSpecifiedIsInput: true,
            aToB: true,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[0].publicKey,
            tickArray2: tickArrays[0].publicKey,
            oracle: oraclePda.publicKey,
          }),
        ).buildAndExecute(),
        /0x17b8/, // PreparedSwapNotPrepared
      );
    });

    it("fails when passed token_program_a/b does not match the owner program of whirlpool's token_mint_a/b", async () => {
      const { params } = await setup();

      // invalid tokenProgramA
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            tokenProgramA: TOKEN_PROGRAM_ID, // not Token-2022 program
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );

      // invalid tokenProgramB
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            tokenProgramB: TOKEN_PROGRAM_ID, // not Token-2022 program
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed memo_program is invalid", async () => {
      const { params } = await setup();

      const ix = WhirlpoolIx.commitSwapV2Ix(ctx.program, params)
        .instructions[0];

      assert.ok(ix.keys[3].pubkey.equals(MEMO_PROGRAM_ADDRESS));
      ix.keys[3].pubkey = PublicKey.unique();

      await assert.rejects(
        toTx(ctx, {
          instructions: [ix],
          cleanupInstructions: [],
          signers: [],
        }).buildAndExecute(),
        /0xbc0/, // InvalidProgramId
      );
    });

    it("fails when token authority is not signer", async () => {
      const { params } = await setup();

      const ix = WhirlpoolIx.commitSwapV2Ix(ctx.program, params)
        .instructions[0];

      assert.ok(ix.keys[4].pubkey.equals(params.tokenAuthority));

      // unset signer flag
      ix.keys[4].isSigner = false;
      ix.keys[4].pubkey = PublicKey.unique(); // other wallet address

      const tx = toTx(ctx, {
        instructions: [ix],
        cleanupInstructions: [],
        // not add tokenAuthority as additional signer
        signers: [],
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc2/, // AccountNotSigner
      );
    });

    it("fails when token authority is invalid (doesn't match the autority on PreparedSwap account)", async () => {
      const { params } = await setup();

      const anotherWalletKeypair = Keypair.generate();
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            tokenAuthority: anotherWalletKeypair.publicKey,
          }),
        )
          .addSigner(anotherWalletKeypair)
          .buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );
    });

    it("fails when Whirlpool account is invalid account", async () => {
      const { params } = await setup();

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            whirlpool: PublicKey.unique(), // invalid Whirlpool account address
          }),
        ).buildAndExecute(),
        /0xbc4/, // AccountNotInitialized
      );
    });

    it("fails when passed token_mint_a/b does not match whirlpool's token_mint_a/b", async () => {
      const { params } = await setup();

      const otherTokenPublicKey = await createMintV2(provider, {
        isToken2022: true,
      });

      // invalid tokenMintA
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            tokenMintA: otherTokenPublicKey,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );

      // invalid tokenMintB
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            tokenMintB: otherTokenPublicKey,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed token_vault_a/b does not match whirlpool's token_vault_a/b", async () => {
      const { params, tokenAccountA, tokenAccountB } = await setup();

      // invalid tokenVaultA
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            tokenVaultA: tokenAccountA,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );

      // invalid tokenVaultB
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            tokenVaultB: tokenAccountB,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed token_owner_account_a/b are invalid", async () => {
      const { params, poolInitInfo, tokenAccountA, tokenAccountB } =
        await setup();

      // invalid tokenOwnerAccountA
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            tokenOwnerAccountA: tokenAccountB,
          }),
        ).buildAndExecute(),
        /0x7d3/, // ConstraintRaw
      );
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            tokenOwnerAccountA: poolInitInfo.tokenProgramA,
          }),
        ).buildAndExecute(),
        /0xbbf/, // AccountOwnedByWrongProgram
      );
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            tokenOwnerAccountA: poolInitInfo.tokenMintA,
          }),
        ).buildAndExecute(),
        /InvalidAccountData/,
      );

      // invalid tokenOwnerAccountB
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            tokenOwnerAccountB: tokenAccountA,
          }),
        ).buildAndExecute(),
        /0x7d3/, // ConstraintRaw
      );
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            tokenOwnerAccountB: poolInitInfo.tokenProgramB,
          }),
        ).buildAndExecute(),
        /0xbbf/, // AccountOwnedByWrongProgram
      );
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            tokenOwnerAccountB: poolInitInfo.tokenMintB,
          }),
        ).buildAndExecute(),
        /InvalidAccountData/,
      );
    });

    it("fails when all provided tick arrays are invalid account", async () => {
      const { params } = await setup();

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            tickArray0: PublicKey.unique(),
            tickArray1: PublicKey.unique(),
            tickArray2: PublicKey.unique(),
          }),
        ).buildAndExecute(),
        /0x1787/, // InvalidTickArraySequence
      );
    });

    it("fails when Oracle account is invalid account", async () => {
      const { params } = await setup();

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            oracle: PublicKey.unique(),
          }),
        ).buildAndExecute(),
        /0x7d6/, // ConstraintSeeds
      );
    });
  });

  /*
  describe("return data", () => {
    let prepareSwapV2Params: PrepareSwapV2Params;
    let quote: SwapQuote;

    beforeAll(async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokensV2(
          ctx,
          tokenTraits.tokenTraitA,
          tokenTraits.tokenTraitB,
          TickSpacing.Standard,
        );
      const aToB = false;
      await initTickArrayRange(
        ctx,
        whirlpoolPda.publicKey,
        22528, // to 33792
        3,
        TickSpacing.Standard,
        aToB,
      );

      const fundParams: FundedPositionV2Params[] = [
        {
          liquidityAmount: new anchor.BN(10_000_000),
          tickLowerIndex: 29440,
          tickUpperIndex: 33536,
        },
      ];

      await fundPositionsV2(
        ctx,
        poolInitInfo,
        tokenAccountA,
        tokenAccountB,
        fundParams,
      );

      const oraclePda = PDAUtil.getOracle(
        ctx.program.programId,
        whirlpoolPda.publicKey,
      );

      const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
      const whirlpoolData = (await fetcher.getPool(
        whirlpoolKey,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      quote = swapQuoteWithParams(
        {
          amountSpecifiedIsInput: true,
          aToB: false,
          tokenAmount: new BN(100000),
          otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
          sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(false),
          whirlpoolData,
          tickArrays: await SwapUtils.getTickArrays(
            whirlpoolData.tickCurrentIndex,
            whirlpoolData.tickSpacing,
            false,
            ctx.program.programId,
            whirlpoolKey,
            fetcher,
            IGNORE_CACHE,
          ),
          tokenExtensionCtx:
            await TokenExtensionUtil.buildTokenExtensionContext(
              fetcher,
              whirlpoolData,
              IGNORE_CACHE,
            ),
          oracleData: NO_ORACLE_DATA,
        },
        Percentage.fromFraction(1, 100),
      );

      const preparedSwapPda = PDAUtil.getPreparedSwap(
        ctx.program.programId,
        initializedPreparedSwapNonce,
      );

      prepareSwapV2Params = {
        ...quote,
        preparedSwap: preparedSwapPda.publicKey,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenMintA: poolInitInfo.tokenMintA,
        tokenMintB: poolInitInfo.tokenMintB,
        oracle: oraclePda.publicKey,
      };
    });

    it("QuoteSuccess", async () => {
      const sim = await simulateTransaction(
        ctx.provider,
        toTx(
          ctx,
          WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
            ...prepareSwapV2Params,
          }),
        ),
      );
      const returnData = parsePrepareSwapV2ReturnData(sim.returnData().data);

      assert.ok(!!returnData && "quoteSuccess" in returnData);
      assert.ok(returnData.quoteSuccess.amount.eq(quote.amount));
      assert.ok(
        returnData.quoteSuccess.otherAmount.eq(quote.estimatedAmountOut),
      );
      assert.ok(
        returnData.quoteSuccess.nextSqrtPrice.eq(quote.estimatedEndSqrtPrice),
      );
      assert.ok(
        returnData.quoteSuccess.nextTickIndex === quote.estimatedEndTickIndex,
      );
    });

    it("QuoteError: ZeroTradableAmount", async () => {
      const sim = await simulateTransaction(
        ctx.provider,
        toTx(
          ctx,
          WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
            ...prepareSwapV2Params,
            amount: ZERO_BN,
          }),
        ),
      );
      const returnData = parsePrepareSwapV2ReturnData(sim.returnData().data);

      assert.ok(!!returnData && "quoteError" in returnData);
      assert.equal(returnData.quoteError.errorCode.toNumber(), 0x1793); // ZeroTradableAmount
    });

    it("QuoteError: InvalidSqrtPriceLimitDirection", async () => {
      const sim = await simulateTransaction(
        ctx.provider,
        toTx(
          ctx,
          WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
            ...prepareSwapV2Params,
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(
              !prepareSwapV2Params.aToB,
            ),
          }),
        ),
      );
      const returnData = parsePrepareSwapV2ReturnData(sim.returnData().data);

      assert.ok(!!returnData && "quoteError" in returnData);
      assert.equal(returnData.quoteError.errorCode.toNumber(), 0x1792); // InvalidSqrtPriceLimitDirection
    });

    it("QuoteError: SqrtPriceOutOfBounds", async () => {
      const sim = await simulateTransaction(
        ctx.provider,
        toTx(
          ctx,
          WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
            ...prepareSwapV2Params,
            sqrtPriceLimit: MAX_SQRT_PRICE_BN.addn(1), // exceeds MAX_SQRT_PRICE
          }),
        ),
      );
      const returnData = parsePrepareSwapV2ReturnData(sim.returnData().data);

      assert.ok(!!returnData && "quoteError" in returnData);
      assert.equal(returnData.quoteError.errorCode.toNumber(), 0x177b); // SqrtPriceOutOfBounds
    });

    it("QuoteError: InvalidTickArraySequence", async () => {
      const sim = await simulateTransaction(
        ctx.provider,
        toTx(
          ctx,
          WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
            ...prepareSwapV2Params,
            tickArray0: PublicKey.unique(),
            tickArray1: PublicKey.unique(),
            tickArray2: PublicKey.unique(),
          }),
        ),
      );
      const returnData = parsePrepareSwapV2ReturnData(sim.returnData().data);

      assert.ok(!!returnData && "quoteError" in returnData);
      assert.equal(returnData.quoteError.errorCode.toNumber(), 0x1787); // InvalidTickArraySequence
    });

    it("QuoteError: TickArraySequenceInvalidIndex", async () => {
      const sim = await simulateTransaction(
        ctx.provider,
        toTx(
          ctx,
          WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
            ...prepareSwapV2Params,
            amount: U64_MAX,
          }),
        ),
      );
      const returnData = parsePrepareSwapV2ReturnData(sim.returnData().data);

      assert.ok(!!returnData && "quoteError" in returnData);
      assert.equal(returnData.quoteError.errorCode.toNumber(), 0x1796); // TickArraySequenceInvalidIndex
    });
  });

  describe("return data: partial fill, b to a", () => {
    const tickSpacing = 128;
    const aToB = false;
    // client initialized in beforeAll

    let poolInitInfo: InitPoolV2Params;
    let whirlpoolPda: PDA;
    let tokenAccountA: PublicKey;
    let tokenAccountB: PublicKey;
    let whirlpoolKey: PublicKey;
    let oraclePda: PDA;
    let preparedSwapPda: PDA;

    beforeEach(async () => {
      const init = await initTestPoolWithTokensV2(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        tickSpacing,
        PriceMath.tickIndexToSqrtPriceX64(439296 + 1),
        new BN("10000000000000000000000"),
      );

      poolInitInfo = init.poolInitInfo;
      whirlpoolPda = poolInitInfo.whirlpoolPda;
      tokenAccountA = init.tokenAccountA;
      tokenAccountB = init.tokenAccountB;
      whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
      oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolKey);
      preparedSwapPda = PDAUtil.getPreparedSwap(
        ctx.program.programId,
        initializedPreparedSwapNonce,
      );

      await initTickArrayRange(
        ctx,
        whirlpoolPda.publicKey,
        439296, // right most TickArray
        1,
        tickSpacing,
        aToB,
      );

      // a: 1 (round up)
      // b: 223379095563402706 (to get 1, need >= 223379095563402706)
      const fundParams: FundedPositionV2Params[] = [
        {
          liquidityAmount: new anchor.BN(10_000_000_000),
          tickLowerIndex: 439424,
          tickUpperIndex: 439552,
        },
      ];

      await fundPositionsV2(
        ctx,
        poolInitInfo,
        tokenAccountA,
        tokenAccountB,
        fundParams,
      );
    });

    // |-S-***-------T,max----|  (*: liquidity, S: start, T: end)
    it("QuoteSuccess: ExactIn, sqrt_price_limit = 0", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("223379095563402706");
      const quote = await swapQuoteByInputToken(
        whirlpool,
        whirlpoolData.tokenMintB,
        amount.muln(2), // x2 input
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      const sim = await simulateTransaction(
        ctx.provider,
        toTx(
          ctx,
          WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
            ...quote,
            preparedSwap: preparedSwapPda.publicKey,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            oracle: oraclePda.publicKey,
            tokenMintA: whirlpoolData.tokenMintA,
            tokenMintB: whirlpoolData.tokenMintB,

            // sqrt_price_limit = 0
            sqrtPriceLimit: ZERO_BN,
          }),
        ),
      );
      const returnData = parsePrepareSwapV2ReturnData(sim.returnData().data);

      assert.ok(!!returnData && "quoteSuccess" in returnData);
      assert.ok(returnData.quoteSuccess.amount.lt(quote.amount)); // partial fill
      assert.ok(returnData.quoteSuccess.amount.eq(quote.estimatedAmountIn));
      assert.ok(
        returnData.quoteSuccess.otherAmount.eq(quote.estimatedAmountOut),
      );
      assert.ok(
        returnData.quoteSuccess.nextSqrtPrice.eq(quote.estimatedEndSqrtPrice),
      );
      assert.ok(
        returnData.quoteSuccess.nextTickIndex === quote.estimatedEndTickIndex,
      );
      assert.ok(returnData.quoteSuccess.nextSqrtPrice.eq(MAX_SQRT_PRICE_BN));
      assert.ok(returnData.quoteSuccess.otherAmount.isZero());
    });

    // |-S-***-------T,max----|  (*: liquidity, S: start, T: end)
    it("QuoteSuccess: ExactIn, sqrt_price_limit = MAX_SQRT_PRICE", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("223379095563402706");
      const quote = await swapQuoteByInputToken(
        whirlpool,
        whirlpoolData.tokenMintB,
        amount.muln(2), // x2 input
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      const sim = await simulateTransaction(
        ctx.provider,
        toTx(
          ctx,
          WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
            ...quote,
            preparedSwap: preparedSwapPda.publicKey,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            oracle: oraclePda.publicKey,
            tokenMintA: whirlpoolData.tokenMintA,
            tokenMintB: whirlpoolData.tokenMintB,

            // sqrt_price_limit = MAX_SQRT_PRICE
            sqrtPriceLimit: MAX_SQRT_PRICE_BN,
          }),
        ),
      );
      const returnData = parsePrepareSwapV2ReturnData(sim.returnData().data);

      assert.ok(!!returnData && "quoteSuccess" in returnData);
      assert.ok(returnData.quoteSuccess.amount.lt(quote.amount)); // partial fill
      assert.ok(returnData.quoteSuccess.amount.eq(quote.estimatedAmountIn));
      assert.ok(
        returnData.quoteSuccess.otherAmount.eq(quote.estimatedAmountOut),
      );
      assert.ok(
        returnData.quoteSuccess.nextSqrtPrice.eq(quote.estimatedEndSqrtPrice),
      );
      assert.ok(
        returnData.quoteSuccess.nextTickIndex === quote.estimatedEndTickIndex,
      );
      assert.ok(returnData.quoteSuccess.nextSqrtPrice.eq(MAX_SQRT_PRICE_BN));
      assert.ok(returnData.quoteSuccess.otherAmount.isZero());
    });

    // |-S-***-------T,max----|  (*: liquidity, S: start, T: end)
    it("QuoteError: ExactOut, sqrt_price_limit = 0", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("1");
      const quote = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintA,
        amount,
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      const sim = await simulateTransaction(
        ctx.provider,
        toTx(
          ctx,
          WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
            ...quote,
            preparedSwap: preparedSwapPda.publicKey,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            oracle: oraclePda.publicKey,
            tokenMintA: whirlpoolData.tokenMintA,
            tokenMintB: whirlpoolData.tokenMintB,

            // sqrt_price_limit = 0
            sqrtPriceLimit: ZERO_BN,
            amount, // 1
          }),
        ),
      );
      const returnData = parsePrepareSwapV2ReturnData(sim.returnData().data);

      assert.ok(!!returnData && "quoteError" in returnData);
      assert.equal(returnData.quoteError.errorCode.toNumber(), 0x17a9); // PartialFillError
    });

    // |-S-***-------T,max----|  (*: liquidity, S: start, T: end)
    it("QuoteSuccess: ExactOut, sqrt_price_limit = MAX_SQRT_PRICE", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("1");
      const quote = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintA,
        amount,
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      const sim = await simulateTransaction(
        ctx.provider,
        toTx(
          ctx,
          WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
            ...quote,
            preparedSwap: preparedSwapPda.publicKey,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            oracle: oraclePda.publicKey,
            tokenMintA: whirlpoolData.tokenMintA,
            tokenMintB: whirlpoolData.tokenMintB,

            // sqrt_price_limit = MAX_SQRT_PRICE
            sqrtPriceLimit: MAX_SQRT_PRICE_BN,
            amount, // 1
          }),
        ),
      );
      const returnData = parsePrepareSwapV2ReturnData(sim.returnData().data);

      assert.ok(!!returnData && "quoteSuccess" in returnData);
      assert.ok(returnData.quoteSuccess.amount.lt(quote.amount)); // partial fill
      assert.ok(returnData.quoteSuccess.amount.eq(quote.estimatedAmountOut));
      assert.ok(
        returnData.quoteSuccess.otherAmount.eq(quote.estimatedAmountIn),
      );
      assert.ok(
        returnData.quoteSuccess.nextSqrtPrice.eq(quote.estimatedEndSqrtPrice),
      );
      assert.ok(
        returnData.quoteSuccess.nextTickIndex === quote.estimatedEndTickIndex,
      );
      assert.ok(returnData.quoteSuccess.nextSqrtPrice.eq(MAX_SQRT_PRICE_BN));
      assert.ok(returnData.quoteSuccess.amount.isZero());
    });
  });

  describe("return data: partial fill, a to b", () => {
    const tickSpacing = 128;
    const aToB = true;
    // client initialized in beforeAll

    let poolInitInfo: InitPoolV2Params;
    let whirlpoolPda: PDA;
    let tokenAccountA: PublicKey;
    let tokenAccountB: PublicKey;
    let whirlpoolKey: PublicKey;
    let oraclePda: PDA;
    let preparedSwapPda: PDA;

    beforeEach(async () => {
      const init = await initTestPoolWithTokensV2(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        tickSpacing,
        PriceMath.tickIndexToSqrtPriceX64(-439296 - 1),
        new BN("10000000000000000000000"),
      );

      poolInitInfo = init.poolInitInfo;
      whirlpoolPda = poolInitInfo.whirlpoolPda;
      tokenAccountA = init.tokenAccountA;
      tokenAccountB = init.tokenAccountB;
      whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
      oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolKey);
      preparedSwapPda = PDAUtil.getPreparedSwap(
        ctx.program.programId,
        initializedPreparedSwapNonce,
      );

      await initTickArrayRange(
        ctx,
        whirlpoolPda.publicKey,
        -450560, // left most TickArray
        1,
        tickSpacing,
        aToB,
      );

      // a: 223379098170764880 (to get 1, need >= 223379098170764880)
      // b: 1 (round up)
      const fundParams: FundedPositionV2Params[] = [
        {
          liquidityAmount: new anchor.BN(10_000_000_000),
          tickLowerIndex: -439552,
          tickUpperIndex: -439424,
        },
      ];

      await fundPositionsV2(
        ctx,
        poolInitInfo,
        tokenAccountA,
        tokenAccountB,
        fundParams,
      );
    });

    // |-min,T---------***-S-|  (*: liquidity, S: start, T: end)
    it("QuoteSuccess: ExactIn, sqrt_price_limit = 0", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("223379098170764880");
      const quote = await swapQuoteByInputToken(
        whirlpool,
        whirlpoolData.tokenMintA,
        amount.muln(2), // x2 input
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      const sim = await simulateTransaction(
        ctx.provider,
        toTx(
          ctx,
          WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
            ...quote,
            preparedSwap: preparedSwapPda.publicKey,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            oracle: oraclePda.publicKey,
            tokenMintA: whirlpoolData.tokenMintA,
            tokenMintB: whirlpoolData.tokenMintB,

            // sqrt_price_limit = 0
            sqrtPriceLimit: ZERO_BN,
          }),
        ),
      );
      const returnData = parsePrepareSwapV2ReturnData(sim.returnData().data);

      assert.ok(!!returnData && "quoteSuccess" in returnData);
      assert.ok(returnData.quoteSuccess.amount.lt(quote.amount)); // partial fill
      assert.ok(returnData.quoteSuccess.amount.eq(quote.estimatedAmountIn));
      assert.ok(
        returnData.quoteSuccess.otherAmount.eq(quote.estimatedAmountOut),
      );
      assert.ok(
        returnData.quoteSuccess.nextSqrtPrice.eq(quote.estimatedEndSqrtPrice),
      );
      assert.ok(
        returnData.quoteSuccess.nextTickIndex === quote.estimatedEndTickIndex,
      );
      assert.ok(returnData.quoteSuccess.nextSqrtPrice.eq(MIN_SQRT_PRICE_BN));
      assert.ok(returnData.quoteSuccess.otherAmount.isZero());
    });

    // |-min,T---------***-S-|  (*: liquidity, S: start, T: end)
    it("QuoteSuccess: ExactIn, sqrt_price_limit = MIN_SQRT_PRICE", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("223379098170764880");
      const quote = await swapQuoteByInputToken(
        whirlpool,
        whirlpoolData.tokenMintA,
        amount.muln(2), // x2 input
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      const sim = await simulateTransaction(
        ctx.provider,
        toTx(
          ctx,
          WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
            ...quote,
            preparedSwap: preparedSwapPda.publicKey,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            oracle: oraclePda.publicKey,
            tokenMintA: whirlpoolData.tokenMintA,
            tokenMintB: whirlpoolData.tokenMintB,

            // sqrt_price_limit = MIN_SQRT_PRICE
            sqrtPriceLimit: MIN_SQRT_PRICE_BN,
          }),
        ),
      );
      const returnData = parsePrepareSwapV2ReturnData(sim.returnData().data);

      assert.ok(!!returnData && "quoteSuccess" in returnData);
      assert.ok(returnData.quoteSuccess.amount.lt(quote.amount)); // partial fill
      assert.ok(returnData.quoteSuccess.amount.eq(quote.estimatedAmountIn));
      assert.ok(
        returnData.quoteSuccess.otherAmount.eq(quote.estimatedAmountOut),
      );
      assert.ok(
        returnData.quoteSuccess.nextSqrtPrice.eq(quote.estimatedEndSqrtPrice),
      );
      assert.ok(
        returnData.quoteSuccess.nextTickIndex === quote.estimatedEndTickIndex,
      );
      assert.ok(returnData.quoteSuccess.nextSqrtPrice.eq(MIN_SQRT_PRICE_BN));
      assert.ok(returnData.quoteSuccess.otherAmount.isZero());
    });

    // |-min,T---------***-S-|  (*: liquidity, S: start, T: end)
    it("QuoteError: ExactOut, sqrt_price_limit = 0", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("1");
      const quote = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintB,
        amount,
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      const sim = await simulateTransaction(
        ctx.provider,
        toTx(
          ctx,
          WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
            ...quote,
            preparedSwap: preparedSwapPda.publicKey,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            oracle: oraclePda.publicKey,
            tokenMintA: whirlpoolData.tokenMintA,
            tokenMintB: whirlpoolData.tokenMintB,

            // sqrt_price_limit = 0
            sqrtPriceLimit: ZERO_BN,
            amount, // 1
          }),
        ),
      );
      const returnData = parsePrepareSwapV2ReturnData(sim.returnData().data);

      assert.ok(!!returnData && "quoteError" in returnData);
      assert.equal(returnData.quoteError.errorCode.toNumber(), 0x17a9); // PartialFillError
    });

    // |-min,T---------***-S-|  (*: liquidity, S: start, T: end)
    it("QuoteSuccess: ExactOut, sqrt_price_limit = MAX_SQRT_PRICE", async () => {
      const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
      const whirlpoolData = whirlpool.getData();

      const amount = new BN("1");
      const quote = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintB,
        amount,
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      const sim = await simulateTransaction(
        ctx.provider,
        toTx(
          ctx,
          WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
            ...quote,
            preparedSwap: preparedSwapPda.publicKey,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            oracle: oraclePda.publicKey,
            tokenMintA: whirlpoolData.tokenMintA,
            tokenMintB: whirlpoolData.tokenMintB,

            // sqrt_price_limit = MIN_SQRT_PRICE
            sqrtPriceLimit: MIN_SQRT_PRICE_BN,
            amount, // 1
          }),
        ),
      );
      const returnData = parsePrepareSwapV2ReturnData(sim.returnData().data);

      assert.ok(!!returnData && "quoteSuccess" in returnData);
      assert.ok(returnData.quoteSuccess.amount.lt(quote.amount)); // partial fill
      assert.ok(returnData.quoteSuccess.amount.eq(quote.estimatedAmountOut));
      assert.ok(
        returnData.quoteSuccess.otherAmount.eq(quote.estimatedAmountIn),
      );
      assert.ok(
        returnData.quoteSuccess.nextSqrtPrice.eq(quote.estimatedEndSqrtPrice),
      );
      assert.ok(
        returnData.quoteSuccess.nextTickIndex === quote.estimatedEndTickIndex,
      );
      assert.ok(returnData.quoteSuccess.nextSqrtPrice.eq(MIN_SQRT_PRICE_BN));
      assert.ok(returnData.quoteSuccess.amount.isZero());
    });
  });
  */
});
