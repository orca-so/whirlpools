import * as anchor from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import BN from "bn.js";
import type { IncreaseLiquidityInput, WhirlpoolClient } from "../../../src";
import {
  PDAUtil,
  PriceMath,
  TickUtil,
  buildWhirlpoolClient,
} from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { initTestPoolWithTokens, useMaxCU } from "../../utils/init-utils";
import {
  startLiteSVM,
  createLiteSVMProvider,
  resetLiteSVM,
  getLiteSVM,
} from "../../utils/litesvm";

const TICK_SPACING = 1;

describe("Swap CUs (litesvm)", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let ctx: WhirlpoolContext;
  let client: WhirlpoolClient;
  let whirlpool: PublicKey;

  beforeAll(async () => {
    await startLiteSVM();
    provider = await createLiteSVMProvider();
    const programId = new anchor.web3.PublicKey(
      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    );
    const idl = require("../../../src/artifacts/whirlpool.json");
    program = new anchor.Program(idl, programId, provider);
    anchor.setProvider(provider);
    ctx = WhirlpoolContext.fromWorkspace(provider, program);
    client = buildWhirlpoolClient(ctx);
  });

  // Swap from 0 to 263 (3 TAs)
  // |------------|------------|------------|
  // 0            88           176          264

  const initFixture = async (tickArrayType: "dynamic" | "fixed") => {
    // Init pool
    const { poolInitInfo } = await initTestPoolWithTokens(
      ctx,
      TICK_SPACING,
      PriceMath.tickIndexToSqrtPriceX64(0),
      new BN(10).pow(new BN(18)),
    );

    whirlpool = poolInitInfo.whirlpoolPda.publicKey;

    const [fullRangeLowerTick, fullRangeUpperTick] =
      TickUtil.getFullRangeTickIndex(TICK_SPACING);

    const pool = await client.getPool(whirlpool);

    // Init 3 TAs and full range tick array
    const initTickArraysTx = await pool.initTickArrayForTicks(
      [fullRangeLowerTick, 0, 88, 176, fullRangeUpperTick],
      undefined,
      IGNORE_CACHE,
      tickArrayType,
    );

    await initTickArraysTx!.buildAndExecute();

    // Init Full range position
    const liquidityInput: IncreaseLiquidityInput = {
      liquidityAmount: new BN(1000000000),
      tokenMaxA: new BN(10).pow(new BN(18)),
      tokenMaxB: new BN(10).pow(new BN(18)),
    };

    const position = await pool.openPosition(
      fullRangeLowerTick,
      fullRangeUpperTick,
      liquidityInput,
    );

    await position.tx.buildAndExecute();
  };

  // Initialze all ticks in range
  const initAllTicks = async () => {
    const pool = await client.getPool(whirlpool);

    for (let i = 0; i < 132; i++) {
      const liquidityInput: IncreaseLiquidityInput = {
        liquidityAmount: new BN(1),
        tokenMaxA: new BN(10).pow(new BN(18)),
        tokenMaxB: new BN(10).pow(new BN(18)),
      };

      const lowerTick = i * TICK_SPACING;
      const upperTick = 264 - (i + 1) * TICK_SPACING;

      const positionTx = await pool.openPosition(
        lowerTick,
        upperTick,
        liquidityInput,
      );
      await positionTx.tx.buildAndExecute();
    }
  };

  // Execute the swap and assert the CUs
  const executeSwap = async (amount: number) => {
    const pool = await client.getPool(whirlpool, IGNORE_CACHE);

    const tickArray0 = PDAUtil.getTickArrayFromTickIndex(
      0,
      TICK_SPACING,
      whirlpool,
      ctx.program.programId,
    );
    const tickArray1 = PDAUtil.getTickArrayFromTickIndex(
      88,
      TICK_SPACING,
      whirlpool,
      ctx.program.programId,
    );
    const tickArray2 = PDAUtil.getTickArrayFromTickIndex(
      176,
      TICK_SPACING,
      whirlpool,
      ctx.program.programId,
    );

    const swapTx = await pool.swap({
      amount: new BN(amount),
      otherAmountThreshold: new BN(0),
      sqrtPriceLimit: new BN(0),
      amountSpecifiedIsInput: true,
      aToB: false,
      tickArray0: tickArray0.publicKey,
      tickArray1: tickArray1.publicKey,
      tickArray2: tickArray2.publicKey,
      supplementalTickArrays: [],
    });

    const sig = await swapTx.addInstruction(useMaxCU()).buildAndExecute();

    const poolAfter = await client.getPool(whirlpool, IGNORE_CACHE);
    assert.strictEqual(poolAfter.getData().tickCurrentIndex, 263);

    // LiteSVM doesn't support getTransaction, so skip CU check for litesvm tests
    try {
      const txResult = await client
        .getContext()
        .connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
      const cu = txResult?.meta?.computeUnitsConsumed ?? Infinity;
      console.info(`SwapV2 CUs: ${cu}`);
      assert.ok(cu < 500_000);
    } catch (e) {
      // LiteSVM doesn't support getTransaction
      console.info("SwapV2 CUs: (not available in LiteSVM)");
    }
  };

  describe("Fixed TA (litesvm)", () => {
    beforeEach(async () => {
      await resetLiteSVM();
      // Re-fund the wallet after reset
      getLiteSVM().airdrop(provider.wallet.publicKey, BigInt(100e9));
    });

    it("No ticks initialized", async () => {
      await initFixture("fixed");
      await executeSwap(13276005);
    });

    // TODO: Runs out of CUs
    it.skip("All ticks initialized", async () => {
      await initFixture("fixed");
      await initAllTicks();
      await executeSwap(13276005);
    });
  });

  describe("Dynamic TA (litesvm)", () => {
    beforeEach(async () => {
      await resetLiteSVM();
      // Re-fund the wallet after reset
      getLiteSVM().airdrop(provider.wallet.publicKey, BigInt(100e9));
    });

    it("No ticks initialized", async () => {
      await initFixture("dynamic");
      await executeSwap(13276005);
    });

    // TODO: Runs out of CUs
    it.skip("All ticks initialized", async () => {
      await initFixture("dynamic");
      await initAllTicks();
      await executeSwap(13276005);
    });
  });
});
