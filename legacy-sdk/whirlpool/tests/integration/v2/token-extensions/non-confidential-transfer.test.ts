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
  NO_ORACLE_DATA,
  NUM_REWARDS,
  PDAUtil,
  PoolUtil,
  PriceMath,
  swapQuoteWithParams,
  SwapUtils,
  toTokenAmount,
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
  useMaxCU,
} from "../../../utils/v2/init-utils-v2";
import { createTokenAccountV2 } from "../../../utils/v2/token-2022";
import type { PublicKey } from "@solana/web3.js";
import { initTickArrayRange } from "../../../utils/init-utils";
import type { InitAquariumV2Params } from "../../../utils/v2/aquarium-v2";
import {
  buildTestAquariumsV2,
  getDefaultAquariumV2,
  getTokenAccsForPoolsV2,
} from "../../../utils/v2/aquarium-v2";
import { hasConfidentialTransferMintExtension } from "../../../utils/v2/confidential-transfer";
import { TokenExtensionUtil } from "../../../../src/utils/public/token-extension-util";

describe("TokenExtension/ConfidentialTransfer (NON confidential transfer only)", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);

  describe("collect_fees_v2, collect_protocol_fees_v2", () => {
    let fixture: WhirlpoolTestFixtureV2;
    let feeAccountA: PublicKey;
    let feeAccountB: PublicKey;

    beforeEach(async () => {
      // In same tick array - start index 22528
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;

      const tickSpacing = TickSpacing.Standard;
      fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: {
          isToken2022: true,
          hasConfidentialTransferExtension: true,
        },
        tokenTraitB: {
          isToken2022: true,
          hasConfidentialTransferExtension: true,
        },
        tickSpacing,
        positions: [
          {
            tickLowerIndex,
            tickUpperIndex,
            liquidityAmount: new anchor.BN(10_000_000),
          }, // In range position
          {
            tickLowerIndex: 0,
            tickUpperIndex: 128,
            liquidityAmount: new anchor.BN(1_000_000),
          }, // Out of range position
        ],
      });
      const {
        poolInitInfo: {
          whirlpoolPda,
          tokenVaultAKeypair,
          tokenVaultBKeypair,
          tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
        },
        tokenAccountA,
        tokenAccountB,
        positions,
      } = fixture.getInfos();

      const tickArrayPda = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpoolPda.publicKey,
        22528,
      );
      const oraclePda = PDAUtil.getOracle(
        ctx.program.programId,
        whirlpoolPda.publicKey,
      );

      // Accrue fees in token A
      await toTx(
        ctx,
        WhirlpoolIx.swapV2Ix(ctx.program, {
          amount: new BN(200_000),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(4)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tickArray0: tickArrayPda.publicKey,
          tickArray1: tickArrayPda.publicKey,
          tickArray2: tickArrayPda.publicKey,
          oracle: oraclePda.publicKey,
        }),
      )
        .prependInstruction(useMaxCU())
        .buildAndExecute();

      // Accrue fees in token B
      await toTx(
        ctx,
        WhirlpoolIx.swapV2Ix(ctx.program, {
          amount: new BN(200_000),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(5)),
          amountSpecifiedIsInput: true,
          aToB: false,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tickArray0: tickArrayPda.publicKey,
          tickArray1: tickArrayPda.publicKey,
          tickArray2: tickArrayPda.publicKey,
          oracle: oraclePda.publicKey,
        }),
      )
        .prependInstruction(useMaxCU())
        .buildAndExecute();

      await toTx(
        ctx,
        WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          position: positions[0].publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        }),
      ).buildAndExecute();

      const whirlpoolData = (await fetcher.getPool(
        whirlpoolPda.publicKey,
        IGNORE_CACHE,
      ))!;
      assert.ok(!whirlpoolData.protocolFeeOwedA.isZero());
      assert.ok(!whirlpoolData.protocolFeeOwedB.isZero());

      const positionBeforeCollect = (await fetcher.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      assert.ok(!positionBeforeCollect.feeOwedA.isZero());
      assert.ok(!positionBeforeCollect.feeOwedB.isZero());

      feeAccountA = await createTokenAccountV2(
        provider,
        { isToken2022: true },
        tokenMintA,
        provider.wallet.publicKey,
      );
      feeAccountB = await createTokenAccountV2(
        provider,
        { isToken2022: true },
        tokenMintB,
        provider.wallet.publicKey,
      );
    });

    it("collect_fees_v2: non confidential transfer", async () => {
      const {
        poolInitInfo: {
          whirlpoolPda,
          tokenVaultAKeypair,
          tokenVaultBKeypair,
          tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
        },
        positions,
      } = fixture.getInfos();

      assert.ok(
        await hasConfidentialTransferMintExtension(provider, tokenMintA),
      );
      assert.ok(
        await hasConfidentialTransferMintExtension(provider, tokenMintB),
      );

      await toTx(
        ctx,
        WhirlpoolIx.collectFeesV2Ix(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
          tokenOwnerAccountA: feeAccountA,
          tokenOwnerAccountB: feeAccountB,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
        }),
      ).buildAndExecute();

      const feeBalanceA = await getTokenBalance(provider, feeAccountA);
      const feeBalanceB = await getTokenBalance(provider, feeAccountB);
      assert.ok(new BN(feeBalanceA).gtn(0));
      assert.ok(new BN(feeBalanceB).gtn(0));
    });

    it("collect_protocol_fees_v2: non confidential transfer", async () => {
      const {
        poolInitInfo: {
          whirlpoolPda,
          tokenVaultAKeypair,
          tokenVaultBKeypair,
          tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
        },
        configKeypairs: { collectProtocolFeesAuthorityKeypair },
        configInitInfo: { whirlpoolsConfigKeypair: whirlpoolsConfigKeypair },
      } = fixture.getInfos();

      assert.ok(
        await hasConfidentialTransferMintExtension(provider, tokenMintA),
      );
      assert.ok(
        await hasConfidentialTransferMintExtension(provider, tokenMintB),
      );

      await toTx(
        ctx,
        WhirlpoolIx.collectProtocolFeesV2Ix(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority:
            collectProtocolFeesAuthorityKeypair.publicKey,
          tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tokenOwnerAccountA: feeAccountA,
          tokenOwnerAccountB: feeAccountB,
        }),
      )
        .addSigner(collectProtocolFeesAuthorityKeypair)
        .buildAndExecute();
      const feeBalanceA = await getTokenBalance(provider, feeAccountA);
      const feeBalanceB = await getTokenBalance(provider, feeAccountB);
      assert.ok(new BN(feeBalanceA).gtn(0));
      assert.ok(new BN(feeBalanceB).gtn(0));
    });
  });

  describe("collect_reward_v2", () => {
    let fixture: WhirlpoolTestFixtureV2;
    let rewardAccounts: PublicKey[];

    beforeEach(async () => {
      const vaultStartBalance = 1_000_000;
      const lowerTickIndex = -1280,
        upperTickIndex = 1280,
        tickSpacing = TickSpacing.Standard;
      fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing: tickSpacing,
        initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
        positions: [
          {
            tickLowerIndex: lowerTickIndex,
            tickUpperIndex: upperTickIndex,
            liquidityAmount: new anchor.BN(1_000_000),
          },
        ],
        rewards: [
          {
            rewardTokenTrait: {
              isToken2022: true,
              hasConfidentialTransferExtension: true,
            },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: {
              isToken2022: true,
              hasConfidentialTransferExtension: true,
            },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: {
              isToken2022: true,
              hasConfidentialTransferExtension: true,
            },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
        ],
      });
      const {
        poolInitInfo: { whirlpoolPda },
        positions,
        rewards,
      } = fixture.getInfos();

      // accrue rewards
      await sleep(3000);

      await toTx(
        ctx,
        WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          position: positions[0].publicKey,
          tickArrayLower: positions[0].tickArrayLower,
          tickArrayUpper: positions[0].tickArrayUpper,
        }),
      ).buildAndExecute();

      // Generate collect reward expectation
      const whirlpoolData = (await fetcher.getPool(
        whirlpoolPda.publicKey,
      )) as WhirlpoolData;
      const positionPreCollect = await client.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      );

      // Lock the collectRewards quote to the last time we called updateFeesAndRewards
      const expectation = collectRewardsQuote({
        whirlpool: whirlpoolData,
        position: positionPreCollect.getData(),
        tickLower: positionPreCollect.getLowerTickData(),
        tickUpper: positionPreCollect.getUpperTickData(),
        timeStampInSeconds: whirlpoolData.rewardLastUpdatedTimestamp,
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
          fetcher,
          whirlpoolData,
          IGNORE_CACHE,
        ),
      });

      // Check that the expectation is not zero
      for (let i = 0; i < NUM_REWARDS; i++) {
        assert.ok(!expectation.rewardOwed[i]!.isZero());
      }

      rewardAccounts = await Promise.all(
        rewards.map((reward) => {
          return createTokenAccountV2(
            provider,
            { isToken2022: true },
            reward.rewardMint,
            provider.wallet.publicKey,
          );
        }),
      );
    });

    it("collect_reward_v2: non confidential transfer", async () => {
      const {
        poolInitInfo: { whirlpoolPda },
        positions,
        rewards,
      } = fixture.getInfos();

      for (let i = 0; i < NUM_REWARDS; i++) {
        assert.ok(
          hasConfidentialTransferMintExtension(provider, rewards[i].rewardMint),
        );

        await toTx(
          ctx,
          WhirlpoolIx.collectRewardV2Ix(ctx.program, {
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positions[0].publicKey,
            positionTokenAccount: positions[0].tokenAccount,
            rewardMint: rewards[i].rewardMint,
            rewardTokenProgram: rewards[i].tokenProgram,
            rewardOwnerAccount: rewardAccounts[i],
            rewardVault: rewards[i].rewardVaultKeypair.publicKey,
            rewardIndex: i,
          }),
        ).buildAndExecute();
        const rewardBalance = await getTokenBalance(
          provider,
          rewardAccounts[i],
        );
        assert.ok(new BN(rewardBalance).gtn(0));
      }
    });
  });

  describe("increase_liquidity_v2", () => {
    const tickLowerIndex = 7168;
    const tickUpperIndex = 8960;
    const currTick = Math.round((tickLowerIndex + tickUpperIndex) / 2);

    let fixture: WhirlpoolTestFixtureV2;

    beforeEach(async () => {
      fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: {
          isToken2022: true,
          hasConfidentialTransferExtension: true,
        },
        tokenTraitB: {
          isToken2022: true,
          hasConfidentialTransferExtension: true,
        },
        tickSpacing: TickSpacing.Standard,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
        ],
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
      });
    });

    it("increase_liquidity_v2: non confidential transfer", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const positionInitInfo = positions[0];

      const tokenAmount = toTokenAmount(1_000_000, 1_000_000);
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount,
      );

      assert.ok(
        await hasConfidentialTransferMintExtension(
          provider,
          poolInitInfo.tokenMintA,
        ),
      );
      assert.ok(
        await hasConfidentialTransferMintExtension(
          provider,
          poolInitInfo.tokenMintB,
        ),
      );

      const preVaultBalanceA = await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      );
      const preVaultBalanceB = await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      );

      await toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
          liquidityAmount,
          tokenMaxA: tokenAmount.tokenA,
          tokenMaxB: tokenAmount.tokenB,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positionInitInfo.publicKey,
          positionTokenAccount: positionInitInfo.tokenAccount,
          tokenMintA: poolInitInfo.tokenMintA,
          tokenMintB: poolInitInfo.tokenMintB,
          tokenProgramA: poolInitInfo.tokenProgramA,
          tokenProgramB: poolInitInfo.tokenProgramB,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: positionInitInfo.tickArrayLower,
          tickArrayUpper: positionInitInfo.tickArrayUpper,
        }),
      ).buildAndExecute();

      const postVaultBalanceA = await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      );
      const postVaultBalanceB = await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      );
      assert.ok(new BN(postVaultBalanceA).gt(new BN(preVaultBalanceA)));
      assert.ok(new BN(postVaultBalanceB).gt(new BN(preVaultBalanceB)));
    });
  });

  describe("decrease_liquidity_v2", () => {
    let fixture: WhirlpoolTestFixtureV2;
    let removalQuote: DecreaseLiquidityQuote;
    let destAccountA: PublicKey;
    let destAccountB: PublicKey;

    beforeEach(async () => {
      const liquidityAmount = new anchor.BN(1_250_000);
      const tickLower = 7168,
        tickUpper = 8960;
      fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: {
          isToken2022: true,
          hasConfidentialTransferExtension: true,
        },
        tokenTraitB: {
          isToken2022: true,
          hasConfidentialTransferExtension: true,
        },
        tickSpacing: TickSpacing.Standard,
        initialSqrtPrice: MathUtil.toX64(new Decimal(1.48)),
        positions: [
          {
            tickLowerIndex: tickLower,
            tickUpperIndex: tickUpper,
            liquidityAmount,
          },
        ],
      });
      const { poolInitInfo } = fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const poolBefore = (await fetcher.getPool(
        whirlpoolPda.publicKey,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
        liquidity: new anchor.BN(1_000_000),
        sqrtPrice: poolBefore.sqrtPrice,
        slippageTolerance: Percentage.fromFraction(1, 100),
        tickCurrentIndex: poolBefore.tickCurrentIndex,
        tickLowerIndex: tickLower,
        tickUpperIndex: tickUpper,
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
          fetcher,
          poolBefore,
          IGNORE_CACHE,
        ),
      });
      assert.ok(!removalQuote.tokenEstA.isZero());
      assert.ok(!removalQuote.tokenEstB.isZero());

      destAccountA = await createTokenAccountV2(
        provider,
        { isToken2022: true },
        poolInitInfo.tokenMintA,
        provider.wallet.publicKey,
      );
      destAccountB = await createTokenAccountV2(
        provider,
        { isToken2022: true },
        poolInitInfo.tokenMintB,
        provider.wallet.publicKey,
      );
    });

    it("decrease_liquidity_v2: non confidential transfer", async () => {
      const { poolInitInfo, positions } = fixture.getInfos();

      assert.ok(
        await hasConfidentialTransferMintExtension(
          provider,
          poolInitInfo.tokenMintA,
        ),
      );
      assert.ok(
        await hasConfidentialTransferMintExtension(
          provider,
          poolInitInfo.tokenMintB,
        ),
      );

      await toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
          ...removalQuote,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          tokenMintA: poolInitInfo.tokenMintA,
          tokenMintB: poolInitInfo.tokenMintB,
          tokenProgramA: poolInitInfo.tokenProgramA,
          tokenProgramB: poolInitInfo.tokenProgramB,
          tokenOwnerAccountA: destAccountA,
          tokenOwnerAccountB: destAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: positions[0].tickArrayLower,
          tickArrayUpper: positions[0].tickArrayUpper,
        }),
      ).buildAndExecute();
      const destBalanceA = await getTokenBalance(provider, destAccountA);
      const destBalanceB = await getTokenBalance(provider, destAccountB);
      assert.ok(new BN(destBalanceA).gtn(0));
      assert.ok(new BN(destBalanceB).gtn(0));
    });
  });

  describe("swap_v2", () => {
    let poolInitInfo: InitPoolV2Params;
    let whirlpoolPda: PDA;
    let tokenAccountA: PublicKey;
    let tokenAccountB: PublicKey;
    let oraclePubkey: PublicKey;
    let quoteAToB: SwapQuote;
    let quoteBToA: SwapQuote;

    beforeEach(async () => {
      const init = await initTestPoolWithTokensV2(
        ctx,
        { isToken2022: true, hasConfidentialTransferExtension: true },
        { isToken2022: true, hasConfidentialTransferExtension: true },
        TickSpacing.Standard,
      );
      poolInitInfo = init.poolInitInfo;
      whirlpoolPda = init.whirlpoolPda;
      tokenAccountA = init.tokenAccountA;
      tokenAccountB = init.tokenAccountB;

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

      oraclePubkey = PDAUtil.getOracle(
        ctx.program.programId,
        whirlpoolPda.publicKey,
      ).publicKey;

      const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
      const whirlpoolData = (await fetcher.getPool(
        whirlpoolKey,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      quoteAToB = swapQuoteWithParams(
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
          oracleData: NO_ORACLE_DATA,
        },
        Percentage.fromFraction(100, 100), // 100% slippage
      );

      quoteBToA = swapQuoteWithParams(
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
          oracleData: NO_ORACLE_DATA,
        },
        Percentage.fromFraction(100, 100), // 100% slippage
      );
    });

    it("swap_v2: non confidential transfer, a to b", async () => {
      assert.ok(
        await hasConfidentialTransferMintExtension(
          provider,
          poolInitInfo.tokenMintA,
        ),
      );
      assert.ok(
        await hasConfidentialTransferMintExtension(
          provider,
          poolInitInfo.tokenMintB,
        ),
      );

      const preBalanceA = new BN(
        await getTokenBalance(provider, tokenAccountA),
      );
      const preBalanceB = new BN(
        await getTokenBalance(provider, tokenAccountB),
      );

      await toTx(
        ctx,
        WhirlpoolIx.swapV2Ix(ctx.program, {
          ...quoteAToB,
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

      const postBalanceA = new BN(
        await getTokenBalance(provider, tokenAccountA),
      );
      const postBalanceB = new BN(
        await getTokenBalance(provider, tokenAccountB),
      );
      assert.ok(postBalanceA.lt(preBalanceA));
      assert.ok(postBalanceB.gt(preBalanceB));
    });

    it("swap_v2: non confidential transfer, b to a", async () => {
      assert.ok(
        await hasConfidentialTransferMintExtension(
          provider,
          poolInitInfo.tokenMintA,
        ),
      );
      assert.ok(
        await hasConfidentialTransferMintExtension(
          provider,
          poolInitInfo.tokenMintB,
        ),
      );

      const preBalanceA = new BN(
        await getTokenBalance(provider, tokenAccountA),
      );
      const preBalanceB = new BN(
        await getTokenBalance(provider, tokenAccountB),
      );

      await toTx(
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

      const postBalanceA = new BN(
        await getTokenBalance(provider, tokenAccountA),
      );
      const postBalanceB = new BN(
        await getTokenBalance(provider, tokenAccountB),
      );
      assert.ok(postBalanceA.gt(preBalanceA));
      assert.ok(postBalanceB.lt(preBalanceB));
    });
  });

  describe("two_hop_swap", () => {
    let aqConfig: InitAquariumV2Params;
    let baseIxParams: TwoHopSwapV2Params;
    let tokenAccountIn: PublicKey;
    let tokenAccountOut: PublicKey;

    beforeEach(async () => {
      aqConfig = getDefaultAquariumV2();
      // Add a third token and account and a second pool
      aqConfig.initMintParams = [
        {
          tokenTrait: {
            isToken2022: true,
            hasConfidentialTransferExtension: true,
          },
        },
        {
          tokenTrait: {
            isToken2022: true,
            hasConfidentialTransferExtension: true,
          },
        },
        {
          tokenTrait: {
            isToken2022: true,
            hasConfidentialTransferExtension: true,
          },
        },
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
            IGNORE_CACHE,
          ),
          tokenExtensionCtx:
            await TokenExtensionUtil.buildTokenExtensionContext(
              fetcher,
              whirlpoolDataOne,
              IGNORE_CACHE,
            ),
          oracleData: NO_ORACLE_DATA,
        },
        Percentage.fromFraction(1, 100),
      );

      const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(intermediaryToken);
      const quote2 = swapQuoteWithParams(
        {
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
            IGNORE_CACHE,
          ),
          tokenExtensionCtx:
            await TokenExtensionUtil.buildTokenExtensionContext(
              fetcher,
              whirlpoolDataTwo,
              IGNORE_CACHE,
            ),
          oracleData: NO_ORACLE_DATA,
        },
        Percentage.fromFraction(1, 100),
      );

      const tokenAccKeys = getTokenAccsForPoolsV2(pools, tokenAccounts);
      const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);
      baseIxParams = {
        ...twoHopQuote,
        tokenAuthority: ctx.wallet.publicKey,
        whirlpoolOne: pools[0].whirlpoolPda.publicKey,
        whirlpoolTwo: pools[1].whirlpoolPda.publicKey,
        tokenMintInput: twoHopQuote.aToBOne
          ? pools[0].tokenMintA
          : pools[0].tokenMintB,
        tokenMintIntermediate: twoHopQuote.aToBOne
          ? pools[0].tokenMintB
          : pools[0].tokenMintA,
        tokenMintOutput: twoHopQuote.aToBTwo
          ? pools[1].tokenMintB
          : pools[1].tokenMintA,
        tokenProgramInput: twoHopQuote.aToBOne
          ? pools[0].tokenProgramA
          : pools[0].tokenProgramB,
        tokenProgramIntermediate: twoHopQuote.aToBOne
          ? pools[0].tokenProgramB
          : pools[0].tokenProgramA,
        tokenProgramOutput: twoHopQuote.aToBTwo
          ? pools[1].tokenProgramB
          : pools[1].tokenProgramA,
        tokenOwnerAccountInput: twoHopQuote.aToBOne
          ? tokenAccKeys[0]
          : tokenAccKeys[1],
        tokenOwnerAccountOutput: twoHopQuote.aToBTwo
          ? tokenAccKeys[3]
          : tokenAccKeys[2],
        tokenVaultOneInput: twoHopQuote.aToBOne
          ? pools[0].tokenVaultAKeypair.publicKey
          : pools[0].tokenVaultBKeypair.publicKey,
        tokenVaultOneIntermediate: twoHopQuote.aToBOne
          ? pools[0].tokenVaultBKeypair.publicKey
          : pools[0].tokenVaultAKeypair.publicKey,
        tokenVaultTwoIntermediate: twoHopQuote.aToBTwo
          ? pools[1].tokenVaultAKeypair.publicKey
          : pools[1].tokenVaultBKeypair.publicKey,
        tokenVaultTwoOutput: twoHopQuote.aToBTwo
          ? pools[1].tokenVaultBKeypair.publicKey
          : pools[1].tokenVaultAKeypair.publicKey,
        oracleOne: PDAUtil.getOracle(
          ctx.program.programId,
          pools[0].whirlpoolPda.publicKey,
        ).publicKey,
        oracleTwo: PDAUtil.getOracle(
          ctx.program.programId,
          pools[1].whirlpoolPda.publicKey,
        ).publicKey,
      };

      tokenAccountIn = baseIxParams.tokenOwnerAccountInput;
      tokenAccountOut = baseIxParams.tokenOwnerAccountOutput;
    });

    it("two_hop_swap_v2: non confidential transfer", async () => {
      const preBalanceIn = new BN(
        await getTokenBalance(provider, tokenAccountIn),
      );
      const preBalanceOut = new BN(
        await getTokenBalance(provider, tokenAccountOut),
      );

      await toTx(
        ctx,
        WhirlpoolIx.twoHopSwapV2Ix(ctx.program, baseIxParams),
      ).buildAndExecute();

      const postBalanceIn = new BN(
        await getTokenBalance(provider, tokenAccountIn),
      );
      const postBalanceOut = new BN(
        await getTokenBalance(provider, tokenAccountOut),
      );
      assert.ok(postBalanceIn.lt(preBalanceIn));
      assert.ok(postBalanceOut.gt(preBalanceOut));
    });
  });
});
