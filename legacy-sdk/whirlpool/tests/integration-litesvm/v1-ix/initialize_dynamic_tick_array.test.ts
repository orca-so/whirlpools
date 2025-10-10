import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { InitPoolParams, InitTickArrayParams } from "../../../src";
import {
  TICK_ARRAY_SIZE,
  WhirlpoolContext,
  WhirlpoolIx,
  toTx,
} from "../../../src";
import { ONE_SOL, TickSpacing, systemTransferTx } from "../../utils";
import { startLiteSVM, createLiteSVMProvider } from "../../utils/litesvm";
import { initTestPool, initTickArray, useMaxCU } from "../../utils/init-utils";
import {
  generateDefaultInitDynamicTickArrayParams,
  generateDefaultInitTickArrayParams,
} from "../../utils/test-builders";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

describe("initialize_dynamic_tick_array (litesvm)", () => {
  let provider: anchor.AnchorProvider;

  let program: anchor.Program;

  let ctx: WhirlpoolContext;

  let fetcher: any;


  beforeAll(async () => {

    await startLiteSVM();

    provider = await createLiteSVMProvider();

    const programId = new anchor.web3.PublicKey(

      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"

    );

    const idl = require("../../../src/artifacts/whirlpool.json");

    program = new anchor.Program(idl, programId, provider);

  // program initialized in beforeAll
  ctx = WhirlpoolContext.fromWorkspace(provider, program);
  fetcher = ctx.fetcher;

  });

  it("successfully init a TickArray account", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * 12;

    const tickArrayInitInfo = generateDefaultInitTickArrayParams(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initDynamicTickArrayIx(ctx.program, tickArrayInitInfo),
    ).buildAndExecute();
    assertTickArrayInitialized(ctx, tickArrayInitInfo, poolInitInfo, startTick);
  });

  it("successfully init a TickArray account with a negative index", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * -12;

    const tickArrayInitInfo = generateDefaultInitTickArrayParams(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initDynamicTickArrayIx(ctx.program, tickArrayInitInfo),
    ).buildAndExecute();
    assertTickArrayInitialized(ctx, tickArrayInitInfo, poolInitInfo, startTick);
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(
      provider,
      funderKeypair.publicKey,
      ONE_SOL,
    ).buildAndExecute();
    await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * 13;
    await initTickArray(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick,
      funderKeypair,
    );
  });

  it("Sucessfully initializes a dynamic tick array that already has balance but is not initialized", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * 12;

    const tickArrayInitInfo = generateDefaultInitTickArrayParams(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick,
    );

    await systemTransferTx(
      provider,
      tickArrayInitInfo.tickArrayPda.publicKey,
      1000000,
    ).buildAndExecute();

    await toTx(
      ctx,
      WhirlpoolIx.initDynamicTickArrayIx(ctx.program, tickArrayInitInfo),
    ).buildAndExecute();
    assertTickArrayInitialized(ctx, tickArrayInitInfo, poolInitInfo, startTick);
  });

  it("Sucessfully initializes a dynamic tick array that is already rent-exempt", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * 12;

    const tickArrayInitInfo = generateDefaultInitTickArrayParams(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick,
    );

    await systemTransferTx(
      provider,
      tickArrayInitInfo.tickArrayPda.publicKey,
      LAMPORTS_PER_SOL,
    ).buildAndExecute();

    await toTx(
      ctx,
      WhirlpoolIx.initDynamicTickArrayIx(ctx.program, tickArrayInitInfo),
    ).buildAndExecute();
    assertTickArrayInitialized(
      ctx,
      tickArrayInitInfo,
      poolInitInfo,
      startTick,
      LAMPORTS_PER_SOL,
    );
  });

  it("fails when start tick index is not a valid start index", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * 12 + 1;

    const params = generateDefaultInitTickArrayParams(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick,
    );

    try {
      await toTx(
        ctx,
        WhirlpoolIx.initDynamicTickArrayIx(ctx.program, params),
      ).buildAndExecute();
      assert.fail(
        "should fail if start-tick is not a multiple of tick spacing and num ticks in array",
      );
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0x1771/); // InvalidStartTick
    }
  });

  it("fails when tick array already exists", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * 14;
    const tickArrayInitInfo = generateDefaultInitTickArrayParams(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick,
    );
    await toTx(
      ctx,
      WhirlpoolIx.initDynamicTickArrayIx(ctx.program, tickArrayInitInfo),
    ).buildAndExecute();
    try {
      await toTx(
        ctx,
        WhirlpoolIx.initDynamicTickArrayIx(ctx.program, tickArrayInitInfo),
      ).buildAndExecute();
      assert.fail("should fail if tick array already exists");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0xbb8/); // AccountDiscriminatorAlreadySet.
    }
  });

  it("fails when the tick array already exists and is fixed", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * 14;
    const tickArrayInitInfo = generateDefaultInitTickArrayParams(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick,
    );
    await toTx(
      ctx,
      WhirlpoolIx.initTickArrayIx(ctx.program, tickArrayInitInfo),
    ).buildAndExecute();
    try {
      await toTx(
        ctx,
        WhirlpoolIx.initDynamicTickArrayIx(ctx.program, tickArrayInitInfo),
      ).buildAndExecute();
      assert.fail("should fail if tick array already exists");
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0xbb8/); // AccountDiscriminatorAlreadySet.
    }
  });

  it("tick array exists is allowed with idempotent true", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * -14;
    const tickArrayInitInfo = generateDefaultInitDynamicTickArrayParams(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick,
      undefined,
      true,
    );
    await toTx(
      ctx,
      WhirlpoolIx.initDynamicTickArrayIx(ctx.program, tickArrayInitInfo),
    )
      .addInstruction(useMaxCU())
      .buildAndExecute();
    await toTx(
      ctx,
      WhirlpoolIx.initDynamicTickArrayIx(ctx.program, tickArrayInitInfo),
    )
      .addInstruction(useMaxCU())
      .buildAndExecute();
    assertTickArrayInitialized(ctx, tickArrayInitInfo, poolInitInfo, startTick);
  });

  it("tick array exists is allowed with idempotent true using a fixed tick array", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * -14;
    const tickArrayInitInfo = generateDefaultInitDynamicTickArrayParams(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick,
      undefined,
      true,
    );
    await toTx(ctx, WhirlpoolIx.initTickArrayIx(ctx.program, tickArrayInitInfo))
      .addInstruction(useMaxCU())
      .buildAndExecute();
    await toTx(
      ctx,
      WhirlpoolIx.initDynamicTickArrayIx(ctx.program, tickArrayInitInfo),
    )
      .addInstruction(useMaxCU())
      .buildAndExecute();
    assertTickArrayInitialized(ctx, tickArrayInitInfo, poolInitInfo, startTick);
  });

  async function assertTickArrayInitialized(
    ctx: WhirlpoolContext,
    tickArrayInitInfo: InitTickArrayParams,
    poolInitInfo: InitPoolParams,
    startTick: number,
    lamports?: number,
  ) {
    const tickArrayData = await fetcher.getTickArray(
      tickArrayInitInfo.tickArrayPda.publicKey,
    );
    assert.ok(
      tickArrayData?.whirlpool.equals(poolInitInfo.whirlpoolPda.publicKey),
    );
    assert.ok(tickArrayData?.startTickIndex == startTick);

    const tickArrayAccount = await ctx.connection.getAccountInfo(
      tickArrayInitInfo.tickArrayPda.publicKey,
    );
    const rentExemptBalance =
      await ctx.connection.getMinimumBalanceForRentExemption(
        tickArrayAccount?.data.length ?? 0,
      );
    assert.strictEqual(
      tickArrayAccount?.lamports,
      lamports ?? rentExemptBalance,
    );
  }
});
