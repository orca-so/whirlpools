import * as anchor from "@coral-xyz/anchor";
import { Percentage } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import { BN } from "bn.js";
import type { InitPoolParams, WhirlpoolData } from "../../../src";
import {
  buildWhirlpoolClient,
  METADATA_PROGRAM_ADDRESS,
  MIN_SQRT_PRICE_BN,
  PDAUtil,
  PriceMath,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
  swapQuoteWithParams,
  SwapUtils,
  toTx,
  twoHopSwapQuoteFromSwapQuotes,
  WhirlpoolContext,
  WhirlpoolIx,
} from "../../../src";
import type {
  InitPoolV2Params,
  TwoHopSwapV2Params,
} from "../../../src/instructions";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import {
  getTokenBalance,
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TOKEN_PROGRAM_ID,
  TickSpacing,
} from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import type { InitAquariumV2Params } from "../../utils/v2/aquarium-v2";
import {
  buildTestAquariumsV2,
  getDefaultAquariumV2,
  getTokenAccsForPoolsV2,
} from "../../utils/v2/aquarium-v2";
import type {
  FundedPositionV2Params,
  TokenTrait,
} from "../../utils/v2/init-utils-v2";
import {
  asyncAssertOwnerProgram,
  createMintV2,
} from "../../utils/v2/token-2022";
import { TokenExtensionUtil } from "../../../src/utils/public/token-extension-util";

