import * as anchor from "@project-serum/anchor";
import * as assert from "assert";
import { WhirlpoolContext } from "../src/context";
import { WhirlpoolClient } from "../src/client";
import { initTestPool, initTickArray } from "./utils/init-utils";
import { generateDefaultInitTickArrayParams } from "./utils/test-builders";
import { InitPoolParams, InitTickArrayParams, TICK_ARRAY_SIZE } from "../src";
import { ONE_SOL, systemTransferTx, TickSpacing } from "./utils";

describe("initialize_tick_array", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  it("successfully init a TickArray account", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(client, TickSpacing.Standard);
    await client.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * 2;

    const tickArrayInitInfo = generateDefaultInitTickArrayParams(
      context,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick
    );

    await client.initTickArrayTx(tickArrayInitInfo).buildAndExecute();
    assertTickArrayInitialized(client, tickArrayInitInfo, poolInitInfo, startTick);
  });

  it("successfully init a TickArray account with a negative index", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(client, TickSpacing.Standard);
    await client.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * -2;

    const tickArrayInitInfo = generateDefaultInitTickArrayParams(
      context,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick
    );

    await client.initTickArrayTx(tickArrayInitInfo).buildAndExecute();
    assertTickArrayInitialized(client, tickArrayInitInfo, poolInitInfo, startTick);
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(client, TickSpacing.Standard);
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();
    await client.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * 3;
    await initTickArray(client, poolInitInfo.whirlpoolPda.publicKey, startTick, funderKeypair);
  });

  it("fails when start tick index is not a valid start index", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(client, TickSpacing.Standard);
    await client.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * 2 + 1;

    const params = generateDefaultInitTickArrayParams(
      context,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick
    );

    try {
      await client.initTickArrayTx(params).buildAndExecute();
      assert.fail(
        "should fail if start-tick is not a multiple of tick spacing and num ticks in array"
      );
    } catch (e) {
      const error = e as Error;
      assert.match(error.message, /0x1771/); // InvalidStartTick
    }
  });

  async function assertTickArrayInitialized(
    client: WhirlpoolClient,
    tickArrayInitInfo: InitTickArrayParams,
    poolInitInfo: InitPoolParams,
    startTick: number
  ) {
    let tickArrayData = await client.getTickArray(tickArrayInitInfo.tickArrayPda.publicKey);
    assert.ok(tickArrayData.whirlpool.equals(poolInitInfo.whirlpoolPda.publicKey));
    assert.ok(tickArrayData.startTickIndex == startTick);
  }
});
