import { AnchorProvider, workspace } from "@project-serum/anchor";
import {
  calculatePoolPrices,
  fetchDecimalsForMints,
  fetchPoolsForMints,
  fetchTickArraysForPools,
  TickUtil,
  WhirlpoolContext,
} from "../../src";
import { TickSpacing } from "../utils";
import { initTestPoolWithLiquidity, initTickArrayRange } from "../utils/init-utils";
import * as assert from "assert";
import { u64 } from "@solana/spl-token";

describe.only("get_pool_prices", () => {
  const provider = AnchorProvider.env();
  const program = workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);

  it("successfully calculates the price for one token with a single pool", async () => {
    // Initialize pool
    const { poolInitInfo, configInitInfo } = await initTestPoolWithLiquidity(context);
    const poolAddress = poolInitInfo.whirlpoolPda.publicKey;

    console.log("initTestPoolWithLiquidity successful");

    // Calculate startTickIndex
    const pool = await context.fetcher.getPool(poolAddress, true);
    assert.ok(pool);

    const config = {
      quoteTokens: [poolInitInfo.tokenMintB.toBase58()],
      tickSpacings: [TickSpacing.Standard],
      programId: program.programId,
      whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
    };

    const thresholdConfig = {
      amountThreshold: new u64(1000),
      priceImpactThreshold: 1.05,
    };

    const mints = [poolInitInfo.tokenMintA];

    // fetch PoolMap
    const poolMap = await fetchPoolsForMints(context, mints, config);

    // fetch TickArrayMap
    const tickArrayMap = await fetchTickArraysForPools(context, poolMap);

    const decimalsMap = await fetchDecimalsForMints(context, mints);

    assert.equal(Object.keys(poolMap).length, 1);
    assert.equal(Object.keys(tickArrayMap).length, 3);

    const priceMap = calculatePoolPrices(
      [poolInitInfo.tokenMintA],
      poolMap,
      tickArrayMap,
      decimalsMap,
      config,
      thresholdConfig
    );
    console.log(priceMap);
  });

  it("successfully calculates the price for two tokens against a third quote token");

  it("successfully calculates the price for one token with multiple pools against a quote token");

  it(
    "successfully calculates the price for one token which requires an indirect pool to calculate price"
  );

  it(
    "successfully calculates the price for two tokens which each require a different indirect pool to calculate price"
  );

  it("fails if missing mint accounts");

  it("does not return a price if insufficient liquidity");

  it("does not return a price if no pools");

  it("does not return a price if missing tick arrays, but provide warning?");
});
