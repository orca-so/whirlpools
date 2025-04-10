import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import { MathUtil, Percentage } from "@orca-so/common-sdk";
import type { PDA } from "@orca-so/common-sdk";
import * as assert from "assert";
import { BN } from "bn.js";
import Decimal from "decimal.js";
import type {
  InitPoolV2Params,
  SwapV2Params,
  TickArrayData,
  WhirlpoolData,
} from "../../../src";
import {
  MAX_SQRT_PRICE,
  MAX_SQRT_PRICE_BN,
  METADATA_PROGRAM_ADDRESS,
  MIN_SQRT_PRICE,
  MIN_SQRT_PRICE_BN,
  NO_ADAPTIVE_FEE_INFO,
  PDAUtil,
  PriceMath,
  SwapUtils,
  TICK_ARRAY_SIZE,
  TickUtil,
  WhirlpoolContext,
  WhirlpoolIx,
  buildWhirlpoolClient,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
  swapQuoteWithParams,
  toTx,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import {
  MAX_U64,
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TOKEN_PROGRAM_ID,
  TickSpacing,
  ZERO_BN,
  getTokenBalance,
  sleep,
} from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { initTickArrayRange } from "../../utils/init-utils";
import type {
  FundedPositionV2Params,
  TokenTrait,
} from "../../utils/v2/init-utils-v2";
import {
  fundPositionsV2,
  initTestPoolV2,
  initTestPoolWithLiquidityV2,
  initTestPoolWithTokensV2,
  withdrawPositionsV2,
} from "../../utils/v2/init-utils-v2";
import { createMintV2 } from "../../utils/v2/token-2022";
import { TokenExtensionUtil } from "../../../src/utils/public/token-extension-util";
import type { PublicKey } from "@solana/web3.js";
import { PROTOCOL_FEE_RATE_MUL_VALUE } from "../../../dist/types/public/constants";

describe("swap_v2", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  describe("v1 parity", () => {
    const tokenTraitVariations: {
      tokenTraitA: TokenTrait;
      tokenTraitB: TokenTrait;
      tokenTraitR: TokenTrait;
    }[] = [
      {
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tokenTraitR: { isToken2022: false },
      },
      {
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: false },
        tokenTraitR: { isToken2022: false },
      },
      {
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: true },
        tokenTraitR: { isToken2022: true },
      },
      {
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tokenTraitR: { isToken2022: true },
      },
    ];
    tokenTraitVariations.forEach((tokenTraits) => {
      describe(`tokenTraitA: ${
        tokenTraits.tokenTraitA.isToken2022 ? "Token2022" : "Token"
      }, tokenTraitB: ${
        tokenTraits.tokenTraitB.isToken2022 ? "Token2022" : "Token"
      }, tokenTraitR: ${tokenTraits.tokenTraitR.isToken2022 ? "Token2022" : "Token"}`, () => {
        it("fail on token vault mint a does not match whirlpool token a", async () => {
          const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
            await initTestPoolWithTokensV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Standard,
            );

          const { poolInitInfo: anotherPoolInitInfo } =
            await initTestPoolWithTokensV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Stable,
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
              WhirlpoolIx.swapV2Ix(ctx.program, {
                amount: new BN(10),
                otherAmountThreshold: ZERO_BN,
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
                tokenVaultA: anotherPoolInitInfo.tokenVaultAKeypair.publicKey, // invalid
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArray0: tickArrays[0].publicKey,
                tickArray1: tickArrays[0].publicKey,
                tickArray2: tickArrays[0].publicKey,
                oracle: oraclePda.publicKey,
              }),
            ).buildAndExecute(),
            /0x7dc/, // ConstraintAddress
          );
        });

        it("fail on token vault mint b does not match whirlpool token b", async () => {
          const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
            await initTestPoolWithTokensV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Standard,
            );

          const { poolInitInfo: anotherPoolInitInfo } =
            await initTestPoolWithTokensV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Stable,
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
              WhirlpoolIx.swapV2Ix(ctx.program, {
                amount: new BN(10),
                otherAmountThreshold: ZERO_BN,
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
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultB: anotherPoolInitInfo.tokenVaultBKeypair.publicKey, // invalid
                tickArray0: tickArrays[0].publicKey,
                tickArray1: tickArrays[0].publicKey,
                tickArray2: tickArrays[0].publicKey,
                oracle: oraclePda.publicKey,
              }),
            ).buildAndExecute(),
            /0x7dc/, // ConstraintAddress
          );
        });

        it("fail on token owner account a does not match vault a mint", async () => {
          const { poolInitInfo, whirlpoolPda, tokenAccountB } =
            await initTestPoolWithTokensV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Standard,
            );

          const { tokenAccountA: anotherTokenAccountA } =
            await initTestPoolWithTokensV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Stable,
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
              WhirlpoolIx.swapV2Ix(ctx.program, {
                amount: new BN(10),
                otherAmountThreshold: ZERO_BN,
                sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
                amountSpecifiedIsInput: true,
                aToB: true,
                whirlpool: whirlpoolPda.publicKey,
                tokenAuthority: ctx.wallet.publicKey,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: anotherTokenAccountA, // invalid
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArray0: tickArrays[0].publicKey,
                tickArray1: tickArrays[0].publicKey,
                tickArray2: tickArrays[0].publicKey,
                oracle: oraclePda.publicKey,
              }),
            ).buildAndExecute(),
            /0x7d3/, // ConstraintRaw
          );
        });

        it("fail on token owner account b does not match vault b mint", async () => {
          const { poolInitInfo, whirlpoolPda, tokenAccountA } =
            await initTestPoolWithTokensV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Standard,
            );

          const { tokenAccountB: anotherTokenAccountB } =
            await initTestPoolWithTokensV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Stable,
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
              WhirlpoolIx.swapV2Ix(ctx.program, {
                amount: new BN(10),
                otherAmountThreshold: ZERO_BN,
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
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenOwnerAccountB: anotherTokenAccountB, // invalid
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArray0: tickArrays[0].publicKey,
                tickArray1: tickArrays[0].publicKey,
                tickArray2: tickArrays[0].publicKey,
                oracle: oraclePda.publicKey,
              }),
            ).buildAndExecute(),
            /0x7d3/, // ConstraintRaw
          );
        });

        it("fails to swap with incorrect token authority", async () => {
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

          const otherTokenAuthority = web3.Keypair.generate();

          const oraclePda = PDAUtil.getOracle(
            ctx.program.programId,
            whirlpoolPda.publicKey,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, {
                amount: new BN(10),
                otherAmountThreshold: ZERO_BN,
                sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
                amountSpecifiedIsInput: true,
                aToB: true,
                whirlpool: whirlpoolPda.publicKey,
                tokenAuthority: otherTokenAuthority.publicKey, // invalid
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArray0: tickArrays[0].publicKey,
                tickArray1: tickArrays[0].publicKey,
                tickArray2: tickArrays[0].publicKey,
                oracle: oraclePda.publicKey,
              }),
            )
              .addSigner(otherTokenAuthority)
              .buildAndExecute(),
            /0x4/, // OwnerMismatch
          );
        });

        it("fails on passing in the wrong tick-array", async () => {
          const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
            await initTestPoolWithTokensV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Standard,
              MathUtil.toX64(new Decimal(0.0242).sqrt()),
            ); // Negative Tick

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
              WhirlpoolIx.swapV2Ix(ctx.program, {
                amount: new BN(10),
                otherAmountThreshold: ZERO_BN,
                sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(-50000),
                amountSpecifiedIsInput: true,
                aToB: true,
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
                tickArray0: tickArrays[0].publicKey,
                tickArray1: tickArrays[0].publicKey,
                tickArray2: tickArrays[0].publicKey,
                oracle: oraclePda.publicKey,
              }),
            ).buildAndExecute(),
            /0x1787/, // InvalidTickArraySequence
          );
        });

        it("fails on passing in the wrong whirlpool", async () => {
          const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
            await initTestPoolWithTokensV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Standard,
            );

          const { poolInitInfo: anotherPoolInitInfo } = await initTestPoolV2(
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
              WhirlpoolIx.swapV2Ix(ctx.program, {
                amount: new BN(10),
                otherAmountThreshold: ZERO_BN,
                sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
                amountSpecifiedIsInput: true,
                aToB: true,
                whirlpool: anotherPoolInitInfo.whirlpoolPda.publicKey, // invalid
                tokenAuthority: ctx.wallet.publicKey,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArray0: tickArrays[0].publicKey,
                tickArray1: tickArrays[0].publicKey,
                tickArray2: tickArrays[0].publicKey,
                oracle: oraclePda.publicKey,
              }),
            ).buildAndExecute(),
            /0x7dc/, // ConstraintAddress at token_mint_a (V1: 0x7d3 (ConstraaintRaw) at token_owner_account_a)
          );
        });

        it("fails on passing in the tick-arrays from another whirlpool", async () => {
          const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
            await initTestPoolWithTokensV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Standard,
            );

          const { poolInitInfo: anotherPoolInitInfo } = await initTestPoolV2(
            ctx,
            tokenTraits.tokenTraitA,
            tokenTraits.tokenTraitB,
            TickSpacing.Standard,
          );

          const tickArrays = await initTickArrayRange(
            ctx,
            anotherPoolInitInfo.whirlpoolPda.publicKey,
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
              WhirlpoolIx.swapV2Ix(ctx.program, {
                amount: new BN(10),
                otherAmountThreshold: ZERO_BN,
                sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
                amountSpecifiedIsInput: true,
                aToB: true,
                whirlpool: poolInitInfo.whirlpoolPda.publicKey,
                tokenAuthority: ctx.wallet.publicKey,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArray0: tickArrays[0].publicKey, // invalid
                tickArray1: tickArrays[0].publicKey,
                tickArray2: tickArrays[0].publicKey,
                oracle: oraclePda.publicKey,
              }),
            ).buildAndExecute(),
            // sparse-swap changes error code (has_one constraint -> check in the handler)
            /0x17a8/, // DifferentWhirlpoolTickArrayAccount
          );
        });

        it("fails on passing in an account of another type for the oracle", async () => {
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

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, {
                amount: new BN(10),
                otherAmountThreshold: ZERO_BN,
                sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
                amountSpecifiedIsInput: true,
                aToB: true,
                whirlpool: poolInitInfo.whirlpoolPda.publicKey,
                tokenAuthority: ctx.wallet.publicKey,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArray0: tickArrays[0].publicKey,
                tickArray1: tickArrays[0].publicKey,
                tickArray2: tickArrays[0].publicKey,
                oracle: tickArrays[0].publicKey, // invalid
              }),
            ).buildAndExecute(),
            /0x7d6/, // ConstraintSeeds
          );
        });

        it("fails on passing in an incorrectly hashed oracle PDA", async () => {
          const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
            await initTestPoolWithTokensV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Standard,
            );

          const { poolInitInfo: anotherPoolInitInfo } = await initTestPoolV2(
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

          const anotherOraclePda = PDAUtil.getOracle(
            ctx.program.programId,
            anotherPoolInitInfo.whirlpoolPda.publicKey,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, {
                amount: new BN(10),
                otherAmountThreshold: ZERO_BN,
                sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
                amountSpecifiedIsInput: true,
                aToB: true,
                whirlpool: poolInitInfo.whirlpoolPda.publicKey,
                tokenAuthority: ctx.wallet.publicKey,
                tokenMintA: poolInitInfo.tokenMintA,
                tokenMintB: poolInitInfo.tokenMintB,
                tokenProgramA: poolInitInfo.tokenProgramA,
                tokenProgramB: poolInitInfo.tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArray0: tickArrays[0].publicKey,
                tickArray1: tickArrays[0].publicKey,
                tickArray2: tickArrays[0].publicKey,
                oracle: anotherOraclePda.publicKey, // invalid
              }),
            ).buildAndExecute(),
            /0x7d6/, // ConstraintSeeds
          );
        });

        it("fail on passing in zero tradable amount", async () => {
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
            // sparse-swap: We didn't provide valid initialized tick arrays.
            // The current pool tick index is 32190, so we need to provide tick array with start_tick_index 22528.
            // Using sparse-swap, the validity of provided tick arrays will be evaluated before evaluating trade amount.
            22528,
            3,
            TickSpacing.Standard,
            true,
          );

          const oraclePda = PDAUtil.getOracle(
            ctx.program.programId,
            whirlpoolPda.publicKey,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, {
                amount: new BN(0),
                otherAmountThreshold: ZERO_BN,
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
                tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                tickArray0: tickArrays[0].publicKey,
                tickArray1: tickArrays[0].publicKey,
                tickArray2: tickArrays[0].publicKey,
                oracle: oraclePda.publicKey,
              }),
            ).buildAndExecute(),
            /0x1793/, // ZeroTradableAmount
          );
        });

        it("swaps across one tick array", async () => {
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

          const tokenVaultABefore = new anchor.BN(
            await getTokenBalance(
              provider,
              poolInitInfo.tokenVaultAKeypair.publicKey,
            ),
          );
          const tokenVaultBBefore = new anchor.BN(
            await getTokenBalance(
              provider,
              poolInitInfo.tokenVaultBKeypair.publicKey,
            ),
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
          /* replaceed by swapQuoteWithParams to avoid using whirlpool client
    const quote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      new BN(100000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );
    */
          const quote = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: false,
              tokenAmount: new BN(100000),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
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
                adaptiveFeeInfo: NO_ADAPTIVE_FEE_INFO,
            },
            Percentage.fromFraction(1, 100),
          );

          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quote,
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
            }),
          ).buildAndExecute();

          assert.equal(
            await getTokenBalance(
              provider,
              poolInitInfo.tokenVaultAKeypair.publicKey,
            ),
            tokenVaultABefore.sub(quote.estimatedAmountOut).toString(),
          );
          assert.equal(
            await getTokenBalance(
              provider,
              poolInitInfo.tokenVaultBKeypair.publicKey,
            ),
            tokenVaultBBefore.add(quote.estimatedAmountIn).toString(),
          );
        });

        it("swaps aToB across initialized tick with no movement", async () => {
          const startingTick = 91720;
          const tickSpacing = TickSpacing.Stable;
          const startingTickArrayStartIndex = TickUtil.getStartTickIndex(
            startingTick,
            tickSpacing,
          );
          const aToB = true;
          const startSqrtPrice =
            PriceMath.tickIndexToSqrtPriceX64(startingTick);
          const initialLiquidity = new anchor.BN(10_000_000);
          const additionalLiquidity = new anchor.BN(2_000_000);

          const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
            await initTestPoolWithTokensV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Stable,
              startSqrtPrice,
            );
          await initTickArrayRange(
            ctx,
            whirlpoolPda.publicKey,
            startingTickArrayStartIndex + TICK_ARRAY_SIZE * tickSpacing * 2,
            5,
            TickSpacing.Stable,
            aToB,
          );
          const oraclePda = PDAUtil.getOracle(
            ctx.program.programId,
            whirlpoolPda.publicKey,
          );

          const initialParams: FundedPositionV2Params[] = [
            {
              liquidityAmount: initialLiquidity,
              tickLowerIndex: startingTickArrayStartIndex + tickSpacing,
              tickUpperIndex:
                startingTickArrayStartIndex +
                TICK_ARRAY_SIZE * tickSpacing * 2 -
                tickSpacing,
            },
          ];

          await fundPositionsV2(
            ctx,
            poolInitInfo,
            tokenAccountA,
            tokenAccountB,
            initialParams,
          );

          const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
          let whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          // Position covers the current price, so liquidity should be equal to the initial funded position
          assert.ok(whirlpoolData.liquidity.eq(new anchor.BN(10_000_000)));

          const nextParams: FundedPositionV2Params[] = [
            {
              liquidityAmount: additionalLiquidity,
              tickLowerIndex: startingTick - tickSpacing * 2,
              tickUpperIndex: startingTick,
            },
          ];

          await fundPositionsV2(
            ctx,
            poolInitInfo,
            tokenAccountA,
            tokenAccountB,
            nextParams,
          );

          whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          // Whirlpool.currentTick is 91720, so the newly funded position's upper tick is not
          // strictly less than 91720 so the liquidity is not added.
          assert.ok(whirlpoolData.liquidity.eq(initialLiquidity));
          assert.ok(whirlpoolData.sqrtPrice.eq(startSqrtPrice));
          assert.equal(whirlpoolData.tickCurrentIndex, startingTick);

          /* replaced by swapQuoteWithParams to avoid using whirlpool client
    const quote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new BN(1),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );
    */
          const quote = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: true,
              tokenAmount: new BN(1),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(true),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                true,
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
                adaptiveFeeInfo: NO_ADAPTIVE_FEE_INFO,
            },
            Percentage.fromFraction(1, 100),
          );

          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quote,
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
            }),
          ).buildAndExecute();

          whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          // After the above swap, since the amount is so low, it is completely taken by fees
          // thus, the sqrt price will remain the same, the starting tick will decrement since it
          // is an aToB swap ending on initialized tick, and since the tick is crossed,
          // the liquidity will be added
          assert.equal(whirlpoolData.tickCurrentIndex, startingTick - 1);
          assert.ok(whirlpoolData.sqrtPrice.eq(startSqrtPrice));
          assert.ok(
            whirlpoolData.liquidity.eq(
              initialLiquidity.add(additionalLiquidity),
            ),
          );

          /* replaced by swapQuoteWithParams to avoid using whirlpool client
    const quote2 = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new BN(1),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );
    */
          const quote2 = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: true,
              tokenAmount: new BN(1),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(true),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                true,
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
                adaptiveFeeInfo: NO_ADAPTIVE_FEE_INFO,
            },
            Percentage.fromFraction(1, 100),
          );

          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quote2,
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
            }),
          ).buildAndExecute();

          whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          // After the above swap, since the amount is so low, it is completely taken by fees
          // thus, the sqrt price will remaing the same, the starting tick will not decrement
          // since it is an aToB swap ending on an uninitialized tick, no tick is crossed
          assert.equal(whirlpoolData.tickCurrentIndex, startingTick - 1);
          assert.ok(whirlpoolData.sqrtPrice.eq(startSqrtPrice));
          assert.ok(
            whirlpoolData.liquidity.eq(
              initialLiquidity.add(additionalLiquidity),
            ),
          );
        });

        it("swaps aToB with small remainder across initialized tick", async () => {
          const startingTick = 91728;
          const tickSpacing = TickSpacing.Stable;
          const startingTickArrayStartIndex = TickUtil.getStartTickIndex(
            startingTick,
            tickSpacing,
          );
          const aToB = true;
          const startSqrtPrice =
            PriceMath.tickIndexToSqrtPriceX64(startingTick);
          const initialLiquidity = new anchor.BN(10_000_000);
          const additionalLiquidity = new anchor.BN(2_000_000);

          const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
            await initTestPoolWithTokensV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Stable,
              startSqrtPrice,
            );
          await initTickArrayRange(
            ctx,
            whirlpoolPda.publicKey,
            startingTickArrayStartIndex + TICK_ARRAY_SIZE * tickSpacing * 2,
            5,
            TickSpacing.Stable,
            aToB,
          );
          const oraclePda = PDAUtil.getOracle(
            ctx.program.programId,
            whirlpoolPda.publicKey,
          );

          const initialParams: FundedPositionV2Params[] = [
            {
              liquidityAmount: initialLiquidity,
              tickLowerIndex: startingTickArrayStartIndex + tickSpacing,
              tickUpperIndex:
                startingTickArrayStartIndex +
                TICK_ARRAY_SIZE * tickSpacing * 2 -
                tickSpacing,
            },
          ];

          await fundPositionsV2(
            ctx,
            poolInitInfo,
            tokenAccountA,
            tokenAccountB,
            initialParams,
          );

          const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
          let whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          // Position covers the current price, so liquidity should be equal to the initial funded position
          assert.ok(whirlpoolData.liquidity.eq(new anchor.BN(10_000_000)));

          const nextParams: FundedPositionV2Params[] = [
            {
              liquidityAmount: additionalLiquidity,
              tickLowerIndex: startingTick - tickSpacing * 3,
              tickUpperIndex: startingTick - tickSpacing,
            },
          ];

          await fundPositionsV2(
            ctx,
            poolInitInfo,
            tokenAccountA,
            tokenAccountB,
            nextParams,
          );

          whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          // Whirlpool.currentTick is 91720, so the newly funded position's upper tick is not
          // strictly less than 91720 so the liquidity is not added.
          assert.ok(whirlpoolData.liquidity.eq(initialLiquidity));
          assert.ok(whirlpoolData.sqrtPrice.eq(startSqrtPrice));
          assert.equal(whirlpoolData.tickCurrentIndex, startingTick);

          /* replaced by swapQuoteWithParams to avoid using whirlpool client
    const quote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new BN(1),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );
    */
          const quote = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: true,
              tokenAmount: new BN(1),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(true),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                true,
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
                adaptiveFeeInfo: NO_ADAPTIVE_FEE_INFO,
            },
            Percentage.fromFraction(1, 100),
          );

          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quote,
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
            }),
          ).buildAndExecute();

          whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          // After the above swap, since the amount is so low, it is completely taken by fees
          // thus, the sqrt price will remain the same, the starting tick will stay the same since it
          // is an aToB swap ending on initialized tick and no tick is crossed
          assert.equal(whirlpoolData.tickCurrentIndex, startingTick);
          assert.ok(whirlpoolData.sqrtPrice.eq(startSqrtPrice));
          assert.ok(whirlpoolData.liquidity.eq(initialLiquidity));

          /* replaced by swapQuoteWithParams to avoid using whirlpool client
    const quote2 = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new BN(43),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );
    */
          const quote2 = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: true,
              tokenAmount: new BN(43),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(true),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                true,
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
                adaptiveFeeInfo: NO_ADAPTIVE_FEE_INFO,
            },
            Percentage.fromFraction(1, 100),
          );

          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quote2,
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
            }),
          ).buildAndExecute();

          whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          // After the above swap, there will be a small amount remaining that crosses
          // an initialized tick index, but isn't enough to move the sqrt price.
          assert.equal(
            whirlpoolData.tickCurrentIndex,
            startingTick - tickSpacing - 1,
          );
          assert.ok(
            whirlpoolData.sqrtPrice.eq(
              PriceMath.tickIndexToSqrtPriceX64(startingTick - tickSpacing),
            ),
          );
          assert.ok(
            whirlpoolData.liquidity.eq(
              initialLiquidity.add(additionalLiquidity),
            ),
          );
        });

        it("swaps across three tick arrays", async () => {
          const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
            await initTestPoolWithTokensV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Stable,
              PriceMath.tickIndexToSqrtPriceX64(27500),
            );

          const aToB = false;
          const tickArrays = await initTickArrayRange(
            ctx,
            whirlpoolPda.publicKey,
            27456, // to 28160, 28864
            5,
            TickSpacing.Stable,
            false,
          );

          const fundParams: FundedPositionV2Params[] = [
            {
              liquidityAmount: new anchor.BN(100_000_000),
              tickLowerIndex: 27456,
              tickUpperIndex: 27840,
            },
            {
              liquidityAmount: new anchor.BN(100_000_000),
              tickLowerIndex: 28864,
              tickUpperIndex: 28928,
            },
            {
              liquidityAmount: new anchor.BN(100_000_000),
              tickLowerIndex: 27712,
              tickUpperIndex: 28928,
            },
          ];

          await fundPositionsV2(
            ctx,
            poolInitInfo,
            tokenAccountA,
            tokenAccountB,
            fundParams,
          );

          assert.equal(
            await getTokenBalance(
              provider,
              poolInitInfo.tokenVaultAKeypair.publicKey,
            ),
            "1977429",
          );
          assert.equal(
            await getTokenBalance(
              provider,
              poolInitInfo.tokenVaultBKeypair.publicKey,
            ),
            "869058",
          );

          const oraclePda = PDAUtil.getOracle(
            ctx.program.programId,
            whirlpoolPda.publicKey,
          );

          // Tick
          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              amount: new BN(7051000),
              otherAmountThreshold: ZERO_BN,
              sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(28500),
              amountSpecifiedIsInput: true,
              aToB: aToB,
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
              tickArray0: tickArrays[0].publicKey,
              tickArray1: tickArrays[1].publicKey,
              tickArray2: tickArrays[2].publicKey,
              oracle: oraclePda.publicKey,
            }),
          ).buildAndExecute();

          assert.equal(
            await getTokenBalance(
              provider,
              poolInitInfo.tokenVaultAKeypair.publicKey,
            ),
            "1535201",
          );
          assert.equal(
            await getTokenBalance(
              provider,
              poolInitInfo.tokenVaultBKeypair.publicKey,
            ),
            "7920058",
          );

          // TODO: Verify fees and other whirlpool params
        });

        /* using sparse-swap, we can handle uninitialized tick-array. so this test is no longer needed.

        it("Error on passing in uninitialized tick-array", async () => {
          const { poolInitInfo, tokenAccountA, tokenAccountB, tickArrays } =
            await initTestPoolWithLiquidityV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB
            );
          const whirlpool = poolInitInfo.whirlpoolPda.publicKey;

          const uninitializedTickArrayPda = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpool,
            0
          );

          const oraclePda = PDAUtil.getOracle(
            ctx.program.programId,
            poolInitInfo.whirlpoolPda.publicKey
          );

          const params: SwapV2Params = {
            amount: new BN(10),
            otherAmountThreshold: ZERO_BN,
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(true),
            amountSpecifiedIsInput: true,
            aToB: true,
            whirlpool: whirlpool,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArray0: tickArrays[0].publicKey,
            tickArray1: uninitializedTickArrayPda.publicKey,
            tickArray2: tickArrays[2].publicKey,
            oracle: oraclePda.publicKey,
          };

          try {
            await toTx(ctx, WhirlpoolIx.swapV2Ix(ctx.program, params)).buildAndExecute();
            assert.fail("should fail if a tick-array is uninitialized");
          } catch (e) {
            const error = e as Error;
            assert.match(error.message, /0xbbf/); // AccountOwnedByWrongProgram
          }
        });
        */

        it("Error if sqrt_price_limit exceeds max", async () => {
          const { poolInitInfo, tokenAccountA, tokenAccountB, tickArrays } =
            await initTestPoolWithLiquidityV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
            );
          const whirlpool = poolInitInfo.whirlpoolPda.publicKey;

          const oraclePda = PDAUtil.getOracle(
            ctx.program.programId,
            poolInitInfo.whirlpoolPda.publicKey,
          );

          const params: SwapV2Params = {
            amount: new BN(10),
            otherAmountThreshold: ZERO_BN,
            sqrtPriceLimit: new anchor.BN(MAX_SQRT_PRICE).add(new anchor.BN(1)),
            amountSpecifiedIsInput: true,
            aToB: true,
            whirlpool: whirlpool,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[1].publicKey,
            tickArray2: tickArrays[2].publicKey,
            oracle: oraclePda.publicKey,
          };

          try {
            await toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, params),
            ).buildAndExecute();
            assert.fail("should fail if sqrt_price exceeds maximum");
          } catch (e) {
            const error = e as Error;
            assert.match(error.message, /0x177b/); // SqrtPriceOutOfBounds
          }
        });

        it("Error if sqrt_price_limit subceed min", async () => {
          const { poolInitInfo, tokenAccountA, tokenAccountB, tickArrays } =
            await initTestPoolWithLiquidityV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
            );
          const whirlpool = poolInitInfo.whirlpoolPda.publicKey;

          const oraclePda = PDAUtil.getOracle(
            ctx.program.programId,
            poolInitInfo.whirlpoolPda.publicKey,
          );

          const params: SwapV2Params = {
            amount: new BN(10),
            otherAmountThreshold: ZERO_BN,
            sqrtPriceLimit: new anchor.BN(MIN_SQRT_PRICE).sub(new anchor.BN(1)),
            amountSpecifiedIsInput: true,
            aToB: true,
            whirlpool: whirlpool,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[1].publicKey,
            tickArray2: tickArrays[2].publicKey,
            oracle: oraclePda.publicKey,
          };

          try {
            await toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, params),
            ).buildAndExecute();
            assert.fail("should fail if sqrt_price subceeds minimum");
          } catch (e) {
            const error = e as Error;
            assert.match(error.message, /0x177b/); // SqrtPriceOutOfBounds
          }
        });

        it("Error if a to b swap below minimum output", async () => {
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
            22528, // to 33792
            3,
            TickSpacing.Standard,
            false,
          );

          const fundParams: FundedPositionV2Params[] = [
            {
              liquidityAmount: new anchor.BN(100_000),
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

          const params = {
            amount: new BN(10),
            otherAmountThreshold: MAX_U64,
            sqrtPriceLimit: new anchor.BN(MIN_SQRT_PRICE),
            amountSpecifiedIsInput: true,
            aToB: true,
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
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[0].publicKey,
            tickArray2: tickArrays[0].publicKey,
            oracle: oraclePda.publicKey,
          };

          try {
            await toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, params),
            ).buildAndExecute();
            assert.fail("should fail if amount out is below threshold");
          } catch (e) {
            const error = e as Error;
            assert.match(error.message, /0x1794/); // AmountOutBelowMinimum
          }
        });

        it("Error if b to a swap below minimum output", async () => {
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
            22528, // to 33792
            3,
            TickSpacing.Standard,
            false,
          );

          const fundParams: FundedPositionV2Params[] = [
            {
              liquidityAmount: new anchor.BN(100_000),
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

          const params: SwapV2Params = {
            amount: new BN(10),
            otherAmountThreshold: MAX_U64,
            sqrtPriceLimit: new anchor.BN(MAX_SQRT_PRICE),
            amountSpecifiedIsInput: true,
            aToB: false,
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
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[0].publicKey,
            tickArray2: tickArrays[0].publicKey,
            oracle: oraclePda.publicKey,
          };

          try {
            await toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, params),
            ).buildAndExecute();
            assert.fail("should fail if amount out is below threshold");
          } catch (e) {
            const error = e as Error;
            assert.match(error.message, /0x1794/); // AmountOutBelowMinimum
          }
        });

        it("Error if a to b swap above maximum input", async () => {
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
            22528, // to 33792
            3,
            TickSpacing.Standard,
            false,
          );

          const fundParams: FundedPositionV2Params[] = [
            {
              liquidityAmount: new anchor.BN(100_000),
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

          const params: SwapV2Params = {
            amount: new BN(10),
            otherAmountThreshold: ZERO_BN,
            sqrtPriceLimit: new anchor.BN(MIN_SQRT_PRICE),
            amountSpecifiedIsInput: false,
            aToB: true,
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
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[0].publicKey,
            tickArray2: tickArrays[0].publicKey,
            oracle: oraclePda.publicKey,
          };

          try {
            await toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, params),
            ).buildAndExecute();
            assert.fail("should fail if amount out is below threshold");
          } catch (e) {
            const error = e as Error;
            assert.match(error.message, /0x1795/); // AmountInAboveMaximum
          }
        });

        it("Error if b to a swap below maximum input", async () => {
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
            22528, // to 33792
            3,
            TickSpacing.Standard,
            false,
          );

          const fundParams: FundedPositionV2Params[] = [
            {
              liquidityAmount: new anchor.BN(100_000),
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

          const params: SwapV2Params = {
            amount: new BN(10),
            otherAmountThreshold: ZERO_BN,
            sqrtPriceLimit: new anchor.BN(MAX_SQRT_PRICE),
            amountSpecifiedIsInput: false,
            aToB: false,
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
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[0].publicKey,
            tickArray2: tickArrays[0].publicKey,
            oracle: oraclePda.publicKey,
          };

          try {
            await toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, params),
            ).buildAndExecute();
            assert.fail("should fail if amount out is below threshold");
          } catch (e) {
            const error = e as Error;
            assert.match(error.message, /0x1795/); // AmountInAboveMaximum
          }
        });

        it("swaps across ten tick arrays", async () => {
          const {
            poolInitInfo,
            configKeypairs,
            whirlpoolPda,
            tokenAccountA,
            tokenAccountB,
          } = await initTestPoolWithTokensV2(
            ctx,
            tokenTraits.tokenTraitA,
            tokenTraits.tokenTraitB,
            TickSpacing.Stable,
            PriceMath.tickIndexToSqrtPriceX64(27500),
          );

          const aToB = false;
          const tickArrays = await initTickArrayRange(
            ctx,
            whirlpoolPda.publicKey,
            27456, // to 30528
            3,
            TickSpacing.Stable,
            aToB,
          );

          // tick array range: 27658 to 29386
          // tick arrays: (27456, 28152), (28160, 28856), (28864, 29,560)
          // current tick: 27727
          // initialized ticks:
          //   27712, 27736, 27840, 28288, 28296, 28304, 28416, 28576, 28736, 29112, 29120, 29240, 29360

          const fundParams: FundedPositionV2Params[] = [
            {
              liquidityAmount: new anchor.BN(10_000_000),
              tickLowerIndex: 27712,
              tickUpperIndex: 29360,
            },
            {
              liquidityAmount: new anchor.BN(10_000_000),
              tickLowerIndex: 27736,
              tickUpperIndex: 29240,
            },
            {
              liquidityAmount: new anchor.BN(10_000_000),
              tickLowerIndex: 27840,
              tickUpperIndex: 29120,
            },
            {
              liquidityAmount: new anchor.BN(10_000_000),
              tickLowerIndex: 28288,
              tickUpperIndex: 29112,
            },
            {
              liquidityAmount: new anchor.BN(10_000_000),
              tickLowerIndex: 28416,
              tickUpperIndex: 29112,
            },
            {
              liquidityAmount: new anchor.BN(10_000_000),
              tickLowerIndex: 28288,
              tickUpperIndex: 28304,
            },
            {
              liquidityAmount: new anchor.BN(10_000_000),
              tickLowerIndex: 28296,
              tickUpperIndex: 29112,
            },
            {
              liquidityAmount: new anchor.BN(10_000_000),
              tickLowerIndex: 28576,
              tickUpperIndex: 28736,
            },
          ];

          const positionInfos = await fundPositionsV2(
            ctx,
            poolInitInfo,
            tokenAccountA,
            tokenAccountB,
            fundParams,
          );

          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

          (
            await Promise.all(
              tickArrays.map((tickArray) =>
                fetcher.getTickArray(tickArray.publicKey),
              ),
            )
          ).map((tickArray) => {
            const ta = tickArray as TickArrayData;
            ta.ticks.forEach((tick) => {
              if (!tick.initialized) {
                return;
              }

              /*
        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
        */
            });
          });

          const oraclePda = PDAUtil.getOracle(
            ctx.program.programId,
            whirlpoolPda.publicKey,
          );

          // Tick
          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              amount: new BN(829996),
              otherAmountThreshold: MAX_U64,
              sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(29240),
              amountSpecifiedIsInput: false,
              aToB,
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
              tickArray0: tickArrays[0].publicKey,
              tickArray1: tickArrays[1].publicKey,
              tickArray2: tickArrays[2].publicKey,
              oracle: oraclePda.publicKey,
            }),
          ).buildAndExecute();

          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

          (
            await Promise.all(
              tickArrays.map((tickArray) =>
                fetcher.getTickArray(tickArray.publicKey),
              ),
            )
          ).map((tickArray) => {
            const ta = tickArray as TickArrayData;
            ta.ticks.forEach((tick) => {
              if (!tick.initialized) {
                return;
              }

              /*
        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
        */
            });
          });

          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              amount: new BN(14538074),
              otherAmountThreshold: MAX_U64,
              sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(27712),
              amountSpecifiedIsInput: false,
              aToB: true,
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
              tickArray0: tickArrays[2].publicKey,
              tickArray1: tickArrays[1].publicKey,
              tickArray2: tickArrays[0].publicKey,
              oracle: oraclePda.publicKey,
            }),
          ).buildAndExecute();

          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

          (
            await Promise.all(
              tickArrays.map((tickArray) =>
                fetcher.getTickArray(tickArray.publicKey),
              ),
            )
          ).map((tickArray) => {
            const ta = tickArray as TickArrayData;
            ta.ticks.forEach((tick) => {
              if (!tick.initialized) {
                return;
              }

              /*
        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
        */
            });
          });

          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              amount: new BN(829996),
              otherAmountThreshold: MAX_U64,
              sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(29240),
              amountSpecifiedIsInput: false,
              aToB,
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
              tickArray0: tickArrays[0].publicKey,
              tickArray1: tickArrays[1].publicKey,
              tickArray2: tickArrays[2].publicKey,
              oracle: oraclePda.publicKey,
            }),
          ).buildAndExecute();

          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

          (
            await Promise.all(
              tickArrays.map((tickArray) =>
                fetcher.getTickArray(tickArray.publicKey),
              ),
            )
          ).map((tickArray) => {
            const ta = tickArray as TickArrayData;
            ta.ticks.forEach((tick) => {
              if (!tick.initialized) {
                return;
              }

              /*
        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
        */
            });
          });

          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              amount: new BN(14538074),
              otherAmountThreshold: MAX_U64,
              sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(27712),
              amountSpecifiedIsInput: false,
              aToB: true,
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
              tickArray0: tickArrays[2].publicKey,
              tickArray1: tickArrays[1].publicKey,
              tickArray2: tickArrays[0].publicKey,
              oracle: oraclePda.publicKey,
            }),
          ).buildAndExecute();

          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

          (
            await Promise.all(
              tickArrays.map((tickArray) =>
                fetcher.getTickArray(tickArray.publicKey),
              ),
            )
          ).map((tickArray) => {
            const ta = tickArray as TickArrayData;
            ta.ticks.forEach((tick) => {
              if (!tick.initialized) {
                return;
              }

              /*
        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
        */
            });
          });

          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              amount: new BN(829996),
              otherAmountThreshold: MAX_U64,
              sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(29240),
              amountSpecifiedIsInput: false,
              aToB,
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
              tickArray0: tickArrays[0].publicKey,
              tickArray1: tickArrays[1].publicKey,
              tickArray2: tickArrays[2].publicKey,
              oracle: oraclePda.publicKey,
            }),
          ).buildAndExecute();

          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

          (
            await Promise.all(
              tickArrays.map((tickArray) =>
                fetcher.getTickArray(tickArray.publicKey),
              ),
            )
          ).map((tickArray) => {
            const ta = tickArray as TickArrayData;
            ta.ticks.forEach((tick) => {
              if (!tick.initialized) {
                return;
              }

              /*
        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
        */
            });
          });

          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              amount: new BN(14538074),
              otherAmountThreshold: MAX_U64,
              sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(27712),
              amountSpecifiedIsInput: false,
              aToB: true,
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
              tickArray0: tickArrays[2].publicKey,
              tickArray1: tickArrays[1].publicKey,
              tickArray2: tickArrays[0].publicKey,
              oracle: oraclePda.publicKey,
            }),
          ).buildAndExecute();

          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

          (
            await Promise.all(
              tickArrays.map((tickArray) =>
                fetcher.getTickArray(tickArray.publicKey),
              ),
            )
          ).map((tickArray) => {
            const ta = tickArray as TickArrayData;
            ta.ticks.forEach((tick) => {
              if (!tick.initialized) {
                return;
              }

              /*
        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
        */
            });
          });

          await withdrawPositionsV2(
            ctx,
            tokenTraits.tokenTraitA,
            tokenTraits.tokenTraitB,
            positionInfos,
            tokenAccountA,
            tokenAccountB,
          );

          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));

          (
            await Promise.all(
              tickArrays.map((tickArray) =>
                fetcher.getTickArray(tickArray.publicKey),
              ),
            )
          ).map((tickArray) => {
            const ta = tickArray as TickArrayData;
            ta.ticks.forEach((tick) => {
              if (!tick.initialized) {
                return;
              }

              /*
        console.log(
          ta.startTickIndex + index * TickSpacing.Stable,
          tick.feeGrowthOutsideA.toString(),
          tick.feeGrowthOutsideB.toString()
        );
        */
            });
          });

          await toTx(
            ctx,
            WhirlpoolIx.collectProtocolFeesV2Ix(ctx.program, {
              whirlpoolsConfig: poolInitInfo.whirlpoolsConfig,
              whirlpool: poolInitInfo.whirlpoolPda.publicKey,
              collectProtocolFeesAuthority:
                configKeypairs.collectProtocolFeesAuthorityKeypair.publicKey,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
              tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
              tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
            }),
          )
            .addSigner(configKeypairs.collectProtocolFeesAuthorityKeypair)
            .buildAndExecute();

          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey));
          //console.log(await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey));
        });
      });
    });

    describe("partial fill, b to a", () => {
      const tickSpacing = 128;
      const aToB = false;
      const client = buildWhirlpoolClient(ctx);

      let poolInitInfo: InitPoolV2Params;
      let whirlpoolPda: PDA;
      let tokenAccountA: PublicKey;
      let tokenAccountB: PublicKey;
      let whirlpoolKey: PublicKey;
      let oraclePda: PDA;

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

      async function getTokenBalances(): Promise<[anchor.BN, anchor.BN]> {
        const tokenVaultA = new anchor.BN(
          await getTokenBalance(provider, tokenAccountA),
        );
        const tokenVaultB = new anchor.BN(
          await getTokenBalance(provider, tokenAccountB),
        );
        return [tokenVaultA, tokenVaultB];
      }

      // |-S-***-------T,max----|  (*: liquidity, S: start, T: end)
      it("ExactIn, sqrt_price_limit = 0", async () => {
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

        const [preA, preB] = await getTokenBalances();

        await toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
            ...quote,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            oracle: oraclePda.publicKey,
            tokenMintA: whirlpoolData.tokenMintA,
            tokenMintB: whirlpoolData.tokenMintB,
            tokenProgramA: TEST_TOKEN_2022_PROGRAM_ID,
            tokenProgramB: TEST_TOKEN_2022_PROGRAM_ID,

            // sqrt_price_limit = 0
            sqrtPriceLimit: ZERO_BN,
            otherAmountThreshold: new BN(0),
          }),
        ).buildAndExecute();

        const postWhirlpoolData = await whirlpool.refreshData();
        const [postA, postB] = await getTokenBalances();
        const diffA = postA.sub(preA);
        const diffB = postB.sub(preB);

        assert.ok(diffA.isZero()); // no output (round up is not used to calculate output)
        assert.ok(diffB.neg().gte(amount) && diffB.neg().lt(amount.muln(2))); // partial
        assert.ok(postWhirlpoolData.sqrtPrice.eq(MAX_SQRT_PRICE_BN)); // hit max
      });

      // |-S-***-------T,max----|  (*: liquidity, S: start, T: end)
      it("ExactIn, sqrt_price_limit = MAX_SQRT_PRICE", async () => {
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

        const [preA, preB] = await getTokenBalances();

        await toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
            ...quote,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            oracle: oraclePda.publicKey,
            tokenMintA: whirlpoolData.tokenMintA,
            tokenMintB: whirlpoolData.tokenMintB,
            tokenProgramA: TEST_TOKEN_2022_PROGRAM_ID,
            tokenProgramB: TEST_TOKEN_2022_PROGRAM_ID,

            // sqrt_price_limit = MAX_SQRT_PRICE
            sqrtPriceLimit: MAX_SQRT_PRICE_BN,
            otherAmountThreshold: new BN(0),
          }),
        ).buildAndExecute();

        const postWhirlpoolData = await whirlpool.refreshData();
        const [postA, postB] = await getTokenBalances();
        const diffA = postA.sub(preA);
        const diffB = postB.sub(preB);

        assert.ok(diffA.isZero()); // no output (round up is not used to calculate output)
        assert.ok(diffB.neg().gte(amount) && diffB.neg().lt(amount.muln(2))); // partial
        assert.ok(postWhirlpoolData.sqrtPrice.eq(MAX_SQRT_PRICE_BN)); // hit max
      });

      // |-S-***-------T,max----|  (*: liquidity, S: start, T: end)
      it("Fails ExactOut, sqrt_price_limit = 0", async () => {
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

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quote,
              whirlpool: whirlpoolPda.publicKey,
              tokenAuthority: ctx.wallet.publicKey,
              tokenOwnerAccountA: tokenAccountA,
              tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
              oracle: oraclePda.publicKey,
              tokenMintA: whirlpoolData.tokenMintA,
              tokenMintB: whirlpoolData.tokenMintB,
              tokenProgramA: TEST_TOKEN_2022_PROGRAM_ID,
              tokenProgramB: TEST_TOKEN_2022_PROGRAM_ID,

              // sqrt_price_limit = 0
              sqrtPriceLimit: ZERO_BN,
              amount, // 1
              otherAmountThreshold: quote.estimatedAmountIn,
            }),
          ).buildAndExecute(),
          /0x17a9/, // PartialFillError
        );
      });

      // |-S-***-------T,max----|  (*: liquidity, S: start, T: end)
      it("ExactOut, sqrt_price_limit = MAX_SQRT_PRICE", async () => {
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

        const [preA, preB] = await getTokenBalances();

        await toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
            ...quote,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            oracle: oraclePda.publicKey,
            tokenMintA: whirlpoolData.tokenMintA,
            tokenMintB: whirlpoolData.tokenMintB,
            tokenProgramA: TEST_TOKEN_2022_PROGRAM_ID,
            tokenProgramB: TEST_TOKEN_2022_PROGRAM_ID,

            // sqrt_price_limit = MAX_SQRT_PRICE
            sqrtPriceLimit: MAX_SQRT_PRICE_BN,
            amount, // 1
            otherAmountThreshold: quote.estimatedAmountIn,
          }),
        ).buildAndExecute();

        const postWhirlpoolData = await whirlpool.refreshData();
        const [postA, postB] = await getTokenBalances();
        const diffA = postA.sub(preA);
        const diffB = postB.sub(preB);

        assert.ok(diffA.isZero()); // no output (round up is not used to calculate output)
        assert.ok(diffB.neg().eq(quote.estimatedAmountIn)); // partial
        assert.ok(postWhirlpoolData.sqrtPrice.eq(MAX_SQRT_PRICE_BN)); // hit max
      });
    });

    describe("partial fill, a to b", () => {
      const tickSpacing = 128;
      const aToB = true;
      const client = buildWhirlpoolClient(ctx);

      let poolInitInfo: InitPoolV2Params;
      let whirlpoolPda: PDA;
      let tokenAccountA: PublicKey;
      let tokenAccountB: PublicKey;
      let whirlpoolKey: PublicKey;
      let oraclePda: PDA;

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

      async function getTokenBalances(): Promise<[anchor.BN, anchor.BN]> {
        const tokenVaultA = new anchor.BN(
          await getTokenBalance(provider, tokenAccountA),
        );
        const tokenVaultB = new anchor.BN(
          await getTokenBalance(provider, tokenAccountB),
        );
        return [tokenVaultA, tokenVaultB];
      }

      // |-min,T---------***-S-|  (*: liquidity, S: start, T: end)
      it("ExactIn, sqrt_price_limit = 0", async () => {
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

        const [preA, preB] = await getTokenBalances();

        await toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
            ...quote,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            oracle: oraclePda.publicKey,
            tokenMintA: whirlpoolData.tokenMintA,
            tokenMintB: whirlpoolData.tokenMintB,
            tokenProgramA: TEST_TOKEN_2022_PROGRAM_ID,
            tokenProgramB: TEST_TOKEN_2022_PROGRAM_ID,

            // sqrt_price_limit = 0
            sqrtPriceLimit: ZERO_BN,
            otherAmountThreshold: new BN(0),
          }),
        ).buildAndExecute();

        const postWhirlpoolData = await whirlpool.refreshData();
        const [postA, postB] = await getTokenBalances();
        const diffA = postA.sub(preA);
        const diffB = postB.sub(preB);

        assert.ok(diffA.neg().gte(amount) && diffA.neg().lt(amount.muln(2))); // partial
        assert.ok(diffB.isZero()); // no output (round up is not used to calculate output)
        assert.ok(postWhirlpoolData.sqrtPrice.eq(MIN_SQRT_PRICE_BN)); // hit min
      });

      // |-min,T---------***-S-|  (*: liquidity, S: start, T: end)
      it("ExactIn, sqrt_price_limit = MIN_SQRT_PRICE", async () => {
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

        const [preA, preB] = await getTokenBalances();

        await toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
            ...quote,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            oracle: oraclePda.publicKey,
            tokenMintA: whirlpoolData.tokenMintA,
            tokenMintB: whirlpoolData.tokenMintB,
            tokenProgramA: TEST_TOKEN_2022_PROGRAM_ID,
            tokenProgramB: TEST_TOKEN_2022_PROGRAM_ID,

            // sqrt_price_limit = MIN_SQRT_PRICE
            sqrtPriceLimit: MIN_SQRT_PRICE_BN,
            otherAmountThreshold: new BN(0),
          }),
        ).buildAndExecute();

        const postWhirlpoolData = await whirlpool.refreshData();
        const [postA, postB] = await getTokenBalances();
        const diffA = postA.sub(preA);
        const diffB = postB.sub(preB);

        assert.ok(diffA.neg().gte(amount) && diffA.neg().lt(amount.muln(2))); // partial
        assert.ok(diffB.isZero()); // no output (round up is not used to calculate output)
        assert.ok(postWhirlpoolData.sqrtPrice.eq(MIN_SQRT_PRICE_BN)); // hit min
      });

      // |-min,T---------***-S-|  (*: liquidity, S: start, T: end)
      it("Fails ExactOut, sqrt_price_limit = 0", async () => {
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

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quote,
              whirlpool: whirlpoolPda.publicKey,
              tokenAuthority: ctx.wallet.publicKey,
              tokenOwnerAccountA: tokenAccountA,
              tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
              oracle: oraclePda.publicKey,
              tokenMintA: whirlpoolData.tokenMintA,
              tokenMintB: whirlpoolData.tokenMintB,
              tokenProgramA: TEST_TOKEN_2022_PROGRAM_ID,
              tokenProgramB: TEST_TOKEN_2022_PROGRAM_ID,

              // sqrt_price_limit = 0
              sqrtPriceLimit: ZERO_BN,
              amount, // 1
              otherAmountThreshold: quote.estimatedAmountIn,
            }),
          ).buildAndExecute(),
          /0x17a9/, // PartialFillError
        );
      });

      // |-min,T---------***-S-|  (*: liquidity, S: start, T: end)
      it("ExactOut, sqrt_price_limit = MAX_SQRT_PRICE", async () => {
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

        const [preA, preB] = await getTokenBalances();

        await toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
            ...quote,
            whirlpool: whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            oracle: oraclePda.publicKey,
            tokenMintA: whirlpoolData.tokenMintA,
            tokenMintB: whirlpoolData.tokenMintB,
            tokenProgramA: TEST_TOKEN_2022_PROGRAM_ID,
            tokenProgramB: TEST_TOKEN_2022_PROGRAM_ID,

            // sqrt_price_limit = MIN_SQRT_PRICE
            sqrtPriceLimit: MIN_SQRT_PRICE_BN,
            amount, // 1
            otherAmountThreshold: quote.estimatedAmountIn,
          }),
        ).buildAndExecute();

        const postWhirlpoolData = await whirlpool.refreshData();
        const [postA, postB] = await getTokenBalances();
        const diffA = postA.sub(preA);
        const diffB = postB.sub(preB);

        assert.ok(diffA.neg().eq(quote.estimatedAmountIn)); // partial
        assert.ok(diffB.isZero()); // no output (round up is not used to calculate output)
        assert.ok(postWhirlpoolData.sqrtPrice.eq(MIN_SQRT_PRICE_BN)); // hit min
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
          tokenExtensionCtx:
            await TokenExtensionUtil.buildTokenExtensionContext(
              fetcher,
              whirlpoolDataPre,
              IGNORE_CACHE,
            ),
        },
        Percentage.fromFraction(1, 100),
      );

      const preSqrtPrice = whirlpoolDataPre.sqrtPrice;
      // event verification
      let eventVerified = false;
      let detectedSignature = null;
      const listener = ctx.program.addEventListener(
        "Traded",
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

      const signature = await toTx(
        ctx,
        WhirlpoolIx.swapV2Ix(ctx.program, {
          ...quote,
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
        }),
      ).buildAndExecute();

      await sleep(2000);
      assert.equal(signature, detectedSignature);
      assert.ok(eventVerified);

      ctx.program.removeEventListener(listener);
    });
  });

  describe("v2 specific accounts", () => {
    it("fails when passed token_mint_a does not match whirlpool's token_mint_a", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokensV2(
          ctx,
          { isToken2022: true },
          { isToken2022: true },
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

      const otherTokenPublicKey = await createMintV2(provider, {
        isToken2022: true,
      });

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
            amount: new BN(10),
            otherAmountThreshold: ZERO_BN,
            sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
            amountSpecifiedIsInput: true,
            aToB: true,
            whirlpool: poolInitInfo.whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: otherTokenPublicKey, // invalid
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[0].publicKey,
            tickArray2: tickArrays[0].publicKey,
            oracle: oraclePda.publicKey,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed token_mint_b does not match whirlpool's token_mint_b", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokensV2(
          ctx,
          { isToken2022: true },
          { isToken2022: true },
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

      const otherTokenPublicKey = await createMintV2(provider, {
        isToken2022: true,
      });

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
            amount: new BN(10),
            otherAmountThreshold: ZERO_BN,
            sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
            amountSpecifiedIsInput: true,
            aToB: true,
            whirlpool: poolInitInfo.whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: otherTokenPublicKey, // invalid
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[0].publicKey,
            tickArray2: tickArrays[0].publicKey,
            oracle: oraclePda.publicKey,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed token_program_a is not token program (token-2022 is passed)", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokensV2(
          ctx,
          { isToken2022: false },
          { isToken2022: false },
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

      assert.ok(poolInitInfo.tokenProgramA.equals(TEST_TOKEN_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
            amount: new BN(10),
            otherAmountThreshold: ZERO_BN,
            sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
            amountSpecifiedIsInput: true,
            aToB: true,
            whirlpool: poolInitInfo.whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: TEST_TOKEN_2022_PROGRAM_ID,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[0].publicKey,
            tickArray2: tickArrays[0].publicKey,
            oracle: oraclePda.publicKey,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed token_program_a is not token-2022 program (token is passed)", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokensV2(
          ctx,
          { isToken2022: true },
          { isToken2022: true },
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

      assert.ok(poolInitInfo.tokenProgramA.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
            amount: new BN(10),
            otherAmountThreshold: ZERO_BN,
            sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
            amountSpecifiedIsInput: true,
            aToB: true,
            whirlpool: poolInitInfo.whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: TEST_TOKEN_PROGRAM_ID,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[0].publicKey,
            tickArray2: tickArrays[0].publicKey,
            oracle: oraclePda.publicKey,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed token_program_a is token_metadata", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokensV2(
          ctx,
          { isToken2022: true },
          { isToken2022: true },
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

      assert.ok(poolInitInfo.tokenProgramA.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
            amount: new BN(10),
            otherAmountThreshold: ZERO_BN,
            sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
            amountSpecifiedIsInput: true,
            aToB: true,
            whirlpool: poolInitInfo.whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: METADATA_PROGRAM_ADDRESS,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[0].publicKey,
            tickArray2: tickArrays[0].publicKey,
            oracle: oraclePda.publicKey,
          }),
        ).buildAndExecute(),
        /0xbc0/, // InvalidProgramId
      );
    });

    it("fails when passed token_program_b is not token program (token-2022 is passed)", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokensV2(
          ctx,
          { isToken2022: false },
          { isToken2022: false },
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

      assert.ok(poolInitInfo.tokenProgramB.equals(TEST_TOKEN_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
            amount: new BN(10),
            otherAmountThreshold: ZERO_BN,
            sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
            amountSpecifiedIsInput: true,
            aToB: true,
            whirlpool: poolInitInfo.whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: TEST_TOKEN_2022_PROGRAM_ID,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[0].publicKey,
            tickArray2: tickArrays[0].publicKey,
            oracle: oraclePda.publicKey,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed token_program_b is not token-2022 program (token is passed)", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokensV2(
          ctx,
          { isToken2022: true },
          { isToken2022: true },
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

      assert.ok(poolInitInfo.tokenProgramB.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
            amount: new BN(10),
            otherAmountThreshold: ZERO_BN,
            sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
            amountSpecifiedIsInput: true,
            aToB: true,
            whirlpool: poolInitInfo.whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: TEST_TOKEN_PROGRAM_ID,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[0].publicKey,
            tickArray2: tickArrays[0].publicKey,
            oracle: oraclePda.publicKey,
          }),
        ).buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed token_program_b is token_metadata", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokensV2(
          ctx,
          { isToken2022: true },
          { isToken2022: true },
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

      assert.ok(poolInitInfo.tokenProgramB.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.swapV2Ix(ctx.program, {
            amount: new BN(10),
            otherAmountThreshold: ZERO_BN,
            sqrtPriceLimit: MathUtil.toX64(new Decimal(4.95)),
            amountSpecifiedIsInput: true,
            aToB: true,
            whirlpool: poolInitInfo.whirlpoolPda.publicKey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: METADATA_PROGRAM_ADDRESS,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            tickArray0: tickArrays[0].publicKey,
            tickArray1: tickArrays[0].publicKey,
            tickArray2: tickArrays[0].publicKey,
            oracle: oraclePda.publicKey,
          }),
        ).buildAndExecute(),
        /0xbc0/, // InvalidProgramId
      );
    });

    it("fails when passed memo_program is token_metadata", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokensV2(
          ctx,
          { isToken2022: true },
          { isToken2022: true },
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

      const invalidMemoProgram = METADATA_PROGRAM_ADDRESS;

      await assert.rejects(
        toTx(ctx, {
          cleanupInstructions: [],
          signers: [],
          instructions: [
            ctx.program.instruction.swapV2(
              new BN(10), // amount
              ZERO_BN, // otherAmountThreshold
              MathUtil.toX64(new Decimal(4.95)), // sqrtPriceLimit
              true, // amountSpecifiedIsInput
              true, // aToB
              { slices: [] },
              {
                accounts: {
                  whirlpool: poolInitInfo.whirlpoolPda.publicKey,
                  tokenAuthority: ctx.wallet.publicKey,
                  tokenMintA: poolInitInfo.tokenMintA,
                  tokenMintB: poolInitInfo.tokenMintB,
                  tokenProgramA: poolInitInfo.tokenProgramA,
                  tokenProgramB: poolInitInfo.tokenProgramB,
                  tokenOwnerAccountA: tokenAccountA,
                  tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
                  tokenOwnerAccountB: tokenAccountB,
                  tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
                  tickArray0: tickArrays[0].publicKey,
                  tickArray1: tickArrays[0].publicKey,
                  tickArray2: tickArrays[0].publicKey,
                  oracle: oraclePda.publicKey,
                  memoProgram: invalidMemoProgram,
                },
              },
            ),
          ],
        }).buildAndExecute(),
        /0xbc0/, // InvalidProgramId
      );
    });
  });
});
