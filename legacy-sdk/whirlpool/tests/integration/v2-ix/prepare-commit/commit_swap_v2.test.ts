import type * as anchor from "@coral-xyz/anchor";
import { MathUtil, Percentage, U64_MAX } from "@orca-so/common-sdk";
import type { PDA } from "@orca-so/common-sdk";
import * as assert from "assert";
import { BN } from "bn.js";
import Decimal from "decimal.js";
import type {
  WhirlpoolContext,
  CommitSwapV2Params} from "../../../../src";
import {
  InitPoolV2Params,
  WhirlpoolData,
  SwapQuote,
  TickUtil,
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
  warpClock,
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
  getWhirlpoolStateSequence,
  parsePreparedSwap,
  parsePrepareSwapV2ReturnData,
  PREPARED_SWAP_STATE_COMMITTED,
  PREPARED_SWAP_STATE_PREPARED,
  PREPARED_SWAP_STATE_UNPREPARED,
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

  async function setup() {
    const {
      configKeypairs,
      poolInitInfo,
      whirlpoolPda,
      tokenAccountA,
      tokenAccountB,
    } = await initTestPoolWithTokensV2(
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
      configKeypairs,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
    };
  }

  describe("invalid accounts", () => {
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
      const preparedSwapAccountInfo = await ctx.connection.getAccountInfo(
        preparedSwapPda.publicKey,
      );
      assert.ok(preparedSwapAccountInfo);
      const preparedSwapData = parsePreparedSwap(preparedSwapAccountInfo);
      assert.ok(preparedSwapData);
      assert.ok(preparedSwapData.state === PREPARED_SWAP_STATE_UNPREPARED);

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

    it("fails when the PreparedSwap account is in Committed state", async () => {
      const { params } = await setup();

      const preparedSwapAccountInfo0 = await ctx.connection.getAccountInfo(
        params.preparedSwap,
      );
      assert.ok(preparedSwapAccountInfo0);
      const preparedSwapData0 = parsePreparedSwap(preparedSwapAccountInfo0);
      assert.ok(preparedSwapData0);
      assert.ok(preparedSwapData0.state === PREPARED_SWAP_STATE_PREPARED);

      // commit successfully
      await toTx(
        ctx,
        WhirlpoolIx.commitSwapV2Ix(ctx.program, params),
      ).buildAndExecute();

      const preparedSwapAccountInfo1 = await ctx.connection.getAccountInfo(
        params.preparedSwap,
      );
      assert.ok(preparedSwapAccountInfo1);
      const preparedSwapData1 = parsePreparedSwap(preparedSwapAccountInfo1);
      assert.ok(preparedSwapData1);
      assert.ok(preparedSwapData1.state === PREPARED_SWAP_STATE_COMMITTED);

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, params),
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

  describe("precondition mismatch", () => {
    it("authority mismatch", async () => {
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

    it("whirlpool mismatch", async () => {
      const {
        params: { preparedSwap },
      } = await setup();

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

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            preparedSwap, // Prepared, but for the other whirlpool
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
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );
    });

    it("whirlpool state sequence mismatch", async () => {
      const { params, poolInitInfo, configKeypairs } = await setup();

      // update fee rate after prepare_swap_v2 ix in setup().
      const preWhirlpool = await fetcher.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );
      assert.ok(preWhirlpool);
      assert.ok(preWhirlpool.feeRate > 0);

      await toTx(
        ctx,
        WhirlpoolIx.setFeeRateIx(ctx.program, {
          feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
          whirlpoolsConfig: poolInitInfo.whirlpoolsConfig,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          feeRate: preWhirlpool.feeRate * 2,
        }),
      )
        .addSigner(configKeypairs.feeAuthorityKeypair)
        .buildAndExecute();

      const postWhirlpool = await fetcher.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );
      assert.ok(postWhirlpool);
      assert.ok(postWhirlpool.feeRate === preWhirlpool.feeRate * 2);

      // check state sequence increment
      const preStateSequence = getWhirlpoolStateSequence(preWhirlpool);
      const postStateSequence = getWhirlpoolStateSequence(postWhirlpool);
      assert.ok(postStateSequence === preStateSequence + 1);

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, params),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );
    });

    it("swap params mismatch", async () => {
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

      // add small Full-range liquidity
      const fullRange = TickUtil.getFullRangeTickIndex(TickSpacing.Standard);
      await initTickArrayRange(
        ctx,
        whirlpoolPda.publicKey,
        TickUtil.getStartTickIndex(fullRange[0], TickSpacing.Standard),
        1,
        TickSpacing.Standard,
        false,
      );
      await initTickArrayRange(
        ctx,
        whirlpoolPda.publicKey,
        TickUtil.getStartTickIndex(fullRange[1], TickSpacing.Standard),
        1,
        TickSpacing.Standard,
        false,
      );
      const fundParams: FundedPositionV2Params[] = [
        {
          liquidityAmount: new BN(10_000_000),
          tickLowerIndex: fullRange[0],
          tickUpperIndex: fullRange[1],
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

      const preparedSwapPda = PDAUtil.getPreparedSwap(
        ctx.program.programId,
        initializedPreparedSwapNonce,
      );

      const params: CommitSwapV2Params = {
        preparedSwap: preparedSwapPda.publicKey,
        amount: new BN(20),
        sqrtPriceLimit: ZERO_BN,
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

      const preparedSwapAccountInfo = await ctx.connection.getAccountInfo(
        preparedSwapPda.publicKey,
      );
      assert.ok(preparedSwapAccountInfo);
      const preparedSwapAccountData = parsePreparedSwap(
        preparedSwapAccountInfo,
      );
      assert.ok(preparedSwapAccountData);

      // amount
      assert.ok(preparedSwapAccountData.precondition.amount.eq(params.amount));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            amount: params.amount.addn(1),
          }),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );

      // sqrt_price_limit
      assert.ok(
        preparedSwapAccountData.precondition.sqrtPriceLimit.eq(ZERO_BN),
      );
      assert.ok(
        !preparedSwapAccountData.precondition.sqrtPriceLimit.eq(
          SwapUtils.getDefaultSqrtPriceLimit(params.aToB),
        ),
      );
      assert.ok(params.sqrtPriceLimit.eq(ZERO_BN));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(params.aToB),
          }),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );

      // amount_specified_is_input
      assert.ok(
        preparedSwapAccountData.precondition.amountSpecifiedIsInput ===
          params.amountSpecifiedIsInput,
      );
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            amountSpecifiedIsInput: !params.amountSpecifiedIsInput,
          }),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );

      // a_to_b
      assert.ok(preparedSwapAccountData.precondition.aToB === params.aToB);
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...params,
            aToB: !params.aToB,
          }),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );
    });

    it("slot mismatch", async () => {
      const preSlot = (await ctx.connection.getEpochInfo()).absoluteSlot;
      const { params } = await setup();

      const preparedSwapAccountInfo = await ctx.connection.getAccountInfo(
        params.preparedSwap,
      );
      assert.ok(preparedSwapAccountInfo);
      const preparedSwapAccountData = parsePreparedSwap(
        preparedSwapAccountInfo,
      );
      assert.ok(preparedSwapAccountData);
      assert.ok(
        preparedSwapAccountData.precondition.slot.toNumber() === preSlot,
      );

      warpClock(1);

      const postSlot = (await ctx.connection.getEpochInfo()).absoluteSlot;
      assert.ok(postSlot > preSlot);

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, params),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );
    });
  });
});
