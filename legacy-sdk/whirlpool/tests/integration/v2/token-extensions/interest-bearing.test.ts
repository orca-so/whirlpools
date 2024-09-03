import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import type { PDA } from "@orca-so/common-sdk";
import { MathUtil, Percentage } from "@orca-so/common-sdk";
import * as assert from "assert";
import Decimal from "decimal.js";
import type {
  DecreaseLiquidityQuote,
  InitPoolV2Params,
  PositionData,
  SwapQuote,
  TwoHopSwapV2Params,
  WhirlpoolData,
} from "../../../../src";
import {
  buildWhirlpoolClient,
  collectRewardsQuote,
  decreaseLiquidityQuoteByLiquidityWithParams,
  NUM_REWARDS,
  PDAUtil,
  swapQuoteWithParams,
  SwapUtils,
  toTx,
  twoHopSwapQuoteFromSwapQuotes,
  WhirlpoolContext,
  WhirlpoolIx,
} from "../../../../src";
import { IGNORE_CACHE } from "../../../../src/network/public/fetcher";
import { getTokenBalance, sleep, TickSpacing, ZERO_BN } from "../../../utils";
import { defaultConfirmOptions } from "../../../utils/const";
import { WhirlpoolTestFixtureV2 } from "../../../utils/v2/fixture-v2";
import type { FundedPositionV2Params } from "../../../utils/v2/init-utils-v2";
import {
  fundPositionsV2,
  initTestPoolWithTokensV2,
} from "../../../utils/v2/init-utils-v2";
import {
  createTokenAccountV2,
  disableRequiredMemoTransfers,
  enableRequiredMemoTransfers,
  isRequiredMemoTransfersEnabled,
} from "../../../utils/v2/token-2022";
import type { PublicKey } from "@solana/web3.js";
import { initTickArrayRange } from "../../../utils/init-utils";
import type { InitAquariumV2Params } from "../../../utils/v2/aquarium-v2";
import {
  buildTestAquariumsV2,
  getDefaultAquariumV2,
  getTokenAccsForPoolsV2,
} from "../../../utils/v2/aquarium-v2";
import { TokenExtensionUtil } from "../../../../src/utils/public/token-extension-util";

describe("TokenExtension/InterestBearing", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);

  it("swap_v2", async () => {
    const {
      whirlpoolPda,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
    } = await initTestPoolWithTokensV2(
      ctx,
      { isToken2022: true, hasInterestBearingExtension: true, interestBearingRate: 10_000 },
      { isToken2022: true, hasInterestBearingExtension: true, interestBearingRate: 10_000 },
      TickSpacing.Standard,
    );

    const aToB = false;
    await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528, // to 33792
      3,
      TickSpacing.Standard,
      aToB,
    );

    const fundParams: FundedPositionV2Params[] = [
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ];

    await fundPositionsV2(
      ctx,
      poolInitInfo,
      tokenAccountA,
      tokenAccountB,
      fundParams,
    );

    const oraclePubkey = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    ).publicKey;

    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolData = (await fetcher.getPool(
      whirlpoolKey,
      IGNORE_CACHE,
    )) as WhirlpoolData;

    const quoteAToB = swapQuoteWithParams(
      {
        amountSpecifiedIsInput: true,
        aToB: true,
        tokenAmount: new BN(100000),
        otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
        sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(true),
        whirlpoolData,
        tickArrays: await SwapUtils.getTickArrays(
          whirlpoolData.tickCurrentIndex,
          whirlpoolData.tickSpacing,
          true,
          ctx.program.programId,
          whirlpoolKey,
          fetcher,
          IGNORE_CACHE,
        ),
        tokenExtensionCtx:
          await TokenExtensionUtil.buildTokenExtensionContext(
            fetcher,
            whirlpoolData,
            IGNORE_CACHE,
          ),
      },
      Percentage.fromFraction(100, 100), // 100% slippage
    );

    const quoteBToA = swapQuoteWithParams(
      {
        amountSpecifiedIsInput: true,
        aToB: false,
        tokenAmount: new BN(100000),
        otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
        sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(false),
        whirlpoolData,
        tickArrays: await SwapUtils.getTickArrays(
          whirlpoolData.tickCurrentIndex,
          whirlpoolData.tickSpacing,
          false,
          ctx.program.programId,
          whirlpoolKey,
          fetcher,
          IGNORE_CACHE,
        ),
        tokenExtensionCtx:
          await TokenExtensionUtil.buildTokenExtensionContext(
            fetcher,
            whirlpoolData,
            IGNORE_CACHE,
          ),
      },
      Percentage.fromFraction(100, 100), // 100% slippage
    );

    const balanceA0 = new BN(await getTokenBalance(provider, tokenAccountA));
    const balanceB0 = new BN(await getTokenBalance(provider, tokenAccountB));

    const sigBToA = await toTx(
      ctx,
      WhirlpoolIx.swapV2Ix(ctx.program, {
        ...quoteBToA,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenMintA: poolInitInfo.tokenMintA,
        tokenMintB: poolInitInfo.tokenMintB,
        tokenProgramA: poolInitInfo.tokenProgramA,
        tokenProgramB: poolInitInfo.tokenProgramB,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        oracle: oraclePubkey,
      }),
    ).buildAndExecute();

    const balanceA1 = new BN(await getTokenBalance(provider, tokenAccountA));
    const balanceB1 = new BN(await getTokenBalance(provider, tokenAccountB));
    assert.ok(balanceB1.lt(balanceB0));
    assert.ok(balanceA1.gt(balanceA0));


  });

});
