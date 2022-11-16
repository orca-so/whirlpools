import * as anchor from "@project-serum/anchor";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  InitPoolParams,
  PDAUtil,
  PriceMath,
  TickUtil,
  WhirlpoolContext,
} from "../../../src";
import { ONE_SOL, systemTransferTx, TickSpacing } from "../../utils";
import { buildTestPoolParams } from "../../utils/init-utils";

describe("whirlpool-client-impl", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const client = buildWhirlpoolClient(ctx);

  let funderKeypair: anchor.web3.Keypair;
  let poolInitInfo: InitPoolParams;
  beforeEach(async () => {
    funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();
    poolInitInfo = (
      await buildTestPoolParams(
        ctx,
        TickSpacing.Standard,
        3000,
        PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
        funderKeypair.publicKey,
        false
      )
    ).poolInitInfo;
  });

  it("successfully creates a new whirpool account and initial tick array account", async () => {
    const initalTick = TickUtil.getInitializableTickIndex(
      PriceMath.sqrtPriceX64ToTickIndex(poolInitInfo.initSqrtPrice),
      poolInitInfo.tickSpacing
    );

    const { pubkey: actualPubkey, tx } = await client.createPool(
      poolInitInfo.whirlpoolsConfig,
      poolInitInfo.tokenMintA,
      poolInitInfo.tokenMintB,
      poolInitInfo.tickSpacing,
      initalTick,
      funderKeypair.publicKey
    );

    const expectedPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      poolInitInfo.whirlpoolsConfig,
      poolInitInfo.tokenMintA,
      poolInitInfo.tokenMintB,
      poolInitInfo.tickSpacing
    );

    const startTickArrayPda = PDAUtil.getTickArrayFromTickIndex(
      initalTick,
      poolInitInfo.tickSpacing,
      expectedPda.publicKey,
      ctx.program.programId
    );

    assert.ok(expectedPda.publicKey.equals(actualPubkey));

    const [whirlpoolAccountBefore, tickArrayAccountBefore] = await Promise.all([
      ctx.fetcher.getPool(expectedPda.publicKey, true),
      ctx.fetcher.getTickArray(startTickArrayPda.publicKey, true),
    ]);

    assert.ok(whirlpoolAccountBefore === null);
    assert.ok(tickArrayAccountBefore === null);

    await tx.addSigner(funderKeypair).buildAndExecute();

    const [whirlpoolAccountAfter, tickArrayAccountAfter] = await Promise.all([
      ctx.fetcher.getPool(expectedPda.publicKey, true),
      ctx.fetcher.getTickArray(startTickArrayPda.publicKey, true),
    ]);

    assert.ok(whirlpoolAccountAfter !== null);
    assert.ok(tickArrayAccountAfter !== null);

    assert.ok(whirlpoolAccountAfter.feeGrowthGlobalA.eqn(0));
    assert.ok(whirlpoolAccountAfter.feeGrowthGlobalB.eqn(0));
    assert.ok(whirlpoolAccountAfter.feeRate === 3000);
    assert.ok(whirlpoolAccountAfter.liquidity.eqn(0));
    assert.ok(whirlpoolAccountAfter.protocolFeeOwedA.eqn(0));
    assert.ok(whirlpoolAccountAfter.protocolFeeOwedB.eqn(0));
    assert.ok(whirlpoolAccountAfter.protocolFeeRate === 300);
    assert.ok(whirlpoolAccountAfter.rewardInfos.length === 3);
    assert.ok(whirlpoolAccountAfter.rewardLastUpdatedTimestamp.eqn(0));
    assert.ok(whirlpoolAccountAfter.sqrtPrice.eq(PriceMath.tickIndexToSqrtPriceX64(initalTick)));
    assert.ok(whirlpoolAccountAfter.tickCurrentIndex === initalTick);
    assert.ok(whirlpoolAccountAfter.tickSpacing === poolInitInfo.tickSpacing);
    assert.ok(whirlpoolAccountAfter.tokenMintA.equals(poolInitInfo.tokenMintA));
    assert.ok(whirlpoolAccountAfter.tokenMintB.equals(poolInitInfo.tokenMintB));
    assert.ok(whirlpoolAccountAfter.whirlpoolBump[0] === expectedPda.bump);
    assert.ok(whirlpoolAccountAfter.whirlpoolsConfig.equals(poolInitInfo.whirlpoolsConfig));

    assert.ok(
      tickArrayAccountAfter.startTickIndex ===
        TickUtil.getStartTickIndex(initalTick, poolInitInfo.tickSpacing)
    );
    assert.ok(tickArrayAccountAfter.ticks.length > 0);
    assert.ok(tickArrayAccountAfter.whirlpool.equals(expectedPda.publicKey));
  });
});
