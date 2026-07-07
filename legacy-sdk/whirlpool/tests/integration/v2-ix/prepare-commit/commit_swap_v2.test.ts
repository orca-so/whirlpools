import type * as anchor from "@coral-xyz/anchor";
import { MathUtil, Percentage } from "@orca-so/common-sdk";
import * as assert from "assert";
import { BN } from "bn.js";
import Decimal from "decimal.js";
import type {
  WhirlpoolContext,
  CommitSwapV2Params,
  WhirlpoolData,
} from "../../../../src";
import {
  TickUtil,
  PROTOCOL_FEE_RATE_MUL_VALUE,
  PriceMath,
  buildWhirlpoolClient,
  increaseLiquidityQuoteByLiquidityWithParams,
} from "../../../../src";
import {
  MAX_PREPARED_SWAP_NONCE,
  MEMO_PROGRAM_ADDRESS,
  NO_ORACLE_DATA,
  PDAUtil,
  SwapUtils,
  WhirlpoolIx,
  swapQuoteWithParams,
  toTx,
} from "../../../../src";
import { IGNORE_CACHE } from "../../../../src/network/public/fetcher";
import {
  MAX_U64,
  TickSpacing,
  ZERO_BN,
  initializeLiteSVMEnvironment,
  pollForCondition,
  warpClock,
} from "../../../utils";
import {
  initTestPoolWithTokens,
  initTickArrayRange,
} from "../../../utils/init-utils";
import type { FundedPositionV2Params } from "../../../utils/v2/init-utils-v2";
import {
  fundPositionsV2,
  initTestPoolWithTokensV2,
} from "../../../utils/v2/init-utils-v2";
import { createMintV2 } from "../../../utils/v2/token-2022";
import {
  NO_TOKEN_EXTENSION_CONTEXT,
  TokenExtensionUtil,
} from "../../../../src/utils/public/token-extension-util";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  getWhirlpoolStateSequence,
  parsePreparedSwap,
  PREPARED_SWAP_STATE_COMMITTED,
  PREPARED_SWAP_STATE_PREPARED,
  PREPARED_SWAP_STATE_UNPREPARED,
} from "../../../utils/prepare-commit-test-utils";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("commit_swap_v2", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

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

  describe("provided tickarrays are not sufficient (prepare/commit mismatch)", () => {
    async function setupSparsePool() {
      // Test pool state
      // Note: [initialized TA], (uninitialized TA)
      //
      // init price                                           p
      // liq 3 (on -11264TA)          |-----|
      // liq 2 (on 5632TA)                                           |-----|
      // liq 1 (full)       |------------------------------------------------------------------------|
      // TA  [full range lower TA]...[-11264 TA](-5632 TA)(0 TA    )[5632 TA   ](11264TA   ) ... [full range upper TA]
      const { whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokens(
          ctx,
          TickSpacing.SixtyFour,
          PriceMath.tickIndexToSqrtPriceX64(2816),
          MAX_U64,
        );

      const client = buildWhirlpoolClient(ctx);

      const pool = await client.getPool(whirlpoolPda.publicKey);

      const fullRange = TickUtil.getFullRangeTickIndex(
        pool.getData().tickSpacing,
      );
      await (await pool.initTickArrayForTicks([
        ...fullRange,
        -11264,
        5632,
      ]))!.buildAndExecute();

      // provide liquidity
      const priceDeviation = Percentage.fromFraction(1, 10_000);
      const { lowerBound, upperBound } = PriceMath.getSlippageBoundForSqrtPrice(
        pool.getData().sqrtPrice,
        priceDeviation,
      );
      // liq 1 (full range)
      {
        const liquidity = new BN(100000000);
        const tickLowerIndex = fullRange[0];
        const tickUpperIndex = fullRange[1];
        const depositQuote = increaseLiquidityQuoteByLiquidityWithParams({
          liquidity: liquidity,
          slippageTolerance: Percentage.fromFraction(0, 100),
          sqrtPrice: pool.getData().sqrtPrice,
          tickCurrentIndex: pool.getData().tickCurrentIndex,
          tickLowerIndex,
          tickUpperIndex,
          tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
        });
        const mintAndTx = await pool.openPosition(
          tickLowerIndex,
          tickUpperIndex,
          {
            ...depositQuote,
            minSqrtPrice: lowerBound[0],
            maxSqrtPrice: upperBound[0],
          },
        );
        await mintAndTx.tx.buildAndExecute();
      }
      // liq 2
      {
        const liquidity = new BN(200000);
        const tickLowerIndex = 5632 + 64;
        const tickUpperIndex = 5632 + 64 + 64;
        const depositQuote = increaseLiquidityQuoteByLiquidityWithParams({
          liquidity: liquidity,
          slippageTolerance: Percentage.fromFraction(0, 100),
          sqrtPrice: pool.getData().sqrtPrice,
          tickCurrentIndex: pool.getData().tickCurrentIndex,
          tickLowerIndex,
          tickUpperIndex,
          tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
        });
        const mintAndTx = await pool.openPosition(
          tickLowerIndex,
          tickUpperIndex,
          {
            ...depositQuote,
            minSqrtPrice: lowerBound[0],
            maxSqrtPrice: upperBound[0],
          },
        );
        await mintAndTx.tx.buildAndExecute();
      }
      // liq 3
      {
        const liquidity = new BN(300000);
        const tickLowerIndex = -5632 - 128 - 64;
        const tickUpperIndex = -5632 - 128;
        const depositQuote = increaseLiquidityQuoteByLiquidityWithParams({
          liquidity: liquidity,
          slippageTolerance: Percentage.fromFraction(0, 100),
          sqrtPrice: pool.getData().sqrtPrice,
          tickCurrentIndex: pool.getData().tickCurrentIndex,
          tickLowerIndex,
          tickUpperIndex,
          tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
        });
        const mintAndTx = await pool.openPosition(
          tickLowerIndex,
          tickUpperIndex,
          {
            ...depositQuote,
            minSqrtPrice: lowerBound[0],
            maxSqrtPrice: upperBound[0],
          },
        );
        await mintAndTx.tx.buildAndExecute();
      }

      const oraclePda = PDAUtil.getOracle(
        ctx.program.programId,
        whirlpoolPda.publicKey,
      );
      const preparedSwapPda = PDAUtil.getPreparedSwap(
        ctx.program.programId,
        initializedPreparedSwapNonce,
      );

      return {
        whirlpool: whirlpoolPda.publicKey,
        oracle: oraclePda.publicKey,
        preparedSwap: preparedSwapPda.publicKey,
        tokenAccountA,
        tokenAccountB,
      };
    }

    async function setupSparsePoolAndQuote(
      aToB: boolean,
      tokenAmount: anchor.BN,
    ) {
      const { whirlpool, oracle, preparedSwap, tokenAccountA, tokenAccountB } =
        await setupSparsePool();

      const whirlpoolData = (await fetcher.getPool(
        whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;
      const quote = swapQuoteWithParams(
        {
          amountSpecifiedIsInput: true,
          aToB,
          tokenAmount,
          otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
          sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
          whirlpoolData: whirlpoolData,
          tickArrays: await SwapUtils.getTickArrays(
            whirlpoolData.tickCurrentIndex,
            whirlpoolData.tickSpacing,
            aToB,
            ctx.program.programId,
            whirlpool,
            fetcher,
            IGNORE_CACHE,
          ),
          tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
          oracleData: NO_ORACLE_DATA,
        },
        Percentage.fromFraction(1, 100),
      );

      const params: CommitSwapV2Params = {
        ...quote,
        preparedSwap,
        whirlpool,
        tokenAuthority: ctx.wallet.publicKey,
        tokenMintA: whirlpoolData.tokenMintA,
        tokenMintB: whirlpoolData.tokenMintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: whirlpoolData.tokenVaultA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: whirlpoolData.tokenVaultB,
        oracle,
      };

      const tickArrayPos0 = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpool,
        0,
      ).publicKey;
      const tickArrayPos5632 = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpool,
        5632,
      ).publicKey;
      const tickArrayPos11264 = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpool,
        11264,
      ).publicKey;
      const tickArrayNeg5632 = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpool,
        -5632,
      ).publicKey;
      const tickArrayNeg11264 = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpool,
        -11264,
      ).publicKey;

      return {
        whirlpool,
        oracle,
        preparedSwap,
        tokenAccountA,
        tokenAccountB,
        quote,
        params,
        tickArrayPos0,
        tickArrayPos5632,
        tickArrayPos11264,
        tickArrayNeg5632,
        tickArrayNeg11264,
      };
    }

    it("walk & stop on one uninitialized TickArray (B to A, tick: 2816 -> 4477)", async () => {
      const aToB = false;
      const tokenAmount = new BN(10000000);

      const setupInfo = await setupSparsePoolAndQuote(aToB, tokenAmount);
      const quote = setupInfo.quote;
      const baseParams = setupInfo.params;

      const preWhirlpoolData = (await fetcher.getPool(
        setupInfo.whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      assert.equal(preWhirlpoolData.tickCurrentIndex, 2816);
      assert.equal(quote.estimatedEndTickIndex, 4477);

      await toTx(
        ctx,
        WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
          ...baseParams,
          tickArray0: setupInfo.tickArrayPos0,
          tickArray1: setupInfo.tickArrayPos0,
          tickArray2: setupInfo.tickArrayPos0,
        }),
      ).buildAndExecute();

      const preparedSwapAccountInfo = await ctx.connection.getAccountInfo(
        setupInfo.preparedSwap,
      );
      assert.ok(preparedSwapAccountInfo);
      const preparedSwapData = parsePreparedSwap(preparedSwapAccountInfo);
      assert.ok(preparedSwapData);

      assert.ok(preparedSwapData.state === PREPARED_SWAP_STATE_PREPARED);
      assert.ok(
        preparedSwapData.precondition.whirlpool.equals(setupInfo.whirlpool),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextSqrtPrice.eq(
          quote.estimatedEndSqrtPrice,
        ),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextTickIndex ===
          quote.estimatedEndTickIndex,
      );
      assert.ok(
        quote.estimatedAmountIn.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB,
        ),
      );
      assert.ok(
        quote.estimatedAmountOut.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA,
        ),
      );
      assert.equal(preparedSwapData.pendingUpdates.pendingTickUpdatesLen, 0);

      await toTx(
        ctx,
        WhirlpoolIx.commitSwapV2Ix(ctx.program, {
          ...baseParams,
          tickArray0: setupInfo.tickArrayPos0,
          tickArray1: setupInfo.tickArrayPos0,
          tickArray2: setupInfo.tickArrayPos0,
        }),
      ).buildAndExecute();

      const postWhirlpoolData = (await fetcher.getPool(
        setupInfo.whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      assert.ok(postWhirlpoolData.sqrtPrice.eq(quote.estimatedEndSqrtPrice));
      assert.ok(
        postWhirlpoolData.tickCurrentIndex === quote.estimatedEndTickIndex,
      );
    });

    it("stop on an initialized TickArray (B to A, tick: 2816 -> 7435)", async () => {
      const aToB = false;
      const tokenAmount = new BN(30000000);

      const setupInfo = await setupSparsePoolAndQuote(aToB, tokenAmount);
      const quote = setupInfo.quote;
      const baseParams = setupInfo.params;

      const preWhirlpoolData = (await fetcher.getPool(
        setupInfo.whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      assert.equal(preWhirlpoolData.tickCurrentIndex, 2816);
      assert.equal(quote.estimatedEndTickIndex, 7435);

      await toTx(
        ctx,
        WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
          ...baseParams,
          tickArray0: setupInfo.tickArrayPos0,
          tickArray1: setupInfo.tickArrayPos5632,
          tickArray2: setupInfo.tickArrayPos5632,
        }),
      ).buildAndExecute();

      const preparedSwapAccountInfo = await ctx.connection.getAccountInfo(
        setupInfo.preparedSwap,
      );
      assert.ok(preparedSwapAccountInfo);
      const preparedSwapData = parsePreparedSwap(preparedSwapAccountInfo);
      assert.ok(preparedSwapData);

      assert.ok(preparedSwapData.state === PREPARED_SWAP_STATE_PREPARED);
      assert.ok(
        preparedSwapData.precondition.whirlpool.equals(setupInfo.whirlpool),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextSqrtPrice.eq(
          quote.estimatedEndSqrtPrice,
        ),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextTickIndex ===
          quote.estimatedEndTickIndex,
      );
      assert.ok(
        quote.estimatedAmountIn.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB,
        ),
      );
      assert.ok(
        quote.estimatedAmountOut.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA,
        ),
      );
      assert.equal(preparedSwapData.pendingUpdates.pendingTickUpdatesLen, 2);

      // TickArray with the start tick 5632 has initialized ticks (pending updates).
      // So commit instruction must receive it.
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...baseParams,
            tickArray0: setupInfo.tickArrayPos0,
            tickArray1: setupInfo.tickArrayPos0,
            tickArray2: setupInfo.tickArrayPos0,
          }),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );

      // tickArrayPos5632 skipped
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...baseParams,
            tickArray0: setupInfo.tickArrayPos0,
            tickArray1: setupInfo.tickArrayPos11264,
            tickArray2: setupInfo.tickArrayPos11264,
          }),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );

      await toTx(
        ctx,
        WhirlpoolIx.commitSwapV2Ix(ctx.program, {
          ...baseParams,
          tickArray0: setupInfo.tickArrayPos0,
          tickArray1: setupInfo.tickArrayPos5632,
          tickArray2: setupInfo.tickArrayPos5632,
        }),
      ).buildAndExecute();

      const postWhirlpoolData = (await fetcher.getPool(
        setupInfo.whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      assert.ok(postWhirlpoolData.sqrtPrice.eq(quote.estimatedEndSqrtPrice));
      assert.ok(
        postWhirlpoolData.tickCurrentIndex === quote.estimatedEndTickIndex,
      );
    });

    it("stop on an uninitialized TickArray (B to A, tick: 2816 -> 13344)", async () => {
      const aToB = false;
      const tokenAmount = new BN(80000000);

      const setupInfo = await setupSparsePoolAndQuote(aToB, tokenAmount);
      const quote = setupInfo.quote;
      const baseParams = setupInfo.params;

      const preWhirlpoolData = (await fetcher.getPool(
        setupInfo.whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      assert.equal(preWhirlpoolData.tickCurrentIndex, 2816);
      assert.equal(quote.estimatedEndTickIndex, 13344);

      await toTx(
        ctx,
        WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
          ...baseParams,
          tickArray0: setupInfo.tickArrayPos0,
          tickArray1: setupInfo.tickArrayPos5632,
          tickArray2: setupInfo.tickArrayPos11264,
        }),
      ).buildAndExecute();

      const preparedSwapAccountInfo = await ctx.connection.getAccountInfo(
        setupInfo.preparedSwap,
      );
      assert.ok(preparedSwapAccountInfo);
      const preparedSwapData = parsePreparedSwap(preparedSwapAccountInfo);
      assert.ok(preparedSwapData);

      assert.ok(preparedSwapData.state === PREPARED_SWAP_STATE_PREPARED);
      assert.ok(
        preparedSwapData.precondition.whirlpool.equals(setupInfo.whirlpool),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextSqrtPrice.eq(
          quote.estimatedEndSqrtPrice,
        ),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextTickIndex ===
          quote.estimatedEndTickIndex,
      );
      assert.ok(
        quote.estimatedAmountIn.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB,
        ),
      );
      assert.ok(
        quote.estimatedAmountOut.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA,
        ),
      );
      assert.equal(preparedSwapData.pendingUpdates.pendingTickUpdatesLen, 2);

      // TickArray with the start tick 5632 has initialized ticks (pending updates).
      // So commit instruction must receive it.
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...baseParams,
            tickArray0: setupInfo.tickArrayPos0,
            tickArray1: setupInfo.tickArrayPos0,
            tickArray2: setupInfo.tickArrayPos0,
          }),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );

      // missing tickArrayPos5632
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...baseParams,
            tickArray0: setupInfo.tickArrayPos0,
            tickArray1: setupInfo.tickArrayPos11264,
            tickArray2: setupInfo.tickArrayPos11264,
          }),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );

      // Swap will stop on tick 13344.
      // The tick 13344 is on TickArray with the start tick 11264.
      // It is not initialized and so it doesn't have any initialized ticks.
      // So no pending tick updates on it.
      // But it SHOULD receive same TickArrays as the prepare instruction receives.
      //
      // Note: Even if this TickArray were not provided, no data inconsistency would occur because the TickArray is uninitialized.
      // However, traversing a TickArray that was not passed in is an unnatural situation,
      // and there is no reason for prepare and commit to receive different sets of TickArrays. Therefore, this is treated as an error.
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...baseParams,
            tickArray0: setupInfo.tickArrayPos0,
            tickArray1: setupInfo.tickArrayPos5632,
            tickArray2: setupInfo.tickArrayPos5632,
          }),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );

      await toTx(
        ctx,
        WhirlpoolIx.commitSwapV2Ix(ctx.program, {
          ...baseParams,
          tickArray0: setupInfo.tickArrayPos0,
          tickArray1: setupInfo.tickArrayPos5632,
          tickArray2: setupInfo.tickArrayPos11264,
        }),
      ).buildAndExecute();

      const postWhirlpoolData = (await fetcher.getPool(
        setupInfo.whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      assert.ok(postWhirlpoolData.sqrtPrice.eq(quote.estimatedEndSqrtPrice));
      assert.ok(
        postWhirlpoolData.tickCurrentIndex === quote.estimatedEndTickIndex,
      );
    });

    it("walk & stop on one uninitialized TickArray (A to B, tick: 2816 -> 1699)", async () => {
      const aToB = true;
      const tokenAmount = new BN(5000000);

      const setupInfo = await setupSparsePoolAndQuote(aToB, tokenAmount);
      const quote = setupInfo.quote;
      const baseParams = setupInfo.params;

      const preWhirlpoolData = (await fetcher.getPool(
        setupInfo.whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      assert.equal(preWhirlpoolData.tickCurrentIndex, 2816);
      assert.equal(quote.estimatedEndTickIndex, 1699);

      await toTx(
        ctx,
        WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
          ...baseParams,
          tickArray0: setupInfo.tickArrayPos0,
          tickArray1: setupInfo.tickArrayPos0,
          tickArray2: setupInfo.tickArrayPos0,
        }),
      ).buildAndExecute();

      const preparedSwapAccountInfo = await ctx.connection.getAccountInfo(
        setupInfo.preparedSwap,
      );
      assert.ok(preparedSwapAccountInfo);
      const preparedSwapData = parsePreparedSwap(preparedSwapAccountInfo);
      assert.ok(preparedSwapData);

      assert.ok(preparedSwapData.state === PREPARED_SWAP_STATE_PREPARED);
      assert.ok(
        preparedSwapData.precondition.whirlpool.equals(setupInfo.whirlpool),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextSqrtPrice.eq(
          quote.estimatedEndSqrtPrice,
        ),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextTickIndex ===
          quote.estimatedEndTickIndex,
      );
      assert.ok(
        quote.estimatedAmountIn.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB,
        ),
      );
      assert.ok(
        quote.estimatedAmountOut.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA,
        ),
      );
      assert.equal(preparedSwapData.pendingUpdates.pendingTickUpdatesLen, 0);

      await toTx(
        ctx,
        WhirlpoolIx.commitSwapV2Ix(ctx.program, {
          ...baseParams,
          tickArray0: setupInfo.tickArrayPos0,
          tickArray1: setupInfo.tickArrayPos0,
          tickArray2: setupInfo.tickArrayPos0,
        }),
      ).buildAndExecute();

      const postWhirlpoolData = (await fetcher.getPool(
        setupInfo.whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      assert.ok(postWhirlpoolData.sqrtPrice.eq(quote.estimatedEndSqrtPrice));
      assert.ok(
        postWhirlpoolData.tickCurrentIndex === quote.estimatedEndTickIndex,
      );
    });

    it("stop on an uninitialized TickArray (A to B, tick: 2816 -> -3103)", async () => {
      const aToB = true;
      const tokenAmount = new BN(30000000);

      const setupInfo = await setupSparsePoolAndQuote(aToB, tokenAmount);
      const quote = setupInfo.quote;
      const baseParams = setupInfo.params;

      const preWhirlpoolData = (await fetcher.getPool(
        setupInfo.whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      assert.equal(preWhirlpoolData.tickCurrentIndex, 2816);
      assert.equal(quote.estimatedEndTickIndex, -3103);

      await toTx(
        ctx,
        WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
          ...baseParams,
          tickArray0: setupInfo.tickArrayPos0,
          tickArray1: setupInfo.tickArrayNeg5632,
          tickArray2: setupInfo.tickArrayNeg5632,
        }),
      ).buildAndExecute();

      const preparedSwapAccountInfo = await ctx.connection.getAccountInfo(
        setupInfo.preparedSwap,
      );
      assert.ok(preparedSwapAccountInfo);
      const preparedSwapData = parsePreparedSwap(preparedSwapAccountInfo);
      assert.ok(preparedSwapData);

      assert.ok(preparedSwapData.state === PREPARED_SWAP_STATE_PREPARED);
      assert.ok(
        preparedSwapData.precondition.whirlpool.equals(setupInfo.whirlpool),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextSqrtPrice.eq(
          quote.estimatedEndSqrtPrice,
        ),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextTickIndex ===
          quote.estimatedEndTickIndex,
      );
      assert.ok(
        quote.estimatedAmountIn.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB,
        ),
      );
      assert.ok(
        quote.estimatedAmountOut.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA,
        ),
      );
      assert.equal(preparedSwapData.pendingUpdates.pendingTickUpdatesLen, 0);

      // Swap will stop on tick -3103.
      // The tick -3103 is on TickArray with the start tick -5632.
      // It is not initialized and so it doesn't have any initialized ticks.
      // So no pending tick updates on it.
      // But it SHOULD receive same TickArrays as the prepare instruction receives.
      //
      // Note: Even if this TickArray were not provided, no data inconsistency would occur because the TickArray is uninitialized.
      // However, traversing a TickArray that was not passed in is an unnatural situation,
      // and there is no reason for prepare and commit to receive different sets of TickArrays. Therefore, this is treated as an error.
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...baseParams,
            tickArray0: setupInfo.tickArrayPos0,
            tickArray1: setupInfo.tickArrayPos0,
            tickArray2: setupInfo.tickArrayPos0,
          }),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );

      await toTx(
        ctx,
        WhirlpoolIx.commitSwapV2Ix(ctx.program, {
          ...baseParams,
          tickArray0: setupInfo.tickArrayPos0,
          tickArray1: setupInfo.tickArrayNeg5632,
          tickArray2: setupInfo.tickArrayNeg5632,
        }),
      ).buildAndExecute();

      const postWhirlpoolData = (await fetcher.getPool(
        setupInfo.whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      assert.ok(postWhirlpoolData.sqrtPrice.eq(quote.estimatedEndSqrtPrice));
      assert.ok(
        postWhirlpoolData.tickCurrentIndex === quote.estimatedEndTickIndex,
      );
    });

    it("stop on an initialized TickArray (A to B, tick: 2816 -> -11148)", async () => {
      const aToB = true;
      const tokenAmount = new BN(88000000);

      const setupInfo = await setupSparsePoolAndQuote(aToB, tokenAmount);
      const quote = setupInfo.quote;
      const baseParams = setupInfo.params;

      const preWhirlpoolData = (await fetcher.getPool(
        setupInfo.whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      assert.equal(preWhirlpoolData.tickCurrentIndex, 2816);
      assert.equal(quote.estimatedEndTickIndex, -11148);

      await toTx(
        ctx,
        WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
          ...baseParams,
          tickArray0: setupInfo.tickArrayPos0,
          tickArray1: setupInfo.tickArrayNeg5632,
          tickArray2: setupInfo.tickArrayNeg11264,
        }),
      ).buildAndExecute();

      const preparedSwapAccountInfo = await ctx.connection.getAccountInfo(
        setupInfo.preparedSwap,
      );
      assert.ok(preparedSwapAccountInfo);
      const preparedSwapData = parsePreparedSwap(preparedSwapAccountInfo);
      assert.ok(preparedSwapData);

      assert.ok(preparedSwapData.state === PREPARED_SWAP_STATE_PREPARED);
      assert.ok(
        preparedSwapData.precondition.whirlpool.equals(setupInfo.whirlpool),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextSqrtPrice.eq(
          quote.estimatedEndSqrtPrice,
        ),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextTickIndex ===
          quote.estimatedEndTickIndex,
      );
      assert.ok(
        quote.estimatedAmountIn.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB,
        ),
      );
      assert.ok(
        quote.estimatedAmountOut.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA,
        ),
      );
      assert.equal(preparedSwapData.pendingUpdates.pendingTickUpdatesLen, 2);

      // tickArrayNeg11264 has pending updates.
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...baseParams,
            tickArray0: setupInfo.tickArrayPos0,
            tickArray1: setupInfo.tickArrayPos0,
            tickArray2: setupInfo.tickArrayPos0,
          }),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );

      // tickArrayNeg11264 has pending updates.
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...baseParams,
            tickArray0: setupInfo.tickArrayPos0,
            tickArray1: setupInfo.tickArrayNeg5632,
            tickArray2: setupInfo.tickArrayNeg5632,
          }),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );

      // no tickArrayNeg5632
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...baseParams,
            tickArray0: setupInfo.tickArrayPos0,
            tickArray1: setupInfo.tickArrayNeg11264,
            tickArray2: setupInfo.tickArrayNeg11264,
          }),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );

      await toTx(
        ctx,
        WhirlpoolIx.commitSwapV2Ix(ctx.program, {
          ...baseParams,
          tickArray0: setupInfo.tickArrayPos0,
          tickArray1: setupInfo.tickArrayNeg5632,
          tickArray2: setupInfo.tickArrayNeg11264,
        }),
      ).buildAndExecute();

      const postWhirlpoolData = (await fetcher.getPool(
        setupInfo.whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      assert.ok(postWhirlpoolData.sqrtPrice.eq(quote.estimatedEndSqrtPrice));
      assert.ok(
        postWhirlpoolData.tickCurrentIndex === quote.estimatedEndTickIndex,
      );
    });

    it("commit instruction receive more tick arrays than prepare (B to A, tick: 2816 -> 4477)", async () => {
      const aToB = false;
      const tokenAmount = new BN(10000000);

      const setupInfo = await setupSparsePoolAndQuote(aToB, tokenAmount);
      const quote = setupInfo.quote;
      const baseParams = setupInfo.params;

      const preWhirlpoolData = (await fetcher.getPool(
        setupInfo.whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      assert.equal(preWhirlpoolData.tickCurrentIndex, 2816);
      assert.equal(quote.estimatedEndTickIndex, 4477);

      await toTx(
        ctx,
        WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
          ...baseParams,
          tickArray0: setupInfo.tickArrayPos0,
          tickArray1: setupInfo.tickArrayPos0,
          tickArray2: setupInfo.tickArrayPos0,
        }),
      ).buildAndExecute();

      const preparedSwapAccountInfo = await ctx.connection.getAccountInfo(
        setupInfo.preparedSwap,
      );
      assert.ok(preparedSwapAccountInfo);
      const preparedSwapData = parsePreparedSwap(preparedSwapAccountInfo);
      assert.ok(preparedSwapData);

      assert.ok(preparedSwapData.state === PREPARED_SWAP_STATE_PREPARED);
      assert.ok(
        preparedSwapData.precondition.whirlpool.equals(setupInfo.whirlpool),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextSqrtPrice.eq(
          quote.estimatedEndSqrtPrice,
        ),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextTickIndex ===
          quote.estimatedEndTickIndex,
      );
      assert.ok(
        quote.estimatedAmountIn.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB,
        ),
      );
      assert.ok(
        quote.estimatedAmountOut.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA,
        ),
      );
      assert.equal(preparedSwapData.pendingUpdates.pendingTickUpdatesLen, 0);

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...baseParams,
            tickArray0: setupInfo.tickArrayPos0,
            tickArray1: setupInfo.tickArrayPos5632,
            tickArray2: setupInfo.tickArrayPos5632,
          }),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );
    });

    it("commit instruction receive more tick arrays than prepare  (A to B, tick: 2816 -> 1699)", async () => {
      const aToB = true;
      const tokenAmount = new BN(5000000);

      const setupInfo = await setupSparsePoolAndQuote(aToB, tokenAmount);
      const quote = setupInfo.quote;
      const baseParams = setupInfo.params;

      const preWhirlpoolData = (await fetcher.getPool(
        setupInfo.whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      assert.equal(preWhirlpoolData.tickCurrentIndex, 2816);
      assert.equal(quote.estimatedEndTickIndex, 1699);

      await toTx(
        ctx,
        WhirlpoolIx.prepareSwapV2Ix(ctx.program, {
          ...baseParams,
          tickArray0: setupInfo.tickArrayPos0,
          tickArray1: setupInfo.tickArrayPos0,
          tickArray2: setupInfo.tickArrayPos0,
        }),
      ).buildAndExecute();

      const preparedSwapAccountInfo = await ctx.connection.getAccountInfo(
        setupInfo.preparedSwap,
      );
      assert.ok(preparedSwapAccountInfo);
      const preparedSwapData = parsePreparedSwap(preparedSwapAccountInfo);
      assert.ok(preparedSwapData);

      assert.ok(preparedSwapData.state === PREPARED_SWAP_STATE_PREPARED);
      assert.ok(
        preparedSwapData.precondition.whirlpool.equals(setupInfo.whirlpool),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextSqrtPrice.eq(
          quote.estimatedEndSqrtPrice,
        ),
      );
      assert.ok(
        preparedSwapData.pendingUpdates.pendingPostSwapUpdate.nextTickIndex ===
          quote.estimatedEndTickIndex,
      );
      assert.ok(
        quote.estimatedAmountIn.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB,
        ),
      );
      assert.ok(
        quote.estimatedAmountOut.eq(
          aToB
            ? preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountB
            : preparedSwapData.pendingUpdates.pendingPostSwapUpdate.amountA,
        ),
      );
      assert.equal(preparedSwapData.pendingUpdates.pendingTickUpdatesLen, 0);

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.commitSwapV2Ix(ctx.program, {
            ...baseParams,
            tickArray0: setupInfo.tickArrayPos0,
            tickArray1: setupInfo.tickArrayNeg5632,
            tickArray2: setupInfo.tickArrayNeg5632,
          }),
        ).buildAndExecute(),
        /0x17b9/, // PreparedSwapPreconditionMismatch
      );
    });
  });

  it("emit Traded event", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokensV2(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
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
        liquidityAmount: new BN(10_000_000),
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
    const whirlpoolDataPre = (await fetcher.getPool(
      whirlpoolKey,
      IGNORE_CACHE,
    )) as WhirlpoolData;
    const quote = swapQuoteWithParams(
      {
        amountSpecifiedIsInput: true,
        aToB: false,
        tokenAmount: new BN(100000),
        otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
        sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(false),
        whirlpoolData: whirlpoolDataPre,
        tickArrays: await SwapUtils.getTickArrays(
          whirlpoolDataPre.tickCurrentIndex,
          whirlpoolDataPre.tickSpacing,
          false,
          ctx.program.programId,
          whirlpoolKey,
          fetcher,
          IGNORE_CACHE,
        ),
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
          fetcher,
          whirlpoolDataPre,
          IGNORE_CACHE,
        ),
        oracleData: NO_ORACLE_DATA,
      },
      Percentage.fromFraction(1, 100),
    );

    const preSqrtPrice = whirlpoolDataPre.sqrtPrice;
    // event verification
    let eventVerified: boolean = false;
    let detectedSignature: string | null = null;
    const listener = ctx.program.addEventListener(
      "traded",
      (event, _slot, signature) => {
        detectedSignature = signature;
        // verify
        assert.ok(event.whirlpool.equals(whirlpoolPda.publicKey));
        assert.ok(event.aToB === aToB);
        assert.ok(event.preSqrtPrice.eq(preSqrtPrice));
        assert.ok(event.postSqrtPrice.eq(quote.estimatedEndSqrtPrice));
        assert.ok(event.inputAmount.eq(quote.estimatedAmountIn));
        assert.ok(event.outputAmount.eq(quote.estimatedAmountOut));
        assert.ok(event.inputTransferFee.isZero());
        assert.ok(event.outputTransferFee.isZero());

        const protocolFee = quote.estimatedFeeAmount
          .muln(whirlpoolDataPre.protocolFeeRate)
          .div(PROTOCOL_FEE_RATE_MUL_VALUE);
        const lpFee = quote.estimatedFeeAmount.sub(protocolFee);
        assert.ok(event.lpFee.eq(lpFee));
        assert.ok(event.protocolFee.eq(protocolFee));

        eventVerified = true;
      },
    );

    const preparedSwapPda = PDAUtil.getPreparedSwap(
      ctx.program.programId,
      initializedPreparedSwapNonce,
    );
    const params: CommitSwapV2Params = {
      ...quote,
      preparedSwap: preparedSwapPda.publicKey,
      whirlpool: whirlpoolPda.publicKey,
      tokenAuthority: ctx.wallet.publicKey,
      tokenMintA: poolInitInfo.tokenMintA,
      tokenMintB: poolInitInfo.tokenMintB,
      tokenProgramA: poolInitInfo.tokenProgramA,
      tokenProgramB: poolInitInfo.tokenProgramB,
      tokenOwnerAccountA: tokenAccountA,
      tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
      tokenOwnerAccountB: tokenAccountB,
      tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
      oracle: oraclePda.publicKey,
    };

    await toTx(
      ctx,
      WhirlpoolIx.prepareSwapV2Ix(ctx.program, params),
    ).buildAndExecute();

    await toTx(
      ctx,
      WhirlpoolIx.commitSwapV2Ix(ctx.program, params),
    ).buildAndExecute();

    warpClock(2);
    const polled = await pollForCondition(
      async () => ({ detectedSignature: detectedSignature, eventVerified }),
      (r) =>
        !!r.detectedSignature &&
        !!(r as { eventVerified?: boolean }).eventVerified,
      { maxRetries: 100, delayMs: 10 },
    );
    assert.ok(!!polled.detectedSignature);
    assert.ok(polled.eventVerified);

    ctx.program.removeEventListener(listener);
  });
});
