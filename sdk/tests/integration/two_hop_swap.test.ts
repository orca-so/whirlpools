import { Percentage } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import {
  buildWhirlpoolClient,
  InitPoolParams,
  PDAUtil,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
  toTx,
  twoHopSwapQuoteFromSwapQuotes,
  WhirlpoolContext,
  WhirlpoolIx,
} from "../../src";
import { getTokenBalance, TickSpacing } from "../utils";
import {
  buildTestAquariums,
  FundedPositionParams,
  getDefaultAquarium,
  getTokenAccsForPools,
  InitAquariumParams,
} from "../utils/init-utils";

describe.only("two-hop-swap", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);

  let aqConfig: InitAquariumParams;
  beforeEach(async () => {
    aqConfig = getDefaultAquarium();
    // Add a third token and account and a second pool
    aqConfig.initMintParams.push({});
    aqConfig.initTokenAccParams.push({ mintIndex: 2 });
    aqConfig.initPoolParams.push({ mintIndices: [1, 2], tickSpacing: TickSpacing.Standard });

    // Add tick arrays and positions
    const aToB = false;
    aqConfig.initTickArrayRangeParams.push({
      poolIndex: 0,
      startTickIndex: 22528,
      arrayCount: 3,
      aToB,
    });
    aqConfig.initTickArrayRangeParams.push({
      poolIndex: 1,
      startTickIndex: 22528,
      arrayCount: 3,
      aToB,
    });
    const fundParams: FundedPositionParams[] = [
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];
    aqConfig.initPositionParams.push({ poolIndex: 0, fundParams });
    aqConfig.initPositionParams.push({ poolIndex: 1, fundParams });
  });

  it("swaps [2] with multi_swap, amountSpecifiedIsInput=true", async () => {
    const aquarium = (await buildTestAquariums(ctx, [aqConfig]))[0];
    const { tokenAccounts, mintKeys, pools } = aquarium;

    let tokenBalances = await getTokenBalances(tokenAccounts.map(acc => acc.account));

    const tokenVaultBalances = await getTokenBalancesForVaults(pools);

    const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
    const whirlpoolOne = await client.getPool(whirlpoolOneKey, true);
    const whirlpoolTwo = await client.getPool(whirlpoolTwoKey, true);

    const [inputToken, intermediaryToken, _outputToken] = mintKeys;

    const quote = await swapQuoteByInputToken(
      whirlpoolOne,
      inputToken,
      new u64(1000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      true
    );

    const quote2 = await swapQuoteByInputToken(
      whirlpoolTwo,
      intermediaryToken,
      quote.estimatedAmountOut,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      true
    );

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(
      quote,
      quote2,
    );

  
    await toTx(
      ctx,
      WhirlpoolIx.twoHopSwapIx(ctx.program, {
        ...twoHopQuote,
        ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
        tokenAuthority: ctx.wallet.publicKey,
      })
    ).buildAndExecute();

    assert.deepEqual(
      await getTokenBalancesForVaults(pools),
      [
        tokenVaultBalances[0].add(quote.estimatedAmountIn),
        tokenVaultBalances[1].sub(quote.estimatedAmountOut),
        tokenVaultBalances[2].add(quote2.estimatedAmountIn),
        tokenVaultBalances[3].sub(quote2.estimatedAmountOut), 
      ]
    );

    const prevTbs = [...tokenBalances];
    tokenBalances = await getTokenBalances(tokenAccounts.map(acc => acc.account));

    assert.deepEqual(
      tokenBalances,
      [
        prevTbs[0].sub(quote.estimatedAmountIn),
        prevTbs[1],
        prevTbs[2].add(quote2.estimatedAmountOut),
      ]
    );
  });

  it("fails swaps [2] with multi_swap, amountSpecifiedIsInput=true, slippage", async () => {
    const aquarium = (await buildTestAquariums(ctx, [aqConfig]))[0];
    const { tokenAccounts, mintKeys, pools } = aquarium;

    const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
    const whirlpoolOne = await client.getPool(whirlpoolOneKey, true);
    const whirlpoolTwo = await client.getPool(whirlpoolTwoKey, true);

    const [inputToken, intermediaryToken, _outputToken] = mintKeys;

    const quote = await swapQuoteByInputToken(
      whirlpoolOne,
      inputToken,
      new u64(1000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      true
    );

    const quote2 = await swapQuoteByInputToken(
      whirlpoolTwo,
      intermediaryToken,
      quote.estimatedAmountOut,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      true
    );

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(
      quote,
      quote2,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.twoHopSwapIx(ctx.program, {
          ...twoHopQuote,
          ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
          otherAmountThreshold: new u64(613309),
          tokenAuthority: ctx.wallet.publicKey,
        })
      ).buildAndExecute(),
      /0x1794/ // Above Out Below Minimum 
    );
  });


  it("swaps [2] with multi_swap, amountSpecifiedIsInput=false", async () => {
    const aquarium = (await buildTestAquariums(ctx, [aqConfig]))[0];
    const { tokenAccounts, mintKeys, pools } = aquarium;

    const preSwapBalances = await getTokenBalances(tokenAccounts.map(acc => acc.account));
    const tokenVaultBalances = await getTokenBalancesForVaults(pools);

    const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
    const whirlpoolOne = await client.getPool(whirlpoolOneKey, true);
    const whirlpoolTwo = await client.getPool(whirlpoolTwoKey, true);

    const [_inputToken, intermediaryToken, outputToken] = mintKeys;

    const quote2 = await swapQuoteByOutputToken(
      whirlpoolTwo,
      outputToken,
      new u64(1000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      true
    );

    const quote = await swapQuoteByOutputToken(
      whirlpoolOne,
      intermediaryToken,
      quote2.estimatedAmountIn,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      true
    );

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(
      quote,
      quote2,
    );

    await toTx(
      ctx,
      WhirlpoolIx.twoHopSwapIx(ctx.program, {
        ...twoHopQuote,
        ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
        tokenAuthority: ctx.wallet.publicKey,
      })
    ).buildAndExecute();

    assert.deepEqual(
      await getTokenBalancesForVaults(pools),
      [
        tokenVaultBalances[0].add(quote.estimatedAmountIn),
        tokenVaultBalances[1].sub(quote.estimatedAmountOut),
        tokenVaultBalances[2].add(quote2.estimatedAmountIn),
        tokenVaultBalances[3].sub(quote2.estimatedAmountOut), 
      ]
    );

    assert.deepEqual(
      await getTokenBalances(tokenAccounts.map(acc => acc.account)),
      [
        preSwapBalances[0].sub(quote.estimatedAmountIn),
        preSwapBalances[1],
        preSwapBalances[2].add(quote2.estimatedAmountOut),
      ]
    );
  });

  it("fails swaps [2] with multi_swap, amountSpecifiedIsInput=false slippage", async () => {
    const aquarium = (await buildTestAquariums(ctx, [aqConfig]))[0];
    const { tokenAccounts, mintKeys, pools } = aquarium;

    const preSwapBalances = await getTokenBalances(tokenAccounts.map(acc => acc.account));
    const tokenVaultBalances = await getTokenBalancesForVaults(pools);

    const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
    const whirlpoolOne = await client.getPool(whirlpoolOneKey, true);
    const whirlpoolTwo = await client.getPool(whirlpoolTwoKey, true);

    const [_inputToken, intermediaryToken, outputToken] = mintKeys;

    const quote2 = await swapQuoteByOutputToken(
      whirlpoolTwo,
      outputToken,
      new u64(1000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      true
    );

    const quote = await swapQuoteByOutputToken(
      whirlpoolOne,
      intermediaryToken,
      quote2.estimatedAmountIn,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      true
    );

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(
      quote,
      quote2,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.twoHopSwapIx(ctx.program, {
          ...twoHopQuote,
          ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
          otherAmountThreshold: new u64(2),
          tokenAuthority: ctx.wallet.publicKey,
        })
      ).buildAndExecute(),
      /0x1795/ // Above In Above Maximum
    );
  });

  it("fails swaps [2] with multi_swap, no overlapping mints", async () => {
    // Add another mint and update pool so there is no overlapping mint
    aqConfig.initMintParams.push({});
    aqConfig.initTokenAccParams.push({ mintIndex: 3 });
    aqConfig.initPoolParams[1].mintIndices = [2, 3];
    const aquarium = (await buildTestAquariums(ctx, [aqConfig]))[0];
    const { tokenAccounts, mintKeys, pools } = aquarium;

    const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
    const whirlpoolOne = await client.getPool(whirlpoolOneKey, true);
    const whirlpoolTwo = await client.getPool(whirlpoolTwoKey, true);

    const [_inputToken, intermediaryToken, outputToken] = mintKeys;

    const quote2 = await swapQuoteByOutputToken(
      whirlpoolTwo,
      outputToken,
      new u64(1000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      true
    );

    const quote = await swapQuoteByOutputToken(
      whirlpoolOne,
      intermediaryToken,
      quote2.estimatedAmountIn,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      true
    );

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(
      quote,
      quote2,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.twoHopSwapIx(ctx.program, {
          ...twoHopQuote,
          ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
          tokenAuthority: ctx.wallet.publicKey,
        })
      ).buildAndExecute(),
      /0x1799/ // Invalid intermediary mint
    );
  });

  function getParamsFromPools(pools: [InitPoolParams, InitPoolParams], tokenAccounts: { mint: PublicKey, account: PublicKey }[]) {
    const tokenAccKeys = getTokenAccsForPools(pools, tokenAccounts);

    const whirlpoolOne = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwo = pools[1].whirlpoolPda.publicKey;
    const oracleOne = PDAUtil.getOracle(ctx.program.programId, whirlpoolOne).publicKey;
    const oracleTwo = PDAUtil.getOracle(ctx.program.programId, whirlpoolTwo).publicKey;
    return {
      whirlpoolOne: pools[0].whirlpoolPda.publicKey,
      whirlpoolTwo: pools[1].whirlpoolPda.publicKey,
      tokenOwnerAccountOneA: tokenAccKeys[0],
      tokenVaultOneA: pools[0].tokenVaultAKeypair.publicKey,
      tokenOwnerAccountOneB: tokenAccKeys[1],
      tokenVaultOneB: pools[0].tokenVaultBKeypair.publicKey,
      tokenOwnerAccountTwoA: tokenAccKeys[2],
      tokenVaultTwoA: pools[1].tokenVaultAKeypair.publicKey,
      tokenOwnerAccountTwoB: tokenAccKeys[3],
      tokenVaultTwoB: pools[1].tokenVaultBKeypair.publicKey,
      oracleOne,
      oracleTwo,
    };
  }

  async function getTokenBalancesForVaults(pools: InitPoolParams[]) {
    const accs = [];
    for (const pool of pools) {
      accs.push(pool.tokenVaultAKeypair.publicKey);
      accs.push(pool.tokenVaultBKeypair.publicKey);
    }
    return getTokenBalances(accs);
  }

  async function getTokenBalances(keys: PublicKey[]) {
    return Promise.all(keys.map(async key => new anchor.BN((await getTokenBalance(provider, key)))));
  }
});