describe("two_hop_swap_v2", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  describe("v1 parity", () => {
    // 8 patterns for tokenTraitA, tokenTraitB, tokenTraitC
    const tokenTraitVariations: {
      tokenTraitA: TokenTrait;
      tokenTraitB: TokenTrait;
      tokenTraitC: TokenTrait;
    }[] = [
      {
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tokenTraitC: { isToken2022: false },
      },
      {
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tokenTraitC: { isToken2022: true },
      },
      {
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: true },
        tokenTraitC: { isToken2022: false },
      },
      {
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: true },
        tokenTraitC: { isToken2022: true },
      },
      {
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: false },
        tokenTraitC: { isToken2022: false },
      },
      {
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: false },
        tokenTraitC: { isToken2022: true },
      },
      {
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tokenTraitC: { isToken2022: false },
      },
      {
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tokenTraitC: { isToken2022: true },
      },
    ];
    tokenTraitVariations.forEach((tokenTraits) => {
      describe(`tokenTraitA: ${
        tokenTraits.tokenTraitA.isToken2022 ? "Token2022" : "Token"
      }, tokenTraitB: ${
        tokenTraits.tokenTraitB.isToken2022 ? "Token2022" : "Token"
      }, tokenTraitC: ${tokenTraits.tokenTraitC.isToken2022 ? "Token2022" : "Token"}`, () => {
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
          aqConfig.initPoolParams.push({
            mintIndices: [1, 2],
            tickSpacing: TickSpacing.Standard,
          });

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

            await asyncAssertOwnerProgram(
              ctx.provider,
              mintKeys[0],
              tokenTraits.tokenTraitA.isToken2022
                ? TEST_TOKEN_2022_PROGRAM_ID
                : TEST_TOKEN_PROGRAM_ID,
            );
            await asyncAssertOwnerProgram(
              ctx.provider,
              mintKeys[1],
              tokenTraits.tokenTraitB.isToken2022
                ? TEST_TOKEN_2022_PROGRAM_ID
                : TEST_TOKEN_PROGRAM_ID,
            );
            await asyncAssertOwnerProgram(
              ctx.provider,
              mintKeys[2],
              tokenTraits.tokenTraitC.isToken2022
                ? TEST_TOKEN_2022_PROGRAM_ID
                : TEST_TOKEN_PROGRAM_ID,
            );

            const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
            const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
            //const whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
            //const whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
            const whirlpoolDataOne = (await fetcher.getPool(
              whirlpoolOneKey,
              IGNORE_CACHE,
            )) as WhirlpoolData;
            const whirlpoolDataTwo = (await fetcher.getPool(
              whirlpoolTwoKey,
              IGNORE_CACHE,
            )) as WhirlpoolData;

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
            const quote = swapQuoteWithParams(
              {
                amountSpecifiedIsInput: true,
                aToB: aToBOne,
                tokenAmount: new BN(1000),
                otherAmountThreshold:
                  SwapUtils.getDefaultOtherAmountThreshold(true),
                sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
                whirlpoolData: whirlpoolDataOne,
                tickArrays: await SwapUtils.getTickArrays(
                  whirlpoolDataOne.tickCurrentIndex,
                  whirlpoolDataOne.tickSpacing,
                  aToBOne,
                  ctx.program.programId,
                  whirlpoolOneKey,
                  fetcher,
                  IGNORE_CACHE,
                ),
                tokenExtensionCtx:
                  await TokenExtensionUtil.buildTokenExtensionContext(
                    fetcher,
                    whirlpoolDataOne,
                    IGNORE_CACHE,
                  ),
              },
              Percentage.fromFraction(1, 100),
            );

            const aToBTwo =
              whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
            const quote2 = swapQuoteWithParams(
              {
                amountSpecifiedIsInput: true,
                aToB: aToBTwo,
                tokenAmount: quote.estimatedAmountOut,
                otherAmountThreshold:
                  SwapUtils.getDefaultOtherAmountThreshold(true),
                sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
                whirlpoolData: whirlpoolDataTwo,
                tickArrays: await SwapUtils.getTickArrays(
                  whirlpoolDataTwo.tickCurrentIndex,
                  whirlpoolDataTwo.tickSpacing,
                  aToBTwo,
                  ctx.program.programId,
                  whirlpoolTwoKey,
                  fetcher,
                  IGNORE_CACHE,
                ),
                tokenExtensionCtx:
                  await TokenExtensionUtil.buildTokenExtensionContext(
                    fetcher,
                    whirlpoolDataTwo,
                    IGNORE_CACHE,
                  ),
              },
              Percentage.fromFraction(1, 100),
            );

            const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);
            baseIxParams = {
              ...twoHopQuote,
              ...getParamsFromPools(
                [pools[0], pools[1]],
                [twoHopQuote.aToBOne, twoHopQuote.aToBTwo],
                tokenAccounts,
              ),
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
              /0x7dc/, // ConstraintAddress
            );
          });

          it("fails invalid token account", async () => {
            await rejectParams(
              {
                ...baseIxParams,
                tokenOwnerAccountInput: baseIxParams.tokenOwnerAccountOutput,
              },
              /0x7d3/, // ConstraintRaw
            );
            await rejectParams(
              {
                ...baseIxParams,
                tokenOwnerAccountOutput: baseIxParams.tokenOwnerAccountInput,
              },
              /0x7d3/, // ConstraintRaw
            );
          });

          it("fails invalid token vault", async () => {
            await rejectParams(
              {
                ...baseIxParams,
                tokenVaultOneInput: baseIxParams.tokenVaultOneIntermediate,
              },
              /0x7dc/, // ConstraintAddress
            );
            await rejectParams(
              {
                ...baseIxParams,
                tokenVaultOneIntermediate: baseIxParams.tokenVaultOneInput,
              },
              /0x7dc/, // ConstraintAddress
            );
            await rejectParams(
              {
                ...baseIxParams,
                tokenVaultTwoIntermediate: baseIxParams.tokenVaultTwoOutput,
              },
              /0x7dc/, // ConstraintAddress
            );
            await rejectParams(
              {
                ...baseIxParams,
                tokenVaultTwoOutput: baseIxParams.tokenVaultTwoIntermediate,
              },
              /0x7dc/, // ConstraintAddress
            );
          });

          it("fails invalid oracle one address", async () => {
            await rejectParams(
              {
                ...baseIxParams,
                oracleOne: PublicKey.unique(),
              },
              /0x7d6/, // Constraint Seeds
            );
          });

          it("fails invalid oracle two address", async () => {
            await rejectParams(
              {
                ...baseIxParams,
                oracleTwo: PublicKey.unique(),
              },
              /0x7d6/, // Constraint Seeds
            );
          });

          it("fails invalid tick array one", async () => {
            await rejectParams(
              {
                ...baseIxParams,
                // sparse-swap can accept completely uninitialized account as candidate for uninitialized tick arrays.
                // so now we use token account as clearly invalid account.
                tickArrayOne0: baseIxParams.tokenVaultOneInput,
              },
              /0xbbf/, // AccountOwnedByWrongProgram
            );
            await rejectParams(
              {
                ...baseIxParams,
                tickArrayOne1: baseIxParams.tokenVaultOneInput,
              },
              /0xbbf/, // AccountOwnedByWrongProgram
            );
            await rejectParams(
              {
                ...baseIxParams,
                tickArrayOne2: baseIxParams.tokenVaultOneInput,
              },
              /0xbbf/, // AccountOwnedByWrongProgram
            );
          });

          it("fails invalid tick array two", async () => {
            await rejectParams(
              {
                ...baseIxParams,
                // sparse-swap can accept completely uninitialized account as candidate for uninitialized tick arrays.
                // so now we use token account as clearly invalid account.
                tickArrayTwo0: baseIxParams.tokenVaultTwoOutput,
              },
              /0xbbf/, // AccountOwnedByWrongProgram
            );
            await rejectParams(
              {
                ...baseIxParams,
                tickArrayTwo1: baseIxParams.tokenVaultTwoOutput,
              },
              /0xbbf/, // AccountOwnedByWrongProgram
            );
            await rejectParams(
              {
                ...baseIxParams,
                tickArrayTwo2: baseIxParams.tokenVaultTwoOutput,
              },
              /0xbbf/, // AccountOwnedByWrongProgram
            );
          });
        });

        it("swaps [2] with two-hop swap, amountSpecifiedIsInput=true", async () => {
          const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
          const { tokenAccounts, mintKeys, pools } = aquarium;

          let tokenBalances = await getTokenBalances(
            tokenAccounts.map((acc) => acc.account),
          );

          const tokenVaultBalances = await getTokenBalancesForVaults(pools);

          const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
          const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
          //let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
          //let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
          const whirlpoolDataOne = (await fetcher.getPool(
            whirlpoolOneKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          const whirlpoolDataTwo = (await fetcher.getPool(
            whirlpoolTwoKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

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
          const quote = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: aToBOne,
              tokenAmount: new BN(1000),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
              whirlpoolData: whirlpoolDataOne,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataOne.tickCurrentIndex,
                whirlpoolDataOne.tickSpacing,
                aToBOne,
                ctx.program.programId,
                whirlpoolOneKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataOne,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
          const quote2 = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: aToBTwo,
              tokenAmount: quote.estimatedAmountOut,
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
              whirlpoolData: whirlpoolDataTwo,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataTwo.tickCurrentIndex,
                whirlpoolDataTwo.tickSpacing,
                aToBTwo,
                ctx.program.programId,
                whirlpoolTwoKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataTwo,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

          await toTx(
            ctx,
            WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
              ...twoHopQuote,
              ...getParamsFromPools(
                [pools[0], pools[1]],
                [twoHopQuote.aToBOne, twoHopQuote.aToBTwo],
                tokenAccounts,
              ),
              tokenAuthority: ctx.wallet.publicKey,
            }),
          ).buildAndExecute();

          assert.deepEqual(await getTokenBalancesForVaults(pools), [
            tokenVaultBalances[0].add(quote.estimatedAmountIn),
            tokenVaultBalances[1].sub(quote.estimatedAmountOut),
            tokenVaultBalances[2].add(quote2.estimatedAmountIn),
            tokenVaultBalances[3].sub(quote2.estimatedAmountOut),
          ]);

          const prevTbs = [...tokenBalances];
          tokenBalances = await getTokenBalances(
            tokenAccounts.map((acc) => acc.account),
          );

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
          aqConfig.initFeeTierParams.push({
            tickSpacing: TickSpacing.ThirtyTwo,
          });
          aqConfig.initPoolParams[1] = {
            mintIndices: [0, 1],
            tickSpacing: TickSpacing.ThirtyTwo,
            feeTierIndex: 1,
          };
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

          let tokenBalances = await getTokenBalances(
            tokenAccounts.map((acc) => acc.account),
          );

          const tokenVaultBalances = await getTokenBalancesForVaults(pools);

          const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
          const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
          //let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
          //let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
          const whirlpoolDataOne = (await fetcher.getPool(
            whirlpoolOneKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          const whirlpoolDataTwo = (await fetcher.getPool(
            whirlpoolTwoKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

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
          const quote = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: aToBOne,
              tokenAmount: new BN(1000),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
              whirlpoolData: whirlpoolDataOne,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataOne.tickCurrentIndex,
                whirlpoolDataOne.tickSpacing,
                aToBOne,
                ctx.program.programId,
                whirlpoolOneKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataOne,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(tokenB);
          const quote2 = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: aToBTwo,
              tokenAmount: quote.estimatedAmountOut,
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
              whirlpoolData: whirlpoolDataTwo,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataTwo.tickCurrentIndex,
                whirlpoolDataTwo.tickSpacing,
                aToBTwo,
                ctx.program.programId,
                whirlpoolTwoKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataTwo,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

          await toTx(
            ctx,
            WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
              ...twoHopQuote,
              ...getParamsFromPools(
                [pools[0], pools[1]],
                [twoHopQuote.aToBOne, twoHopQuote.aToBTwo],
                tokenAccounts,
              ),
              tokenAuthority: ctx.wallet.publicKey,
            }),
          ).buildAndExecute();

          assert.deepEqual(await getTokenBalancesForVaults(pools), [
            tokenVaultBalances[0].add(quote.estimatedAmountIn),
            tokenVaultBalances[1].sub(quote.estimatedAmountOut),
            tokenVaultBalances[2].sub(quote2.estimatedAmountOut),
            tokenVaultBalances[3].add(quote2.estimatedAmountIn),
          ]);

          const prevTbs = [...tokenBalances];
          tokenBalances = await getTokenBalances(
            tokenAccounts.map((acc) => acc.account),
          );

          assert.deepEqual(tokenBalances, [
            prevTbs[0]
              .sub(quote.estimatedAmountIn)
              .add(quote2.estimatedAmountOut),
            prevTbs[1]
              .add(quote.estimatedAmountOut)
              .sub(quote2.estimatedAmountIn),
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
          const whirlpoolDataOne = (await fetcher.getPool(
            whirlpoolOneKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          const whirlpoolDataTwo = (await fetcher.getPool(
            whirlpoolTwoKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

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
          const quote = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: aToBOne,
              tokenAmount: new BN(1000),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
              whirlpoolData: whirlpoolDataOne,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataOne.tickCurrentIndex,
                whirlpoolDataOne.tickSpacing,
                aToBOne,
                ctx.program.programId,
                whirlpoolOneKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataOne,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
          const quote2 = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: aToBTwo,
              tokenAmount: quote.estimatedAmountOut,
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
              whirlpoolData: whirlpoolDataTwo,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataTwo.tickCurrentIndex,
                whirlpoolDataTwo.tickSpacing,
                aToBTwo,
                ctx.program.programId,
                whirlpoolTwoKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataTwo,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                ...twoHopQuote,
                ...getParamsFromPools(
                  [pools[0], pools[1]],
                  [twoHopQuote.aToBOne, twoHopQuote.aToBTwo],
                  tokenAccounts,
                ),
                otherAmountThreshold: new BN(613309),
                tokenAuthority: ctx.wallet.publicKey,
              }),
            ).buildAndExecute(),
            /0x1794/, // Above Out Below Minimum
          );
        });

        it("swaps [2] with two-hop swap, amountSpecifiedIsInput=false", async () => {
          const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
          const { tokenAccounts, mintKeys, pools } = aquarium;

          const preSwapBalances = await getTokenBalances(
            tokenAccounts.map((acc) => acc.account),
          );
          const tokenVaultBalances = await getTokenBalancesForVaults(pools);

          const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
          const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
          //const whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
          //const whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
          const whirlpoolDataOne = (await fetcher.getPool(
            whirlpoolOneKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          const whirlpoolDataTwo = (await fetcher.getPool(
            whirlpoolTwoKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

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
          const quote2 = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: false,
              aToB: aToBTwo,
              tokenAmount: new BN(1000),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
              whirlpoolData: whirlpoolDataTwo,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataTwo.tickCurrentIndex,
                whirlpoolDataTwo.tickSpacing,
                aToBTwo,
                ctx.program.programId,
                whirlpoolTwoKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataTwo,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const aToBOne = whirlpoolDataOne.tokenMintB.equals(intermediaryToken);
          const quote = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: false,
              aToB: aToBOne,
              tokenAmount: quote2.estimatedAmountIn,
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
              whirlpoolData: whirlpoolDataOne,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataOne.tickCurrentIndex,
                whirlpoolDataOne.tickSpacing,
                aToBOne,
                ctx.program.programId,
                whirlpoolOneKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataOne,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

          await toTx(
            ctx,
            WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
              ...twoHopQuote,
              ...getParamsFromPools(
                [pools[0], pools[1]],
                [twoHopQuote.aToBOne, twoHopQuote.aToBTwo],
                tokenAccounts,
              ),
              tokenAuthority: ctx.wallet.publicKey,
            }),
          ).buildAndExecute();

          assert.deepEqual(await getTokenBalancesForVaults(pools), [
            tokenVaultBalances[0].add(quote.estimatedAmountIn),
            tokenVaultBalances[1].sub(quote.estimatedAmountOut),
            tokenVaultBalances[2].add(quote2.estimatedAmountIn),
            tokenVaultBalances[3].sub(quote2.estimatedAmountOut),
          ]);

          assert.deepEqual(
            await getTokenBalances(tokenAccounts.map((acc) => acc.account)),
            [
              preSwapBalances[0].sub(quote.estimatedAmountIn),
              preSwapBalances[1],
              preSwapBalances[2].add(quote2.estimatedAmountOut),
            ],
          );
        });

        it("fails swaps [2] with two-hop swap, amountSpecifiedIsInput=false slippage", async () => {
          const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
          const { tokenAccounts, mintKeys, pools } = aquarium;

          const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
          const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
          //const whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
          //const whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
          const whirlpoolDataOne = (await fetcher.getPool(
            whirlpoolOneKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          const whirlpoolDataTwo = (await fetcher.getPool(
            whirlpoolTwoKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

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
          const quote2 = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: false,
              aToB: aToBTwo,
              tokenAmount: new BN(1000),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
              whirlpoolData: whirlpoolDataTwo,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataTwo.tickCurrentIndex,
                whirlpoolDataTwo.tickSpacing,
                aToBTwo,
                ctx.program.programId,
                whirlpoolTwoKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataTwo,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const aToBOne = whirlpoolDataOne.tokenMintB.equals(intermediaryToken);
          const quote = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: false,
              aToB: aToBOne,
              tokenAmount: quote2.estimatedAmountIn,
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
              whirlpoolData: whirlpoolDataOne,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataOne.tickCurrentIndex,
                whirlpoolDataOne.tickSpacing,
                aToBOne,
                ctx.program.programId,
                whirlpoolOneKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataOne,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                ...twoHopQuote,
                ...getParamsFromPools(
                  [pools[0], pools[1]],
                  [twoHopQuote.aToBOne, twoHopQuote.aToBTwo],
                  tokenAccounts,
                ),
                otherAmountThreshold: new BN(2),
                tokenAuthority: ctx.wallet.publicKey,
              }),
            ).buildAndExecute(),
            /0x1795/, // Above In Above Maximum
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
          const whirlpoolDataOne = (await fetcher.getPool(
            whirlpoolOneKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          const whirlpoolDataTwo = (await fetcher.getPool(
            whirlpoolTwoKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

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
          const quote2 = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: false,
              aToB: aToBTwo,
              tokenAmount: new BN(1000),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
              whirlpoolData: whirlpoolDataTwo,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataTwo.tickCurrentIndex,
                whirlpoolDataTwo.tickSpacing,
                aToBTwo,
                ctx.program.programId,
                whirlpoolTwoKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataTwo,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const aToBOne = whirlpoolDataOne.tokenMintB.equals(intermediaryToken);
          const quote = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: false,
              aToB: aToBOne,
              tokenAmount: quote2.estimatedAmountIn,
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
              whirlpoolData: whirlpoolDataOne,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataOne.tickCurrentIndex,
                whirlpoolDataOne.tickSpacing,
                aToBOne,
                ctx.program.programId,
                whirlpoolOneKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataOne,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                ...twoHopQuote,
                ...getParamsFromPools(
                  [pools[0], pools[1]],
                  [twoHopQuote.aToBOne, twoHopQuote.aToBTwo],
                  tokenAccounts,
                ),
                tokenAuthority: ctx.wallet.publicKey,
              }),
            ).buildAndExecute(),
            /0x1799/, // Invalid intermediary mint
          );
        });

        it("swaps [2] with two-hop swap, amount_specified_is_input=true, first swap price limit", async () => {
          const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
          const { tokenAccounts, mintKeys, pools } = aquarium;

          const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
          const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
          //let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
          //let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
          const whirlpoolDataOne = (await fetcher.getPool(
            whirlpoolOneKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          const whirlpoolDataTwo = (await fetcher.getPool(
            whirlpoolTwoKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

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
          const quote = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: aToBOne,
              tokenAmount: new BN(1000),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
              whirlpoolData: whirlpoolDataOne,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataOne.tickCurrentIndex,
                whirlpoolDataOne.tickSpacing,
                aToBOne,
                ctx.program.programId,
                whirlpoolOneKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataOne,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
          const quote2 = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: aToBTwo,
              tokenAmount: quote.estimatedAmountOut,
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
              whirlpoolData: whirlpoolDataTwo,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataTwo.tickCurrentIndex,
                whirlpoolDataTwo.tickSpacing,
                aToBTwo,
                ctx.program.programId,
                whirlpoolTwoKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataTwo,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          // Set a price limit that is less than the 1% slippage threshold,
          // which will allow the swap to go through
          quote.sqrtPriceLimit = quote.estimatedEndSqrtPrice.add(
            whirlpoolDataOne.sqrtPrice
              .sub(quote.estimatedEndSqrtPrice)
              .mul(new anchor.BN("5"))
              .div(new anchor.BN("1000")),
          );

          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

          await toTx(
            ctx,
            WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
              ...twoHopQuote,
              ...getParamsFromPools(
                [pools[0], pools[1]],
                [twoHopQuote.aToBOne, twoHopQuote.aToBTwo],
                tokenAccounts,
              ),
              tokenAuthority: ctx.wallet.publicKey,
            }),
          ).buildAndExecute();

          const postWhirlpoolDataOne = (await fetcher.getPool(
            whirlpoolOneKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          //const postWhirlpoolDataTwo = await fetcher.getPool(whirlpoolTwoKey, IGNORE_CACHE) as WhirlpoolData;

          assert.equal(
            postWhirlpoolDataOne.sqrtPrice.eq(quote.sqrtPriceLimit),
            true,
          );
        });

        it("fails: swaps [2] with two-hop swap, amount_specified_is_input=true, second swap price limit", async () => {
          // ATTENTION: v1 and v2 are different
          // v2 use vault to vault transfer, so the output of first swap MUST be equal to the input of the second swap.
          // So not-full-filled swap will be rejected.

          const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
          const { tokenAccounts, mintKeys, pools } = aquarium;

          const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
          const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
          //let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
          //let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
          const whirlpoolDataOne = (await fetcher.getPool(
            whirlpoolOneKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          const whirlpoolDataTwo = (await fetcher.getPool(
            whirlpoolTwoKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

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
          const quote = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: aToBOne,
              tokenAmount: new BN(1000),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
              whirlpoolData: whirlpoolDataOne,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataOne.tickCurrentIndex,
                whirlpoolDataOne.tickSpacing,
                aToBOne,
                ctx.program.programId,
                whirlpoolOneKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataOne,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
          const quote2 = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: aToBTwo,
              tokenAmount: quote.estimatedAmountOut,
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
              whirlpoolData: whirlpoolDataTwo,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataTwo.tickCurrentIndex,
                whirlpoolDataTwo.tickSpacing,
                aToBTwo,
                ctx.program.programId,
                whirlpoolTwoKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataTwo,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          // Set a price limit that is less than the 1% slippage threshold,
          // which will result non-full-filled second swap
          quote2.sqrtPriceLimit = quote2.estimatedEndSqrtPrice.add(
            whirlpoolDataTwo.sqrtPrice
              .sub(quote2.estimatedEndSqrtPrice)
              .mul(new anchor.BN("5"))
              .div(new anchor.BN("1000")),
          );

          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                ...twoHopQuote,
                ...getParamsFromPools(
                  [pools[0], pools[1]],
                  [twoHopQuote.aToBOne, twoHopQuote.aToBTwo],
                  tokenAccounts,
                ),
                tokenAuthority: ctx.wallet.publicKey,
              }),
            ).buildAndExecute(),
            /0x17a3/, // IntermediateTokenAmountMismatch
          );
        });

        it("fails: swaps [2] with two-hop swap, amount_specified_is_input=false, first swap price limit", async () => {
          // ATTENTION: v1 and v2 are different
          // v2 use vault to vault transfer, so the output of first swap MUST be equal to the input of the second swap.
          // So not-full-filled swap will be rejected.

          const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
          const { tokenAccounts, mintKeys, pools } = aquarium;

          const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
          const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
          const whirlpoolDataOne = (await fetcher.getPool(
            whirlpoolOneKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          const whirlpoolDataTwo = (await fetcher.getPool(
            whirlpoolTwoKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const [_inputToken, intermediaryToken, outputToken] = mintKeys;

          const aToBTwo = whirlpoolDataTwo.tokenMintB.equals(outputToken);
          const quote2 = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: false,
              aToB: aToBTwo,
              tokenAmount: new BN(1000),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
              whirlpoolData: whirlpoolDataTwo,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataTwo.tickCurrentIndex,
                whirlpoolDataTwo.tickSpacing,
                aToBTwo,
                ctx.program.programId,
                whirlpoolTwoKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataTwo,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const aToBOne = whirlpoolDataOne.tokenMintB.equals(intermediaryToken);
          const quote = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: false,
              aToB: aToBOne,
              tokenAmount: quote2.estimatedAmountIn,
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
              whirlpoolData: whirlpoolDataOne,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataOne.tickCurrentIndex,
                whirlpoolDataOne.tickSpacing,
                aToBOne,
                ctx.program.programId,
                whirlpoolOneKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataOne,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          // add sqrtPriceLimit on quote
          quote.sqrtPriceLimit = aToBOne
            ? quote.estimatedEndSqrtPrice.addn(1)
            : quote.estimatedEndSqrtPrice.subn(1);

          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                ...twoHopQuote,
                ...getParamsFromPools(
                  [pools[0], pools[1]],
                  [twoHopQuote.aToBOne, twoHopQuote.aToBTwo],
                  tokenAccounts,
                ),
                tokenAuthority: ctx.wallet.publicKey,
              }),
            ).buildAndExecute(),
            /0x17a3/, // IntermediateTokenAmountMismatch
          );
        });

        it("fails swaps [2] with two-hop swap, amount_specified_is_input=true, first swap price limit", async () => {
          const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
          const { tokenAccounts, mintKeys, pools } = aquarium;

          const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
          const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
          //let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
          //let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
          const whirlpoolDataOne = (await fetcher.getPool(
            whirlpoolOneKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          const whirlpoolDataTwo = (await fetcher.getPool(
            whirlpoolTwoKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

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
          const quote = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: aToBOne,
              tokenAmount: new BN(1000),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
              whirlpoolData: whirlpoolDataOne,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataOne.tickCurrentIndex,
                whirlpoolDataOne.tickSpacing,
                aToBOne,
                ctx.program.programId,
                whirlpoolOneKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataOne,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
          const quote2 = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: aToBTwo,
              tokenAmount: quote.estimatedAmountOut,
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
              whirlpoolData: whirlpoolDataTwo,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataTwo.tickCurrentIndex,
                whirlpoolDataTwo.tickSpacing,
                aToBTwo,
                ctx.program.programId,
                whirlpoolTwoKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataTwo,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          // Set a price limit that is less than the 1% slippage threshold,
          // which will allow the swap to go through
          quote.sqrtPriceLimit = quote.estimatedEndSqrtPrice.add(
            whirlpoolDataOne.sqrtPrice
              .sub(quote.estimatedEndSqrtPrice)
              .mul(new anchor.BN("15"))
              .div(new anchor.BN("1000")),
          );

          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                ...twoHopQuote,
                ...getParamsFromPools(
                  [pools[0], pools[1]],
                  [twoHopQuote.aToBOne, twoHopQuote.aToBTwo],
                  tokenAccounts,
                ),
                tokenAuthority: ctx.wallet.publicKey,
              }),
            ).buildAndExecute(),
          );
        });

        it("fails swaps [2] with two-hop swap, amount_specified_is_input=true, second swap price limit", async () => {
          const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
          const { tokenAccounts, mintKeys, pools } = aquarium;

          const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
          const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
          //let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
          //let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
          const whirlpoolDataOne = (await fetcher.getPool(
            whirlpoolOneKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          const whirlpoolDataTwo = (await fetcher.getPool(
            whirlpoolTwoKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

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
          const quote = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: aToBOne,
              tokenAmount: new BN(1000),
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
              whirlpoolData: whirlpoolDataOne,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataOne.tickCurrentIndex,
                whirlpoolDataOne.tickSpacing,
                aToBOne,
                ctx.program.programId,
                whirlpoolOneKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataOne,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
          const quote2 = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: true,
              aToB: aToBTwo,
              tokenAmount: quote.estimatedAmountOut,
              otherAmountThreshold:
                SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
              whirlpoolData: whirlpoolDataTwo,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataTwo.tickCurrentIndex,
                whirlpoolDataTwo.tickSpacing,
                aToBTwo,
                ctx.program.programId,
                whirlpoolTwoKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx:
                await TokenExtensionUtil.buildTokenExtensionContext(
                  fetcher,
                  whirlpoolDataTwo,
                  IGNORE_CACHE,
                ),
            },
            Percentage.fromFraction(1, 100),
          );

          // Set a price limit that is greater than the 1% slippage threshold,
          // which will cause the swap to fail
          quote2.sqrtPriceLimit = quote2.estimatedEndSqrtPrice.add(
            whirlpoolDataTwo.sqrtPrice
              .sub(quote2.estimatedEndSqrtPrice)
              .mul(new anchor.BN("15"))
              .div(new anchor.BN("1000")),
          );

          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                ...twoHopQuote,
                ...getParamsFromPools(
                  [pools[0], pools[1]],
                  [twoHopQuote.aToBOne, twoHopQuote.aToBTwo],
                  tokenAccounts,
                ),
                tokenAuthority: ctx.wallet.publicKey,
              }),
            ).buildAndExecute(),
          );
        });
      });
    });
  });

  describe("v2 specific accounts", () => {
    describe("with Token-2022", () => {
      const tokenTraits = {
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tokenTraitC: { isToken2022: true },
      };

      let aqConfig: InitAquariumV2Params;
      let baseIxParams: TwoHopSwapV2Params;
      let otherTokenPublicKey: PublicKey;

      beforeEach(async () => {
        otherTokenPublicKey = await createMintV2(provider, {
          isToken2022: true,
        });

        aqConfig = getDefaultAquariumV2();
        // Add a third token and account and a second pool
        aqConfig.initMintParams = [
          { tokenTrait: tokenTraits.tokenTraitA },
          { tokenTrait: tokenTraits.tokenTraitB },
          { tokenTrait: tokenTraits.tokenTraitC },
        ];
        aqConfig.initTokenAccParams.push({ mintIndex: 2 });
        aqConfig.initPoolParams.push({
          mintIndices: [1, 2],
          tickSpacing: TickSpacing.Standard,
        });

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

        const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
        const { tokenAccounts, mintKeys, pools } = aquarium;

        const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
        const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
        const whirlpoolDataOne = (await fetcher.getPool(
          whirlpoolOneKey,
          IGNORE_CACHE,
        )) as WhirlpoolData;
        const whirlpoolDataTwo = (await fetcher.getPool(
          whirlpoolTwoKey,
          IGNORE_CACHE,
        )) as WhirlpoolData;

        const [inputToken, intermediaryToken, _outputToken] = mintKeys;

        const aToBOne = whirlpoolDataOne.tokenMintA.equals(inputToken);
        const quote = swapQuoteWithParams(
          {
            amountSpecifiedIsInput: true,
            aToB: aToBOne,
            tokenAmount: new BN(1000),
            otherAmountThreshold:
              SwapUtils.getDefaultOtherAmountThreshold(true),
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
            whirlpoolData: whirlpoolDataOne,
            tickArrays: await SwapUtils.getTickArrays(
              whirlpoolDataOne.tickCurrentIndex,
              whirlpoolDataOne.tickSpacing,
              aToBOne,
              ctx.program.programId,
              whirlpoolOneKey,
              fetcher,
              IGNORE_CACHE,
            ),
            tokenExtensionCtx:
              await TokenExtensionUtil.buildTokenExtensionContext(
                fetcher,
                whirlpoolDataOne,
                IGNORE_CACHE,
              ),
          },
          Percentage.fromFraction(1, 100),
        );

        const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
        const quote2 = swapQuoteWithParams(
          {
            amountSpecifiedIsInput: true,
            aToB: aToBTwo,
            tokenAmount: quote.estimatedAmountOut,
            otherAmountThreshold:
              SwapUtils.getDefaultOtherAmountThreshold(true),
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
            whirlpoolData: whirlpoolDataTwo,
            tickArrays: await SwapUtils.getTickArrays(
              whirlpoolDataTwo.tickCurrentIndex,
              whirlpoolDataTwo.tickSpacing,
              aToBTwo,
              ctx.program.programId,
              whirlpoolTwoKey,
              fetcher,
              IGNORE_CACHE,
            ),
            tokenExtensionCtx:
              await TokenExtensionUtil.buildTokenExtensionContext(
                fetcher,
                whirlpoolDataTwo,
                IGNORE_CACHE,
              ),
          },
          Percentage.fromFraction(1, 100),
        );

        const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);
        baseIxParams = {
          ...twoHopQuote,
          ...getParamsFromPools(
            [pools[0], pools[1]],
            [twoHopQuote.aToBOne, twoHopQuote.aToBTwo],
            tokenAccounts,
          ),
          tokenAuthority: ctx.wallet.publicKey,
        };
      });

      describe("fails when passed token_mint_* does not match whirlpool's token_mint_*_*", () => {
        it("token_mint_input", async () => {
          await rejectParams(
            {
              ...baseIxParams,
              tokenMintInput: otherTokenPublicKey,
            },
            /0x7dc/, // ConstraintAddress
          );
        });
        it("token_mint_intermediate", async () => {
          await rejectParams(
            {
              ...baseIxParams,
              tokenMintIntermediate: otherTokenPublicKey,
            },
            /0x7dc/, // ConstraintAddress
          );
        });
        it("token_mint_output", async () => {
          await rejectParams(
            {
              ...baseIxParams,
              tokenMintOutput: otherTokenPublicKey,
            },
            /0x7dc/, // ConstraintAddress
          );
        });
      });

      describe("fails when passed token_program_* is not token-2022 program (token is passed)", () => {
        it("token_program_input", async () => {
          await rejectParams(
            {
              ...baseIxParams,
              tokenProgramInput: TEST_TOKEN_PROGRAM_ID,
            },
            /0x7dc/, // ConstraintAddress
          );
        });
        it("token_program_intermediate", async () => {
          await rejectParams(
            {
              ...baseIxParams,
              tokenProgramIntermediate: TEST_TOKEN_PROGRAM_ID,
            },
            /0x7dc/, // ConstraintAddress
          );
        });
        it("token_program_output", async () => {
          await rejectParams(
            {
              ...baseIxParams,
              tokenProgramOutput: TEST_TOKEN_PROGRAM_ID,
            },
            /0x7dc/, // ConstraintAddress
          );
        });
      });

      describe("fails when passed token_program_*_* is token_metadata", () => {
        it("token_program_input", async () => {
          await rejectParams(
            {
              ...baseIxParams,
              tokenProgramInput: METADATA_PROGRAM_ADDRESS,
            },
            /0xbc0/, // InvalidProgramId
          );
        });
        it("token_program_intermediate", async () => {
          await rejectParams(
            {
              ...baseIxParams,
              tokenProgramIntermediate: METADATA_PROGRAM_ADDRESS,
            },
            /0xbc0/, // InvalidProgramId
          );
        });
        it("token_program_output", async () => {
          await rejectParams(
            {
              ...baseIxParams,
              tokenProgramOutput: METADATA_PROGRAM_ADDRESS,
            },
            /0xbc0/, // InvalidProgramId
          );
        });
      });

      it("fails when passed memo_program is token_metadata", async () => {
        await assert.rejects(
          toTx(ctx, {
            cleanupInstructions: [],
            signers: [],
            instructions: [
              ctx.program.instruction.twoHopSwapV2(
                baseIxParams.amount,
                baseIxParams.otherAmountThreshold,
                baseIxParams.amountSpecifiedIsInput,
                baseIxParams.aToBOne,
                baseIxParams.aToBTwo,
                baseIxParams.sqrtPriceLimitOne,
                baseIxParams.sqrtPriceLimitTwo,
                { slices: [] },
                {
                  accounts: {
                    ...baseIxParams,
                    memoProgram: METADATA_PROGRAM_ADDRESS,
                  },
                },
              ),
            ],
          }).buildAndExecute(),
          /0xbc0/, // InvalidProgramId
        );
      });
    });

    describe("with Token", () => {
      const tokenTraits = {
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tokenTraitC: { isToken2022: false },
      };

      let aqConfig: InitAquariumV2Params;
      let baseIxParams: TwoHopSwapV2Params;

      beforeEach(async () => {
        await createMintV2(provider, {
          isToken2022: false,
        });

        aqConfig = getDefaultAquariumV2();
        // Add a third token and account and a second pool
        aqConfig.initMintParams = [
          { tokenTrait: tokenTraits.tokenTraitA },
          { tokenTrait: tokenTraits.tokenTraitB },
          { tokenTrait: tokenTraits.tokenTraitC },
        ];
        aqConfig.initTokenAccParams.push({ mintIndex: 2 });
        aqConfig.initPoolParams.push({
          mintIndices: [1, 2],
          tickSpacing: TickSpacing.Standard,
        });

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

        const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
        const { tokenAccounts, mintKeys, pools } = aquarium;

        const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
        const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
        const whirlpoolDataOne = (await fetcher.getPool(
          whirlpoolOneKey,
          IGNORE_CACHE,
        )) as WhirlpoolData;
        const whirlpoolDataTwo = (await fetcher.getPool(
          whirlpoolTwoKey,
          IGNORE_CACHE,
        )) as WhirlpoolData;

        const [inputToken, intermediaryToken, _outputToken] = mintKeys;

        const aToBOne = whirlpoolDataOne.tokenMintA.equals(inputToken);
        const quote = swapQuoteWithParams(
          {
            amountSpecifiedIsInput: true,
            aToB: aToBOne,
            tokenAmount: new BN(1000),
            otherAmountThreshold:
              SwapUtils.getDefaultOtherAmountThreshold(true),
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
            whirlpoolData: whirlpoolDataOne,
            tickArrays: await SwapUtils.getTickArrays(
              whirlpoolDataOne.tickCurrentIndex,
              whirlpoolDataOne.tickSpacing,
              aToBOne,
              ctx.program.programId,
              whirlpoolOneKey,
              fetcher,
              IGNORE_CACHE,
            ),
            tokenExtensionCtx:
              await TokenExtensionUtil.buildTokenExtensionContext(
                fetcher,
                whirlpoolDataOne,
                IGNORE_CACHE,
              ),
          },
          Percentage.fromFraction(1, 100),
        );

        const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
        const quote2 = swapQuoteWithParams(
          {
            amountSpecifiedIsInput: true,
            aToB: aToBTwo,
            tokenAmount: quote.estimatedAmountOut,
            otherAmountThreshold:
              SwapUtils.getDefaultOtherAmountThreshold(true),
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
            whirlpoolData: whirlpoolDataTwo,
            tickArrays: await SwapUtils.getTickArrays(
              whirlpoolDataTwo.tickCurrentIndex,
              whirlpoolDataTwo.tickSpacing,
              aToBTwo,
              ctx.program.programId,
              whirlpoolTwoKey,
              fetcher,
              IGNORE_CACHE,
            ),
            tokenExtensionCtx:
              await TokenExtensionUtil.buildTokenExtensionContext(
                fetcher,
                whirlpoolDataTwo,
                IGNORE_CACHE,
              ),
          },
          Percentage.fromFraction(1, 100),
        );

        const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);
        baseIxParams = {
          ...twoHopQuote,
          ...getParamsFromPools(
            [pools[0], pools[1]],
            [twoHopQuote.aToBOne, twoHopQuote.aToBTwo],
            tokenAccounts,
          ),
          tokenAuthority: ctx.wallet.publicKey,
        };
      });

      describe("fails when passed token_program_* is not token program (token-2022 is passed)", () => {
        it("token_program_input", async () => {
          await rejectParams(
            {
              ...baseIxParams,
              tokenProgramInput: TEST_TOKEN_2022_PROGRAM_ID,
            },
            /0x7dc/, // ConstraintAddress
          );
        });
        it("token_program_intermediate", async () => {
          await rejectParams(
            {
              ...baseIxParams,
              tokenProgramIntermediate: TEST_TOKEN_2022_PROGRAM_ID,
            },
            /0x7dc/, // ConstraintAddress
          );
        });
        it("token_program_output", async () => {
          await rejectParams(
            {
              ...baseIxParams,
              tokenProgramOutput: TEST_TOKEN_2022_PROGRAM_ID,
            },
            /0x7dc/, // ConstraintAddress
          );
        });
      });
    });
  });

  describe("partial fill", () => {
    const client = buildWhirlpoolClient(ctx);
    const aqConfig = {
      ...getDefaultAquariumV2(),
      initMintParams: [
        {tokenTrait: {isToken2022: true}},
        {tokenTrait: {isToken2022: true}},
        {tokenTrait: {isToken2022: true}},
      ],
      initTokenAccParams: [
        { mintIndex: 0 },
        { mintIndex: 1 },
        { mintIndex: 2 },
      ],
      initPoolParams: [
        { mintIndices: [0, 1] as [number, number], tickSpacing: 128, },
        { mintIndices: [1, 2] as [number, number], tickSpacing: 128, },
      ],
    };

    // Reject partial fill result
    // |--***T**-S-| --> |-min,T----**-S-| (where *: liquidity, S: start, T: end)
    it("fails ExactOut, partial fill on second swap, sqrt_price_limit_two == 0", async () => {
      const aquarium = (await buildTestAquariumsV2(ctx, [{
        configParams: aqConfig.configParams,
        initFeeTierParams: aqConfig.initFeeTierParams,
        initMintParams: aqConfig.initMintParams,
        initTokenAccParams: [
          {mintIndex: 0, mintAmount: new BN(1_000_000_000_000_000)},
          {mintIndex: 1, mintAmount: new BN(1_000_000_000_000_000)},
          {mintIndex: 2, mintAmount: new BN(1_000_000_000_000_000)},
        ],
        initPoolParams: [
          { ...aqConfig.initPoolParams[0], tickSpacing: 128, initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(-1) },
          { ...aqConfig.initPoolParams[1], tickSpacing: 128, initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(-439296 - 1) },
        ],
        initTickArrayRangeParams: [
          {
            poolIndex: 0,
            startTickIndex: 0,
            arrayCount: 3,
            aToB: true,
          },
          {
            poolIndex: 1,
            startTickIndex: -450560,
            arrayCount: 1,
            aToB: true,
          },
        ],
        initPositionParams: [
          {poolIndex: 0, fundParams: [{tickLowerIndex: -512, tickUpperIndex: -128, liquidityAmount: new BN(5_000_000_000_000)}]},
          {poolIndex: 1, fundParams: [{tickLowerIndex: -439296 - 256, tickUpperIndex: -439296 - 128, liquidityAmount: new BN(1_000)}]},
        ],
      }]))[0];
      const { tokenAccounts, mintKeys, pools } = aquarium;

      const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
      const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
      let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
      let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);

      const [inputToken, intermediaryToken, outputToken] = mintKeys;
  
      const quoteSecond = await swapQuoteByOutputToken(
        whirlpoolTwo,
        outputToken,
        new BN(1),
        Percentage.fromFraction(0, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );
  
      const quoteFirst = await swapQuoteByOutputToken(
        whirlpoolOne,
        intermediaryToken,
        quoteSecond.estimatedAmountIn,
        Percentage.fromFraction(0, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );
    
      const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quoteFirst, quoteSecond);
  
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
            ...twoHopQuote,
            sqrtPriceLimitTwo: new BN(0), // Partial fill is NOT allowed
            ...getParamsFromPools([pools[0], pools[1]], [true, true], tokenAccounts),
            tokenAuthority: ctx.wallet.publicKey,
          }),
        ).buildAndExecute(),
        /0x17a9/,  // PartialFillError
      );

      await toTx(
        ctx,
        WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
          ...twoHopQuote,
          sqrtPriceLimitTwo: MIN_SQRT_PRICE_BN, // Partial fill is allowed
          ...getParamsFromPools([pools[0], pools[1]], [true, true], tokenAccounts),
          tokenAuthority: ctx.wallet.publicKey,
        }),
      ).buildAndExecute();
    });

    // Reject partial fill on the first swap by sqrt_price_limit_one = 0
    // |-min,T----**-S-| --> |--***T**-S-| (where *: liquidity, S: start, T: end)
    it("fails ExactOut, partial fill on first swap, sqrt_price_limit_one == 0", async () => {
      const aquarium = (await buildTestAquariumsV2(ctx, [{
        configParams: aqConfig.configParams,
        initFeeTierParams: [{tickSpacing: 128, feeRate: 0}], // to realize input = 1 on second swap
        initMintParams: aqConfig.initMintParams,
        initTokenAccParams: [
          {mintIndex: 0, mintAmount: new BN(1_000_000_000_000_000)},
          {mintIndex: 1, mintAmount: new BN(1_000_000_000_000_000)},
          {mintIndex: 2, mintAmount: new BN(1_000_000_000_000_000)},
        ],
        initPoolParams: [
          { ...aqConfig.initPoolParams[0], tickSpacing: 128, initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(-439296 - 1) },
          { ...aqConfig.initPoolParams[1], tickSpacing: 128, initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(1024 + 1) },
        ],
        initTickArrayRangeParams: [
          {
            poolIndex: 0,
            startTickIndex: -450560,
            arrayCount: 1,
            aToB: true,
          },
          {
            poolIndex: 1,
            startTickIndex: 0,
            arrayCount: 3,
            aToB: true,
          },
        ],
        initPositionParams: [
          {poolIndex: 0, fundParams: [{tickLowerIndex: -439296 - 256, tickUpperIndex: -439296 - 128, liquidityAmount: new BN(1_000)}]},
          {poolIndex: 1, fundParams: [{tickLowerIndex: 512, tickUpperIndex: 1024, liquidityAmount: new BN(5_000_000_000_000)}]},
        ],
      }]))[0];
      const { tokenAccounts, mintKeys, pools } = aquarium;

      const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
      const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
      let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
      let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);

      const [inputToken, intermediaryToken, outputToken] = mintKeys;
  
      // 1 --> 1
      const quoteSecond = await swapQuoteByOutputToken(
        whirlpoolTwo,
        outputToken,
        new BN(1),
        Percentage.fromFraction(0, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );
  
      // 22337909818 --> 0 (not round up)
      const quoteFirst = await swapQuoteByOutputToken(
        whirlpoolOne,
        intermediaryToken,
        quoteSecond.estimatedAmountIn,
        Percentage.fromFraction(0, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );
    
      const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quoteFirst, quoteSecond);
  
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
            ...twoHopQuote,
            sqrtPriceLimitOne: new BN(0), // Partial fill is NOT allowed
            ...getParamsFromPools([pools[0], pools[1]], [true, true], tokenAccounts),
            tokenAuthority: ctx.wallet.publicKey,
          }),
        ).buildAndExecute(),
        /0x17a9/,  // PartialFillError
      );
    });

    // Reject partial fill on the first swap by the constraint that first output must be equal to the second input
    // Pools are safe, but owner consume intermediate tokens unproportionally
    // |-min,T----**-S-| --> |--***T**-S-| (where *: liquidity, S: start, T: end)
    it("fails ExactOut, partial fill on first swap, sqrt_price_limit_one != 0", async () => {
      const aquarium = (await buildTestAquariumsV2(ctx, [{
        configParams: aqConfig.configParams,
        initFeeTierParams: [{tickSpacing: 128, feeRate: 0}], // to realize input = 1 on second swap
        initMintParams: aqConfig.initMintParams,
        initTokenAccParams: [
          {mintIndex: 0, mintAmount: new BN(1_000_000_000_000_000)},
          {mintIndex: 1, mintAmount: new BN(1_000_000_000_000_000)},
          {mintIndex: 2, mintAmount: new BN(1_000_000_000_000_000)},
        ],
        initPoolParams: [
          { ...aqConfig.initPoolParams[0], tickSpacing: 128, initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(-439296 - 1) },
          { ...aqConfig.initPoolParams[1], tickSpacing: 128, initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(1024 + 1) },
        ],
        initTickArrayRangeParams: [
          {
            poolIndex: 0,
            startTickIndex: -450560,
            arrayCount: 1,
            aToB: true,
          },
          {
            poolIndex: 1,
            startTickIndex: 0,
            arrayCount: 3,
            aToB: true,
          },
        ],
        initPositionParams: [
          {poolIndex: 0, fundParams: [{tickLowerIndex: -439296 - 256, tickUpperIndex: -439296 - 128, liquidityAmount: new BN(1_000)}]},
          {poolIndex: 1, fundParams: [{tickLowerIndex: 512, tickUpperIndex: 1024, liquidityAmount: new BN(5_000_000_000_000)}]},
        ],
      }]))[0];
      const { tokenAccounts, mintKeys, pools } = aquarium;

      const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
      const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
      let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
      let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);

      const [inputToken, intermediaryToken, outputToken] = mintKeys;
  
      // 1 --> 1
      const quoteSecond = await swapQuoteByOutputToken(
        whirlpoolTwo,
        outputToken,
        new BN(1),
        Percentage.fromFraction(0, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );
  
      // 22337909818 --> 0 (not round up)
      const quoteFirst = await swapQuoteByOutputToken(
        whirlpoolOne,
        intermediaryToken,
        quoteSecond.estimatedAmountIn,
        Percentage.fromFraction(0, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );
    
      const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quoteFirst, quoteSecond);
  
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
            ...twoHopQuote,
            sqrtPriceLimitTwo: new BN(0), // Partial fill is NOT allowed
            ...getParamsFromPools([pools[0], pools[1]], [true, true], tokenAccounts),
            tokenAuthority: ctx.wallet.publicKey,
          }),
        ).buildAndExecute(),
        /0x17a3/,  // IntermediateTokenAmountMismatch
      );
    });

    // Reject partial fill on the second swap by the constraint that second output must be equal to the first input
    // Pools and owner are safe, but owner will receive unconsumed intermediate tokens
    // |-S-***T**-| -> |-S-***T,limit**--| (where *: liquidity, S: start, T: end)
    it("fails ExactIn, partial fill on second swap", async () => {
      const aquarium = (await buildTestAquariumsV2(ctx, [{
        configParams: aqConfig.configParams,
        initFeeTierParams: aqConfig.initFeeTierParams,
        initMintParams: aqConfig.initMintParams,
        initTokenAccParams: [
          {mintIndex: 0, mintAmount: new BN(1_000_000_000_000_000)},
          {mintIndex: 1, mintAmount: new BN(1_000_000_000_000_000)},
          {mintIndex: 2, mintAmount: new BN(1_000_000_000_000_000)},
        ],
        initPoolParams: [
          { ...aqConfig.initPoolParams[0], tickSpacing: 128, initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(1024 + 1) },
          { ...aqConfig.initPoolParams[1], tickSpacing: 128, initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(1024 + 1) },
        ],
        initTickArrayRangeParams: [
          {
            poolIndex: 0,
            startTickIndex: 0,
            arrayCount: 3,
            aToB: true,
          },
          {
            poolIndex: 1,
            startTickIndex: 0,
            arrayCount: 3,
            aToB: true,
          },
        ],
        initPositionParams: [
          {poolIndex: 0, fundParams: [{tickLowerIndex: 512, tickUpperIndex: 1024, liquidityAmount: new BN(1_000_000_000)}]},
          {poolIndex: 1, fundParams: [{tickLowerIndex: 512, tickUpperIndex: 1024, liquidityAmount: new BN(1_000_000_000)}]},
        ],
      }]))[0];
      const { tokenAccounts, mintKeys, pools } = aquarium;

      const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
      const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
      let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
      let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);

      const [inputToken, intermediaryToken, outputToken] = mintKeys;
        
      // 1000000 --> 1103339
      const quoteFirst = await swapQuoteByInputToken(
        whirlpoolOne,
        inputToken,
        new BN(1_000_000),
        Percentage.fromFraction(0, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );

      // 1103339 1217224
      const quoteSecond = await swapQuoteByInputToken(
        whirlpoolTwo,
        intermediaryToken,
        quoteFirst.estimatedAmountOut,
        Percentage.fromFraction(0, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE,
      );
    
      const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quoteFirst, quoteSecond);

      assert.ok(quoteSecond.estimatedEndTickIndex < 1002);
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
            ...twoHopQuote,
            sqrtPriceLimitTwo: PriceMath.tickIndexToSqrtPriceX64(1002), // Partial fill
            ...getParamsFromPools([pools[0], pools[1]], [true, true], tokenAccounts),
            tokenAuthority: ctx.wallet.publicKey,
          }),
        ).buildAndExecute(),
        /0x17a3/,  // IntermediateTokenAmountMismatch
      );

      assert.ok(quoteSecond.estimatedEndTickIndex > 999);
      await toTx(
        ctx,
        WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
          ...twoHopQuote,
          sqrtPriceLimitTwo: PriceMath.tickIndexToSqrtPriceX64(999),
          ...getParamsFromPools([pools[0], pools[1]], [true, true], tokenAccounts),
          tokenAuthority: ctx.wallet.publicKey,
        }),
      ).buildAndExecute();

    });
  });

  async function rejectParams(
    params: TwoHopSwapV2Params,
    error: assert.AssertPredicate,
  ) {
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.twoHopSwapV2Ix(ctx.program, params),
      ).buildAndExecute(),
      error,
    );
  }

  function getParamsFromPools(
    pools: [InitPoolV2Params, InitPoolV2Params],
    aToBs: boolean[],
    tokenAccounts: {
      mint: PublicKey;
      account: PublicKey;
      tokenTrait: TokenTrait;
    }[],
  ) {
    const [aToBOne, aToBTwo] = aToBs;
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
    const oracleOne = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolOne,
    ).publicKey;
    const oracleTwo = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolTwo,
    ).publicKey;
    return {
      whirlpoolOne: pools[0].whirlpoolPda.publicKey,
      whirlpoolTwo: pools[1].whirlpoolPda.publicKey,
      oracleOne,
      oracleTwo,
      // mints
      tokenMintInput: aToBOne ? tokenMintOneA : tokenMintOneB,
      tokenMintIntermediate: aToBOne ? tokenMintOneB : tokenMintOneA,
      tokenMintOutput: aToBTwo ? tokenMintTwoB : tokenMintTwoA,
      // token programs
      tokenProgramInput: aToBOne ? tokenProgramOneA : tokenProgramOneB,
      tokenProgramIntermediate: aToBOne ? tokenProgramOneB : tokenProgramOneA,
      tokenProgramOutput: aToBTwo ? tokenProgramTwoB : tokenProgramTwoA,
      // accounts
      tokenOwnerAccountInput: aToBOne ? tokenAccKeys[0] : tokenAccKeys[1],
      tokenVaultOneInput: aToBOne
        ? pools[0].tokenVaultAKeypair.publicKey
        : pools[0].tokenVaultBKeypair.publicKey,
      tokenVaultOneIntermediate: aToBOne
        ? pools[0].tokenVaultBKeypair.publicKey
        : pools[0].tokenVaultAKeypair.publicKey,
      tokenVaultTwoIntermediate: aToBTwo
        ? pools[1].tokenVaultAKeypair.publicKey
        : pools[1].tokenVaultBKeypair.publicKey,
      tokenVaultTwoOutput: aToBTwo
        ? pools[1].tokenVaultBKeypair.publicKey
        : pools[1].tokenVaultAKeypair.publicKey,
      tokenOwnerAccountOutput: aToBTwo ? tokenAccKeys[3] : tokenAccKeys[2],
    };
  }

  async function getTokenBalancesForVaults(pools: InitPoolParams[]) {
    const accs: PublicKey[] = [];
    for (const pool of pools) {
      accs.push(pool.tokenVaultAKeypair.publicKey);
      accs.push(pool.tokenVaultBKeypair.publicKey);
    }
    return getTokenBalances(accs);
  }

  async function getTokenBalances(keys: PublicKey[]) {
    return Promise.all(
      keys.map(
        async (key) => new anchor.BN(await getTokenBalance(provider, key)),
      ),
    );
  }
});
