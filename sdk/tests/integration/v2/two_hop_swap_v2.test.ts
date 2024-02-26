import * as anchor from "@coral-xyz/anchor";
import { Percentage } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import { BN } from "bn.js";
import {
  buildWhirlpoolClient,
  InitPoolParams,
  PDAUtil,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
  swapQuoteWithParams,
  SwapUtils,
  toTx,
  twoHopSwapQuoteFromSwapQuotes,
  WhirlpoolContext,
  WhirlpoolData,
  WhirlpoolIx
} from "../../../src";
import { InitPoolV2Params, TwoHopSwapV2Params } from "../../../src/instructions";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { getTokenBalance, TEST_TOKEN_2022_PROGRAM_ID, TEST_TOKEN_PROGRAM_ID, TickSpacing } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import {
  buildTestAquariumsV2,
  getDefaultAquariumV2,
  getTokenAccsForPoolsV2,
  InitAquariumV2Params
} from "../../utils/v2/aquarium-v2";
import {
  FundedPositionV2Params, TokenTrait
} from "../../utils/v2/init-utils-v2";
import { asyncAssertOwnerProgram } from "../../utils/v2/token-2022";

describe("two_hop_swap_v2", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);

  // 8 patterns for tokenTraitA, tokenTraitB, tokenTraitC
  const tokenTraitVariations: {tokenTraitA: TokenTrait, tokenTraitB: TokenTrait, tokenTraitC: TokenTrait}[] = [
    {tokenTraitA: {isToken2022: false}, tokenTraitB: {isToken2022: false}, tokenTraitC: {isToken2022: false} },
    {tokenTraitA: {isToken2022: false}, tokenTraitB: {isToken2022: false},  tokenTraitC: {isToken2022: true} },
    {tokenTraitA: {isToken2022: false}, tokenTraitB: {isToken2022: true}, tokenTraitC: {isToken2022: false} },
    {tokenTraitA: {isToken2022: false}, tokenTraitB: {isToken2022: true}, tokenTraitC: {isToken2022: true} },
    {tokenTraitA: {isToken2022: true}, tokenTraitB: {isToken2022: false}, tokenTraitC: {isToken2022: false} },
    {tokenTraitA: {isToken2022: true}, tokenTraitB: {isToken2022: false}, tokenTraitC: {isToken2022: true} },
    {tokenTraitA: {isToken2022: true}, tokenTraitB: {isToken2022: true}, tokenTraitC: {isToken2022: false} },
    {tokenTraitA: {isToken2022: true}, tokenTraitB: {isToken2022: true}, tokenTraitC: {isToken2022: true} },
  ];
  tokenTraitVariations.forEach((tokenTraits) => {
    describe(`tokenTraitA: ${tokenTraits.tokenTraitA.isToken2022 ? "Token2022" : "Token"}, tokenTraitB: ${tokenTraits.tokenTraitB.isToken2022 ? "Token2022" : "Token"}, tokenTraitC: ${tokenTraits.tokenTraitC.isToken2022 ? "Token2022" : "Token"}`, () => {

  let aqConfig: InitAquariumV2Params;
  beforeEach(async () => {
    aqConfig = getDefaultAquariumV2();
    // Add a third token and account and a second pool
    aqConfig.initMintParams = [
      { tokenTrait: tokenTraits.tokenTraitA },
      { tokenTrait: tokenTraits.tokenTraitB },
      { tokenTrait: tokenTraits.tokenTraitC },
    ];
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
    const fundParams: FundedPositionV2Params[] = [
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];
    aqConfig.initPositionParams.push({ poolIndex: 0, fundParams });
    aqConfig.initPositionParams.push({ poolIndex: 1, fundParams });
  });

  describe("fails [2] with two-hop swap, invalid accounts", () => {
    let baseIxParams: TwoHopSwapV2Params;
    beforeEach(async () => {
      const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
      const { tokenAccounts, mintKeys, pools } = aquarium;

      await asyncAssertOwnerProgram(ctx.provider, mintKeys[0], tokenTraits.tokenTraitA.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID);
      await asyncAssertOwnerProgram(ctx.provider, mintKeys[1], tokenTraits.tokenTraitB.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID);
      await asyncAssertOwnerProgram(ctx.provider, mintKeys[2], tokenTraits.tokenTraitC.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID);

      const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
      const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
      //const whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
      //const whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
      const whirlpoolDataOne = await fetcher.getPool(whirlpoolOneKey, IGNORE_CACHE) as WhirlpoolData;
      const whirlpoolDataTwo = await fetcher.getPool(whirlpoolTwoKey, IGNORE_CACHE) as WhirlpoolData;

      const [inputToken, intermediaryToken, _outputToken] = mintKeys;

      /* replaced by swapQuoteWithParams to avoid using whirlpool client
      const quote = await swapQuoteByInputToken(
        whirlpoolOne,
        inputToken,
        new BN(1000),
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );

      const quote2 = await swapQuoteByInputToken(
        whirlpoolTwo,
        intermediaryToken,
        quote.estimatedAmountOut,
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
      */

      const aToBOne = whirlpoolDataOne.tokenMintA.equals(inputToken);
      const quote = swapQuoteWithParams({
        amountSpecifiedIsInput: true,
        aToB: aToBOne,
        tokenAmount: new BN(1000),
        otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
        sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
        whirlpoolData: whirlpoolDataOne,
        tickArrays: await SwapUtils.getTickArrays(
          whirlpoolDataOne.tickCurrentIndex,
          whirlpoolDataOne.tickSpacing,
          aToBOne,
          ctx.program.programId,
          whirlpoolOneKey,
          fetcher,
          IGNORE_CACHE
        ),  
      }, Percentage.fromFraction(1, 100));

      const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
      const quote2 = swapQuoteWithParams({
        amountSpecifiedIsInput: true,
        aToB: aToBTwo,
        tokenAmount: quote.estimatedAmountOut,
        otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
        sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
        whirlpoolData: whirlpoolDataTwo,
        tickArrays: await SwapUtils.getTickArrays(
          whirlpoolDataTwo.tickCurrentIndex,
          whirlpoolDataTwo.tickSpacing,
          aToBTwo,
          ctx.program.programId,
          whirlpoolTwoKey,
          fetcher,
          IGNORE_CACHE
        ),  
      }, Percentage.fromFraction(1, 100));

      const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);
      baseIxParams = {
        ...twoHopQuote,
        ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
        tokenAuthority: ctx.wallet.publicKey,
      };
    });

    it("fails invalid whirlpool", async () => {
      await rejectParams(
        {
          ...baseIxParams,
          whirlpoolOne: baseIxParams.whirlpoolTwo,
        },
        ///0x7d3/ // ConstraintRaw
        // V2 has token_mint_one_a and it has address constraint
        /0x7dc/ // ConstraintAddress
      );
    });

    it("fails invalid token account", async () => {
      await rejectParams(
        {
          ...baseIxParams,
          tokenOwnerAccountOneA: baseIxParams.tokenOwnerAccountOneB,
        },
        /0x7d3/ // ConstraintRaw
      );
    });

    it("fails invalid token vault", async () => {
      await rejectParams(
        {
          ...baseIxParams,
          tokenVaultOneA: baseIxParams.tokenVaultOneB,
        },
        /0x7dc/ // ConstraintAddress
      );
    });

    it("fails invalid oracle one address", async () => {
      await rejectParams(
        {
          ...baseIxParams,
          oracleOne: PublicKey.unique(),
        },
        /0x7d6/ // Constraint Seeds
      );
    });

    it("fails invalid oracle two address", async () => {
      await rejectParams(
        {
          ...baseIxParams,
          oracleTwo: PublicKey.unique(),
        },
        /0x7d6/ // Constraint Seeds
      );
    });

    it("fails invalid tick array one", async () => {
      await rejectParams(
        {
          ...baseIxParams,
          tickArrayOne0: PublicKey.unique(),
        },
        /0xbbf/ // AccountOwnedByWrongProgram
      );
      await rejectParams(
        {
          ...baseIxParams,
          tickArrayOne1: PublicKey.unique(),
        },
        /0xbbf/ // AccountOwnedByWrongProgram
      );
      await rejectParams(
        {
          ...baseIxParams,
          tickArrayOne2: PublicKey.unique(),
        },
        /0xbbf/ // AccountOwnedByWrongProgram
      );
    });

    it("fails invalid tick array two", async () => {
      await rejectParams(
        {
          ...baseIxParams,
          tickArrayTwo0: PublicKey.unique(),
        },
        /0xbbf/ // AccountOwnedByWrongProgram
      );
      await rejectParams(
        {
          ...baseIxParams,
          tickArrayTwo1: PublicKey.unique(),
        },
        /0xbbf/ // AccountOwnedByWrongProgram
      );
      await rejectParams(
        {
          ...baseIxParams,
          tickArrayTwo2: PublicKey.unique(),
        },
        /0xbbf/ // AccountOwnedByWrongProgram
      );
    });

    async function rejectParams(params: TwoHopSwapV2Params, error: assert.AssertPredicate) {
      await assert.rejects(
        toTx(ctx, WhirlpoolIx.twoHopSwapV2Ix(ctx.program, params)).buildAndExecute(),
        error,
      );
    }

  });

  it("swaps [2] with two-hop swap, amountSpecifiedIsInput=true", async () => {
    const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
    const { tokenAccounts, mintKeys, pools } = aquarium;

    let tokenBalances = await getTokenBalances(tokenAccounts.map((acc) => acc.account));

    const tokenVaultBalances = await getTokenBalancesForVaults(pools);

    const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
    //let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
    //let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
    const whirlpoolDataOne = await fetcher.getPool(whirlpoolOneKey, IGNORE_CACHE) as WhirlpoolData;
    const whirlpoolDataTwo = await fetcher.getPool(whirlpoolTwoKey, IGNORE_CACHE) as WhirlpoolData;

    const [inputToken, intermediaryToken, _outputToken] = mintKeys;

    /* replaced by swapQuoteWithParams to avoid using whirlpool client
    const quote = await swapQuoteByInputToken(
      whirlpoolOne,
      inputToken,
      new BN(1000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );

    const quote2 = await swapQuoteByInputToken(
      whirlpoolTwo,
      intermediaryToken,
      quote.estimatedAmountOut,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );
    */

    const aToBOne = whirlpoolDataOne.tokenMintA.equals(inputToken);
    const quote = swapQuoteWithParams({
      amountSpecifiedIsInput: true,
      aToB: aToBOne,
      tokenAmount: new BN(1000),
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
      whirlpoolData: whirlpoolDataOne,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataOne.tickCurrentIndex,
        whirlpoolDataOne.tickSpacing,
        aToBOne,
        ctx.program.programId,
        whirlpoolOneKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
    const quote2 = swapQuoteWithParams({
      amountSpecifiedIsInput: true,
      aToB: aToBTwo,
      tokenAmount: quote.estimatedAmountOut,
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
      whirlpoolData: whirlpoolDataTwo,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataTwo.tickCurrentIndex,
        whirlpoolDataTwo.tickSpacing,
        aToBTwo,
        ctx.program.programId,
        whirlpoolTwoKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

    await toTx(
      ctx,
      WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
        ...twoHopQuote,
        ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
        tokenAuthority: ctx.wallet.publicKey,
      })
    ).buildAndExecute();

    assert.deepEqual(await getTokenBalancesForVaults(pools), [
      tokenVaultBalances[0].add(quote.estimatedAmountIn),
      tokenVaultBalances[1].sub(quote.estimatedAmountOut),
      tokenVaultBalances[2].add(quote2.estimatedAmountIn),
      tokenVaultBalances[3].sub(quote2.estimatedAmountOut),
    ]);

    const prevTbs = [...tokenBalances];
    tokenBalances = await getTokenBalances(tokenAccounts.map((acc) => acc.account));

    assert.deepEqual(tokenBalances, [
      prevTbs[0].sub(quote.estimatedAmountIn),
      prevTbs[1],
      prevTbs[2].add(quote2.estimatedAmountOut),
    ]);

    //whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
    //whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
  });


  it("swaps [2] with two-hop swap, amountSpecifiedIsInput=true, A->B->A", async () => {
    // Add another mint and update pool so there is no overlapping mint
    aqConfig.initFeeTierParams.push({ tickSpacing: TickSpacing.ThirtyTwo });
    aqConfig.initPoolParams[1] = { mintIndices: [0, 1], tickSpacing: TickSpacing.ThirtyTwo, feeTierIndex: 1 };
    aqConfig.initTickArrayRangeParams.push({
      poolIndex: 1,
      startTickIndex: 22528,
      arrayCount: 12,
      aToB: true,
    });
    aqConfig.initTickArrayRangeParams.push({
      poolIndex: 1,
      startTickIndex: 22528,
      arrayCount: 12,
      aToB: false,
    });


    const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
    const { tokenAccounts, mintKeys, pools } = aquarium;

    let tokenBalances = await getTokenBalances(tokenAccounts.map((acc) => acc.account));

    const tokenVaultBalances = await getTokenBalancesForVaults(pools);

    const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
    //let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
    //let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
    const whirlpoolDataOne = await fetcher.getPool(whirlpoolOneKey, IGNORE_CACHE) as WhirlpoolData;
    const whirlpoolDataTwo = await fetcher.getPool(whirlpoolTwoKey, IGNORE_CACHE) as WhirlpoolData;

    const [tokenA, tokenB, _outputToken] = mintKeys;

    /* replaced by swapQuoteWithParams to avoid using whirlpool client
    const quote = await swapQuoteByInputToken(
      whirlpoolOne,
      tokenA,
      new BN(1000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );

    const quote2 = await swapQuoteByInputToken(
      whirlpoolTwo,
      tokenB,
      quote.estimatedAmountOut,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );
    */

    const aToBOne = whirlpoolDataOne.tokenMintA.equals(tokenA);
    const quote = swapQuoteWithParams({
      amountSpecifiedIsInput: true,
      aToB: aToBOne,
      tokenAmount: new BN(1000),
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
      whirlpoolData: whirlpoolDataOne,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataOne.tickCurrentIndex,
        whirlpoolDataOne.tickSpacing,
        aToBOne,
        ctx.program.programId,
        whirlpoolOneKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(tokenB);
    const quote2 = swapQuoteWithParams({
      amountSpecifiedIsInput: true,
      aToB: aToBTwo,
      tokenAmount: quote.estimatedAmountOut,
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
      whirlpoolData: whirlpoolDataTwo,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataTwo.tickCurrentIndex,
        whirlpoolDataTwo.tickSpacing,
        aToBTwo,
        ctx.program.programId,
        whirlpoolTwoKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

    await toTx(
      ctx,
      WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
        ...twoHopQuote,
        ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
        tokenAuthority: ctx.wallet.publicKey,
      })
    ).buildAndExecute();

    assert.deepEqual(await getTokenBalancesForVaults(pools), [
      tokenVaultBalances[0].add(quote.estimatedAmountIn),
      tokenVaultBalances[1].sub(quote.estimatedAmountOut),
      tokenVaultBalances[2].sub(quote2.estimatedAmountOut),
      tokenVaultBalances[3].add(quote2.estimatedAmountIn),
    ]);

    const prevTbs = [...tokenBalances];
    tokenBalances = await getTokenBalances(tokenAccounts.map((acc) => acc.account));

    assert.deepEqual(tokenBalances, [
      prevTbs[0].sub(quote.estimatedAmountIn).add(quote2.estimatedAmountOut),
      prevTbs[1].add(quote.estimatedAmountOut).sub(quote2.estimatedAmountIn),
      prevTbs[2],
    ]);
  });

  it("fails swaps [2] with top-hop swap, amountSpecifiedIsInput=true, slippage", async () => {
    const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
    const { tokenAccounts, mintKeys, pools } = aquarium;

    const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
    //const whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
    //const whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
    const whirlpoolDataOne = await fetcher.getPool(whirlpoolOneKey, IGNORE_CACHE) as WhirlpoolData;
    const whirlpoolDataTwo = await fetcher.getPool(whirlpoolTwoKey, IGNORE_CACHE) as WhirlpoolData;

    const [inputToken, intermediaryToken, _outputToken] = mintKeys;

    /* replaced by swapQuoteWithParams to avoid using whirlpool client
    const quote = await swapQuoteByInputToken(
      whirlpoolOne,
      inputToken,
      new BN(1000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );

    const quote2 = await swapQuoteByInputToken(
      whirlpoolTwo,
      intermediaryToken,
      quote.estimatedAmountOut,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );
    */

    const aToBOne = whirlpoolDataOne.tokenMintA.equals(inputToken);
    const quote = swapQuoteWithParams({
      amountSpecifiedIsInput: true,
      aToB: aToBOne,
      tokenAmount: new BN(1000),
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
      whirlpoolData: whirlpoolDataOne,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataOne.tickCurrentIndex,
        whirlpoolDataOne.tickSpacing,
        aToBOne,
        ctx.program.programId,
        whirlpoolOneKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
    const quote2 = swapQuoteWithParams({
      amountSpecifiedIsInput: true,
      aToB: aToBTwo,
      tokenAmount: quote.estimatedAmountOut,
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
      whirlpoolData: whirlpoolDataTwo,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataTwo.tickCurrentIndex,
        whirlpoolDataTwo.tickSpacing,
        aToBTwo,
        ctx.program.programId,
        whirlpoolTwoKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
          ...twoHopQuote,
          ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
          otherAmountThreshold: new BN(613309),
          tokenAuthority: ctx.wallet.publicKey,
        })
      ).buildAndExecute(),
      /0x1794/ // Above Out Below Minimum
    );
  });

  it("swaps [2] with two-hop swap, amountSpecifiedIsInput=false", async () => {
    const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
    const { tokenAccounts, mintKeys, pools } = aquarium;

    const preSwapBalances = await getTokenBalances(tokenAccounts.map((acc) => acc.account));
    const tokenVaultBalances = await getTokenBalancesForVaults(pools);

    const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
    //const whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
    //const whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
    const whirlpoolDataOne = await fetcher.getPool(whirlpoolOneKey, IGNORE_CACHE) as WhirlpoolData;
    const whirlpoolDataTwo = await fetcher.getPool(whirlpoolTwoKey, IGNORE_CACHE) as WhirlpoolData;

    const [_inputToken, intermediaryToken, outputToken] = mintKeys;

    /* replaced by swapQuoteWithParams to avoid using whirlpool client
    const quote2 = await swapQuoteByOutputToken(
      whirlpoolTwo,
      outputToken,
      new BN(1000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );

    const quote = await swapQuoteByOutputToken(
      whirlpoolOne,
      intermediaryToken,
      quote2.estimatedAmountIn,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );
    */

    const aToBTwo = whirlpoolDataTwo.tokenMintB.equals(outputToken);
    const quote2 = swapQuoteWithParams({
      amountSpecifiedIsInput: false,
      aToB: aToBTwo,
      tokenAmount: new BN(1000),
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(false),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
      whirlpoolData: whirlpoolDataTwo,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataTwo.tickCurrentIndex,
        whirlpoolDataTwo.tickSpacing,
        aToBTwo,
        ctx.program.programId,
        whirlpoolTwoKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const aToBOne = whirlpoolDataOne.tokenMintB.equals(intermediaryToken);
    const quote = swapQuoteWithParams({
      amountSpecifiedIsInput: false,
      aToB: aToBOne,
      tokenAmount: quote2.estimatedAmountIn,
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(false),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
      whirlpoolData: whirlpoolDataOne,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataOne.tickCurrentIndex,
        whirlpoolDataOne.tickSpacing,
        aToBOne,
        ctx.program.programId,
        whirlpoolOneKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

    await toTx(
      ctx,
      WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
        ...twoHopQuote,
        ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
        tokenAuthority: ctx.wallet.publicKey,
      })
    ).buildAndExecute();

    assert.deepEqual(await getTokenBalancesForVaults(pools), [
      tokenVaultBalances[0].add(quote.estimatedAmountIn),
      tokenVaultBalances[1].sub(quote.estimatedAmountOut),
      tokenVaultBalances[2].add(quote2.estimatedAmountIn),
      tokenVaultBalances[3].sub(quote2.estimatedAmountOut),
    ]);

    assert.deepEqual(await getTokenBalances(tokenAccounts.map((acc) => acc.account)), [
      preSwapBalances[0].sub(quote.estimatedAmountIn),
      preSwapBalances[1],
      preSwapBalances[2].add(quote2.estimatedAmountOut),
    ]);
  });

  it("fails swaps [2] with two-hop swap, amountSpecifiedIsInput=false slippage", async () => {
    const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
    const { tokenAccounts, mintKeys, pools } = aquarium;

    const preSwapBalances = await getTokenBalances(tokenAccounts.map((acc) => acc.account));
    const tokenVaultBalances = await getTokenBalancesForVaults(pools);

    const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
    //const whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
    //const whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
    const whirlpoolDataOne = await fetcher.getPool(whirlpoolOneKey, IGNORE_CACHE) as WhirlpoolData;
    const whirlpoolDataTwo = await fetcher.getPool(whirlpoolTwoKey, IGNORE_CACHE) as WhirlpoolData;

    const [_inputToken, intermediaryToken, outputToken] = mintKeys;

    /*
    const quote2 = await swapQuoteByOutputToken(
      whirlpoolTwo,
      outputToken,
      new BN(1000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );

    const quote = await swapQuoteByOutputToken(
      whirlpoolOne,
      intermediaryToken,
      quote2.estimatedAmountIn,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );
    */

    const aToBTwo = whirlpoolDataTwo.tokenMintB.equals(outputToken);
    const quote2 = swapQuoteWithParams({
      amountSpecifiedIsInput: false,
      aToB: aToBTwo,
      tokenAmount: new BN(1000),
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(false),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
      whirlpoolData: whirlpoolDataTwo,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataTwo.tickCurrentIndex,
        whirlpoolDataTwo.tickSpacing,
        aToBTwo,
        ctx.program.programId,
        whirlpoolTwoKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const aToBOne = whirlpoolDataOne.tokenMintB.equals(intermediaryToken);
    const quote = swapQuoteWithParams({
      amountSpecifiedIsInput: false,
      aToB: aToBOne,
      tokenAmount: quote2.estimatedAmountIn,
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(false),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
      whirlpoolData: whirlpoolDataOne,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataOne.tickCurrentIndex,
        whirlpoolDataOne.tickSpacing,
        aToBOne,
        ctx.program.programId,
        whirlpoolOneKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
          ...twoHopQuote,
          ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
          otherAmountThreshold: new BN(2),
          tokenAuthority: ctx.wallet.publicKey,
        })
      ).buildAndExecute(),
      /0x1795/ // Above In Above Maximum
    );
  });

  it("fails swaps [2] with two-hop swap, no overlapping mints", async () => {
    // Add another mint and update pool so there is no overlapping mint
    aqConfig.initMintParams.push({ tokenTrait: { isToken2022: true } });
    aqConfig.initTokenAccParams.push({ mintIndex: 3 });
    aqConfig.initPoolParams[1].mintIndices = [2, 3];
    const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
    const { tokenAccounts, mintKeys, pools } = aquarium;

    const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
    //const whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
    //const whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
    const whirlpoolDataOne = await fetcher.getPool(whirlpoolOneKey, IGNORE_CACHE) as WhirlpoolData;
    const whirlpoolDataTwo = await fetcher.getPool(whirlpoolTwoKey, IGNORE_CACHE) as WhirlpoolData;

    const [_inputToken, intermediaryToken, outputToken] = mintKeys;

    /* replaced by swapQuoteWithParams to avoid using whirlpool client
    const quote2 = await swapQuoteByOutputToken(
      whirlpoolTwo,
      outputToken,
      new BN(1000),
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );

    const quote = await swapQuoteByOutputToken(
      whirlpoolOne,
      intermediaryToken,
      quote2.estimatedAmountIn,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );
    */

    const aToBTwo = whirlpoolDataTwo.tokenMintB.equals(outputToken);
    const quote2 = swapQuoteWithParams({
      amountSpecifiedIsInput: false,
      aToB: aToBTwo,
      tokenAmount: new BN(1000),
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(false),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
      whirlpoolData: whirlpoolDataTwo,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataTwo.tickCurrentIndex,
        whirlpoolDataTwo.tickSpacing,
        aToBTwo,
        ctx.program.programId,
        whirlpoolTwoKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const aToBOne = whirlpoolDataOne.tokenMintB.equals(intermediaryToken);
    const quote = swapQuoteWithParams({
      amountSpecifiedIsInput: false,
      aToB: aToBOne,
      tokenAmount: quote2.estimatedAmountIn,
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(false),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
      whirlpoolData: whirlpoolDataOne,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataOne.tickCurrentIndex,
        whirlpoolDataOne.tickSpacing,
        aToBOne,
        ctx.program.programId,
        whirlpoolOneKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
          ...twoHopQuote,
          ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
          tokenAuthority: ctx.wallet.publicKey,
        })
      ).buildAndExecute(),
      /0x1799/ // Invalid intermediary mint
    );
  });

  it("swaps [2] with two-hop swap, amount_specified_is_input=true, first swap price limit", async () => {
    const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
    const { tokenAccounts, mintKeys, pools } = aquarium;

    const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
    //let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
    //let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
    const whirlpoolDataOne = await fetcher.getPool(whirlpoolOneKey, IGNORE_CACHE) as WhirlpoolData;
    const whirlpoolDataTwo = await fetcher.getPool(whirlpoolTwoKey, IGNORE_CACHE) as WhirlpoolData;

    const [inputToken, intermediaryToken, _outputToken] = mintKeys;

    /* replaced by swapQuoteWithParams to avoid using whirlpool client
    const quote = await swapQuoteByInputToken(
      whirlpoolOne,
      inputToken,
      new BN(1000),
      Percentage.fromFraction(0, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );

    const quote2 = await swapQuoteByInputToken(
      whirlpoolTwo,
      intermediaryToken,
      quote.estimatedAmountOut,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );
    */

    const aToBOne = whirlpoolDataOne.tokenMintA.equals(inputToken);
    const quote = swapQuoteWithParams({
      amountSpecifiedIsInput: true,
      aToB: aToBOne,
      tokenAmount: new BN(1000),
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
      whirlpoolData: whirlpoolDataOne,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataOne.tickCurrentIndex,
        whirlpoolDataOne.tickSpacing,
        aToBOne,
        ctx.program.programId,
        whirlpoolOneKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
    const quote2 = swapQuoteWithParams({
      amountSpecifiedIsInput: true,
      aToB: aToBTwo,
      tokenAmount: quote.estimatedAmountOut,
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
      whirlpoolData: whirlpoolDataTwo,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataTwo.tickCurrentIndex,
        whirlpoolDataTwo.tickSpacing,
        aToBTwo,
        ctx.program.programId,
        whirlpoolTwoKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    // Set a price limit that is less than the 1% slippage threshold,
    // which will allow the swap to go through
    quote.sqrtPriceLimit = quote.estimatedEndSqrtPrice.add(
      whirlpoolDataOne
        .sqrtPrice.sub(quote.estimatedEndSqrtPrice)
        .mul(new anchor.BN("5"))
        .div(new anchor.BN("1000"))
    );

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

    await toTx(
      ctx,
      WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
        ...twoHopQuote,
        ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
        tokenAuthority: ctx.wallet.publicKey,
      })
    ).buildAndExecute();

    const postWhirlpoolDataOne = await fetcher.getPool(whirlpoolOneKey, IGNORE_CACHE) as WhirlpoolData;
    //const postWhirlpoolDataTwo = await fetcher.getPool(whirlpoolTwoKey, IGNORE_CACHE) as WhirlpoolData;

    assert.equal(postWhirlpoolDataOne.sqrtPrice.eq(quote.sqrtPriceLimit), true);
  });


  it("swaps [2] with two-hop swap, amount_specified_is_input=true, second swap price limit", async () => {
    const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
    const { tokenAccounts, mintKeys, pools } = aquarium;

    const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
    //let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
    //let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
    const whirlpoolDataOne = await fetcher.getPool(whirlpoolOneKey, IGNORE_CACHE) as WhirlpoolData;
    const whirlpoolDataTwo = await fetcher.getPool(whirlpoolTwoKey, IGNORE_CACHE) as WhirlpoolData;

    const [inputToken, intermediaryToken, _outputToken] = mintKeys;

    /*
    const quote = await swapQuoteByInputToken(
      whirlpoolOne,
      inputToken,
      new BN(1000),
      Percentage.fromFraction(0, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );

    const quote2 = await swapQuoteByInputToken(
      whirlpoolTwo,
      intermediaryToken,
      quote.estimatedAmountOut,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );
    */

    const aToBOne = whirlpoolDataOne.tokenMintA.equals(inputToken);
    const quote = swapQuoteWithParams({
      amountSpecifiedIsInput: true,
      aToB: aToBOne,
      tokenAmount: new BN(1000),
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
      whirlpoolData: whirlpoolDataOne,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataOne.tickCurrentIndex,
        whirlpoolDataOne.tickSpacing,
        aToBOne,
        ctx.program.programId,
        whirlpoolOneKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
    const quote2 = swapQuoteWithParams({
      amountSpecifiedIsInput: true,
      aToB: aToBTwo,
      tokenAmount: quote.estimatedAmountOut,
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
      whirlpoolData: whirlpoolDataTwo,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataTwo.tickCurrentIndex,
        whirlpoolDataTwo.tickSpacing,
        aToBTwo,
        ctx.program.programId,
        whirlpoolTwoKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    // Set a price limit that is less than the 1% slippage threshold,
    // which will allow the swap to go through
    quote2.sqrtPriceLimit = quote2.estimatedEndSqrtPrice.add(
      whirlpoolDataTwo
        .sqrtPrice.sub(quote2.estimatedEndSqrtPrice)
        .mul(new anchor.BN("5"))
        .div(new anchor.BN("1000"))
    );

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

    await toTx(
      ctx,
      WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
        ...twoHopQuote,
        ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
        tokenAuthority: ctx.wallet.publicKey,
      })
    ).buildAndExecute();

    //const postWhirlpoolDataOne = await fetcher.getPool(whirlpoolOneKey, IGNORE_CACHE) as WhirlpoolData;
    const postWhirlpoolDataTwo = await fetcher.getPool(whirlpoolTwoKey, IGNORE_CACHE) as WhirlpoolData;

    assert.equal(postWhirlpoolDataTwo.sqrtPrice.eq(quote2.sqrtPriceLimit), true);
  });

  it("fails swaps [2] with two-hop swap, amount_specified_is_input=true, first swap price limit", async () => {
    const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
    const { tokenAccounts, mintKeys, pools } = aquarium;

    const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
    //let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
    //let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
    const whirlpoolDataOne = await fetcher.getPool(whirlpoolOneKey, IGNORE_CACHE) as WhirlpoolData;
    const whirlpoolDataTwo = await fetcher.getPool(whirlpoolTwoKey, IGNORE_CACHE) as WhirlpoolData;

    const [inputToken, intermediaryToken, _outputToken] = mintKeys;

    /*
    const quote = await swapQuoteByInputToken(
      whirlpoolOne,
      inputToken,
      new BN(1000),
      Percentage.fromFraction(0, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );

    const quote2 = await swapQuoteByInputToken(
      whirlpoolTwo,
      intermediaryToken,
      quote.estimatedAmountOut,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );
    */

    const aToBOne = whirlpoolDataOne.tokenMintA.equals(inputToken);
    const quote = swapQuoteWithParams({
      amountSpecifiedIsInput: true,
      aToB: aToBOne,
      tokenAmount: new BN(1000),
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
      whirlpoolData: whirlpoolDataOne,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataOne.tickCurrentIndex,
        whirlpoolDataOne.tickSpacing,
        aToBOne,
        ctx.program.programId,
        whirlpoolOneKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
    const quote2 = swapQuoteWithParams({
      amountSpecifiedIsInput: true,
      aToB: aToBTwo,
      tokenAmount: quote.estimatedAmountOut,
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
      whirlpoolData: whirlpoolDataTwo,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataTwo.tickCurrentIndex,
        whirlpoolDataTwo.tickSpacing,
        aToBTwo,
        ctx.program.programId,
        whirlpoolTwoKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    // Set a price limit that is less than the 1% slippage threshold,
    // which will allow the swap to go through
    quote.sqrtPriceLimit = quote.estimatedEndSqrtPrice.add(
      whirlpoolDataOne
        .sqrtPrice.sub(quote.estimatedEndSqrtPrice)
        .mul(new anchor.BN("15"))
        .div(new anchor.BN("1000"))
    );

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
          ...twoHopQuote,
          ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
          tokenAuthority: ctx.wallet.publicKey,
        })
      ).buildAndExecute()
    );
  });


  it("fails swaps [2] with two-hop swap, amount_specified_is_input=true, second swap price limit", async () => {
    const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
    const { tokenAccounts, mintKeys, pools } = aquarium;

    const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
    //let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
    //let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
    const whirlpoolDataOne = await fetcher.getPool(whirlpoolOneKey, IGNORE_CACHE) as WhirlpoolData;
    const whirlpoolDataTwo = await fetcher.getPool(whirlpoolTwoKey, IGNORE_CACHE) as WhirlpoolData;

    const [inputToken, intermediaryToken, _outputToken] = mintKeys;

    /* replaced by swapQuoteWithParams to avoid using whirlpool client
    const quote = await swapQuoteByInputToken(
      whirlpoolOne,
      inputToken,
      new BN(1000),
      Percentage.fromFraction(0, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );

    const quote2 = await swapQuoteByInputToken(
      whirlpoolTwo,
      intermediaryToken,
      quote.estimatedAmountOut,
      Percentage.fromFraction(1, 100),
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE
    );
    */

    const aToBOne = whirlpoolDataOne.tokenMintA.equals(inputToken);
    const quote = swapQuoteWithParams({
      amountSpecifiedIsInput: true,
      aToB: aToBOne,
      tokenAmount: new BN(1000),
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
      whirlpoolData: whirlpoolDataOne,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataOne.tickCurrentIndex,
        whirlpoolDataOne.tickSpacing,
        aToBOne,
        ctx.program.programId,
        whirlpoolOneKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
    const quote2 = swapQuoteWithParams({
      amountSpecifiedIsInput: true,
      aToB: aToBTwo,
      tokenAmount: quote.estimatedAmountOut,
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
      whirlpoolData: whirlpoolDataTwo,
      tickArrays: await SwapUtils.getTickArrays(
        whirlpoolDataTwo.tickCurrentIndex,
        whirlpoolDataTwo.tickSpacing,
        aToBTwo,
        ctx.program.programId,
        whirlpoolTwoKey,
        fetcher,
        IGNORE_CACHE
      ),  
    }, Percentage.fromFraction(1, 100));

    // Set a price limit that is greater than the 1% slippage threshold,
    // which will cause the swap to fail
    quote2.sqrtPriceLimit = quote2.estimatedEndSqrtPrice.add(
      whirlpoolDataTwo
        .sqrtPrice.sub(quote2.estimatedEndSqrtPrice)
        .mul(new anchor.BN("15"))
        .div(new anchor.BN("1000"))
    );

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.twoHopSwapIx(ctx.program, {
          ...twoHopQuote,
          ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
          tokenAuthority: ctx.wallet.publicKey,
        })
      ).buildAndExecute()
    );
  });

  function getParamsFromPools(
    pools: [InitPoolV2Params, InitPoolV2Params],
    tokenAccounts: { mint: PublicKey; account: PublicKey, tokenTrait: TokenTrait }[]
  ) {
    const tokenAccKeys = getTokenAccsForPoolsV2(pools, tokenAccounts);

    const whirlpoolOne = pools[0].whirlpoolPda.publicKey;
    const whirlpoolTwo = pools[1].whirlpoolPda.publicKey;
    const tokenMintOneA = pools[0].tokenMintA;
    const tokenMintOneB = pools[0].tokenMintB;
    const tokenMintTwoA = pools[1].tokenMintA;
    const tokenMintTwoB = pools[1].tokenMintB;
    const tokenProgramOneA = pools[0].tokenProgramA;
    const tokenProgramOneB = pools[0].tokenProgramB;
    const tokenProgramTwoA = pools[1].tokenProgramA;
    const tokenProgramTwoB = pools[1].tokenProgramB;
    const oracleOne = PDAUtil.getOracle(ctx.program.programId, whirlpoolOne).publicKey;
    const oracleTwo = PDAUtil.getOracle(ctx.program.programId, whirlpoolTwo).publicKey;
    return {
      whirlpoolOne: pools[0].whirlpoolPda.publicKey,
      whirlpoolTwo: pools[1].whirlpoolPda.publicKey,
      tokenMintOneA,
      tokenMintOneB,
      tokenMintTwoA,
      tokenMintTwoB,
      tokenProgramOneA,
      tokenProgramOneB,
      tokenProgramTwoA,
      tokenProgramTwoB,
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
    return Promise.all(
      keys.map(async (key) => new anchor.BN(await getTokenBalance(provider, key)))
    );
  }




});
});

});
