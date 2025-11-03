import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import * as assert from "assert";
import type {
  PositionData,
  WhirlpoolData,
  WhirlpoolContext,
} from "../../../src";
import {
  PoolUtil,
  PriceMath,
  TickUtil,
  toTokenAmount,
  toTx,
  WhirlpoolIx,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import {
  getTokenBalance,
  TEST_TOKEN_2022_PROGRAM_ID,
  TickSpacing,
  ZERO_BN,
} from "../../utils";
import { initializeLiteSVMEnvironment } from "../../utils/litesvm";
import { WhirlpoolTestFixtureV2 } from "../../utils/v2/fixture-v2";
import {
  calculateTransferFeeExcludedAmount,
  calculateTransferFeeIncludedAmount,
  createTokenAccountV2,
} from "../../utils/v2/token-2022";
import type { PublicKey } from "@solana/web3.js";
import {
  hasConfidentialTransferFeeConfigExtension,
  hasConfidentialTransferMintExtension,
} from "../../utils/v2/confidential-transfer";
import type { TransferFee } from "@solana/spl-token";
import { getEpochFee, getMint, getTransferFeeConfig } from "@solana/spl-token";

describe("TokenExtension/ConfidentialTransfer (NON confidential transfer only) + TransferFee", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  // ConfidentialTransfer + TransferFee is combination test
  // We'll test owner to vault transfer by increase liquidity, vault to owner transfer by decrease liquidity

  async function getTransferFee(mint: PublicKey): Promise<TransferFee> {
    const mintData = await getMint(
      provider.connection,
      mint,
      undefined,
      TEST_TOKEN_2022_PROGRAM_ID,
    );
    const transferFeeConfig = getTransferFeeConfig(mintData);
    assert.ok(transferFeeConfig !== null);

    const epochInfo = await provider.connection.getEpochInfo();
    const transferFee = getEpochFee(transferFeeConfig, BigInt(epochInfo.epoch));
    return transferFee;
  }

  describe("increase_liquidity_v2", () => {
    const tickLowerIndex = 7168;
    const tickUpperIndex = 8960;
    const currTick = Math.round((tickLowerIndex + tickUpperIndex) / 2);

    const aboveLowerIndex = TickUtil.getNextInitializableTickIndex(
      currTick + 1,
      TickSpacing.Standard,
    );
    const aboveUpperIndex = tickUpperIndex;
    const belowLowerIndex = tickLowerIndex;
    const belowUpperIndex = TickUtil.getPrevInitializableTickIndex(
      currTick - 1,
      TickSpacing.Standard,
    );

    let fixture: WhirlpoolTestFixtureV2;

    beforeEach(async () => {
      fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: {
          isToken2022: true,
          hasTransferFeeExtension: true,
          hasConfidentialTransferExtension: true,
          transferFeeInitialBps: 500,
        }, // 5%
        tokenTraitB: {
          isToken2022: true,
          hasTransferFeeExtension: true,
          hasConfidentialTransferExtension: true,
          transferFeeInitialBps: 1000,
        }, // 10%
        tickSpacing: TickSpacing.Standard,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
          {
            tickLowerIndex: aboveLowerIndex,
            tickUpperIndex: aboveUpperIndex,
            liquidityAmount: ZERO_BN,
          },
          {
            tickLowerIndex: belowLowerIndex,
            tickUpperIndex: belowUpperIndex,
            liquidityAmount: ZERO_BN,
          },
        ],
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
      });
    });

    it("increase_liquidity_v2: with transfer fee", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } =
        fixture.getInfos();
      const positionInitInfo = positions[0];

      // transfer fee
      const transferFeeA = await getTransferFee(poolInitInfo.tokenMintA);
      const transferFeeB = await getTransferFee(poolInitInfo.tokenMintB);
      assert.equal(transferFeeA.transferFeeBasisPoints, 500); // 5%
      assert.equal(transferFeeB.transferFeeBasisPoints, 1000); // 10%

      // confidential transfer
      assert.equal(
        await hasConfidentialTransferMintExtension(
          provider,
          poolInitInfo.tokenMintA,
        ),
        true,
      );
      assert.equal(
        await hasConfidentialTransferMintExtension(
          provider,
          poolInitInfo.tokenMintB,
        ),
        true,
      );
      // confidential transfer fee config
      assert.equal(
        await hasConfidentialTransferFeeConfigExtension(
          provider,
          poolInitInfo.tokenMintA,
        ),
        true,
      );
      assert.equal(
        await hasConfidentialTransferFeeConfigExtension(
          provider,
          poolInitInfo.tokenMintB,
        ),
        true,
      );

      const tokenAmount = toTokenAmount(1_000_000 * 0.8, 1_000_000 * 0.8);
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount,
      );
      const requiredAmountDelta = PoolUtil.getTokenAmountsFromLiquidity(
        liquidityAmount,
        PriceMath.tickIndexToSqrtPriceX64(currTick),
        PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex),
        PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex),
        true,
      );

      // transfer fee should be non zero
      assert.ok(requiredAmountDelta.tokenA.gtn(0));
      assert.ok(requiredAmountDelta.tokenB.gtn(0));
      const expectedTransferFeeIncludedAmountA =
        calculateTransferFeeIncludedAmount(
          transferFeeA,
          requiredAmountDelta.tokenA,
        );
      const expectedTransferFeeIncludedAmountB =
        calculateTransferFeeIncludedAmount(
          transferFeeB,
          requiredAmountDelta.tokenB,
        );
      assert.ok(expectedTransferFeeIncludedAmountA.fee.gtn(0));
      assert.ok(expectedTransferFeeIncludedAmountB.fee.gtn(0));

      const preVaultBalanceA = new BN(
        await getTokenBalance(
          provider,
          poolInitInfo.tokenVaultAKeypair.publicKey,
        ),
      );
      const preVaultBalanceB = new BN(
        await getTokenBalance(
          provider,
          poolInitInfo.tokenVaultBKeypair.publicKey,
        ),
      );
      const preOwnerAccountBalanceA = new BN(
        await getTokenBalance(provider, tokenAccountA),
      );
      const preOwnerAccountBalanceB = new BN(
        await getTokenBalance(provider, tokenAccountB),
      );

      await toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
          liquidityAmount,
          tokenMaxA: expectedTransferFeeIncludedAmountA.amount,
          tokenMaxB: expectedTransferFeeIncludedAmountB.amount,
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

      const postVaultBalanceA = new BN(
        await getTokenBalance(
          provider,
          poolInitInfo.tokenVaultAKeypair.publicKey,
        ),
      );
      const postVaultBalanceB = new BN(
        await getTokenBalance(
          provider,
          poolInitInfo.tokenVaultBKeypair.publicKey,
        ),
      );
      const postOwnerAccountBalanceA = new BN(
        await getTokenBalance(provider, tokenAccountA),
      );
      const postOwnerAccountBalanceB = new BN(
        await getTokenBalance(provider, tokenAccountB),
      );

      // owner sent requiredAmountDelta plus transfer fees
      assert.ok(
        preOwnerAccountBalanceA
          .sub(postOwnerAccountBalanceA)
          .eq(expectedTransferFeeIncludedAmountA.amount),
      );
      assert.ok(
        preOwnerAccountBalanceB
          .sub(postOwnerAccountBalanceB)
          .eq(expectedTransferFeeIncludedAmountB.amount),
      );
      // vault received requiredAmountDelta
      assert.ok(
        postVaultBalanceA.sub(preVaultBalanceA).eq(requiredAmountDelta.tokenA),
      );
      assert.ok(
        postVaultBalanceB.sub(preVaultBalanceB).eq(requiredAmountDelta.tokenB),
      );
    });
  });

  describe("decrease_liquidity_v2", () => {
    let fixture: WhirlpoolTestFixtureV2;
    let destAccountA: PublicKey;
    let destAccountB: PublicKey;

    const tickLowerIndex = 7168;
    const tickUpperIndex = 8960;
    const currTick = Math.round((tickLowerIndex + tickUpperIndex) / 2);

    const aboveLowerIndex = TickUtil.getNextInitializableTickIndex(
      currTick + 1,
      TickSpacing.Standard,
    );
    const aboveUpperIndex = tickUpperIndex;
    const belowLowerIndex = tickLowerIndex;
    const belowUpperIndex = TickUtil.getPrevInitializableTickIndex(
      currTick - 1,
      TickSpacing.Standard,
    );

    beforeEach(async () => {
      const liquidityAmount = new anchor.BN(1_250_000);
      fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: {
          isToken2022: true,
          hasTransferFeeExtension: true,
          hasConfidentialTransferExtension: true,
          transferFeeInitialBps: 500,
        }, // 5%
        tokenTraitB: {
          isToken2022: true,
          hasTransferFeeExtension: true,
          hasConfidentialTransferExtension: true,
          transferFeeInitialBps: 1000,
        }, // 10%
        tickSpacing: TickSpacing.Standard,
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount },
          {
            tickLowerIndex: aboveLowerIndex,
            tickUpperIndex: aboveUpperIndex,
            liquidityAmount,
          },
          {
            tickLowerIndex: belowLowerIndex,
            tickUpperIndex: belowUpperIndex,
            liquidityAmount,
          },
        ],
      });
      const { poolInitInfo } = fixture.getInfos();

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

    it("decrease_liquidity_v2: with transfer fee", async () => {
      const { poolInitInfo, positions } = fixture.getInfos();

      // transfer fee
      const transferFeeA = await getTransferFee(poolInitInfo.tokenMintA);
      const transferFeeB = await getTransferFee(poolInitInfo.tokenMintB);
      assert.equal(transferFeeA.transferFeeBasisPoints, 500); // 5%
      assert.equal(transferFeeB.transferFeeBasisPoints, 1000); // 10%

      // confidential transfer
      assert.equal(
        await hasConfidentialTransferMintExtension(
          provider,
          poolInitInfo.tokenMintA,
        ),
        true,
      );
      assert.equal(
        await hasConfidentialTransferMintExtension(
          provider,
          poolInitInfo.tokenMintB,
        ),
        true,
      );
      // confidential transfer fee config
      assert.equal(
        await hasConfidentialTransferFeeConfigExtension(
          provider,
          poolInitInfo.tokenMintA,
        ),
        true,
      );
      assert.equal(
        await hasConfidentialTransferFeeConfigExtension(
          provider,
          poolInitInfo.tokenMintB,
        ),
        true,
      );

      const position = positions[0];
      const positionData = (await fetcher.getPosition(
        position.publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      const whirlpoolData = (await fetcher.getPool(
        positionData.whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;
      const expectedAmount = PoolUtil.getTokenAmountsFromLiquidity(
        positionData.liquidity,
        whirlpoolData.sqrtPrice,
        PriceMath.tickIndexToSqrtPriceX64(positionData.tickLowerIndex),
        PriceMath.tickIndexToSqrtPriceX64(positionData.tickUpperIndex),
        false,
      );

      // transfer fee should be non zero
      assert.ok(expectedAmount.tokenA.gtn(0));
      assert.ok(expectedAmount.tokenB.gtn(0));
      const expectedTransferFeeExcludedAmountA =
        calculateTransferFeeExcludedAmount(transferFeeA, expectedAmount.tokenA);
      const expectedTransferFeeExcludedAmountB =
        calculateTransferFeeExcludedAmount(transferFeeB, expectedAmount.tokenB);
      assert.ok(expectedTransferFeeExcludedAmountA.fee.gtn(0));
      assert.ok(expectedTransferFeeExcludedAmountB.fee.gtn(0));

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
        WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
          liquidityAmount: positionData.liquidity,
          tokenMinA: expectedAmount.tokenA.sub(
            expectedTransferFeeExcludedAmountA.fee,
          ),
          tokenMinB: expectedAmount.tokenB.sub(
            expectedTransferFeeExcludedAmountB.fee,
          ),
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: position.publicKey,
          positionTokenAccount: position.tokenAccount,
          tokenMintA: poolInitInfo.tokenMintA,
          tokenMintB: poolInitInfo.tokenMintB,
          tokenProgramA: poolInitInfo.tokenProgramA,
          tokenProgramB: poolInitInfo.tokenProgramB,
          tokenOwnerAccountA: destAccountA,
          tokenOwnerAccountB: destAccountB,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: position.tickArrayLower,
          tickArrayUpper: position.tickArrayUpper,
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
      assert.ok(
        new BN(preVaultBalanceA)
          .sub(new BN(postVaultBalanceA))
          .eq(expectedAmount.tokenA),
      );
      assert.ok(
        new BN(preVaultBalanceB)
          .sub(new BN(postVaultBalanceB))
          .eq(expectedAmount.tokenB),
      );

      // owner received withdrawable amount minus transfer fee (transferFeeExcludedAmount)
      const destBalanceA = await getTokenBalance(provider, destAccountA);
      const destBalanceB = await getTokenBalance(provider, destAccountB);
      //console.info("A", destBalanceA.toString(), expectedTransferFeeExcludedAmountA.amount.toString(), expectedTransferFeeExcludedAmountA.fee.toString());
      //console.info("B", destBalanceB.toString(), expectedTransferFeeExcludedAmountB.amount.toString(), expectedTransferFeeExcludedAmountB.fee.toString());

      assert.ok(
        new BN(destBalanceA).eq(expectedTransferFeeExcludedAmountA.amount),
      );
      assert.ok(
        new BN(destBalanceB).eq(expectedTransferFeeExcludedAmountB.amount),
      );

      // all liquidity have been decreased
      const positionDataAfterWithdraw = (await fetcher.getPosition(
        position.publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      assert.ok(positionDataAfterWithdraw.liquidity.isZero());
    });
  });
});
