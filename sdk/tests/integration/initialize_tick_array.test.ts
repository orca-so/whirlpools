import * as anchor from "@project-serum/anchor";
import * as assert from "assert";
import {
  InitPoolParams,
  InitTickArrayParams,
  TickArrayData,
  TICK_ARRAY_SIZE,
  toTx,
  WhirlpoolContext,
  WhirlpoolIx,
} from "../../src";
import { ONE_SOL, systemTransferTx, TickSpacing } from "../utils";
import { initTestPool, initTickArray } from "../utils/init-utils";
import { generateDefaultInitTickArrayParams } from "../utils/test-builders";

describe("initialize_tick_array", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  it("successfully init a TickArray account", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * 2;

    const tickArrayInitInfo = generateDefaultInitTickArrayParams(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick
    );

    await toTx(ctx, WhirlpoolIx.initTickArrayIx(ctx.program, tickArrayInitInfo)).buildAndExecute();
    assertTickArrayInitialized(ctx, tickArrayInitInfo, poolInitInfo, startTick);
  });

  it("successfully init a TickArray account with a negative index", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * -2;

    const tickArrayInitInfo = generateDefaultInitTickArrayParams(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick
    );

    await toTx(ctx, WhirlpoolIx.initTickArrayIx(ctx.program, tickArrayInitInfo)).buildAndExecute();
    assertTickArrayInitialized(ctx, tickArrayInitInfo, poolInitInfo, startTick);
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();
    await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * 3;
    await initTickArray(ctx, poolInitInfo.whirlpoolPda.publicKey, startTick, funderKeypair);
  });

  it("fails when start tick index is not a valid start index", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * 2 + 1;

    const params = generateDefaultInitTickArrayParams(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick
    );

    try {
      await toTx(ctx, WhirlpoolIx.initTickArrayIx(ctx.program, params)).buildAndExecute();
      assert.fail(
        "should fail if start-tick is not a multiple of tick spacing and num ticks in array"
      );
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0x1771/); // InvalidStartTick
    }
  });

  async function assertTickArrayInitialized(
    ctx: WhirlpoolContext,
    tickArrayInitInfo: InitTickArrayParams,
    poolInitInfo: InitPoolParams,
    startTick: number
  ) {
    let tickArrayData = (await fetcher.getTickArray(
      tickArrayInitInfo.tickArrayPda.publicKey
    )) as TickArrayData;
    assert.ok(tickArrayData.whirlpool.equals(poolInitInfo.whirlpoolPda.publicKey));
    assert.ok(tickArrayData.startTickIndex == startTick);
  }
});
