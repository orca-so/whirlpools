import * as anchor from "@coral-xyz/anchor";
import { Percentage } from "@orca-so/common-sdk";
import * as assert from "assert";
import BN from "bn.js";
import {
  PriceMath,
  WhirlpoolContext,
  buildWhirlpoolClient,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
} from "../../../../src";
import { IGNORE_CACHE } from "../../../../src/network/public/fetcher";
import { NATIVE_MINT } from "@solana/spl-token";
import { WhirlpoolTestFixture } from "../../../utils/fixture";
import { SystemInstruction } from "@solana/web3.js";
import { SwapUtils } from "../../../../dist/utils/public/swap-utils";
import { startLiteSVM, createLiteSVMProvider } from "../../../utils";

describe("swap edge case test (litesvm)", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let ctx: WhirlpoolContext;
  let fetcher: any;
  let client: any;

  beforeAll(async () => {
    await startLiteSVM();
    provider = await createLiteSVMProvider();
    const programId = new anchor.web3.PublicKey(
      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
    );
    const idl = require("../../../../src/artifacts/whirlpool.json");
    program = new anchor.Program(idl, programId, provider);
    ctx = WhirlpoolContext.fromWorkspace(provider, program);
    fetcher = ctx.fetcher;
    client = buildWhirlpoolClient(ctx);
  });

  describe("SOL Wrapping", () => {
    async function buildTestFixture() {
      const tickSpacing = 64;
      const tickInitialIndex = -1988;
      const tickUpperIndex = -64;
      const tickLowerIndex = -3904;
      const liquidityAmount = new BN(100000000000);

      return new WhirlpoolTestFixture(ctx).init({
        tokenAIsNative: true, // build pool which is similar to SOL/mSOL
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(tickInitialIndex),
        tickSpacing,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position
        ],
      });
    }

    it("ExactIn, SOL is input token", async () => {
      const fixture = await buildTestFixture();
      const poolInitInfo = fixture.getInfos().poolInitInfo;

      const pool = await client.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE
      );
      assert.ok(pool.getData().tokenMintA.equals(NATIVE_MINT));

      const quote = await swapQuoteByInputToken(
        pool,
        pool.getData().tokenMintA, // SOL(tokenMintA) will be input
        new BN(1_000_000_000), // 1 SOL (required input is obvilously 1 SOL + rent)
        Percentage.fromFraction(0, 1000),
        ctx.program.programId,
        ctx.fetcher,
        IGNORE_CACHE
      );

      // ExactIn
      assert.ok(quote.amountSpecifiedIsInput === true);
      assert.ok(quote.aToB);

      // The value of mSOL > The value of SOL
      assert.ok(quote.amount.eq(new BN(1_000_000_000))); // 1 SOL
      assert.ok(quote.otherAmountThreshold.lt(new BN(900_000_000))); // < 0.9 mSOL

      const tx = await pool.swap(quote);

      // check wrapping instruction
      const createAccountIx = tx.compressIx(true).instructions[0];
      const decoded = SystemInstruction.decodeCreateAccount(createAccountIx);
      const tokenAccountRent = await fetcher.getAccountRentExempt(true);
      const lamportsExpected = quote.amount.addn(tokenAccountRent);
      assert.ok(lamportsExpected.eq(new BN(decoded.lamports)));

      await tx.buildAndExecute();
    });

    it("ExactOut, SOL is input token", async () => {
      const fixture = await buildTestFixture();
      const poolInitInfo = fixture.getInfos().poolInitInfo;

      const pool = await client.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE
      );
      assert.ok(pool.getData().tokenMintA.equals(NATIVE_MINT));

      const quote = await swapQuoteByOutputToken(
        pool,
        pool.getData().tokenMintB, // SOL(tokenMintA) will be input
        new BN(1_000_000_000), // 1 mSOL (required input is obvilously larger than 1 SOL)
        Percentage.fromFraction(0, 1000),
        ctx.program.programId,
        ctx.fetcher,
        IGNORE_CACHE
      );

      // ExactOut
      assert.ok(quote.amountSpecifiedIsInput === false);
      assert.ok(quote.aToB);

      // If WSOL amount is 1 WSOL, swap should be failed
      assert.ok(quote.amount.eq(new BN(1_000_000_000))); // 1 mSOL
      assert.ok(quote.otherAmountThreshold.gt(new BN(1_100_000_000))); // > 1.1 SOL

      const tx = await pool.swap(quote);

      // check wrapping instruction
      const createAccountIx = tx.compressIx(true).instructions[0];
      const decoded = SystemInstruction.decodeCreateAccount(createAccountIx);
      const tokenAccountRent = await fetcher.getAccountRentExempt(true);
      const lamportsExpected =
        quote.otherAmountThreshold.addn(tokenAccountRent);
      assert.ok(lamportsExpected.eq(new BN(decoded.lamports)));

      await tx.buildAndExecute();
    });

    it("[Fail] ExactOut, SOL is input token, otherAmountThreshold is default value (U64_MAX)", async () => {
      const fixture = await buildTestFixture();
      const poolInitInfo = fixture.getInfos().poolInitInfo;

      const pool = await client.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE
      );
      assert.ok(pool.getData().tokenMintA.equals(NATIVE_MINT));

      const quote = await swapQuoteByOutputToken(
        pool,
        pool.getData().tokenMintB, // SOL(tokenMintA) will be input
        new BN(1_000_000_000), // 1 mSOL (required input is obvilously larger than 1 SOL)
        Percentage.fromFraction(0, 1000),
        ctx.program.programId,
        ctx.fetcher,
        IGNORE_CACHE
      );

      // ExactOut
      assert.ok(quote.amountSpecifiedIsInput === false);
      assert.ok(quote.aToB);

      // If WSOL amount is 1 WSOL, swap should be failed
      assert.ok(quote.amount.eq(new BN(1_000_000_000))); // 1 mSOL
      assert.ok(quote.otherAmountThreshold.gt(new BN(1_100_000_000))); // > 1.1 SOL

      await assert.rejects(
        pool.swap({
          ...quote,
          // use default otherAmountThreshold (U64_MAX)
          otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
            quote.amountSpecifiedIsInput
          ),
        }),
        /Wrapping U64_MAX amount of SOL is not possible/
      );
    });
  });
});
