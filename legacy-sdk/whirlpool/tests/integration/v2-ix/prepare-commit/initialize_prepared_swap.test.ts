import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type {
  InitPoolParams,
  InitTickArrayParams,
  TickArrayData,
  WhirlpoolContext,
} from "../../../../src";
import { getAccountSize, AccountName, TICK_ARRAY_SIZE, WhirlpoolIx, toTx, MAX_PREPARED_SWAP_NONCE } from "../../../../src";
import { initializeLiteSVMEnvironment } from "../../../utils/litesvm";
import { PDAUtil } from "../../../../dist/utils/public/pda-utils";
import { ONE_SOL, systemTransferTx } from "../../../utils";

describe("initialize_prepared_swap", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  it("successfully init a PreparedSwap account (nonce = 0)", async () => {
    const nonce = 0;
    const preparedSwapPda = PDAUtil.getPreparedSwap(ctx.program.programId, nonce);

    const preAccountInfo = await provider.connection.getAccountInfo(preparedSwapPda.publicKey);
    assert.ok(preAccountInfo === null);

    await toTx(
      ctx,
      WhirlpoolIx.initializePreparedSwapIx(ctx.program, {
        funder: ctx.wallet.publicKey,
        nonce,
        preparedSwapPda,
      }),
    ).buildAndExecute();
    
    const postAccountInfo = await provider.connection.getAccountInfo(preparedSwapPda.publicKey);
    assert.ok(postAccountInfo);
    assert.ok(postAccountInfo.data.length == getAccountSize(AccountName.PreparedSwap));
  });

  it("successfully init a PreparedSwap account (nonce = MAX_PREPARED_SWAP_NONCE)", async () => {
    const nonce = MAX_PREPARED_SWAP_NONCE;
    const preparedSwapPda = PDAUtil.getPreparedSwap(ctx.program.programId, nonce);

    const preAccountInfo = await provider.connection.getAccountInfo(preparedSwapPda.publicKey);
    assert.ok(preAccountInfo === null);

    await toTx(
      ctx,
      WhirlpoolIx.initializePreparedSwapIx(ctx.program, {
        funder: ctx.wallet.publicKey,
        nonce,
        preparedSwapPda,
      }),
    ).buildAndExecute();
    
    const postAccountInfo = await provider.connection.getAccountInfo(preparedSwapPda.publicKey);
    assert.ok(postAccountInfo);
    assert.ok(postAccountInfo.data.length == getAccountSize(AccountName.PreparedSwap));
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(
      provider,
      funderKeypair.publicKey,
      ONE_SOL,
    ).buildAndExecute();

    const nonce = 1; // Note: We need to use new nonce because these test cases uses the same liteSVM env.
    const preparedSwapPda = PDAUtil.getPreparedSwap(ctx.program.programId, nonce);

    const preAccountInfo = await provider.connection.getAccountInfo(preparedSwapPda.publicKey);
    assert.ok(preAccountInfo === null);

    await toTx(
      ctx,
      WhirlpoolIx.initializePreparedSwapIx(ctx.program, {
        funder: funderKeypair.publicKey,
        nonce,
        preparedSwapPda,
      }),
    )
    .addSigner(funderKeypair)
    .buildAndExecute();
    
    const postAccountInfo = await provider.connection.getAccountInfo(preparedSwapPda.publicKey);
    assert.ok(postAccountInfo);
    assert.ok(postAccountInfo.data.length == getAccountSize(AccountName.PreparedSwap));
  });

  it("fails when the accout has been already initialized", async () => {
    const nonce = 0;
    const preparedSwapPda = PDAUtil.getPreparedSwap(ctx.program.programId, nonce);

    // Initialize the account if needed.
    // Note: these tests share the same LiteSVM environment, so the account may have
    // already been initialized. We intentionally ignore the error here, and only
    // care that the account is initialized after this step.
    try {
      await toTx(
        ctx,
        WhirlpoolIx.initializePreparedSwapIx(ctx.program, {
          funder: ctx.wallet.publicKey,
          nonce,
          preparedSwapPda,
        }),
      ).buildAndExecute();
    } catch (e) {}

    const preAccountInfo = await provider.connection.getAccountInfo(preparedSwapPda.publicKey);
    assert.ok(preAccountInfo);
    assert.ok(preAccountInfo.data.length == getAccountSize(AccountName.PreparedSwap));
    
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.initializePreparedSwapIx(ctx.program, {
          funder: ctx.wallet.publicKey,
          nonce,
          preparedSwapPda,
        }),
      ).buildAndExecute(),
      (err: Error) => {
        return err.message.includes("already in use");
      },
    );
  });


  /*

  it("fails when start tick index is not a valid start index", async () => {
    const tickSpacing = TickSpacing.Standard;
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const startTick = TICK_ARRAY_SIZE * tickSpacing * 2 + 1;

    const params = generateDefaultInitTickArrayParams(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      startTick,
    );

    try {
      await toTx(
        ctx,
        WhirlpoolIx.initTickArrayIx(ctx.program, params),
      ).buildAndExecute();
      assert.fail(
        "should fail if start-tick is not a multiple of tick spacing and num ticks in array",
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
    startTick: number,
  ) {
    let tickArrayData = (await fetcher.getTickArray(
      tickArrayInitInfo.tickArrayPda.publicKey,
    )) as TickArrayData;
    assert.ok(
      tickArrayData.whirlpool.equals(poolInitInfo.whirlpoolPda.publicKey),
    );
    assert.ok(tickArrayData.startTickIndex == startTick);
  }
    */
});
