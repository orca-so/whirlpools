import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { MathUtil, MintWithTokenProgram, PDA, Percentage, U64_MAX } from "@orca-so/common-sdk";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  collectRewardsQuote,
  DecreaseLiquidityV2Params,
  IncreaseLiquidityV2Params,
  InitPoolV2Params,
  MEMO_PROGRAM_ADDRESS,
  NUM_REWARDS,
  PDAUtil,
  PoolUtil,
  PositionData,
  PriceMath,
  swapQuoteWithParams,
  SwapUtils,
  TickUtil,
  toTokenAmount,
  toTx,
  twoHopSwapQuoteFromSwapQuotes,
  TwoHopSwapV2Params,
  WhirlpoolContext,
  WhirlpoolData,
  WhirlpoolIx,
} from "../../../../src";
import { IGNORE_CACHE } from "../../../../src/network/public/fetcher";
import {
  getTokenBalance,
  sleep,
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TOKEN_PROGRAM_ID,
  TickSpacing,
  ZERO_BN,
} from "../../../utils";
import { defaultConfirmOptions } from "../../../utils/const";
import { WhirlpoolTestFixtureV2 } from "../../../utils/v2/fixture-v2";
import {
  FundedPositionV2Params,
  TokenTrait,
  fundPositionsV2,
  initTestPoolWithTokensV2,
  useMaxCU,
} from "../../../utils/v2/init-utils-v2";
import {
  calculateTransferFeeExcludedAmount,
  calculateTransferFeeIncludedAmount,
  createTokenAccountV2,
} from "../../../utils/v2/token-2022";
import { PublicKey } from "@solana/web3.js";
import { initTickArrayRange } from "../../../utils/init-utils";
import {
  InitAquariumV2Params,
  TestAquarium,
  buildTestAquariumsV2,
  getDefaultAquariumV2,
  getTokenAccsForPoolsV2,
} from "../../../utils/v2/aquarium-v2";
import {
  MAX_FEE_BASIS_POINTS,
  TransferFee,
  TransferFeeConfig,
  getAccount,
  getEpochFee,
  getMint,
  getTransferFeeAmount,
  getTransferFeeConfig,
} from "@solana/spl-token";
import { createSetTransferFeeInstruction } from "../../../utils/v2/transfer-fee";
import { TokenExtensionContext, TokenExtensionUtil } from "../../../../src/utils/public/token-extension-util";

describe("TokenExtension/TransferFee", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);

  const dummyTokenMintWithProgram: MintWithTokenProgram = {
    address: PublicKey.default,
    decimals: 0,
    freezeAuthority: null,
    isInitialized: true,
    mintAuthority: null,
    supply: 1_000_000_000n,
    tlvData: Buffer.from([]),
    tokenProgram: TEST_TOKEN_PROGRAM_ID,
  }

  const withNoExtension: TokenExtensionContext = {
    currentEpoch: 100,
    tokenMintWithProgramA: dummyTokenMintWithProgram,
    tokenMintWithProgramB: dummyTokenMintWithProgram,
    rewardTokenMintsWithProgram: [
      dummyTokenMintWithProgram,
      dummyTokenMintWithProgram,
      dummyTokenMintWithProgram,
    ],
  };

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

  const WAIT_EPOCH_TIMEOUT_MS = 30 * 1000;

  async function getCurrentEpoch(): Promise<number> {
    const epochInfo = await provider.connection.getEpochInfo("confirmed");
    return epochInfo.epoch;
  }

  async function waitEpoch(waitForEpoch: number) {
    const current = await getCurrentEpoch();
    const startWait = Date.now();

    while (Date.now() - startWait < WAIT_EPOCH_TIMEOUT_MS) {
      const epoch = await getCurrentEpoch();
      if (epoch >= waitForEpoch) return;
      sleep(1000);
    }
    throw Error("waitEpoch Timeout, Please set slots_per_epoch smaller in Anchor.toml");
  }

  async function fetchTransferFeeConfig(mint: PublicKey): Promise<TransferFeeConfig> {
    const mintData = await getMint(provider.connection, mint, "confirmed", TEST_TOKEN_2022_PROGRAM_ID);
    const config = getTransferFeeConfig(mintData);
    assert.ok(config !== null);
    return config!;
  }

  async function fetchTransferFeeWithheldAmount(account: PublicKey): Promise<BN> {
    const accountData = await getAccount(provider.connection, account, "confirmed", TEST_TOKEN_2022_PROGRAM_ID);
    const amount = getTransferFeeAmount(accountData);
    assert.ok(amount !== null);
    return new BN(amount.withheldAmount.toString());
  }

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
          hasTransferFeeExtension: true,
          transferFeeInitialBps: 500,
        }, // 5%
        tokenTraitB: {
          isToken2022: true,
          hasTransferFeeExtension: true,
          transferFeeInitialBps: 1000,
        }, // 10%
        tickSpacing,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) }, // In range position
          { tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: new anchor.BN(1_000_000) }, // Out of range position
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
      const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

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
      ).buildAndExecute();

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
      ).buildAndExecute();

      await toTx(
        ctx,
        WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          position: positions[0].publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        }),
      ).buildAndExecute();

      const whirlpoolData = (await fetcher.getPool(whirlpoolPda.publicKey, IGNORE_CACHE))!;
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

    it("collect_fees_v2: with transfer fee", async () => {
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

      const transferFeeA = await getTransferFee(tokenMintA);
      const transferFeeB = await getTransferFee(tokenMintB);
      assert.equal(transferFeeA.transferFeeBasisPoints, 500); // 5%
      assert.equal(transferFeeB.transferFeeBasisPoints, 1000); // 10%

      // feeOwed includes transfer fee
      const positionBeforeCollect = (await fetcher.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      assert.ok(!positionBeforeCollect.feeOwedA.isZero());
      assert.ok(!positionBeforeCollect.feeOwedB.isZero());

      // transfer fee should be non zero
      const expectedTransferFeeExcludedAmountA = calculateTransferFeeExcludedAmount(
        transferFeeA,
        positionBeforeCollect.feeOwedA,
      );
      const expectedTransferFeeExcludedAmountB = calculateTransferFeeExcludedAmount(
        transferFeeB,
        positionBeforeCollect.feeOwedB,
      );
      assert.ok(expectedTransferFeeExcludedAmountA.fee.gtn(0));
      assert.ok(expectedTransferFeeExcludedAmountB.fee.gtn(0));

      const preVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const preVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);

      const sig = await toTx(
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

      // vault sent owed only (transfer fee is paid from owed)
      const postVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const postVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);
      assert.ok(
        new BN(preVaultBalanceA).sub(new BN(postVaultBalanceA)).eq(positionBeforeCollect.feeOwedA),
      );
      assert.ok(
        new BN(preVaultBalanceB).sub(new BN(postVaultBalanceB)).eq(positionBeforeCollect.feeOwedB),
      );

      // owner received feeOwed minus transfer fee (transferFeeExcludedAmount)
      const feeBalanceA = await getTokenBalance(provider, feeAccountA);
      const feeBalanceB = await getTokenBalance(provider, feeAccountB);
      assert.ok(new BN(feeBalanceA).eq(expectedTransferFeeExcludedAmountA.amount));
      assert.ok(new BN(feeBalanceB).eq(expectedTransferFeeExcludedAmountB.amount));

      //console.log("A", positionBeforeCollect.feeOwedA.toString(), feeBalanceA.toString(), expectedTransferFeeExcludedAmountA.amount.toString(), expectedTransferFeeExcludedAmountA.fee.toString());
      //console.log("B", positionBeforeCollect.feeOwedB.toString(), feeBalanceB.toString(), expectedTransferFeeExcludedAmountB.amount.toString(), expectedTransferFeeExcludedAmountB.fee.toString());

      // all owed amount should be collected
      const positionAfterCollect = (await fetcher.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      assert.ok(positionAfterCollect.feeOwedA.isZero());
      assert.ok(positionAfterCollect.feeOwedB.isZero());
    });

    it("collect_fees_v2: feeOwed is zero", async () => {
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

      const transferFeeA = await getTransferFee(tokenMintA);
      const transferFeeB = await getTransferFee(tokenMintB);
      assert.equal(transferFeeA.transferFeeBasisPoints, 500); // 5%
      assert.equal(transferFeeB.transferFeeBasisPoints, 1000); // 10%

      // collect owed fees
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

      // feeOwed includes transfer fee
      const positionBeforeCollect = (await fetcher.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      assert.ok(positionBeforeCollect.feeOwedA.isZero());
      assert.ok(positionBeforeCollect.feeOwedB.isZero());

      // transfer fee should be zero
      const expectedTransferFeeExcludedAmountA = calculateTransferFeeExcludedAmount(
        transferFeeA,
        positionBeforeCollect.feeOwedA,
      );
      const expectedTransferFeeExcludedAmountB = calculateTransferFeeExcludedAmount(
        transferFeeB,
        positionBeforeCollect.feeOwedB,
      );
      assert.ok(expectedTransferFeeExcludedAmountA.fee.isZero());
      assert.ok(expectedTransferFeeExcludedAmountB.fee.isZero());

      const preVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const preVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);
      const preFeeBalanceA = await getTokenBalance(provider, feeAccountA);
      const preFeeBalanceB = await getTokenBalance(provider, feeAccountB);

      const sig = await toTx(
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

      // vault sent owed only (transfer fee is paid from owed)
      const postVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const postVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);
      assert.ok(new BN(preVaultBalanceA).sub(new BN(postVaultBalanceA)).isZero());
      assert.ok(new BN(preVaultBalanceB).sub(new BN(postVaultBalanceB)).isZero());

      const postFeeBalanceA = await getTokenBalance(provider, feeAccountA);
      const postFeeBalanceB = await getTokenBalance(provider, feeAccountB);
      assert.ok(new BN(postFeeBalanceA).sub(new BN(preFeeBalanceA)).isZero());
      assert.ok(new BN(postFeeBalanceB).sub(new BN(preFeeBalanceB)).isZero());
    });

    it("collect_fees_v2: transfer fee rate is 0%", async () => {
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

      // update fee config
      await toTx(ctx, {
        cleanupInstructions: [],
        signers: [], // provider.wallet is authority & payer
        instructions: [
          createSetTransferFeeInstruction(
            tokenMintA,
            0,
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          ),
          createSetTransferFeeInstruction(
            tokenMintB,
            0,
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          )
        ]
      }).buildAndExecute();

      const updatedFeeConfigA = await fetchTransferFeeConfig(tokenMintA);
      const updatedFeeConfigB = await fetchTransferFeeConfig(tokenMintB);
      assert.equal(updatedFeeConfigA.newerTransferFee.transferFeeBasisPoints, 0);
      assert.equal(updatedFeeConfigB.newerTransferFee.transferFeeBasisPoints, 0);

      // wait for epoch to enable updated fee rate
      await waitEpoch(Number(updatedFeeConfigA.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigA.newerTransferFee.epoch);
      await waitEpoch(Number(updatedFeeConfigB.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigB.newerTransferFee.epoch);

      // feeOwed includes transfer fee
      const positionBeforeCollect = (await fetcher.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      assert.ok(!positionBeforeCollect.feeOwedA.isZero());
      assert.ok(!positionBeforeCollect.feeOwedB.isZero());

      // transfer fee should be zero
      const expectedTransferFeeExcludedAmountA = calculateTransferFeeExcludedAmount(
        updatedFeeConfigA.newerTransferFee,
        positionBeforeCollect.feeOwedA,
      );
      const expectedTransferFeeExcludedAmountB = calculateTransferFeeExcludedAmount(
        updatedFeeConfigB.newerTransferFee,
        positionBeforeCollect.feeOwedB,
      );
      assert.ok(expectedTransferFeeExcludedAmountA.amount.eq(positionBeforeCollect.feeOwedA));
      assert.ok(expectedTransferFeeExcludedAmountB.amount.eq(positionBeforeCollect.feeOwedB));
      assert.ok(expectedTransferFeeExcludedAmountA.fee.isZero());
      assert.ok(expectedTransferFeeExcludedAmountB.fee.isZero());

      const preVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const preVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);

      const sig = await toTx(
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

      // vault sent owed only (transfer fee is paid from owed)
      const postVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const postVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);
      assert.ok(
        new BN(preVaultBalanceA).sub(new BN(postVaultBalanceA)).eq(positionBeforeCollect.feeOwedA),
      );
      assert.ok(
        new BN(preVaultBalanceB).sub(new BN(postVaultBalanceB)).eq(positionBeforeCollect.feeOwedB),
      );

      // owner received feeOwed minus transfer fee (transferFeeExcludedAmount)
      const feeBalanceA = await getTokenBalance(provider, feeAccountA);
      const feeBalanceB = await getTokenBalance(provider, feeAccountB);
      assert.ok(new BN(feeBalanceA).eq(expectedTransferFeeExcludedAmountA.amount));
      assert.ok(new BN(feeBalanceB).eq(expectedTransferFeeExcludedAmountB.amount));
    });

    it("collect_fees_v2: transfer fee rate is 100%", async () => {
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

      // update fee config
      await toTx(ctx, {
        cleanupInstructions: [],
        signers: [], // provider.wallet is authority & payer
        instructions: [
          createSetTransferFeeInstruction(
            tokenMintA,
            MAX_FEE_BASIS_POINTS, // 100 %
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          ),
          createSetTransferFeeInstruction(
            tokenMintB,
            MAX_FEE_BASIS_POINTS, // 100 %
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          )
        ]
      }).buildAndExecute();

      const updatedFeeConfigA = await fetchTransferFeeConfig(tokenMintA);
      const updatedFeeConfigB = await fetchTransferFeeConfig(tokenMintB);
      assert.equal(updatedFeeConfigA.newerTransferFee.transferFeeBasisPoints, MAX_FEE_BASIS_POINTS);
      assert.equal(updatedFeeConfigB.newerTransferFee.transferFeeBasisPoints, MAX_FEE_BASIS_POINTS);

      // wait for epoch to enable updated fee rate
      await waitEpoch(Number(updatedFeeConfigA.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigA.newerTransferFee.epoch);
      await waitEpoch(Number(updatedFeeConfigB.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigB.newerTransferFee.epoch);

      // feeOwed includes transfer fee
      const positionBeforeCollect = (await fetcher.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      assert.ok(!positionBeforeCollect.feeOwedA.isZero());
      assert.ok(!positionBeforeCollect.feeOwedB.isZero());

      // transfer fee should be zero
      const expectedTransferFeeExcludedAmountA = calculateTransferFeeExcludedAmount(
        updatedFeeConfigA.newerTransferFee,
        positionBeforeCollect.feeOwedA,
      );
      const expectedTransferFeeExcludedAmountB = calculateTransferFeeExcludedAmount(
        updatedFeeConfigB.newerTransferFee,
        positionBeforeCollect.feeOwedB,
      );
      assert.ok(expectedTransferFeeExcludedAmountA.amount.isZero());
      assert.ok(expectedTransferFeeExcludedAmountB.amount.isZero());
      assert.ok(expectedTransferFeeExcludedAmountA.fee.eq(positionBeforeCollect.feeOwedA));
      assert.ok(expectedTransferFeeExcludedAmountB.fee.eq(positionBeforeCollect.feeOwedB));

      const preVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const preVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);

      const sig = await toTx(
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

      // vault sent owed only (transfer fee is paid from owed)
      const postVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const postVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);
      assert.ok(
        new BN(preVaultBalanceA).sub(new BN(postVaultBalanceA)).eq(positionBeforeCollect.feeOwedA),
      );
      assert.ok(
        new BN(preVaultBalanceB).sub(new BN(postVaultBalanceB)).eq(positionBeforeCollect.feeOwedB),
      );

      // owner received 0 tokens
      const feeBalanceA = await getTokenBalance(provider, feeAccountA);
      const feeBalanceB = await getTokenBalance(provider, feeAccountB);
      assert.ok(new BN(feeBalanceA).isZero());
      assert.ok(new BN(feeBalanceB).isZero());
      // all tokens should be withheld as transfer fee
      const transferFeeWithheldA = await fetchTransferFeeWithheldAmount(feeAccountA);
      const transferFeeWithheldB = await fetchTransferFeeWithheldAmount(feeAccountB);
      assert.ok(transferFeeWithheldA.eq(positionBeforeCollect.feeOwedA));
      assert.ok(transferFeeWithheldB.eq(positionBeforeCollect.feeOwedB));
    });

    it("collect_protocol_fees_v2: with transfer fee", async () => {
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

      const transferFeeA = await getTransferFee(tokenMintA);
      const transferFeeB = await getTransferFee(tokenMintB);
      assert.equal(transferFeeA.transferFeeBasisPoints, 500); // 5%
      assert.equal(transferFeeB.transferFeeBasisPoints, 1000); // 10%

      // protocolFeeOwed includes transfer fee
      const poolBeforeCollect = (await fetcher.getPool(
        whirlpoolPda.publicKey,
        IGNORE_CACHE,
      )) as WhirlpoolData;
      assert.ok(!poolBeforeCollect.protocolFeeOwedA.isZero());
      assert.ok(!poolBeforeCollect.protocolFeeOwedB.isZero());

      // transfer fee should be non zero
      const expectedTransferFeeExcludedAmountA = calculateTransferFeeExcludedAmount(
        transferFeeA,
        poolBeforeCollect.protocolFeeOwedA,
      );
      const expectedTransferFeeExcludedAmountB = calculateTransferFeeExcludedAmount(
        transferFeeB,
        poolBeforeCollect.protocolFeeOwedB,
      );
      assert.ok(expectedTransferFeeExcludedAmountA.fee.gtn(0));
      assert.ok(expectedTransferFeeExcludedAmountB.fee.gtn(0));

      const preVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const preVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);

      const sig = await toTx(
        ctx,
        WhirlpoolIx.collectProtocolFeesV2Ix(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
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

      // vault sent owed only (transfer fee is paid from owed)
      const postVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const postVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);
      assert.ok(
        new BN(preVaultBalanceA)
          .sub(new BN(postVaultBalanceA))
          .eq(poolBeforeCollect.protocolFeeOwedA),
      );
      assert.ok(
        new BN(preVaultBalanceB)
          .sub(new BN(postVaultBalanceB))
          .eq(poolBeforeCollect.protocolFeeOwedB),
      );

      // protocol received feeOwed minus transfer fee (transferFeeExcludedAmount)
      const feeBalanceA = await getTokenBalance(provider, feeAccountA);
      const feeBalanceB = await getTokenBalance(provider, feeAccountB);
      assert.ok(new BN(feeBalanceA).eq(expectedTransferFeeExcludedAmountA.amount));
      assert.ok(new BN(feeBalanceB).eq(expectedTransferFeeExcludedAmountB.amount));

      // all owed amount should be collected
      const poolAfterCollect = (await fetcher.getPool(
        whirlpoolPda.publicKey,
        IGNORE_CACHE,
      )) as WhirlpoolData;
      assert.ok(poolAfterCollect.protocolFeeOwedA.isZero());
      assert.ok(poolAfterCollect.protocolFeeOwedB.isZero());
    });

    it("collect_protocol_fees_v2: protocolFeeOwed is zero", async () => {
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

      // collect
      await toTx(
        ctx,
        WhirlpoolIx.collectProtocolFeesV2Ix(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
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

      const transferFeeA = await getTransferFee(tokenMintA);
      const transferFeeB = await getTransferFee(tokenMintB);
      assert.equal(transferFeeA.transferFeeBasisPoints, 500); // 5%
      assert.equal(transferFeeB.transferFeeBasisPoints, 1000); // 10%

      // protocolFeeOwed includes transfer fee
      const poolBeforeCollect = (await fetcher.getPool(
        whirlpoolPda.publicKey,
        IGNORE_CACHE,
      )) as WhirlpoolData;
      assert.ok(poolBeforeCollect.protocolFeeOwedA.isZero());
      assert.ok(poolBeforeCollect.protocolFeeOwedB.isZero());

      // transfer fee should be zero
      const expectedTransferFeeExcludedAmountA = calculateTransferFeeExcludedAmount(
        transferFeeA,
        poolBeforeCollect.protocolFeeOwedA,
      );
      const expectedTransferFeeExcludedAmountB = calculateTransferFeeExcludedAmount(
        transferFeeB,
        poolBeforeCollect.protocolFeeOwedB,
      );
      assert.ok(expectedTransferFeeExcludedAmountA.amount.isZero());
      assert.ok(expectedTransferFeeExcludedAmountB.amount.isZero());
      assert.ok(expectedTransferFeeExcludedAmountA.fee.isZero());
      assert.ok(expectedTransferFeeExcludedAmountB.fee.isZero());

      const preVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const preVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);
      const preFeeBalanceA = await getTokenBalance(provider, feeAccountA);
      const preFeeBalanceB = await getTokenBalance(provider, feeAccountB);

      const sig = await toTx(
        ctx,
        WhirlpoolIx.collectProtocolFeesV2Ix(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
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

      // vault balance should not change
      const postVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const postVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);
      assert.ok(new BN(preVaultBalanceA).eq(new BN(postVaultBalanceA)));
      assert.ok(new BN(preVaultBalanceB).eq(new BN(postVaultBalanceB)));

      // protocol received 0 tokens
      const postFeeBalanceA = await getTokenBalance(provider, feeAccountA);
      const postFeeBalanceB = await getTokenBalance(provider, feeAccountB);
      assert.ok(new BN(preFeeBalanceA).eq(new BN(postFeeBalanceA)));
      assert.ok(new BN(preFeeBalanceB).eq(new BN(postFeeBalanceB)));
    });

    it("collect_protocol_fees_v2: transfer fee rate is 0%", async () => {
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

      // update fee config
      await toTx(ctx, {
        cleanupInstructions: [],
        signers: [], // provider.wallet is authority & payer
        instructions: [
          createSetTransferFeeInstruction(
            tokenMintA,
            0,
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          ),
          createSetTransferFeeInstruction(
            tokenMintB,
            0,
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          )
        ]
      }).buildAndExecute();

      const updatedFeeConfigA = await fetchTransferFeeConfig(tokenMintA);
      const updatedFeeConfigB = await fetchTransferFeeConfig(tokenMintB);
      assert.equal(updatedFeeConfigA.newerTransferFee.transferFeeBasisPoints, 0);
      assert.equal(updatedFeeConfigB.newerTransferFee.transferFeeBasisPoints, 0);

      // wait for epoch to enable updated fee rate
      await waitEpoch(Number(updatedFeeConfigA.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigA.newerTransferFee.epoch);
      await waitEpoch(Number(updatedFeeConfigB.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigB.newerTransferFee.epoch);

      // protocolFeeOwed includes transfer fee
      const poolBeforeCollect = (await fetcher.getPool(
        whirlpoolPda.publicKey,
        IGNORE_CACHE,
      )) as WhirlpoolData;
      assert.ok(!poolBeforeCollect.protocolFeeOwedA.isZero());
      assert.ok(!poolBeforeCollect.protocolFeeOwedB.isZero());

      // transfer fee should be zero
      const expectedTransferFeeExcludedAmountA = calculateTransferFeeExcludedAmount(
        updatedFeeConfigA.newerTransferFee,
        poolBeforeCollect.protocolFeeOwedA,
      );
      const expectedTransferFeeExcludedAmountB = calculateTransferFeeExcludedAmount(
        updatedFeeConfigB.newerTransferFee,
        poolBeforeCollect.protocolFeeOwedB,
      );
      assert.ok(expectedTransferFeeExcludedAmountA.amount.eq(poolBeforeCollect.protocolFeeOwedA));
      assert.ok(expectedTransferFeeExcludedAmountB.amount.eq(poolBeforeCollect.protocolFeeOwedB));
      assert.ok(expectedTransferFeeExcludedAmountA.fee.isZero());
      assert.ok(expectedTransferFeeExcludedAmountB.fee.isZero());

      const preVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const preVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);
      const preFeeBalanceA = await getTokenBalance(provider, feeAccountA);
      const preFeeBalanceB = await getTokenBalance(provider, feeAccountB);

      const sig = await toTx(
        ctx,
        WhirlpoolIx.collectProtocolFeesV2Ix(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
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

      // vault balance should not change
      const postVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const postVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);
      assert.ok(new BN(preVaultBalanceA).sub(new BN(postVaultBalanceA)).eq(poolBeforeCollect.protocolFeeOwedA));
      assert.ok(new BN(preVaultBalanceB).sub(new BN(postVaultBalanceB)).eq(poolBeforeCollect.protocolFeeOwedB));

      // protocol received all owed amount
      const postFeeBalanceA = await getTokenBalance(provider, feeAccountA);
      const postFeeBalanceB = await getTokenBalance(provider, feeAccountB);
      assert.ok(new BN(postFeeBalanceA).sub(new BN(preFeeBalanceA)).eq(poolBeforeCollect.protocolFeeOwedA));
      assert.ok(new BN(postFeeBalanceB).sub(new BN(preFeeBalanceB)).eq(poolBeforeCollect.protocolFeeOwedB));
    });

    it("collect_protocol_fees_v2: transfer fee rate is 100%", async () => {
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

      // update fee config
      await toTx(ctx, {
        cleanupInstructions: [],
        signers: [], // provider.wallet is authority & payer
        instructions: [
          createSetTransferFeeInstruction(
            tokenMintA,
            MAX_FEE_BASIS_POINTS, // 100 %
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          ),
          createSetTransferFeeInstruction(
            tokenMintB,
            MAX_FEE_BASIS_POINTS, // 100 %
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          )
        ]
      }).buildAndExecute();

      const updatedFeeConfigA = await fetchTransferFeeConfig(tokenMintA);
      const updatedFeeConfigB = await fetchTransferFeeConfig(tokenMintB);
      assert.equal(updatedFeeConfigA.newerTransferFee.transferFeeBasisPoints, MAX_FEE_BASIS_POINTS);
      assert.equal(updatedFeeConfigB.newerTransferFee.transferFeeBasisPoints, MAX_FEE_BASIS_POINTS);

      // wait for epoch to enable updated fee rate
      await waitEpoch(Number(updatedFeeConfigA.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigA.newerTransferFee.epoch);
      await waitEpoch(Number(updatedFeeConfigB.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigB.newerTransferFee.epoch);

      // protocolFeeOwed includes transfer fee
      const poolBeforeCollect = (await fetcher.getPool(
        whirlpoolPda.publicKey,
        IGNORE_CACHE,
      )) as WhirlpoolData;
      assert.ok(!poolBeforeCollect.protocolFeeOwedA.isZero());
      assert.ok(!poolBeforeCollect.protocolFeeOwedB.isZero());

      // transfer fee should be 100%
      const expectedTransferFeeExcludedAmountA = calculateTransferFeeExcludedAmount(
        updatedFeeConfigA.newerTransferFee,
        poolBeforeCollect.protocolFeeOwedA,
      );
      const expectedTransferFeeExcludedAmountB = calculateTransferFeeExcludedAmount(
        updatedFeeConfigB.newerTransferFee,
        poolBeforeCollect.protocolFeeOwedB,
      );
      assert.ok(expectedTransferFeeExcludedAmountA.fee.eq(poolBeforeCollect.protocolFeeOwedA));
      assert.ok(expectedTransferFeeExcludedAmountB.fee.eq(poolBeforeCollect.protocolFeeOwedB));
      assert.ok(expectedTransferFeeExcludedAmountA.amount.isZero());
      assert.ok(expectedTransferFeeExcludedAmountB.amount.isZero());

      const preVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const preVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);

      const sig = await toTx(
        ctx,
        WhirlpoolIx.collectProtocolFeesV2Ix(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
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

      // vault balance should not change
      const postVaultBalanceA = await getTokenBalance(provider, tokenVaultAKeypair.publicKey);
      const postVaultBalanceB = await getTokenBalance(provider, tokenVaultBKeypair.publicKey);
      assert.ok(new BN(preVaultBalanceA).sub(new BN(postVaultBalanceA)).eq(poolBeforeCollect.protocolFeeOwedA));
      assert.ok(new BN(preVaultBalanceB).sub(new BN(postVaultBalanceB)).eq(poolBeforeCollect.protocolFeeOwedB));

      // protocol received 0 tokens
      const feeBalanceA = await getTokenBalance(provider, feeAccountA);
      const feeBalanceB = await getTokenBalance(provider, feeAccountB);
      assert.ok(new BN(feeBalanceA).isZero());
      assert.ok(new BN(feeBalanceB).isZero());
      // all tokens should be withheld as transfer fee
      const transferFeeWithheldA = await fetchTransferFeeWithheldAmount(feeAccountA);
      const transferFeeWithheldB = await fetchTransferFeeWithheldAmount(feeAccountB);
      assert.ok(transferFeeWithheldA.eq(poolBeforeCollect.protocolFeeOwedA));
      assert.ok(transferFeeWithheldB.eq(poolBeforeCollect.protocolFeeOwedB));      
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
              hasTransferFeeExtension: true,
              transferFeeInitialBps: 500,
            }, // 5%
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: {
              isToken2022: true,
              hasTransferFeeExtension: true,
              transferFeeInitialBps: 1000,
            }, // 10%
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: {
              isToken2022: true,
              hasTransferFeeExtension: true,
              transferFeeInitialBps: 5000,
            }, // 50%
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
      const whirlpoolData = (await fetcher.getPool(whirlpoolPda.publicKey)) as WhirlpoolData;
      const positionPreCollect = await client.getPosition(positions[0].publicKey, IGNORE_CACHE);

      // Lock the collectRewards quote to the last time we called updateFeesAndRewards
      const expectation = collectRewardsQuote({
        whirlpool: whirlpoolData,
        position: positionPreCollect.getData(),
        tickLower: positionPreCollect.getLowerTickData(),
        tickUpper: positionPreCollect.getUpperTickData(),
        timeStampInSeconds: whirlpoolData.rewardLastUpdatedTimestamp,
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(fetcher, whirlpoolData, IGNORE_CACHE),
      });

      // Check that the expectation is not zero
      for (let i = 0; i < NUM_REWARDS; i++) {
        assert.ok(!expectation.rewardOwed[i]!.isZero());
        assert.ok(!expectation.transferFee.deductedFromRewardOwed[i]!.isZero());
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

    it("collect_reward_v2: with transfer fee", async () => {
      const {
        poolInitInfo: { whirlpoolPda },
        positions,
        rewards,
      } = fixture.getInfos();

      const whirlpoolData = (await fetcher.getPool(whirlpoolPda.publicKey)) as WhirlpoolData;
      const positionPreCollect = await client.getPosition(positions[0].publicKey, IGNORE_CACHE);
      const expectation = collectRewardsQuote({
        whirlpool: whirlpoolData,
        position: positionPreCollect.getData(),
        tickLower: positionPreCollect.getLowerTickData(),
        tickUpper: positionPreCollect.getUpperTickData(),
        timeStampInSeconds: whirlpoolData.rewardLastUpdatedTimestamp,
        tokenExtensionCtx: withNoExtension, // no TransferFee consideration because it is taken into account later
      });

      for (let i = 0; i < NUM_REWARDS; i++) {
        const transferFee = await getTransferFee(rewards[i].rewardMint);
        assert.equal(transferFee.transferFeeBasisPoints, [500, 1000, 5000][i]);

        // expectation include transfer fee
        const expectedTransferFeeExcludedAmount = calculateTransferFeeExcludedAmount(
          transferFee,
          expectation.rewardOwed[i]!,
        );
        assert.ok(expectedTransferFeeExcludedAmount.fee.gtn(0));

        const preVaultBalance = await getTokenBalance(
          provider,
          rewards[i].rewardVaultKeypair.publicKey,
        );

        const sig = await toTx(
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

        // vault sent owed only (no transfer fee, transfer fee is paid from owed)
        const postVaultBalance = await getTokenBalance(
          provider,
          rewards[i].rewardVaultKeypair.publicKey,
        );
        assert.ok(new BN(preVaultBalance).sub(new BN(postVaultBalance)).eq(expectation.rewardOwed[i]!));

        // owner received expectation minus transfer fee (transferFeeExcludedAmount)
        const rewardBalance = await getTokenBalance(provider, rewardAccounts[i]);
        assert.ok(new BN(rewardBalance).eq(expectedTransferFeeExcludedAmount.amount));

        //console.log("R", expectation[i]?.toString(), rewardBalance.toString(), expectedTransferFeeExcludedAmount.amount.toString(), expectedTransferFeeExcludedAmount.fee.toString());
      }

      const positionPostCollect = await client.getPosition(positions[0].publicKey, IGNORE_CACHE);
      const expectationPostCollect = collectRewardsQuote({
        whirlpool: whirlpoolData,
        position: positionPostCollect.getData(),
        tickLower: positionPostCollect.getLowerTickData(),
        tickUpper: positionPostCollect.getUpperTickData(),
        timeStampInSeconds: whirlpoolData.rewardLastUpdatedTimestamp,
        tokenExtensionCtx: withNoExtension,
      });

      assert.ok(expectationPostCollect.rewardOwed.every((n) => n!.isZero()));
    });

    it("collect_reward_v2: rewardOwed is zero", async () => {
      const {
        poolInitInfo: { whirlpoolPda },
        positions,
        rewards,
      } = fixture.getInfos();

      // collect
      for (let i = 0; i < NUM_REWARDS; i++) {
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
      }

      const whirlpoolData = (await fetcher.getPool(whirlpoolPda.publicKey)) as WhirlpoolData;
      const positionPreCollect = await client.getPosition(positions[0].publicKey, IGNORE_CACHE);

      for (let i = 0; i < NUM_REWARDS; i++) {
        const transferFee = await getTransferFee(rewards[i].rewardMint);
        assert.equal(transferFee.transferFeeBasisPoints, [500, 1000, 5000][i]);

        // expectation include transfer fee
        const expectedTransferFeeExcludedAmount = calculateTransferFeeExcludedAmount(
          transferFee,
          positionPreCollect.getData().rewardInfos[i].amountOwed,
        );
        assert.ok(expectedTransferFeeExcludedAmount.amount.isZero());
        assert.ok(expectedTransferFeeExcludedAmount.fee.isZero());

        const preVaultBalance = await getTokenBalance(
          provider,
          rewards[i].rewardVaultKeypair.publicKey,
        );
        const preRewardBalance = await getTokenBalance(provider, rewardAccounts[i]);

        const sig = await toTx(
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

        // vault sent owed only (no transfer fee, transfer fee is paid from owed)
        const postVaultBalance = await getTokenBalance(
          provider,
          rewards[i].rewardVaultKeypair.publicKey,
        );
        assert.ok(new BN(preVaultBalance).eq(new BN(postVaultBalance)));

        // owner received expectation minus transfer fee (transferFeeExcludedAmount)
        const postRewardBalance = await getTokenBalance(provider, rewardAccounts[i]);
        assert.ok(new BN(postRewardBalance).eq(new BN(preRewardBalance)));
      }
    });

    it("collect_reward_v2: transfer fee rate is 0%", async () => {
      const {
        poolInitInfo: { whirlpoolPda },
        positions,
        rewards,
      } = fixture.getInfos();

      const whirlpoolData = (await fetcher.getPool(whirlpoolPda.publicKey)) as WhirlpoolData;

      // update fee config
      await toTx(ctx, {
        cleanupInstructions: [],
        signers: [], // provider.wallet is authority & payer
        instructions: whirlpoolData.rewardInfos.map((rewardInfo, i) =>
          createSetTransferFeeInstruction(
            rewardInfo.mint,
            0,
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          )),
      }).buildAndExecute();

      const positionPreCollect = await client.getPosition(positions[0].publicKey, IGNORE_CACHE);

      for (let i = 0; i < NUM_REWARDS; i++) {
        const updatedFeeConfig = await fetchTransferFeeConfig(rewards[i].rewardMint);

        assert.equal(updatedFeeConfig.newerTransferFee.transferFeeBasisPoints, 0);
        await waitEpoch(Number(updatedFeeConfig.newerTransferFee.epoch));
        assert.ok((await getCurrentEpoch()) >= updatedFeeConfig.newerTransferFee.epoch);
  
        const transferFee = await getTransferFee(rewards[i].rewardMint);

        // expectation include transfer fee
        const expectedTransferFeeExcludedAmount = calculateTransferFeeExcludedAmount(
          transferFee,
          positionPreCollect.getData().rewardInfos[i].amountOwed,
        );
        assert.ok(expectedTransferFeeExcludedAmount.amount.eq(positionPreCollect.getData().rewardInfos[i].amountOwed));
        assert.ok(expectedTransferFeeExcludedAmount.fee.isZero());

        const preVaultBalance = await getTokenBalance(
          provider,
          rewards[i].rewardVaultKeypair.publicKey,
        );

        const sig = await toTx(
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

        // vault sent owed only (no transfer fee, transfer fee is paid from owed)
        const postVaultBalance = await getTokenBalance(
          provider,
          rewards[i].rewardVaultKeypair.publicKey,
        );
        assert.ok(new BN(preVaultBalance).sub(new BN(postVaultBalance)).eq(positionPreCollect.getData().rewardInfos[i].amountOwed));

        // owner received expectation minus transfer fee (transferFeeExcludedAmount)
        const postRewardBalance = await getTokenBalance(provider, rewardAccounts[i]);
        assert.ok(new BN(postRewardBalance).eq(expectedTransferFeeExcludedAmount.amount));
      }
    });

    it("collect_reward_v2: transfer fee rate is 100%", async () => {
      const {
        poolInitInfo: { whirlpoolPda },
        positions,
        rewards,
      } = fixture.getInfos();

      const whirlpoolData = (await fetcher.getPool(whirlpoolPda.publicKey)) as WhirlpoolData;

      // update fee config
      await toTx(ctx, {
        cleanupInstructions: [],
        signers: [], // provider.wallet is authority & payer
        instructions: whirlpoolData.rewardInfos.map((rewardInfo, i) =>
          createSetTransferFeeInstruction(
            rewardInfo.mint,
            MAX_FEE_BASIS_POINTS, // 100 %
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          )),
      }).buildAndExecute();

      const positionPreCollect = await client.getPosition(positions[0].publicKey, IGNORE_CACHE);

      for (let i = 0; i < NUM_REWARDS; i++) {
        const updatedFeeConfig = await fetchTransferFeeConfig(rewards[i].rewardMint);

        assert.equal(updatedFeeConfig.newerTransferFee.transferFeeBasisPoints, MAX_FEE_BASIS_POINTS);
        await waitEpoch(Number(updatedFeeConfig.newerTransferFee.epoch));
        assert.ok((await getCurrentEpoch()) >= updatedFeeConfig.newerTransferFee.epoch);
  
        const transferFee = await getTransferFee(rewards[i].rewardMint);

        // expectation include transfer fee
        const expectedTransferFeeExcludedAmount = calculateTransferFeeExcludedAmount(
          transferFee,
          positionPreCollect.getData().rewardInfos[i].amountOwed,
        );
        assert.ok(expectedTransferFeeExcludedAmount.fee.eq(positionPreCollect.getData().rewardInfos[i].amountOwed));
        assert.ok(expectedTransferFeeExcludedAmount.amount.isZero());

        const preVaultBalance = await getTokenBalance(
          provider,
          rewards[i].rewardVaultKeypair.publicKey,
        );

        const sig = await toTx(
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

        // vault sent owed only (no transfer fee, transfer fee is paid from owed)
        const postVaultBalance = await getTokenBalance(
          provider,
          rewards[i].rewardVaultKeypair.publicKey,
        );
        assert.ok(new BN(preVaultBalance).sub(new BN(postVaultBalance)).eq(positionPreCollect.getData().rewardInfos[i].amountOwed));

        // owner received expectation minus transfer fee (transferFeeExcludedAmount)
        const postRewardBalance = await getTokenBalance(provider, rewardAccounts[i]);
        assert.ok(new BN(postRewardBalance).isZero());

        const withheldAmount = await fetchTransferFeeWithheldAmount(rewardAccounts[i]);
        assert.ok(withheldAmount.eq(positionPreCollect.getData().rewardInfos[i].amountOwed));
      }
    });
  });

  describe("increase_liquidity_v2", () => {
    const tickLowerIndex = 7168;
    const tickUpperIndex = 8960;
    const currTick = Math.round((tickLowerIndex + tickUpperIndex) / 2);

    const aboveLowerIndex = TickUtil.getNextInitializableTickIndex(currTick + 1, TickSpacing.Standard);
    const aboveUpperIndex = tickUpperIndex;
    const belowLowerIndex = tickLowerIndex;
    const belowUpperIndex = TickUtil.getPrevInitializableTickIndex(currTick - 1, TickSpacing.Standard);

    let fixture: WhirlpoolTestFixtureV2;

    beforeEach(async () => {
      fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: {
          isToken2022: true,
          hasTransferFeeExtension: true,
          transferFeeInitialBps: 500,
        }, // 5%
        tokenTraitB: {
          isToken2022: true,
          hasTransferFeeExtension: true,
          transferFeeInitialBps: 1000,
        }, // 10%
        tickSpacing: TickSpacing.Standard,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
          { tickLowerIndex: aboveLowerIndex, tickUpperIndex: aboveUpperIndex, liquidityAmount: ZERO_BN },
          { tickLowerIndex: belowLowerIndex, tickUpperIndex: belowUpperIndex, liquidityAmount: ZERO_BN },
        ],
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
      });
    });

    it("increase_liquidity_v2: with transfer fee", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const positionInitInfo = positions[0];

      const transferFeeA = await getTransferFee(poolInitInfo.tokenMintA);
      const transferFeeB = await getTransferFee(poolInitInfo.tokenMintB);
      assert.equal(transferFeeA.transferFeeBasisPoints, 500); // 5%
      assert.equal(transferFeeB.transferFeeBasisPoints, 1000); // 10%

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
      const expectedTransferFeeIncludedAmountA = calculateTransferFeeIncludedAmount(
        transferFeeA,
        requiredAmountDelta.tokenA,
      );
      const expectedTransferFeeIncludedAmountB = calculateTransferFeeIncludedAmount(
        transferFeeB,
        requiredAmountDelta.tokenB,
      );
      assert.ok(expectedTransferFeeIncludedAmountA.fee.gtn(0));
      assert.ok(expectedTransferFeeIncludedAmountB.fee.gtn(0));

      const preVaultBalanceA = new BN(
        await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      );
      const preVaultBalanceB = new BN(
        await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      );
      const preOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
      const preOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

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
        await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      );
      const postVaultBalanceB = new BN(
        await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      );
      const postOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
      const postOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

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
      assert.ok(postVaultBalanceA.sub(preVaultBalanceA).eq(requiredAmountDelta.tokenA));
      assert.ok(postVaultBalanceB.sub(preVaultBalanceB).eq(requiredAmountDelta.tokenB));
    });

    it("increase_liquidity_v2: transfer fee rate is 0%", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const positionInitInfo = positions[0];

      // update fee config
      await toTx(ctx, {
        cleanupInstructions: [],
        signers: [], // provider.wallet is authority & payer
        instructions: [
          createSetTransferFeeInstruction(
            poolInitInfo.tokenMintA,
            0,
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          ),
          createSetTransferFeeInstruction(
            poolInitInfo.tokenMintB,
            0,
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          )
        ]
      }).buildAndExecute();

      const updatedFeeConfigA = await fetchTransferFeeConfig(poolInitInfo.tokenMintA);
      const updatedFeeConfigB = await fetchTransferFeeConfig(poolInitInfo.tokenMintB);
      assert.equal(updatedFeeConfigA.newerTransferFee.transferFeeBasisPoints, 0);
      assert.equal(updatedFeeConfigB.newerTransferFee.transferFeeBasisPoints, 0);

      // wait for epoch to enable updated fee rate
      await waitEpoch(Number(updatedFeeConfigA.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigA.newerTransferFee.epoch);
      await waitEpoch(Number(updatedFeeConfigB.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigB.newerTransferFee.epoch);

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

      // transfer fee should be zero
      assert.ok(requiredAmountDelta.tokenA.gtn(0));
      assert.ok(requiredAmountDelta.tokenB.gtn(0));
      const expectedTransferFeeIncludedAmountA = calculateTransferFeeIncludedAmount(
        updatedFeeConfigA.newerTransferFee,
        requiredAmountDelta.tokenA,
      );
      const expectedTransferFeeIncludedAmountB = calculateTransferFeeIncludedAmount(
        updatedFeeConfigB.newerTransferFee,
        requiredAmountDelta.tokenB,
      );
      assert.ok(expectedTransferFeeIncludedAmountA.fee.isZero());
      assert.ok(expectedTransferFeeIncludedAmountB.fee.isZero());
      assert.ok(expectedTransferFeeIncludedAmountA.amount.eq(requiredAmountDelta.tokenA));
      assert.ok(expectedTransferFeeIncludedAmountB.amount.eq(requiredAmountDelta.tokenB));

      const preVaultBalanceA = new BN(
        await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      );
      const preVaultBalanceB = new BN(
        await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      );
      const preOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
      const preOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

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
        await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      );
      const postVaultBalanceB = new BN(
        await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      );
      const postOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
      const postOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

      // owner sent requiredAmountDelta plus transfer fees (0)
      assert.ok(
        preOwnerAccountBalanceA
          .sub(postOwnerAccountBalanceA)
          .eq(requiredAmountDelta.tokenA),
      );
      assert.ok(
        preOwnerAccountBalanceB
          .sub(postOwnerAccountBalanceB)
          .eq(requiredAmountDelta.tokenB),
      );
      // vault received requiredAmountDelta
      assert.ok(postVaultBalanceA.sub(preVaultBalanceA).eq(requiredAmountDelta.tokenA));
      assert.ok(postVaultBalanceB.sub(preVaultBalanceB).eq(requiredAmountDelta.tokenB));
    });

    it("increase_liquidity_v2: [FAIL] transfer fee rate is 100% without cap", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const positionInitInfo = positions[0];

      // update fee config
      await toTx(ctx, {
        cleanupInstructions: [],
        signers: [], // provider.wallet is authority & payer
        instructions: [
          createSetTransferFeeInstruction(
            poolInitInfo.tokenMintA,
            MAX_FEE_BASIS_POINTS,
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          ),
          createSetTransferFeeInstruction(
            poolInitInfo.tokenMintB,
            MAX_FEE_BASIS_POINTS,
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          )
        ]
      }).buildAndExecute();

      const updatedFeeConfigA = await fetchTransferFeeConfig(poolInitInfo.tokenMintA);
      const updatedFeeConfigB = await fetchTransferFeeConfig(poolInitInfo.tokenMintB);
      assert.equal(updatedFeeConfigA.newerTransferFee.transferFeeBasisPoints, MAX_FEE_BASIS_POINTS);
      assert.equal(updatedFeeConfigB.newerTransferFee.transferFeeBasisPoints, MAX_FEE_BASIS_POINTS);

      // wait for epoch to enable updated fee rate
      await waitEpoch(Number(updatedFeeConfigA.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigA.newerTransferFee.epoch);
      await waitEpoch(Number(updatedFeeConfigB.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigB.newerTransferFee.epoch);

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

      assert.ok(requiredAmountDelta.tokenA.gtn(0));
      assert.ok(requiredAmountDelta.tokenB.gtn(0));

      // overflow at client-side
      assert.throws(() => {
        calculateTransferFeeIncludedAmount(updatedFeeConfigA.newerTransferFee, requiredAmountDelta.tokenA);
      });
      assert.throws(() => {
        calculateTransferFeeIncludedAmount(updatedFeeConfigB.newerTransferFee, requiredAmountDelta.tokenB);
      });

      // overflow at contract-side
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
            liquidityAmount,
            tokenMaxA: U64_MAX,
            tokenMaxB: U64_MAX,
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
        ).buildAndExecute(),
        /0x17a4/, // TransferFeeCalculationError
      );
    });

    it("increase_liquidity_v2: transfer fee rate is 100% with cap", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const positionInitInfo = positions[0];

      // update fee config
      await toTx(ctx, {
        cleanupInstructions: [],
        signers: [], // provider.wallet is authority & payer
        instructions: [
          createSetTransferFeeInstruction(
            poolInitInfo.tokenMintA,
            MAX_FEE_BASIS_POINTS,
            99n, // cap
            provider.wallet.publicKey,
          ),
          createSetTransferFeeInstruction(
            poolInitInfo.tokenMintB,
            MAX_FEE_BASIS_POINTS,
            99n, // cap
            provider.wallet.publicKey,
          )
        ]
      }).buildAndExecute();

      const updatedFeeConfigA = await fetchTransferFeeConfig(poolInitInfo.tokenMintA);
      const updatedFeeConfigB = await fetchTransferFeeConfig(poolInitInfo.tokenMintB);
      assert.equal(updatedFeeConfigA.newerTransferFee.transferFeeBasisPoints, MAX_FEE_BASIS_POINTS);
      assert.equal(updatedFeeConfigB.newerTransferFee.transferFeeBasisPoints, MAX_FEE_BASIS_POINTS);
      assert.equal(updatedFeeConfigA.newerTransferFee.maximumFee, 99n);
      assert.equal(updatedFeeConfigB.newerTransferFee.maximumFee, 99n);

      // wait for epoch to enable updated fee rate
      await waitEpoch(Number(updatedFeeConfigA.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigA.newerTransferFee.epoch);
      await waitEpoch(Number(updatedFeeConfigB.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigB.newerTransferFee.epoch);

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

      assert.ok(requiredAmountDelta.tokenA.gtn(0));
      assert.ok(requiredAmountDelta.tokenB.gtn(0));

      const expectedTransferFeeIncludedAmountA = calculateTransferFeeIncludedAmount(
        updatedFeeConfigA.newerTransferFee,
        requiredAmountDelta.tokenA,
      );
      const expectedTransferFeeIncludedAmountB = calculateTransferFeeIncludedAmount(
        updatedFeeConfigB.newerTransferFee,
        requiredAmountDelta.tokenB,
      );
      assert.ok(expectedTransferFeeIncludedAmountA.fee.eq(new BN(99)));
      assert.ok(expectedTransferFeeIncludedAmountB.fee.eq(new BN(99)));
      assert.ok(expectedTransferFeeIncludedAmountA.amount.sub(expectedTransferFeeIncludedAmountA.fee).eq(requiredAmountDelta.tokenA));
      assert.ok(expectedTransferFeeIncludedAmountB.amount.sub(expectedTransferFeeIncludedAmountB.fee).eq(requiredAmountDelta.tokenB));

      const preVaultBalanceA = new BN(
        await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      );
      const preVaultBalanceB = new BN(
        await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      );
      const preOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
      const preOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

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
        await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      );
      const postVaultBalanceB = new BN(
        await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      );
      const postOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
      const postOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

      // owner sent requiredAmountDelta plus transfer fees
      assert.ok(
        preOwnerAccountBalanceA
          .sub(postOwnerAccountBalanceA)
          .eq(expectedTransferFeeIncludedAmountA.amount)
      );
      assert.ok(
        preOwnerAccountBalanceB
          .sub(postOwnerAccountBalanceB)
          .eq(expectedTransferFeeIncludedAmountB.amount),
      );
      // vault received requiredAmountDelta
      assert.ok(postVaultBalanceA.sub(preVaultBalanceA).eq(requiredAmountDelta.tokenA));
      assert.ok(postVaultBalanceB.sub(preVaultBalanceB).eq(requiredAmountDelta.tokenB));

      const withheldAmountA = await fetchTransferFeeWithheldAmount(poolInitInfo.tokenVaultAKeypair.publicKey);
      const withheldAmountB = await fetchTransferFeeWithheldAmount(poolInitInfo.tokenVaultBKeypair.publicKey);
      assert.ok(new BN(withheldAmountA).eq(new BN(99)));
      assert.ok(new BN(withheldAmountB).eq(new BN(99)));
    });

    it("increase_liquidity_v2: out or range (above, tokenB amount is zero)", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const positionInitInfo = positions[1];

      const transferFeeA = await getTransferFee(poolInitInfo.tokenMintA);
      const transferFeeB = await getTransferFee(poolInitInfo.tokenMintB);
      assert.equal(transferFeeA.transferFeeBasisPoints, 500); // 5%
      assert.equal(transferFeeB.transferFeeBasisPoints, 1000); // 10%

      const tokenAmount = toTokenAmount(1_000_000 * 0.8, 1_000_000 * 0.8);
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        aboveLowerIndex,
        aboveUpperIndex,
        tokenAmount,
      );
      const requiredAmountDelta = PoolUtil.getTokenAmountsFromLiquidity(
        liquidityAmount,
        PriceMath.tickIndexToSqrtPriceX64(currTick),
        PriceMath.tickIndexToSqrtPriceX64(aboveLowerIndex),
        PriceMath.tickIndexToSqrtPriceX64(aboveUpperIndex),
        true,
      );

      assert.ok(requiredAmountDelta.tokenA.gtn(0));
      assert.ok(requiredAmountDelta.tokenB.isZero()); // out of range, all asset is in tokenA
      const expectedTransferFeeIncludedAmountA = calculateTransferFeeIncludedAmount(
        transferFeeA,
        requiredAmountDelta.tokenA,
      );
      const expectedTransferFeeIncludedAmountB = calculateTransferFeeIncludedAmount(
        transferFeeB,
        requiredAmountDelta.tokenB,
      );
      assert.ok(expectedTransferFeeIncludedAmountA.fee.gtn(0));
      assert.ok(expectedTransferFeeIncludedAmountB.amount.isZero());
      assert.ok(expectedTransferFeeIncludedAmountB.fee.isZero());

      const preVaultBalanceA = new BN(
        await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      );
      const preVaultBalanceB = new BN(
        await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      );
      const preOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
      const preOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

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
        await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      );
      const postVaultBalanceB = new BN(
        await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      );
      const postOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
      const postOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

      // owner sent requiredAmountDelta plus transfer fees
      assert.ok(
        preOwnerAccountBalanceA
          .sub(postOwnerAccountBalanceA)
          .eq(expectedTransferFeeIncludedAmountA.amount),
      );
      assert.ok(
        preOwnerAccountBalanceB
          .sub(postOwnerAccountBalanceB)
          .isZero()
      );
      // vault received requiredAmountDelta
      assert.ok(postVaultBalanceA.sub(preVaultBalanceA).eq(requiredAmountDelta.tokenA));
      assert.ok(postVaultBalanceB.sub(preVaultBalanceB).isZero());
    });

    it("increase_liquidity_v2: out or range (below, tokenA amount is zero)", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const positionInitInfo = positions[2];

      const transferFeeA = await getTransferFee(poolInitInfo.tokenMintA);
      const transferFeeB = await getTransferFee(poolInitInfo.tokenMintB);
      assert.equal(transferFeeA.transferFeeBasisPoints, 500); // 5%
      assert.equal(transferFeeB.transferFeeBasisPoints, 1000); // 10%

      const tokenAmount = toTokenAmount(1_000_000 * 0.8, 1_000_000 * 0.8);
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        belowLowerIndex,
        belowUpperIndex,
        tokenAmount,
      );
      const requiredAmountDelta = PoolUtil.getTokenAmountsFromLiquidity(
        liquidityAmount,
        PriceMath.tickIndexToSqrtPriceX64(currTick),
        PriceMath.tickIndexToSqrtPriceX64(belowLowerIndex),
        PriceMath.tickIndexToSqrtPriceX64(belowUpperIndex),
        true,
      );

      assert.ok(requiredAmountDelta.tokenA.isZero()); // out of range, all asset is in tokenB
      assert.ok(requiredAmountDelta.tokenB.gtn(0));
      const expectedTransferFeeIncludedAmountA = calculateTransferFeeIncludedAmount(
        transferFeeA,
        requiredAmountDelta.tokenA,
      );
      const expectedTransferFeeIncludedAmountB = calculateTransferFeeIncludedAmount(
        transferFeeB,
        requiredAmountDelta.tokenB,
      );
      assert.ok(expectedTransferFeeIncludedAmountA.amount.isZero());
      assert.ok(expectedTransferFeeIncludedAmountA.fee.isZero());
      assert.ok(expectedTransferFeeIncludedAmountB.fee.gtn(0));

      const preVaultBalanceA = new BN(
        await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      );
      const preVaultBalanceB = new BN(
        await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      );
      const preOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
      const preOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

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
        await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
      );
      const postVaultBalanceB = new BN(
        await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
      );
      const postOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
      const postOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

      // owner sent requiredAmountDelta plus transfer fees
      assert.ok(
        preOwnerAccountBalanceA
          .sub(postOwnerAccountBalanceA)
          .isZero(),
      );
      assert.ok(
        preOwnerAccountBalanceB
          .sub(postOwnerAccountBalanceB)
          .eq(expectedTransferFeeIncludedAmountB.amount)
      );
      // vault received requiredAmountDelta
      assert.ok(postVaultBalanceA.sub(preVaultBalanceA).isZero());
      assert.ok(postVaultBalanceB.sub(preVaultBalanceB).eq(requiredAmountDelta.tokenB));
    });

    it("increase_liquidity_v2: [FAIL] TokenMaxExceeded due to transfer fee", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const positionInitInfo = positions[0];

      const transferFeeA = await getTransferFee(poolInitInfo.tokenMintA);
      const transferFeeB = await getTransferFee(poolInitInfo.tokenMintB);
      assert.equal(transferFeeA.transferFeeBasisPoints, 500); // 5%
      assert.equal(transferFeeB.transferFeeBasisPoints, 1000); // 10%

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
      const expectedTransferFeeIncludedAmountA = calculateTransferFeeIncludedAmount(
        transferFeeA,
        requiredAmountDelta.tokenA,
      );
      const expectedTransferFeeIncludedAmountB = calculateTransferFeeIncludedAmount(
        transferFeeB,
        requiredAmountDelta.tokenB,
      );
      assert.ok(expectedTransferFeeIncludedAmountA.fee.gtn(0));
      assert.ok(expectedTransferFeeIncludedAmountB.fee.gtn(0));

      const normalParams: IncreaseLiquidityV2Params = {
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
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
            ...normalParams,
            // TransferFee is not taken into account
            tokenMaxA: requiredAmountDelta.tokenA,
          }),
        ).buildAndExecute(),
        /0x1781/, // TokenMaxExceeded
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
            ...normalParams,
            // TransferFee is not taken into account
            tokenMaxB: requiredAmountDelta.tokenB,
          }),
        ).buildAndExecute(),
        /0x1781/, // TokenMaxExceeded
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
            ...normalParams,
            // set maxA to expected - 1
            tokenMaxA: requiredAmountDelta.tokenA
              .add(expectedTransferFeeIncludedAmountA.fee)
              .subn(1),
          }),
        ).buildAndExecute(),
        /0x1781/, // TokenMaxExceeded
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
            ...normalParams,
            // set maxB to expected - 1
            tokenMaxB: requiredAmountDelta.tokenB
              .add(expectedTransferFeeIncludedAmountB.fee)
              .subn(1),
          }),
        ).buildAndExecute(),
        /0x1781/, // TokenMaxExceeded
      );

      // success with normal params
      await toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, normalParams),
      ).buildAndExecute();
    });
  });

  describe("decrease_liquidity_v2", () => {
    let fixture: WhirlpoolTestFixtureV2;
    let destAccountA: PublicKey;
    let destAccountB: PublicKey;

    const tickLowerIndex = 7168;
    const tickUpperIndex = 8960;
    const currTick = Math.round((tickLowerIndex + tickUpperIndex) / 2);

    const aboveLowerIndex = TickUtil.getNextInitializableTickIndex(currTick + 1, TickSpacing.Standard);
    const aboveUpperIndex = tickUpperIndex;
    const belowLowerIndex = tickLowerIndex;
    const belowUpperIndex = TickUtil.getPrevInitializableTickIndex(currTick - 1, TickSpacing.Standard);

    beforeEach(async () => {
      const liquidityAmount = new anchor.BN(1_250_000);
      fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: {
          isToken2022: true,
          hasTransferFeeExtension: true,
          transferFeeInitialBps: 500,
        }, // 5%
        tokenTraitB: {
          isToken2022: true,
          hasTransferFeeExtension: true,
          transferFeeInitialBps: 1000,
        }, // 10%
        tickSpacing: TickSpacing.Standard,
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount },
          { tickLowerIndex: aboveLowerIndex, tickUpperIndex: aboveUpperIndex, liquidityAmount },
          { tickLowerIndex: belowLowerIndex, tickUpperIndex: belowUpperIndex, liquidityAmount },
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

      const transferFeeA = await getTransferFee(poolInitInfo.tokenMintA);
      const transferFeeB = await getTransferFee(poolInitInfo.tokenMintB);
      assert.equal(transferFeeA.transferFeeBasisPoints, 500); // 5%
      assert.equal(transferFeeB.transferFeeBasisPoints, 1000); // 10%

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
      const expectedTransferFeeExcludedAmountA = calculateTransferFeeExcludedAmount(
        transferFeeA,
        expectedAmount.tokenA,
      );
      const expectedTransferFeeExcludedAmountB = calculateTransferFeeExcludedAmount(
        transferFeeB,
        expectedAmount.tokenB,
      );
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

      const sig = await toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
          liquidityAmount: positionData.liquidity,
          tokenMinA: expectedAmount.tokenA.sub(expectedTransferFeeExcludedAmountA.fee),
          tokenMinB: expectedAmount.tokenB.sub(expectedTransferFeeExcludedAmountB.fee),
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
      assert.ok(new BN(preVaultBalanceA).sub(new BN(postVaultBalanceA)).eq(expectedAmount.tokenA));
      assert.ok(new BN(preVaultBalanceB).sub(new BN(postVaultBalanceB)).eq(expectedAmount.tokenB));

      // owner received withdrawable amount minus transfer fee (transferFeeExcludedAmount)
      const destBalanceA = await getTokenBalance(provider, destAccountA);
      const destBalanceB = await getTokenBalance(provider, destAccountB);
      //console.log("A", destBalanceA.toString(), expectedTransferFeeExcludedAmountA.amount.toString(), expectedTransferFeeExcludedAmountA.fee.toString());
      //console.log("B", destBalanceB.toString(), expectedTransferFeeExcludedAmountB.amount.toString(), expectedTransferFeeExcludedAmountB.fee.toString());

      assert.ok(new BN(destBalanceA).eq(expectedTransferFeeExcludedAmountA.amount));
      assert.ok(new BN(destBalanceB).eq(expectedTransferFeeExcludedAmountB.amount));

      // all liquidity have been decreased
      const positionDataAfterWithdraw = (await fetcher.getPosition(
        position.publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      assert.ok(positionDataAfterWithdraw.liquidity.isZero());
    });

    it("decrease_liquidity_v2: transfer fee rate is 0%", async () => {
      const { poolInitInfo, positions } = fixture.getInfos();

      // update fee config
      await toTx(ctx, {
        cleanupInstructions: [],
        signers: [], // provider.wallet is authority & payer
        instructions: [
          createSetTransferFeeInstruction(
            poolInitInfo.tokenMintA,
            0,
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          ),
          createSetTransferFeeInstruction(
            poolInitInfo.tokenMintB,
            0,
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          )
        ]
      }).buildAndExecute();

      const updatedFeeConfigA = await fetchTransferFeeConfig(poolInitInfo.tokenMintA);
      const updatedFeeConfigB = await fetchTransferFeeConfig(poolInitInfo.tokenMintB);
      assert.equal(updatedFeeConfigA.newerTransferFee.transferFeeBasisPoints, 0);
      assert.equal(updatedFeeConfigB.newerTransferFee.transferFeeBasisPoints, 0);

      // wait for epoch to enable updated fee rate
      await waitEpoch(Number(updatedFeeConfigA.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigA.newerTransferFee.epoch);
      await waitEpoch(Number(updatedFeeConfigB.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigB.newerTransferFee.epoch);

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

      // transfer fee should be zero
      assert.ok(expectedAmount.tokenA.gtn(0));
      assert.ok(expectedAmount.tokenB.gtn(0));
      const expectedTransferFeeExcludedAmountA = calculateTransferFeeExcludedAmount(
        updatedFeeConfigA.newerTransferFee,
        expectedAmount.tokenA,
      );
      const expectedTransferFeeExcludedAmountB = calculateTransferFeeExcludedAmount(
        updatedFeeConfigB.newerTransferFee,
        expectedAmount.tokenB,
      );
      assert.ok(expectedTransferFeeExcludedAmountA.fee.isZero());
      assert.ok(expectedTransferFeeExcludedAmountB.fee.isZero());
      assert.ok(expectedTransferFeeExcludedAmountA.amount.eq(expectedAmount.tokenA));
      assert.ok(expectedTransferFeeExcludedAmountB.amount.eq(expectedAmount.tokenB));

      const preVaultBalanceA = await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      );
      const preVaultBalanceB = await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      );

      const sig = await toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
          liquidityAmount: positionData.liquidity,
          tokenMinA: expectedAmount.tokenA.sub(expectedTransferFeeExcludedAmountA.fee),
          tokenMinB: expectedAmount.tokenB.sub(expectedTransferFeeExcludedAmountB.fee),
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
      assert.ok(new BN(preVaultBalanceA).sub(new BN(postVaultBalanceA)).eq(expectedAmount.tokenA));
      assert.ok(new BN(preVaultBalanceB).sub(new BN(postVaultBalanceB)).eq(expectedAmount.tokenB));

      // owner received withdrawable amount minus transfer fee (0)
      const destBalanceA = await getTokenBalance(provider, destAccountA);
      const destBalanceB = await getTokenBalance(provider, destAccountB);

      assert.ok(new BN(destBalanceA).eq(expectedTransferFeeExcludedAmountA.amount));
      assert.ok(new BN(destBalanceB).eq(expectedTransferFeeExcludedAmountB.amount));
    });

    it("decrease_liquidity_v2: transfer fee rate is 100% without cap", async () => {
      const { poolInitInfo, positions } = fixture.getInfos();

      // update fee config
      await toTx(ctx, {
        cleanupInstructions: [],
        signers: [], // provider.wallet is authority & payer
        instructions: [
          createSetTransferFeeInstruction(
            poolInitInfo.tokenMintA,
            MAX_FEE_BASIS_POINTS,
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          ),
          createSetTransferFeeInstruction(
            poolInitInfo.tokenMintB,
            MAX_FEE_BASIS_POINTS,
            BigInt(U64_MAX.toString()),
            provider.wallet.publicKey,
          )
        ]
      }).buildAndExecute();

      const updatedFeeConfigA = await fetchTransferFeeConfig(poolInitInfo.tokenMintA);
      const updatedFeeConfigB = await fetchTransferFeeConfig(poolInitInfo.tokenMintB);
      assert.equal(updatedFeeConfigA.newerTransferFee.transferFeeBasisPoints, MAX_FEE_BASIS_POINTS);
      assert.equal(updatedFeeConfigB.newerTransferFee.transferFeeBasisPoints, MAX_FEE_BASIS_POINTS);

      // wait for epoch to enable updated fee rate
      await waitEpoch(Number(updatedFeeConfigA.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigA.newerTransferFee.epoch);
      await waitEpoch(Number(updatedFeeConfigB.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigB.newerTransferFee.epoch);

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

      // transfer fee should be zero
      assert.ok(expectedAmount.tokenA.gtn(0));
      assert.ok(expectedAmount.tokenB.gtn(0));
      const expectedTransferFeeExcludedAmountA = calculateTransferFeeExcludedAmount(
        updatedFeeConfigA.newerTransferFee,
        expectedAmount.tokenA,
      );
      const expectedTransferFeeExcludedAmountB = calculateTransferFeeExcludedAmount(
        updatedFeeConfigB.newerTransferFee,
        expectedAmount.tokenB,
      );
      assert.ok(expectedTransferFeeExcludedAmountA.fee.eq(expectedAmount.tokenA));
      assert.ok(expectedTransferFeeExcludedAmountB.fee.eq(expectedAmount.tokenB));
      assert.ok(expectedTransferFeeExcludedAmountA.amount.isZero());
      assert.ok(expectedTransferFeeExcludedAmountB.amount.isZero());

      const preVaultBalanceA = await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      );
      const preVaultBalanceB = await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      );

      const sig = await toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
          liquidityAmount: positionData.liquidity,
          tokenMinA: expectedAmount.tokenA.sub(expectedTransferFeeExcludedAmountA.fee),
          tokenMinB: expectedAmount.tokenB.sub(expectedTransferFeeExcludedAmountB.fee),
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
      assert.ok(new BN(preVaultBalanceA).sub(new BN(postVaultBalanceA)).eq(expectedAmount.tokenA));
      assert.ok(new BN(preVaultBalanceB).sub(new BN(postVaultBalanceB)).eq(expectedAmount.tokenB));

      // owner received 0 tokens
      const destBalanceA = await getTokenBalance(provider, destAccountA);
      const destBalanceB = await getTokenBalance(provider, destAccountB);

      // all amount is collected as transfer fee
      assert.ok(new BN(destBalanceA).isZero());
      assert.ok(new BN(destBalanceB).isZero());
      const withheldAmountA = await fetchTransferFeeWithheldAmount(destAccountA);
      const withheldAmountB = await fetchTransferFeeWithheldAmount(destAccountB);
      assert.ok(withheldAmountA.eq(expectedAmount.tokenA));
      assert.ok(withheldAmountB.eq(expectedAmount.tokenB));
    });

    it("decrease_liquidity_v2: transfer fee rate is 100% with cap", async () => {
      const { poolInitInfo, positions } = fixture.getInfos();

      // update fee config
      await toTx(ctx, {
        cleanupInstructions: [],
        signers: [], // provider.wallet is authority & payer
        instructions: [
          createSetTransferFeeInstruction(
            poolInitInfo.tokenMintA,
            MAX_FEE_BASIS_POINTS,
            99n, // cap
            provider.wallet.publicKey,
          ),
          createSetTransferFeeInstruction(
            poolInitInfo.tokenMintB,
            MAX_FEE_BASIS_POINTS,
            99n, // cap
            provider.wallet.publicKey,
          )
        ]
      }).buildAndExecute();

      const updatedFeeConfigA = await fetchTransferFeeConfig(poolInitInfo.tokenMintA);
      const updatedFeeConfigB = await fetchTransferFeeConfig(poolInitInfo.tokenMintB);
      assert.equal(updatedFeeConfigA.newerTransferFee.transferFeeBasisPoints, MAX_FEE_BASIS_POINTS);
      assert.equal(updatedFeeConfigB.newerTransferFee.transferFeeBasisPoints, MAX_FEE_BASIS_POINTS);

      // wait for epoch to enable updated fee rate
      await waitEpoch(Number(updatedFeeConfigA.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigA.newerTransferFee.epoch);
      await waitEpoch(Number(updatedFeeConfigB.newerTransferFee.epoch));
      assert.ok((await getCurrentEpoch()) >= updatedFeeConfigB.newerTransferFee.epoch);

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

      // transfer fee should be zero
      assert.ok(expectedAmount.tokenA.gtn(0));
      assert.ok(expectedAmount.tokenB.gtn(0));
      const expectedTransferFeeExcludedAmountA = calculateTransferFeeExcludedAmount(
        updatedFeeConfigA.newerTransferFee,
        expectedAmount.tokenA,
      );
      const expectedTransferFeeExcludedAmountB = calculateTransferFeeExcludedAmount(
        updatedFeeConfigB.newerTransferFee,
        expectedAmount.tokenB,
      );
      assert.ok(expectedTransferFeeExcludedAmountA.fee.eqn(99));
      assert.ok(expectedTransferFeeExcludedAmountB.fee.eqn(99));

      const preVaultBalanceA = await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      );
      const preVaultBalanceB = await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      );

      const sig = await toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
          liquidityAmount: positionData.liquidity,
          tokenMinA: expectedAmount.tokenA.sub(expectedTransferFeeExcludedAmountA.fee),
          tokenMinB: expectedAmount.tokenB.sub(expectedTransferFeeExcludedAmountB.fee),
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
      assert.ok(new BN(preVaultBalanceA).sub(new BN(postVaultBalanceA)).eq(expectedAmount.tokenA));
      assert.ok(new BN(preVaultBalanceB).sub(new BN(postVaultBalanceB)).eq(expectedAmount.tokenB));

      // owner received expectedAmount minus capped transfer fee
      const destBalanceA = await getTokenBalance(provider, destAccountA);
      const destBalanceB = await getTokenBalance(provider, destAccountB);

      // all amount is collected as transfer fee
      assert.ok(new BN(destBalanceA).eq(expectedTransferFeeExcludedAmountA.amount));
      assert.ok(new BN(destBalanceB).eq(expectedTransferFeeExcludedAmountB.amount));
      const withheldAmountA = await fetchTransferFeeWithheldAmount(destAccountA);
      const withheldAmountB = await fetchTransferFeeWithheldAmount(destAccountB);
      assert.ok(withheldAmountA.eqn(99));
      assert.ok(withheldAmountB.eqn(99));
    });

    it("decrease_liquidity_v2: out or range (above, tokenB amount is zero", async () => {
      const { poolInitInfo, positions } = fixture.getInfos();

      const transferFeeA = await getTransferFee(poolInitInfo.tokenMintA);
      const transferFeeB = await getTransferFee(poolInitInfo.tokenMintB);
      assert.equal(transferFeeA.transferFeeBasisPoints, 500); // 5%
      assert.equal(transferFeeB.transferFeeBasisPoints, 1000); // 10%

      const position = positions[1]; // [1] for above
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

      assert.ok(expectedAmount.tokenA.gtn(0));
      assert.ok(expectedAmount.tokenB.isZero());
      const expectedTransferFeeExcludedAmountA = calculateTransferFeeExcludedAmount(
        transferFeeA,
        expectedAmount.tokenA,
      );
      const expectedTransferFeeExcludedAmountB = calculateTransferFeeExcludedAmount(
        transferFeeB,
        expectedAmount.tokenB,
      );
      assert.ok(expectedTransferFeeExcludedAmountA.fee.gtn(0));
      assert.ok(expectedTransferFeeExcludedAmountB.fee.isZero());

      const preVaultBalanceA = await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      );
      const preVaultBalanceB = await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      );

      const sig = await toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
          liquidityAmount: positionData.liquidity,
          tokenMinA: expectedAmount.tokenA.sub(expectedTransferFeeExcludedAmountA.fee),
          tokenMinB: expectedAmount.tokenB.sub(expectedTransferFeeExcludedAmountB.fee),
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
      assert.ok(new BN(preVaultBalanceA).sub(new BN(postVaultBalanceA)).eq(expectedAmount.tokenA));
      assert.ok(new BN(preVaultBalanceB).sub(new BN(postVaultBalanceB)).isZero());

      const destBalanceA = await getTokenBalance(provider, destAccountA);
      const destBalanceB = await getTokenBalance(provider, destAccountB);
      assert.ok(new BN(destBalanceA).eq(expectedTransferFeeExcludedAmountA.amount));
      assert.ok(new BN(destBalanceB).isZero());
    });

    it("decrease_liquidity_v2: out or range (above, tokenA amount is zero", async () => {
      const { poolInitInfo, positions } = fixture.getInfos();

      const transferFeeA = await getTransferFee(poolInitInfo.tokenMintA);
      const transferFeeB = await getTransferFee(poolInitInfo.tokenMintB);
      assert.equal(transferFeeA.transferFeeBasisPoints, 500); // 5%
      assert.equal(transferFeeB.transferFeeBasisPoints, 1000); // 10%

      const position = positions[2]; // [2] for below
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

      assert.ok(expectedAmount.tokenA.isZero());
      assert.ok(expectedAmount.tokenB.gtn(0));
      const expectedTransferFeeExcludedAmountA = calculateTransferFeeExcludedAmount(
        transferFeeA,
        expectedAmount.tokenA,
      );
      const expectedTransferFeeExcludedAmountB = calculateTransferFeeExcludedAmount(
        transferFeeB,
        expectedAmount.tokenB,
      );
      assert.ok(expectedTransferFeeExcludedAmountA.fee.isZero());
      assert.ok(expectedTransferFeeExcludedAmountB.fee.gtn(0));

      const preVaultBalanceA = await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultAKeypair.publicKey,
      );
      const preVaultBalanceB = await getTokenBalance(
        provider,
        poolInitInfo.tokenVaultBKeypair.publicKey,
      );

      const sig = await toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
          liquidityAmount: positionData.liquidity,
          tokenMinA: expectedAmount.tokenA.sub(expectedTransferFeeExcludedAmountA.fee),
          tokenMinB: expectedAmount.tokenB.sub(expectedTransferFeeExcludedAmountB.fee),
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
      assert.ok(new BN(preVaultBalanceA).sub(new BN(postVaultBalanceA)).isZero());
      assert.ok(new BN(preVaultBalanceB).sub(new BN(postVaultBalanceB)).eq(expectedAmount.tokenB));

      const destBalanceA = await getTokenBalance(provider, destAccountA);
      const destBalanceB = await getTokenBalance(provider, destAccountB);
      assert.ok(new BN(destBalanceA).isZero());
      assert.ok(new BN(destBalanceB).eq(expectedTransferFeeExcludedAmountB.amount));
    });

    it("decrease_liquidity_v2: [FAIL] TokenMinSubceeded due to transfer fee", async () => {
      const { poolInitInfo, positions } = fixture.getInfos();

      const transferFeeA = await getTransferFee(poolInitInfo.tokenMintA);
      const transferFeeB = await getTransferFee(poolInitInfo.tokenMintB);
      assert.equal(transferFeeA.transferFeeBasisPoints, 500); // 5%
      assert.equal(transferFeeB.transferFeeBasisPoints, 1000); // 10%

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
      const expectedTransferFeeExcludedAmountA = calculateTransferFeeExcludedAmount(
        transferFeeA,
        expectedAmount.tokenA,
      );
      const expectedTransferFeeExcludedAmountB = calculateTransferFeeExcludedAmount(
        transferFeeB,
        expectedAmount.tokenB,
      );
      assert.ok(expectedTransferFeeExcludedAmountA.fee.gtn(0));
      assert.ok(expectedTransferFeeExcludedAmountB.fee.gtn(0));

      const normalParams: DecreaseLiquidityV2Params = {
        liquidityAmount: positionData.liquidity,
        tokenMinA: expectedAmount.tokenA.sub(expectedTransferFeeExcludedAmountA.fee),
        tokenMinB: expectedAmount.tokenB.sub(expectedTransferFeeExcludedAmountB.fee),
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
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
            ...normalParams,
            // TransferFee is not taken into account
            tokenMinA: expectedAmount.tokenA,
          }),
        ).buildAndExecute(),
        /0x1782/, // TokenMinSubceeded
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
            ...normalParams,
            // TransferFee is not taken into account
            tokenMinB: expectedAmount.tokenB,
          }),
        ).buildAndExecute(),
        /0x1782/, // TokenMinSubceeded
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
            ...normalParams,
            // set minA to expected + 1
            tokenMinA: expectedAmount.tokenA.sub(expectedTransferFeeExcludedAmountA.fee).addn(1),
          }),
        ).buildAndExecute(),
        /0x1782/, // TokenMinSubceeded
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
            ...normalParams,
            // set minB to expected + 1
            tokenMinB: expectedAmount.tokenB.sub(expectedTransferFeeExcludedAmountB.fee).addn(1),
          }),
        ).buildAndExecute(),
        /0x1782/, // TokenMinSubceeded
      );

      // success with normal params
      await toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, normalParams),
      ).buildAndExecute();
    });
  });

  describe("swap_v2", () => {
    let poolInitInfo: InitPoolV2Params;
    let whirlpoolPda: PDA;
    let transferFeeA: TransferFee | null;
    let transferFeeB: TransferFee | null;
    let tokenAccountA: PublicKey;
    let tokenAccountB: PublicKey;
    let oraclePubkey: PublicKey;

    const variations: { tokenA: TokenTrait; tokenB: TokenTrait }[] = [
      // both A & B has transfer fee
      {
        tokenA: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 500 },
        tokenB: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 1000 },
      },
      // only A has transfer fee
      {
        tokenA: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 500 },
        tokenB: { isToken2022: true, hasTransferFeeExtension: false },
      },
      // only B has transfer fee
      {
        tokenA: { isToken2022: true, hasTransferFeeExtension: false },
        tokenB: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 1000 },
      },
      // both A & B has transfer fee extension, but bps is zero
      {
        tokenA: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
        tokenB: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
      },
    ];

    variations.forEach(({ tokenA, tokenB }) => {
      const labelA = `TokenA: transfer fee bps = ${
        tokenA.hasTransferFeeExtension ? tokenA.transferFeeInitialBps?.toString() : "none"
      }`;
      const labelB = `TokenB: transfer fee bps = ${
        tokenB.hasTransferFeeExtension ? tokenB.transferFeeInitialBps?.toString() : "none"
      }`;
      describe(`${labelA}, ${labelB}`, () => {
        beforeEach(async () => {
          const init = await initTestPoolWithTokensV2(ctx, tokenA, tokenB, TickSpacing.Standard);
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

          await fundPositionsV2(ctx, poolInitInfo, tokenAccountA, tokenAccountB, fundParams);
          oraclePubkey = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey).publicKey;

          transferFeeA = tokenA.hasTransferFeeExtension
            ? await getTransferFee(poolInitInfo.tokenMintA)
            : null;
          transferFeeB = tokenB.hasTransferFeeExtension
            ? await getTransferFee(poolInitInfo.tokenMintB)
            : null;

          if (transferFeeA)
            assert.equal(transferFeeA.transferFeeBasisPoints, tokenA.transferFeeInitialBps!);
          if (transferFeeB)
            assert.equal(transferFeeB.transferFeeBasisPoints, tokenB.transferFeeInitialBps!);
        });

        it("A --> B, ExactIn", async () => {
          const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
          const whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const aToB = true;
          const inputAmount = new BN(100000);
          const transferFeeExcludedInputAmount = transferFeeA
            ? calculateTransferFeeExcludedAmount(transferFeeA, inputAmount)
            : { amount: inputAmount, fee: ZERO_BN };
          if (transferFeeA && transferFeeA.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedInputAmount.fee.gtn(0));

          const quoteAToB = swapQuoteWithParams(
            {
              // A --> B, ExactIn
              amountSpecifiedIsInput: true,
              aToB,
              tokenAmount: transferFeeExcludedInputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                aToB,
                ctx.program.programId,
                whirlpoolKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100), // 0% slippage
          );

          const transferFeeExcludedOutputAmount = transferFeeB
            ? calculateTransferFeeExcludedAmount(transferFeeB, quoteAToB.estimatedAmountOut)
            : { amount: quoteAToB.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeB && transferFeeB.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedOutputAmount.fee.gtn(0));

          const expectedOwnerAccountADelta = inputAmount.neg(); // out
          const expectedOwnerAccountBDelta = transferFeeExcludedOutputAmount.amount; // in
          const expectedVaultAccountADelta = transferFeeExcludedInputAmount.amount; // in
          const expectedVaultAccountBDelta = quoteAToB.estimatedAmountOut.neg(); // out
          assert.ok(expectedVaultAccountADelta.eq(quoteAToB.estimatedAmountIn));
          assert.ok(expectedVaultAccountBDelta.eq(quoteAToB.estimatedAmountOut.neg()));

          const preVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const preVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const preOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const preOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, {
                ...quoteAToB,
                amount: inputAmount, // transfer fee included
                otherAmountThreshold: transferFeeExcludedOutputAmount.amount.addn(1), // transfer fee excluded
  
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
            ).buildAndExecute(),
            /0x1794/, // AmountOutBelowMinimum
          );
    
          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quoteAToB,
              amount: inputAmount, // transfer fee included
              otherAmountThreshold: transferFeeExcludedOutputAmount.amount, // transfer fee excluded

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

          const postVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const postVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const postOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const postOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

          assert.ok(postVaultBalanceA.sub(preVaultBalanceA).eq(expectedVaultAccountADelta));
          assert.ok(postVaultBalanceB.sub(preVaultBalanceB).eq(expectedVaultAccountBDelta));
          assert.ok(
            postOwnerAccountBalanceA.sub(preOwnerAccountBalanceA).eq(expectedOwnerAccountADelta),
          );
          assert.ok(
            postOwnerAccountBalanceB.sub(preOwnerAccountBalanceB).eq(expectedOwnerAccountBDelta),
          );
        });

        it("A <-- B, ExactIn", async () => {
          const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
          const whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const aToB = false;
          const inputAmount = new BN(100000);
          const transferFeeExcludedInputAmount = transferFeeB
            ? calculateTransferFeeExcludedAmount(transferFeeB, inputAmount)
            : { amount: inputAmount, fee: ZERO_BN };
          if (transferFeeB && transferFeeB.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedInputAmount.fee.gtn(0));

          const quoteBToA = swapQuoteWithParams(
            {
              // A <-- B, ExactIn
              amountSpecifiedIsInput: true,
              aToB,
              tokenAmount: transferFeeExcludedInputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                aToB,
                ctx.program.programId,
                whirlpoolKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100), // 0% slippage
          );

          const transferFeeExcludedOutputAmount = transferFeeA
            ? calculateTransferFeeExcludedAmount(transferFeeA, quoteBToA.estimatedAmountOut)
            : { amount: quoteBToA.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeA && transferFeeA.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedOutputAmount.fee.gtn(0));

          const expectedOwnerAccountADelta = transferFeeExcludedOutputAmount.amount; // in
          const expectedOwnerAccountBDelta = inputAmount.neg(); // out
          const expectedVaultAccountADelta = quoteBToA.estimatedAmountOut.neg(); // out
          const expectedVaultAccountBDelta = transferFeeExcludedInputAmount.amount; // in
          assert.ok(expectedVaultAccountADelta.eq(quoteBToA.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountBDelta.eq(quoteBToA.estimatedAmountIn));

          const preVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const preVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const preOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const preOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, {
                ...quoteBToA,
                amount: inputAmount, // transfer fee included
                otherAmountThreshold: transferFeeExcludedOutputAmount.amount.addn(1), // transfer fee excluded
  
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
            ).buildAndExecute(),
            /0x1794/, // AmountOutBelowMinimum
          );

          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quoteBToA,
              amount: inputAmount, // transfer fee included
              otherAmountThreshold: transferFeeExcludedOutputAmount.amount, // transfer fee excluded

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

          const postVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const postVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const postOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const postOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

          assert.ok(postVaultBalanceA.sub(preVaultBalanceA).eq(expectedVaultAccountADelta));
          assert.ok(postVaultBalanceB.sub(preVaultBalanceB).eq(expectedVaultAccountBDelta));
          assert.ok(
            postOwnerAccountBalanceA.sub(preOwnerAccountBalanceA).eq(expectedOwnerAccountADelta),
          );
          assert.ok(
            postOwnerAccountBalanceB.sub(preOwnerAccountBalanceB).eq(expectedOwnerAccountBDelta),
          );
        });

        it("A --> B, ExactOut", async () => {
          const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
          const whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const aToB = true;
          const outputAmount = new BN(2000000);
          const transferFeeIncludedOutputAmount = transferFeeB
            ? calculateTransferFeeIncludedAmount(transferFeeB, outputAmount)
            : { amount: outputAmount, fee: ZERO_BN };
          if (transferFeeB && transferFeeB.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedOutputAmount.fee.gtn(0));

          const quoteAToB = swapQuoteWithParams(
            {
              // A --> B, ExactOut
              amountSpecifiedIsInput: false,
              aToB,
              tokenAmount: transferFeeIncludedOutputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                aToB,
                ctx.program.programId,
                whirlpoolKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100), // 0% slippage
          );

          const transferFeeIncludedInputAmount = transferFeeA
            ? calculateTransferFeeIncludedAmount(transferFeeA, quoteAToB.estimatedAmountIn)
            : { amount: quoteAToB.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeA && transferFeeA.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedInputAmount.fee.gtn(0));

          const expectedOwnerAccountADelta = transferFeeIncludedInputAmount.amount.neg(); // out
          const expectedOwnerAccountBDelta = outputAmount; // in
          const expectedVaultAccountADelta = quoteAToB.estimatedAmountIn; // in
          const expectedVaultAccountBDelta = transferFeeIncludedOutputAmount.amount.neg(); // out
          assert.ok(expectedVaultAccountADelta.eq(quoteAToB.estimatedAmountIn));
          assert.ok(expectedVaultAccountBDelta.eq(quoteAToB.estimatedAmountOut.neg()));

          const preVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const preVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const preOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const preOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, {
                ...quoteAToB,
                amount: outputAmount, // transfer fee excluded
                otherAmountThreshold: transferFeeIncludedInputAmount.amount.subn(1), // transfer fee included
  
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
            ).buildAndExecute(),
            /0x1795/, // AmountInAboveMaximum
          );
          
          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quoteAToB,
              amount: outputAmount, // transfer fee excluded
              otherAmountThreshold: transferFeeIncludedInputAmount.amount, // transfer fee included

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

          const postVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const postVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const postOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const postOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

          assert.ok(postVaultBalanceA.sub(preVaultBalanceA).eq(expectedVaultAccountADelta));
          assert.ok(postVaultBalanceB.sub(preVaultBalanceB).eq(expectedVaultAccountBDelta));
          assert.ok(
            postOwnerAccountBalanceA.sub(preOwnerAccountBalanceA).eq(expectedOwnerAccountADelta),
          );
          assert.ok(
            postOwnerAccountBalanceB.sub(preOwnerAccountBalanceB).eq(expectedOwnerAccountBDelta),
          );
        });

        it("A <-- B, ExactOut", async () => {
          const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
          const whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const aToB = false;
          const outputAmount = new BN(100000);
          const transferFeeIncludedOutputAmount = transferFeeA
            ? calculateTransferFeeIncludedAmount(transferFeeA, outputAmount)
            : { amount: outputAmount, fee: ZERO_BN };
          if (transferFeeA && transferFeeA.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedOutputAmount.fee.gtn(0));

          const quoteBToA = swapQuoteWithParams(
            {
              // A <-- B, ExactOut
              amountSpecifiedIsInput: false,
              aToB,
              tokenAmount: transferFeeIncludedOutputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                aToB,
                ctx.program.programId,
                whirlpoolKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100), // 0% slippage
          );

          const transferFeeIncludedInputAmount = transferFeeB
            ? calculateTransferFeeIncludedAmount(transferFeeB, quoteBToA.estimatedAmountIn)
            : { amount: quoteBToA.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeB && transferFeeB.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedInputAmount.fee.gtn(0));

          const expectedOwnerAccountADelta = outputAmount; // in
          const expectedOwnerAccountBDelta = transferFeeIncludedInputAmount.amount.neg(); // out
          const expectedVaultAccountADelta = transferFeeIncludedOutputAmount.amount.neg(); // out
          const expectedVaultAccountBDelta = quoteBToA.estimatedAmountIn; // in
          assert.ok(expectedVaultAccountADelta.eq(quoteBToA.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountBDelta.eq(quoteBToA.estimatedAmountIn));

          const preVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const preVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const preOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const preOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));


          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, {
                ...quoteBToA,
                amount: outputAmount, // transfer fee excluded
                otherAmountThreshold: transferFeeIncludedInputAmount.amount.subn(1), // transfer fee included
  
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
            ).buildAndExecute(),
            /0x1795/, // AmountInAboveMaximum
          );

          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quoteBToA,
              amount: outputAmount, // transfer fee excluded
              otherAmountThreshold: transferFeeIncludedInputAmount.amount, // transfer fee included

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

          const postVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const postVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const postOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const postOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

          assert.ok(postVaultBalanceA.sub(preVaultBalanceA).eq(expectedVaultAccountADelta));
          assert.ok(postVaultBalanceB.sub(preVaultBalanceB).eq(expectedVaultAccountBDelta));
          assert.ok(
            postOwnerAccountBalanceA.sub(preOwnerAccountBalanceA).eq(expectedOwnerAccountADelta),
          );
          assert.ok(
            postOwnerAccountBalanceB.sub(preOwnerAccountBalanceB).eq(expectedOwnerAccountBDelta),
          );
        });
      });
    });

    const variationsWith100PercentFee: { tokenA: TokenTrait; tokenB: TokenTrait }[] = [
      {
        tokenA: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: MAX_FEE_BASIS_POINTS },
        tokenB: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
      },
      {
        tokenA: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: MAX_FEE_BASIS_POINTS, transferFeeInitialMax: 99n },
        tokenB: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
      },
      {
        tokenA: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
        tokenB: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: MAX_FEE_BASIS_POINTS },
      },
      {
        tokenA: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
        tokenB: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: MAX_FEE_BASIS_POINTS, transferFeeInitialMax: 99n },
      },
    ];

    variationsWith100PercentFee.forEach(({ tokenA, tokenB }) => {
      const labelA = `TokenA: transfer fee bps = ${tokenA.transferFeeInitialBps ? ("100%" + (tokenA.transferFeeInitialMax? " with cap" : " without cap")) : "0%"}`;
      const labelB = `TokenB: transfer fee bps = ${tokenB.transferFeeInitialBps ? ("100%" + (tokenB.transferFeeInitialMax? " with cap" : " without cap")) : "0%"}`;

      describe(`${labelA}, ${labelB}`, () => {
        beforeEach(async () => {
          const init = await initTestPoolWithTokensV2(
            ctx,
            {isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0},
            {isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0},
            TickSpacing.Standard
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

          await fundPositionsV2(ctx, poolInitInfo, tokenAccountA, tokenAccountB, fundParams);
          oraclePubkey = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey).publicKey;

          // update fee config
          await toTx(ctx, {
            cleanupInstructions: [],
            signers: [], // provider.wallet is authority & payer
            instructions: [
              createSetTransferFeeInstruction(
                poolInitInfo.tokenMintA,
                tokenA.transferFeeInitialBps!,
                tokenA.transferFeeInitialMax ?? BigInt(U64_MAX.toString()),
                provider.wallet.publicKey,
              ),
              createSetTransferFeeInstruction(
                poolInitInfo.tokenMintB,
                tokenB.transferFeeInitialBps!,
                tokenB.transferFeeInitialMax ?? BigInt(U64_MAX.toString()),
                provider.wallet.publicKey,
              )
            ]
          }).buildAndExecute();

          // wait for epoch to enable updated fee rate
          const updatedFeeConfigA = await fetchTransferFeeConfig(poolInitInfo.tokenMintA);
          await waitEpoch(Number(updatedFeeConfigA.newerTransferFee.epoch));
          assert.ok((await getCurrentEpoch()) >= updatedFeeConfigA.newerTransferFee.epoch);

          transferFeeA = tokenA.hasTransferFeeExtension
            ? await getTransferFee(poolInitInfo.tokenMintA)
            : null;
          transferFeeB = tokenB.hasTransferFeeExtension
            ? await getTransferFee(poolInitInfo.tokenMintB)
            : null;

          assert.equal(transferFeeA!.transferFeeBasisPoints, tokenA.transferFeeInitialBps!);
          assert.equal(transferFeeA!.maximumFee, tokenA.transferFeeInitialMax ?? BigInt(U64_MAX.toString()));
          assert.equal(transferFeeB!.transferFeeBasisPoints, tokenB.transferFeeInitialBps!);
          assert.equal(transferFeeB!.maximumFee, tokenB.transferFeeInitialMax ?? BigInt(U64_MAX.toString()));
        });

        it("A --> B, ExactIn", async () => {
          const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
          const whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const aToB = true;
          const inputAmount = new BN(100000);

          // edge-case
          if (transferFeeA!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeA!.maximumFee === BigInt(U64_MAX.toString())) {
            // we cannot determine input size because all amount will be collected as transfer fee
            const tickArrays = await SwapUtils.getTickArrays(
              whirlpoolData.tickCurrentIndex,
              whirlpoolData.tickSpacing,
              aToB,
              ctx.program.programId,
              whirlpoolKey,
              fetcher,
              IGNORE_CACHE,
            );
  
            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.swapV2Ix(ctx.program, {
                  amount: inputAmount,
                  otherAmountThreshold: new BN(0),
                  sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
                  amountSpecifiedIsInput: true,
                  aToB,
                  tickArray0: tickArrays[0].address,
                  tickArray1: tickArrays[0].address,
                  tickArray2: tickArrays[0].address,    
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
              ).buildAndExecute(),
              /0x1793/, // ZeroTradableAmount (All amount is collected as transfer fee...)
            );

            return;
          }

          const transferFeeExcludedInputAmount = transferFeeA
            ? calculateTransferFeeExcludedAmount(transferFeeA, inputAmount)
            : { amount: inputAmount, fee: ZERO_BN };
          if (transferFeeA && transferFeeA.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedInputAmount.fee.gtn(0));

          const quoteAToB = swapQuoteWithParams(
            {
              // A --> B, ExactIn
              amountSpecifiedIsInput: true,
              aToB,
              tokenAmount: transferFeeExcludedInputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                aToB,
                ctx.program.programId,
                whirlpoolKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100), // 0% slippage
          );

          const transferFeeExcludedOutputAmount = transferFeeB
            ? calculateTransferFeeExcludedAmount(transferFeeB, quoteAToB.estimatedAmountOut)
            : { amount: quoteAToB.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeB && transferFeeB.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedOutputAmount.fee.gtn(0));

          const expectedOwnerAccountADelta = inputAmount.neg(); // out
          const expectedOwnerAccountBDelta = transferFeeExcludedOutputAmount.amount; // in
          const expectedVaultAccountADelta = transferFeeExcludedInputAmount.amount; // in
          const expectedVaultAccountBDelta = quoteAToB.estimatedAmountOut.neg(); // out
          assert.ok(expectedVaultAccountADelta.eq(quoteAToB.estimatedAmountIn));
          assert.ok(expectedVaultAccountBDelta.eq(quoteAToB.estimatedAmountOut.neg()));

          const preVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const preVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const preOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const preOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, {
                ...quoteAToB,
                amount: inputAmount, // transfer fee included
                otherAmountThreshold: transferFeeExcludedOutputAmount.amount.addn(1), // transfer fee excluded
  
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
            ).buildAndExecute(),
            /0x1794/, // AmountOutBelowMinimum
          );
    
          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quoteAToB,
              amount: inputAmount, // transfer fee included
              otherAmountThreshold: transferFeeExcludedOutputAmount.amount, // transfer fee excluded

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

          const postVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const postVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const postOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const postOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

          assert.ok(postVaultBalanceA.sub(preVaultBalanceA).eq(expectedVaultAccountADelta));
          assert.ok(postVaultBalanceB.sub(preVaultBalanceB).eq(expectedVaultAccountBDelta));
          assert.ok(
            postOwnerAccountBalanceA.sub(preOwnerAccountBalanceA).eq(expectedOwnerAccountADelta),
          );
          assert.ok(
            postOwnerAccountBalanceB.sub(preOwnerAccountBalanceB).eq(expectedOwnerAccountBDelta),
          );
        });

        it("A <-- B, ExactIn", async () => {
          const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
          const whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const aToB = false;
          const inputAmount = new BN(100000);

          // edge-case
          if (transferFeeB!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeB!.maximumFee === BigInt(U64_MAX.toString())) {
            // we cannot determine input size because all amount will be collected as transfer fee
            const tickArrays = await SwapUtils.getTickArrays(
              whirlpoolData.tickCurrentIndex,
              whirlpoolData.tickSpacing,
              aToB,
              ctx.program.programId,
              whirlpoolKey,
              fetcher,
              IGNORE_CACHE,
            );
  
            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.swapV2Ix(ctx.program, {
                  amount: inputAmount,
                  otherAmountThreshold: new BN(0),
                  sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
                  amountSpecifiedIsInput: true,
                  aToB,
                  tickArray0: tickArrays[0].address,
                  tickArray1: tickArrays[0].address,
                  tickArray2: tickArrays[0].address,    
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
              ).buildAndExecute(),
              /0x1793/, // ZeroTradableAmount (All amount is collected as transfer fee...)
            );

            return;
          }

          const transferFeeExcludedInputAmount = transferFeeB
            ? calculateTransferFeeExcludedAmount(transferFeeB, inputAmount)
            : { amount: inputAmount, fee: ZERO_BN };
          if (transferFeeB && transferFeeB.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedInputAmount.fee.gtn(0));

          const quoteBToA = swapQuoteWithParams(
            {
              // A <-- B, ExactIn
              amountSpecifiedIsInput: true,
              aToB,
              tokenAmount: transferFeeExcludedInputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                aToB,
                ctx.program.programId,
                whirlpoolKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100), // 0% slippage
          );

          const transferFeeExcludedOutputAmount = transferFeeA
            ? calculateTransferFeeExcludedAmount(transferFeeA, quoteBToA.estimatedAmountOut)
            : { amount: quoteBToA.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeA && transferFeeA.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedOutputAmount.fee.gtn(0));

          const expectedOwnerAccountADelta = transferFeeExcludedOutputAmount.amount; // in
          const expectedOwnerAccountBDelta = inputAmount.neg(); // out
          const expectedVaultAccountADelta = quoteBToA.estimatedAmountOut.neg(); // out
          const expectedVaultAccountBDelta = transferFeeExcludedInputAmount.amount; // in
          assert.ok(expectedVaultAccountADelta.eq(quoteBToA.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountBDelta.eq(quoteBToA.estimatedAmountIn));

          const preVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const preVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const preOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const preOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, {
                ...quoteBToA,
                amount: inputAmount, // transfer fee included
                otherAmountThreshold: transferFeeExcludedOutputAmount.amount.addn(1), // transfer fee excluded
  
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
            ).buildAndExecute(),
            /0x1794/, // AmountOutBelowMinimum
          );

          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quoteBToA,
              amount: inputAmount, // transfer fee included
              otherAmountThreshold: transferFeeExcludedOutputAmount.amount, // transfer fee excluded

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

          const postVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const postVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const postOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const postOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

          assert.ok(postVaultBalanceA.sub(preVaultBalanceA).eq(expectedVaultAccountADelta));
          assert.ok(postVaultBalanceB.sub(preVaultBalanceB).eq(expectedVaultAccountBDelta));
          assert.ok(
            postOwnerAccountBalanceA.sub(preOwnerAccountBalanceA).eq(expectedOwnerAccountADelta),
          );
          assert.ok(
            postOwnerAccountBalanceB.sub(preOwnerAccountBalanceB).eq(expectedOwnerAccountBDelta),
          );
        });

        it("A --> B, ExactOut", async () => {
          const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
          const whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const aToB = true;
          const outputAmount = new BN(2000000);

          // edge-case
          if (transferFeeA!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeA!.maximumFee === BigInt(U64_MAX.toString())) {
            // we cannot determine input size because all amount will be collected as transfer fee
            const tickArrays = await SwapUtils.getTickArrays(
              whirlpoolData.tickCurrentIndex,
              whirlpoolData.tickSpacing,
              aToB,
              ctx.program.programId,
              whirlpoolKey,
              fetcher,
              IGNORE_CACHE,
            );
  
            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.swapV2Ix(ctx.program, {
                  amount: outputAmount,
                  otherAmountThreshold: U64_MAX,
                  sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
                  amountSpecifiedIsInput: false,
                  aToB,
                  tickArray0: tickArrays[0].address,
                  tickArray1: tickArrays[0].address,
                  tickArray2: tickArrays[0].address,    
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
              ).buildAndExecute(),
              /0x17a4/, // TransferFeeCalculationError
            );

            return;
          }

          if (transferFeeB!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeB!.maximumFee === BigInt(U64_MAX.toString())) {
            // we cannot determine output size including transfer fee because all amount will be collected as transfer fee
            const tickArrays = await SwapUtils.getTickArrays(
              whirlpoolData.tickCurrentIndex,
              whirlpoolData.tickSpacing,
              aToB,
              ctx.program.programId,
              whirlpoolKey,
              fetcher,
              IGNORE_CACHE,
            );
  
            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.swapV2Ix(ctx.program, {
                  amount: outputAmount,
                  otherAmountThreshold: U64_MAX,
                  sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
                  amountSpecifiedIsInput: false,
                  aToB,
                  tickArray0: tickArrays[0].address,
                  tickArray1: tickArrays[0].address,
                  tickArray2: tickArrays[0].address,    
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
              ).buildAndExecute(),
              /0x17a4/, // TransferFeeCalculationError
            );

            return;
          }

          const transferFeeIncludedOutputAmount = transferFeeB
            ? calculateTransferFeeIncludedAmount(transferFeeB, outputAmount)
            : { amount: outputAmount, fee: ZERO_BN };
          if (transferFeeB && transferFeeB.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedOutputAmount.fee.gtn(0));

          const quoteAToB = swapQuoteWithParams(
            {
              // A --> B, ExactOut
              amountSpecifiedIsInput: false,
              aToB,
              tokenAmount: transferFeeIncludedOutputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                aToB,
                ctx.program.programId,
                whirlpoolKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100), // 0% slippage
          );

          const transferFeeIncludedInputAmount = transferFeeA
            ? calculateTransferFeeIncludedAmount(transferFeeA, quoteAToB.estimatedAmountIn)
            : { amount: quoteAToB.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeA && transferFeeA.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedInputAmount.fee.gtn(0));

          const expectedOwnerAccountADelta = transferFeeIncludedInputAmount.amount.neg(); // out
          const expectedOwnerAccountBDelta = outputAmount; // in
          const expectedVaultAccountADelta = quoteAToB.estimatedAmountIn; // in
          const expectedVaultAccountBDelta = transferFeeIncludedOutputAmount.amount.neg(); // out
          assert.ok(expectedVaultAccountADelta.eq(quoteAToB.estimatedAmountIn));
          assert.ok(expectedVaultAccountBDelta.eq(quoteAToB.estimatedAmountOut.neg()));

          const preVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const preVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const preOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const preOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, {
                ...quoteAToB,
                amount: outputAmount, // transfer fee excluded
                otherAmountThreshold: transferFeeIncludedInputAmount.amount.subn(1), // transfer fee included
  
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
            ).buildAndExecute(),
            /0x1795/, // AmountInAboveMaximum
          );
          
          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quoteAToB,
              amount: outputAmount, // transfer fee excluded
              otherAmountThreshold: transferFeeIncludedInputAmount.amount, // transfer fee included

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

          const postVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const postVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const postOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const postOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

          assert.ok(postVaultBalanceA.sub(preVaultBalanceA).eq(expectedVaultAccountADelta));
          assert.ok(postVaultBalanceB.sub(preVaultBalanceB).eq(expectedVaultAccountBDelta));
          assert.ok(
            postOwnerAccountBalanceA.sub(preOwnerAccountBalanceA).eq(expectedOwnerAccountADelta),
          );
          assert.ok(
            postOwnerAccountBalanceB.sub(preOwnerAccountBalanceB).eq(expectedOwnerAccountBDelta),
          );
        });

        it("A <-- B, ExactOut", async () => {
          const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
          const whirlpoolData = (await fetcher.getPool(
            whirlpoolKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          const aToB = false;
          const outputAmount = new BN(100000);

          // edge-case
          if (transferFeeA!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeA!.maximumFee === BigInt(U64_MAX.toString())) {
            // we cannot determine output size including transfer fee because all amount will be collected as transfer fee
            const tickArrays = await SwapUtils.getTickArrays(
              whirlpoolData.tickCurrentIndex,
              whirlpoolData.tickSpacing,
              aToB,
              ctx.program.programId,
              whirlpoolKey,
              fetcher,
              IGNORE_CACHE,
            );
  
            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.swapV2Ix(ctx.program, {
                  amount: outputAmount,
                  otherAmountThreshold: U64_MAX,
                  sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
                  amountSpecifiedIsInput: false,
                  aToB,
                  tickArray0: tickArrays[0].address,
                  tickArray1: tickArrays[0].address,
                  tickArray2: tickArrays[0].address,    
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
              ).buildAndExecute(),
              /0x17a4/, // TransferFeeCalculationError
            );

            return;
          }

          if (transferFeeB!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeB!.maximumFee === BigInt(U64_MAX.toString())) {
            // we cannot determine input size because all amount will be collected as transfer fee
            const tickArrays = await SwapUtils.getTickArrays(
              whirlpoolData.tickCurrentIndex,
              whirlpoolData.tickSpacing,
              aToB,
              ctx.program.programId,
              whirlpoolKey,
              fetcher,
              IGNORE_CACHE,
            );
  
            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.swapV2Ix(ctx.program, {
                  amount: outputAmount,
                  otherAmountThreshold: U64_MAX,
                  sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
                  amountSpecifiedIsInput: false,
                  aToB,
                  tickArray0: tickArrays[0].address,
                  tickArray1: tickArrays[0].address,
                  tickArray2: tickArrays[0].address,    
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
              ).buildAndExecute(),
              /0x17a4/, // TransferFeeCalculationError
            );

            return;
          }

          const transferFeeIncludedOutputAmount = transferFeeA
            ? calculateTransferFeeIncludedAmount(transferFeeA, outputAmount)
            : { amount: outputAmount, fee: ZERO_BN };
          if (transferFeeA && transferFeeA.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedOutputAmount.fee.gtn(0));

          const quoteBToA = swapQuoteWithParams(
            {
              // A <-- B, ExactOut
              amountSpecifiedIsInput: false,
              aToB,
              tokenAmount: transferFeeIncludedOutputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                aToB,
                ctx.program.programId,
                whirlpoolKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100), // 0% slippage
          );

          const transferFeeIncludedInputAmount = transferFeeB
            ? calculateTransferFeeIncludedAmount(transferFeeB, quoteBToA.estimatedAmountIn)
            : { amount: quoteBToA.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeB && transferFeeB.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedInputAmount.fee.gtn(0));

          const expectedOwnerAccountADelta = outputAmount; // in
          const expectedOwnerAccountBDelta = transferFeeIncludedInputAmount.amount.neg(); // out
          const expectedVaultAccountADelta = transferFeeIncludedOutputAmount.amount.neg(); // out
          const expectedVaultAccountBDelta = quoteBToA.estimatedAmountIn; // in
          assert.ok(expectedVaultAccountADelta.eq(quoteBToA.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountBDelta.eq(quoteBToA.estimatedAmountIn));

          const preVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const preVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const preOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const preOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));


          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.swapV2Ix(ctx.program, {
                ...quoteBToA,
                amount: outputAmount, // transfer fee excluded
                otherAmountThreshold: transferFeeIncludedInputAmount.amount.subn(1), // transfer fee included
  
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
            ).buildAndExecute(),
            /0x1795/, // AmountInAboveMaximum
          );

          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quoteBToA,
              amount: outputAmount, // transfer fee excluded
              otherAmountThreshold: transferFeeIncludedInputAmount.amount, // transfer fee included

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

          const postVaultBalanceA = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey),
          );
          const postVaultBalanceB = new BN(
            await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey),
          );
          const postOwnerAccountBalanceA = new BN(await getTokenBalance(provider, tokenAccountA));
          const postOwnerAccountBalanceB = new BN(await getTokenBalance(provider, tokenAccountB));

          assert.ok(postVaultBalanceA.sub(preVaultBalanceA).eq(expectedVaultAccountADelta));
          assert.ok(postVaultBalanceB.sub(preVaultBalanceB).eq(expectedVaultAccountBDelta));
          assert.ok(
            postOwnerAccountBalanceA.sub(preOwnerAccountBalanceA).eq(expectedOwnerAccountADelta),
          );
          assert.ok(
            postOwnerAccountBalanceB.sub(preOwnerAccountBalanceB).eq(expectedOwnerAccountBDelta),
          );
        });
      });
    });
  });

  describe("two_hop_swap", () => {
    let aqConfig: InitAquariumV2Params;
    let aquarium: TestAquarium;
    let whirlpoolOneKey: PublicKey;
    let whirlpoolTwoKey: PublicKey;
    let whirlpoolDataOne: WhirlpoolData;
    let whirlpoolDataTwo: WhirlpoolData;

    const variations: TokenTrait[][] = [
      // all token has transfer fee
      [
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 300 },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 500 },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 1000 },
      ],
      // input token has transfer fee
      [
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 300 },
        { isToken2022: true, hasTransferFeeExtension: false },
        { isToken2022: true, hasTransferFeeExtension: false },
      ],
      // input and mid token has transfer fee
      [
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 300 },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 500 },
        { isToken2022: true, hasTransferFeeExtension: false },
      ],
      // output token has transfer fee
      [
        { isToken2022: true, hasTransferFeeExtension: false },
        { isToken2022: true, hasTransferFeeExtension: false },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 1000 },
      ],
      // output and mid token has transfer fee
      [
        { isToken2022: true, hasTransferFeeExtension: false },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 500 },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 1000 },
      ],
      // mid token has transfer fee
      [
        { isToken2022: true, hasTransferFeeExtension: false },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 500 },
        { isToken2022: true, hasTransferFeeExtension: false },
      ],
      // input and output token has transfer fee
      [
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 300 },
        { isToken2022: true, hasTransferFeeExtension: false },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 1000 },
      ],
      // all token has transfer fee, but bps are zero
      [
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
      ],
    ];

    variations.forEach(([token0, token1, token2]) => {
      const label0 = `Token0: transfer fee bps = ${
        token0.hasTransferFeeExtension ? token0.transferFeeInitialBps?.toString() : "none"
      }`;
      const label1 = `Token1: transfer fee bps = ${
        token1.hasTransferFeeExtension ? token1.transferFeeInitialBps?.toString() : "none"
      }`;
      const label2 = `Token2: transfer fee bps = ${
        token2.hasTransferFeeExtension ? token2.transferFeeInitialBps?.toString() : "none"
      }`;

      describe(`${label0}, ${label1}, ${label2}`, () => {
        beforeEach(async () => {
          aqConfig = getDefaultAquariumV2();
          // Add a third token and account and a second pool
          aqConfig.initMintParams = [
            { tokenTrait: token0 },
            { tokenTrait: token1 },
            { tokenTrait: token2 },
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

          aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
          const { pools } = aquarium;

          whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
          whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
          whirlpoolDataOne = (await fetcher.getPool(
            whirlpoolOneKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          whirlpoolDataTwo = (await fetcher.getPool(
            whirlpoolTwoKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
        });

        it("T0 --> T1 --> T2, ExactIn", async () => {
          const [inputToken, midToken, outputToken] = aquarium.mintKeys;
          const [inputTokenTrait, midTokenTrait, outputTokenTrait] = [token0, token1, token2];

          const transferFeeInput = inputTokenTrait.hasTransferFeeExtension ? await getTransferFee(inputToken) : null;
          const transferFeeMid = midTokenTrait.hasTransferFeeExtension ? await getTransferFee(midToken) : null;
          const transferFeeOutput = outputTokenTrait.hasTransferFeeExtension ? await getTransferFee(outputToken) : null;

          const inputAmount = new BN(1000);
          const transferFeeExcludedInputAmount = transferFeeInput
            ? calculateTransferFeeExcludedAmount(transferFeeInput, inputAmount)
            : { amount: inputAmount, fee: ZERO_BN };
          if (transferFeeInput && transferFeeInput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedInputAmount.fee.gtn(0));

          const aToBOne = whirlpoolDataOne.tokenMintA.equals(inputToken);
          const quote = swapQuoteWithParams(
            {
              // T0 --> T1, ExactIn
              amountSpecifiedIsInput: true,
              aToB: aToBOne,
              tokenAmount: transferFeeExcludedInputAmount.amount,

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
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100),
          );

          /*
          // vault -> owner
          const transferFeeExcludedMidOutputAmount = transferFeeMid
            ? calculateTransferFeeExcludedAmount(transferFeeMid, quote.estimatedAmountOut)
            : { amount: quote.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedMidOutputAmount.fee.gtn(0));

          // owner -> vault
          const transferFeeExcludedMidInputAmount = transferFeeMid
            ? calculateTransferFeeExcludedAmount(transferFeeMid, transferFeeExcludedMidOutputAmount.amount)
            : { amount: transferFeeExcludedMidOutputAmount.amount, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedMidInputAmount.fee.gtn(0));
          */
         
          // vault to vault
          const transferFeeExcludedMidInputAmount = transferFeeMid
            ? calculateTransferFeeExcludedAmount(transferFeeMid, quote.estimatedAmountOut)
            : { amount: quote.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedMidInputAmount.fee.gtn(0));

          const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(midToken);
          const quote2 = swapQuoteWithParams(
            {
              // T1 --> T2, ExactIn
              amountSpecifiedIsInput: true,
              aToB: aToBTwo,
              tokenAmount: transferFeeExcludedMidInputAmount.amount,

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
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later              
            },
            Percentage.fromFraction(0, 100),
          );

          const transferFeeExcludedOutputAmount = transferFeeOutput
           ? calculateTransferFeeExcludedAmount(transferFeeOutput, quote2.estimatedAmountOut)
            : { amount: quote2.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeOutput && transferFeeOutput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedOutputAmount.fee.gtn(0));

          const expectedOwnerAccountInputDelta = inputAmount.neg(); // out
          const expectedOwnerAccountMidDelta = ZERO_BN; // in = out
          const expectedOwnerAccountOutputDelta = transferFeeExcludedOutputAmount.amount; // in
          const [expectedVaultAccountOneADelta, expectedVaultAccountOneBDelta] = aToBOne
            ? [transferFeeExcludedInputAmount.amount, quote.estimatedAmountOut.neg()]
            : [quote.estimatedAmountOut.neg(), transferFeeExcludedInputAmount.amount];
          const [expectedVaultAccountTwoADelta, expectedVaultAccountTwoBDelta] = aToBTwo
            ? [transferFeeExcludedMidInputAmount.amount, quote2.estimatedAmountOut.neg()]
            : [quote2.estimatedAmountOut.neg(), transferFeeExcludedMidInputAmount.amount];
          assert.ok(expectedVaultAccountOneADelta.eq(aToBOne ? quote.estimatedAmountIn : quote.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountOneBDelta.eq(aToBOne ? quote.estimatedAmountOut.neg() : quote.estimatedAmountIn));
          assert.ok(expectedVaultAccountTwoADelta.eq(aToBTwo ? quote2.estimatedAmountIn : quote2.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountTwoBDelta.eq(aToBTwo ? quote2.estimatedAmountOut.neg() : quote2.estimatedAmountIn));

          const pools = aquarium.pools;
          const tokenAccKeys = getTokenAccsForPoolsV2(pools, aquarium.tokenAccounts);
          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);
          const baseIxParams: TwoHopSwapV2Params = {
            ...twoHopQuote,
            amount: inputAmount, // transfer fee included
            otherAmountThreshold: transferFeeExcludedOutputAmount.amount, // transfer fee excluded

            tokenAuthority: ctx.wallet.publicKey,
            whirlpoolOne: pools[0].whirlpoolPda.publicKey,
            whirlpoolTwo: pools[1].whirlpoolPda.publicKey,
            tokenMintInput: twoHopQuote.aToBOne ? pools[0].tokenMintA : pools[0].tokenMintB,
            tokenMintIntermediate: twoHopQuote.aToBOne ? pools[0].tokenMintB : pools[0].tokenMintA,
            tokenMintOutput: twoHopQuote.aToBTwo ? pools[1].tokenMintB : pools[1].tokenMintA,
            tokenProgramInput: twoHopQuote.aToBOne ? pools[0].tokenProgramA : pools[0].tokenProgramB,
            tokenProgramIntermediate: twoHopQuote.aToBOne ? pools[0].tokenProgramB : pools[0].tokenProgramA,
            tokenProgramOutput: twoHopQuote.aToBTwo ? pools[1].tokenProgramB : pools[1].tokenProgramA,
            tokenOwnerAccountInput: twoHopQuote.aToBOne ? tokenAccKeys[0] : tokenAccKeys[1],
            tokenOwnerAccountOutput: twoHopQuote.aToBTwo ? tokenAccKeys[3] : tokenAccKeys[2],
            tokenVaultOneInput: twoHopQuote.aToBOne ? pools[0].tokenVaultAKeypair.publicKey : pools[0].tokenVaultBKeypair.publicKey,
            tokenVaultOneIntermediate: twoHopQuote.aToBOne ? pools[0].tokenVaultBKeypair.publicKey : pools[0].tokenVaultAKeypair.publicKey,
            tokenVaultTwoIntermediate: twoHopQuote.aToBTwo ? pools[1].tokenVaultAKeypair.publicKey : pools[1].tokenVaultBKeypair.publicKey,
            tokenVaultTwoOutput: twoHopQuote.aToBTwo ? pools[1].tokenVaultBKeypair.publicKey : pools[1].tokenVaultAKeypair.publicKey,
                oracleOne: PDAUtil.getOracle(ctx.program.programId, pools[0].whirlpoolPda.publicKey)
              .publicKey,
            oracleTwo: PDAUtil.getOracle(ctx.program.programId, pools[1].whirlpoolPda.publicKey)
              .publicKey,
          };
    
          const preVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const preVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const preVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const preVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const preOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const preOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                ...baseIxParams,
                otherAmountThreshold: baseIxParams.otherAmountThreshold.addn(1),
              })
            ).prependInstruction(useMaxCU()).buildAndExecute(), // add CU
            /0x1794/, // AmountOutBelowMinimum
          );

          await toTx(
            ctx,
            WhirlpoolIx.twoHopSwapV2Ix(ctx.program, baseIxParams)
          ).prependInstruction(useMaxCU()).buildAndExecute(); // add CU

          const postVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const postVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const postVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const postVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const postOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const postOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          assert.ok(postVaultBalanceOneA.sub(preVaultBalanceOneA).eq(expectedVaultAccountOneADelta));
          assert.ok(postVaultBalanceOneB.sub(preVaultBalanceOneB).eq(expectedVaultAccountOneBDelta));
          assert.ok(postVaultBalanceTwoA.sub(preVaultBalanceTwoA).eq(expectedVaultAccountTwoADelta));
          assert.ok(postVaultBalanceTwoB.sub(preVaultBalanceTwoB).eq(expectedVaultAccountTwoBDelta));
          assert.ok(postOwnerAccountBalanceInput.sub(preOwnerAccountBalanceInput).eq(expectedOwnerAccountInputDelta));
          assert.ok(postOwnerAccountBalanceOutput.sub(preOwnerAccountBalanceOutput).eq(expectedOwnerAccountOutputDelta));

          //console.log(`aToB: ${aToBOne} ${aToBTwo}`);
          //console.log("in", transferFeeExcludedInputAmount.amount.toString(), transferFeeExcludedInputAmount.fee.toString());
          //console.log("midout", transferFeeExcludedMidOutputAmount.amount.toString(), transferFeeExcludedMidOutputAmount.fee.toString());
          //console.log("midin", transferFeeExcludedMidInputAmount.amount.toString(), transferFeeExcludedMidInputAmount.fee.toString());
          //console.log("out", transferFeeExcludedOutputAmount.amount.toString(), transferFeeExcludedOutputAmount.fee.toString());
          //console.log("q1", quote.estimatedAmountIn.toString(), quote.estimatedAmountOut.toString());
          //console.log("q2", quote2.estimatedAmountIn.toString(), quote2.estimatedAmountOut.toString());
        });

        it("T0 <-- T1 <-- T2, ExactIn", async () => {
          const [outputToken, midToken, inputToken] = aquarium.mintKeys;
          const [outputTokenTrait, midTokenTrait, inputTokenTrait] = [token0, token1, token2];

          const transferFeeInput = inputTokenTrait.hasTransferFeeExtension ? await getTransferFee(inputToken) : null;
          const transferFeeMid = midTokenTrait.hasTransferFeeExtension ? await getTransferFee(midToken) : null;
          const transferFeeOutput = outputTokenTrait.hasTransferFeeExtension ? await getTransferFee(outputToken) : null;

          const inputAmount = new BN(100000);
          const transferFeeExcludedInputAmount = transferFeeInput
            ? calculateTransferFeeExcludedAmount(transferFeeInput, inputAmount)
            : { amount: inputAmount, fee: ZERO_BN };
          if (transferFeeInput && transferFeeInput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedInputAmount.fee.gtn(0));

          const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(inputToken);
          const quote = swapQuoteWithParams(
            {
              // T1 <-- T2, ExactIn
              amountSpecifiedIsInput: true,
              aToB: aToBTwo,
              tokenAmount: transferFeeExcludedInputAmount.amount,

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
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100),
          );

          /*
          // vault -> owner
          const transferFeeExcludedMidOutputAmount = transferFeeMid
            ? calculateTransferFeeExcludedAmount(transferFeeMid, quote.estimatedAmountOut)
            : { amount: quote.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedMidOutputAmount.fee.gtn(0));

          // owner -> vault
          const transferFeeExcludedMidInputAmount = transferFeeMid
            ? calculateTransferFeeExcludedAmount(transferFeeMid, transferFeeExcludedMidOutputAmount.amount)
            : { amount: transferFeeExcludedMidOutputAmount.amount, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedMidInputAmount.fee.gtn(0));
          */

          // vault to vault
          const transferFeeExcludedMidInputAmount = transferFeeMid
            ? calculateTransferFeeExcludedAmount(transferFeeMid, quote.estimatedAmountOut)
            : { amount: quote.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedMidInputAmount.fee.gtn(0));

          const aToBOne = whirlpoolDataOne.tokenMintA.equals(midToken);
          const quote2 = swapQuoteWithParams(
            {
              // T0 <-- T1, ExactIn
              amountSpecifiedIsInput: true,
              aToB: aToBOne,
              tokenAmount: transferFeeExcludedMidInputAmount.amount,

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
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100),
          );

          const transferFeeExcludedOutputAmount = transferFeeOutput
           ? calculateTransferFeeExcludedAmount(transferFeeOutput, quote2.estimatedAmountOut)
            : { amount: quote2.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeOutput && transferFeeOutput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedOutputAmount.fee.gtn(0));

          const expectedOwnerAccountInputDelta = inputAmount.neg(); // out
          const expectedOwnerAccountMidDelta = ZERO_BN; // in = out
          const expectedOwnerAccountOutputDelta = transferFeeExcludedOutputAmount.amount; // in
          const [expectedVaultAccountOneADelta, expectedVaultAccountOneBDelta] = aToBOne
            ? [transferFeeExcludedInputAmount.amount, quote.estimatedAmountOut.neg()]
            : [quote.estimatedAmountOut.neg(), transferFeeExcludedInputAmount.amount];
          const [expectedVaultAccountTwoADelta, expectedVaultAccountTwoBDelta] = aToBTwo
            ? [transferFeeExcludedMidInputAmount.amount, quote2.estimatedAmountOut.neg()]
            : [quote2.estimatedAmountOut.neg(), transferFeeExcludedMidInputAmount.amount];
          assert.ok(expectedVaultAccountOneADelta.eq(aToBOne ? quote.estimatedAmountIn : quote.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountOneBDelta.eq(aToBOne ? quote.estimatedAmountOut.neg() : quote.estimatedAmountIn));
          assert.ok(expectedVaultAccountTwoADelta.eq(aToBTwo ? quote2.estimatedAmountIn : quote2.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountTwoBDelta.eq(aToBTwo ? quote2.estimatedAmountOut.neg() : quote2.estimatedAmountIn));

          const pools = aquarium.pools;
          const tokenAccKeys = getTokenAccsForPoolsV2(pools, aquarium.tokenAccounts);
          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);
          const baseIxParams: TwoHopSwapV2Params = {
            ...twoHopQuote,
            amount: inputAmount, // transfer fee included
            otherAmountThreshold: transferFeeExcludedOutputAmount.amount, // transfer fee excluded

            tokenAuthority: ctx.wallet.publicKey,
            whirlpoolOne: pools[1].whirlpoolPda.publicKey,
            whirlpoolTwo: pools[0].whirlpoolPda.publicKey,
            tokenMintInput: aToBTwo ? pools[1].tokenMintA : pools[1].tokenMintB,
            tokenMintIntermediate: aToBTwo ? pools[1].tokenMintB : pools[1].tokenMintA,
            tokenMintOutput: aToBOne ? pools[0].tokenMintB : pools[0].tokenMintA,
            tokenProgramInput: aToBTwo ? pools[1].tokenProgramA : pools[1].tokenProgramB,
            tokenProgramIntermediate: aToBTwo ? pools[1].tokenProgramB : pools[1].tokenProgramA,
            tokenProgramOutput: aToBOne ? pools[0].tokenProgramB : pools[0].tokenProgramA,
            tokenOwnerAccountInput: aToBTwo ? tokenAccKeys[2] : tokenAccKeys[3],
            tokenOwnerAccountOutput: aToBOne ? tokenAccKeys[1] : tokenAccKeys[0],
            tokenVaultOneInput: aToBTwo ? pools[1].tokenVaultAKeypair.publicKey : pools[1].tokenVaultBKeypair.publicKey,
            tokenVaultOneIntermediate: aToBTwo ? pools[1].tokenVaultBKeypair.publicKey : pools[1].tokenVaultAKeypair.publicKey,
            tokenVaultTwoIntermediate: aToBOne ? pools[0].tokenVaultAKeypair.publicKey : pools[0].tokenVaultBKeypair.publicKey,
            tokenVaultTwoOutput: aToBOne ? pools[0].tokenVaultBKeypair.publicKey : pools[0].tokenVaultAKeypair.publicKey,
                oracleOne: PDAUtil.getOracle(ctx.program.programId, pools[1].whirlpoolPda.publicKey)
              .publicKey,
            oracleTwo: PDAUtil.getOracle(ctx.program.programId, pools[0].whirlpoolPda.publicKey)
              .publicKey,
          };

          const preVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const preVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const preVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const preVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const preOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const preOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                ...baseIxParams,
                otherAmountThreshold: baseIxParams.otherAmountThreshold.addn(1),
              })
            ).prependInstruction(useMaxCU()).buildAndExecute(), // add CU
            /0x1794/, // AmountOutBelowMinimum
          );

          await toTx(
            ctx,
            WhirlpoolIx.twoHopSwapV2Ix(ctx.program, baseIxParams)
          ).prependInstruction(useMaxCU()).buildAndExecute(); // add CU

          const postVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const postVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const postVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const postVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const postOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const postOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          assert.ok(postVaultBalanceOneA.sub(preVaultBalanceOneA).eq(expectedVaultAccountOneADelta));
          assert.ok(postVaultBalanceOneB.sub(preVaultBalanceOneB).eq(expectedVaultAccountOneBDelta));
          assert.ok(postVaultBalanceTwoA.sub(preVaultBalanceTwoA).eq(expectedVaultAccountTwoADelta));
          assert.ok(postVaultBalanceTwoB.sub(preVaultBalanceTwoB).eq(expectedVaultAccountTwoBDelta));
          assert.ok(postOwnerAccountBalanceInput.sub(preOwnerAccountBalanceInput).eq(expectedOwnerAccountInputDelta));
          assert.ok(postOwnerAccountBalanceOutput.sub(preOwnerAccountBalanceOutput).eq(expectedOwnerAccountOutputDelta));

          //console.log(`aToB: ${aToBTwo} ${aToBOne}`);
          //console.log("in", transferFeeExcludedInputAmount.amount.toString(), transferFeeExcludedInputAmount.fee.toString());
          //console.log("midout", transferFeeExcludedMidOutputAmount.amount.toString(), transferFeeExcludedMidOutputAmount.fee.toString());
          //console.log("midin", transferFeeExcludedMidInputAmount.amount.toString(), transferFeeExcludedMidInputAmount.fee.toString());
          //console.log("out", transferFeeExcludedOutputAmount.amount.toString(), transferFeeExcludedOutputAmount.fee.toString());
          //console.log("q1", quote.estimatedAmountIn.toString(), quote.estimatedAmountOut.toString());
          //console.log("q2", quote2.estimatedAmountIn.toString(), quote2.estimatedAmountOut.toString());
        })

        it("T0 --> T1 --> T2, ExactOut", async () => {
          const [inputToken, midToken, outputToken] = aquarium.mintKeys;
          const [inputTokenTrait, midTokenTrait, outputTokenTrait] = [token0, token1, token2];

          const transferFeeInput = inputTokenTrait.hasTransferFeeExtension ? await getTransferFee(inputToken) : null;
          const transferFeeMid = midTokenTrait.hasTransferFeeExtension ? await getTransferFee(midToken) : null;
          const transferFeeOutput = outputTokenTrait.hasTransferFeeExtension ? await getTransferFee(outputToken) : null;

          const outputAmount = new BN(500000);
          const transferFeeIncludedOutputAmount = transferFeeOutput
            ? calculateTransferFeeIncludedAmount(transferFeeOutput, outputAmount)
            : { amount: outputAmount, fee: ZERO_BN };
          if (transferFeeOutput && transferFeeOutput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedOutputAmount.fee.gtn(0));

          const aToBTwo = whirlpoolDataTwo.tokenMintB.equals(outputToken);
          const quote2 = swapQuoteWithParams(
            {
              // T1 --> T2, ExactOut
              amountSpecifiedIsInput: false,
              aToB: aToBTwo,
              tokenAmount: transferFeeIncludedOutputAmount.amount,

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
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100),
          );

          /*
          // owner -> vault
          const transferFeeIncludedMidInputAmount = transferFeeMid
            ? calculateTransferFeeIncludedAmount(transferFeeMid, quote2.estimatedAmountIn)
            : { amount: quote2.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedMidInputAmount.fee.gtn(0));

          // vault -> owner
          const transferFeeIncludedMidOutputAmount = transferFeeMid
            ? calculateTransferFeeIncludedAmount(transferFeeMid, transferFeeIncludedMidInputAmount.amount)
            : { amount: transferFeeIncludedMidInputAmount.amount, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedMidOutputAmount.fee.gtn(0));
          */

          // vault to vault
          const transferFeeIncludedMidOutputAmount = transferFeeMid
            ? calculateTransferFeeIncludedAmount(transferFeeMid, quote2.estimatedAmountIn)
            : { amount: quote2.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedMidOutputAmount.fee.gtn(0));

          const aToBOne = whirlpoolDataOne.tokenMintB.equals(midToken);
          const quote = swapQuoteWithParams(
            {
              // T0 --> T1, ExactOut
              amountSpecifiedIsInput: false,
              aToB: aToBOne,
              tokenAmount: transferFeeIncludedMidOutputAmount.amount,

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
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100),
          );

          const transferFeeIncludedInputAmount = transferFeeInput
           ? calculateTransferFeeIncludedAmount(transferFeeInput, quote.estimatedAmountIn)
            : { amount: quote.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeInput && transferFeeInput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedInputAmount.fee.gtn(0));

          const expectedOwnerAccountInputDelta = transferFeeIncludedInputAmount.amount.neg(); // out
          const expectedOwnerAccountMidDelta = ZERO_BN; // in = out
          const expectedOwnerAccountOutputDelta = outputAmount; // in
          const [expectedVaultAccountOneADelta, expectedVaultAccountOneBDelta] = aToBOne
            ? [quote.estimatedAmountIn, transferFeeIncludedMidOutputAmount.amount.neg()]
            : [transferFeeIncludedMidOutputAmount.amount.neg(), quote.estimatedAmountIn];
          const [expectedVaultAccountTwoADelta, expectedVaultAccountTwoBDelta] = aToBTwo
            ? [quote2.estimatedAmountIn, transferFeeIncludedOutputAmount.amount.neg()]
            : [transferFeeIncludedOutputAmount.amount.neg(), quote2.estimatedAmountIn];
          assert.ok(expectedVaultAccountOneADelta.eq(aToBOne ? quote.estimatedAmountIn : quote.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountOneBDelta.eq(aToBOne ? quote.estimatedAmountOut.neg() : quote.estimatedAmountIn));
          assert.ok(expectedVaultAccountTwoADelta.eq(aToBTwo ? quote2.estimatedAmountIn : quote2.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountTwoBDelta.eq(aToBTwo ? quote2.estimatedAmountOut.neg() : quote2.estimatedAmountIn));

          const pools = aquarium.pools;
          const tokenAccKeys = getTokenAccsForPoolsV2(pools, aquarium.tokenAccounts);
          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);
          const baseIxParams: TwoHopSwapV2Params = {
            ...twoHopQuote,
            amount: outputAmount, // transfer fee excluded
            otherAmountThreshold: transferFeeIncludedInputAmount.amount, // transfer fee included

            tokenAuthority: ctx.wallet.publicKey,
            whirlpoolOne: pools[0].whirlpoolPda.publicKey,
            whirlpoolTwo: pools[1].whirlpoolPda.publicKey,
            tokenMintInput: twoHopQuote.aToBOne ? pools[0].tokenMintA : pools[0].tokenMintB,
            tokenMintIntermediate: twoHopQuote.aToBOne ? pools[0].tokenMintB : pools[0].tokenMintA,
            tokenMintOutput: twoHopQuote.aToBTwo ? pools[1].tokenMintB : pools[1].tokenMintA,
            tokenProgramInput: twoHopQuote.aToBOne ? pools[0].tokenProgramA : pools[0].tokenProgramB,
            tokenProgramIntermediate: twoHopQuote.aToBOne ? pools[0].tokenProgramB : pools[0].tokenProgramA,
            tokenProgramOutput: twoHopQuote.aToBTwo ? pools[1].tokenProgramB : pools[1].tokenProgramA,
            tokenOwnerAccountInput: twoHopQuote.aToBOne ? tokenAccKeys[0] : tokenAccKeys[1],
            tokenOwnerAccountOutput: twoHopQuote.aToBTwo ? tokenAccKeys[3] : tokenAccKeys[2],
            tokenVaultOneInput: twoHopQuote.aToBOne ? pools[0].tokenVaultAKeypair.publicKey : pools[0].tokenVaultBKeypair.publicKey,
            tokenVaultOneIntermediate: twoHopQuote.aToBOne ? pools[0].tokenVaultBKeypair.publicKey : pools[0].tokenVaultAKeypair.publicKey,
            tokenVaultTwoIntermediate: twoHopQuote.aToBTwo ? pools[1].tokenVaultAKeypair.publicKey : pools[1].tokenVaultBKeypair.publicKey,
            tokenVaultTwoOutput: twoHopQuote.aToBTwo ? pools[1].tokenVaultBKeypair.publicKey : pools[1].tokenVaultAKeypair.publicKey,
                oracleOne: PDAUtil.getOracle(ctx.program.programId, pools[0].whirlpoolPda.publicKey)
              .publicKey,
            oracleTwo: PDAUtil.getOracle(ctx.program.programId, pools[1].whirlpoolPda.publicKey)
              .publicKey,
          };

          const preVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const preVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const preVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const preVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const preOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const preOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                ...baseIxParams,
                otherAmountThreshold: baseIxParams.otherAmountThreshold.subn(1),
              })
            ).prependInstruction(useMaxCU()).buildAndExecute(), // add CU
            /0x1795/, // AmountInAboveMaximum
          );

          await toTx(
            ctx,
            WhirlpoolIx.twoHopSwapV2Ix(ctx.program, baseIxParams)
          ).prependInstruction(useMaxCU()).buildAndExecute(); // add CU

          const postVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const postVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const postVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const postVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const postOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const postOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          assert.ok(postVaultBalanceOneA.sub(preVaultBalanceOneA).eq(expectedVaultAccountOneADelta));
          assert.ok(postVaultBalanceOneB.sub(preVaultBalanceOneB).eq(expectedVaultAccountOneBDelta));
          assert.ok(postVaultBalanceTwoA.sub(preVaultBalanceTwoA).eq(expectedVaultAccountTwoADelta));
          assert.ok(postVaultBalanceTwoB.sub(preVaultBalanceTwoB).eq(expectedVaultAccountTwoBDelta));
          assert.ok(postOwnerAccountBalanceInput.sub(preOwnerAccountBalanceInput).eq(expectedOwnerAccountInputDelta));
          assert.ok(postOwnerAccountBalanceOutput.sub(preOwnerAccountBalanceOutput).eq(expectedOwnerAccountOutputDelta));

          //console.log(`aToB: ${aToBOne} ${aToBTwo}`);
          //console.log("out", transferFeeIncludedOutputAmount.amount.toString(), transferFeeIncludedOutputAmount.fee.toString());
          //console.log("midin", transferFeeIncludedMidInputAmount.amount.toString(), transferFeeIncludedMidInputAmount.fee.toString());
          //console.log("midout", transferFeeIncludedMidOutputAmount.amount.toString(), transferFeeIncludedMidOutputAmount.fee.toString());
          //console.log("in", transferFeeIncludedInputAmount.amount.toString(), transferFeeIncludedInputAmount.fee.toString());
          //console.log("q2", quote2.estimatedAmountIn.toString(), quote2.estimatedAmountOut.toString());
          //console.log("q1", quote.estimatedAmountIn.toString(), quote.estimatedAmountOut.toString());
        });

        it("T0 <-- T1 <-- T2, ExactOut", async () => {
          const [outputToken, midToken, inputToken] = aquarium.mintKeys;
          const [outputTokenTrait, midTokenTrait, inputTokenTrait] = [token0, token1, token2];

          const transferFeeInput = inputTokenTrait.hasTransferFeeExtension ? await getTransferFee(inputToken) : null;
          const transferFeeMid = midTokenTrait.hasTransferFeeExtension ? await getTransferFee(midToken) : null;
          const transferFeeOutput = outputTokenTrait.hasTransferFeeExtension ? await getTransferFee(outputToken) : null;

          const outputAmount = new BN(1000);
          const transferFeeIncludedOutputAmount = transferFeeOutput
            ? calculateTransferFeeIncludedAmount(transferFeeOutput, outputAmount)
            : { amount: outputAmount, fee: ZERO_BN };
          if (transferFeeOutput && transferFeeOutput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedOutputAmount.fee.gtn(0));

          const aToBTwo = whirlpoolDataOne.tokenMintB.equals(outputToken);
          const quote2 = swapQuoteWithParams(
            {
              // T0 <-- T1, ExactOut
              amountSpecifiedIsInput: false,
              aToB: aToBTwo,
              tokenAmount: transferFeeIncludedOutputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
              whirlpoolData: whirlpoolDataOne,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataOne.tickCurrentIndex,
                whirlpoolDataOne.tickSpacing,
                aToBTwo,
                ctx.program.programId,
                whirlpoolOneKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100),
          );

          /*
          // owner -> vault
          const transferFeeIncludedMidInputAmount = transferFeeMid
            ? calculateTransferFeeIncludedAmount(transferFeeMid, quote2.estimatedAmountIn)
            : { amount: quote2.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedMidInputAmount.fee.gtn(0));

          // vault -> owner
          const transferFeeIncludedMidOutputAmount = transferFeeMid
            ? calculateTransferFeeIncludedAmount(transferFeeMid, transferFeeIncludedMidInputAmount.amount)
            : { amount: transferFeeIncludedMidInputAmount.amount, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedMidOutputAmount.fee.gtn(0));
          */

          // vault to vault
          const transferFeeIncludedMidOutputAmount = transferFeeMid
            ? calculateTransferFeeIncludedAmount(transferFeeMid, quote2.estimatedAmountIn)
            : { amount: quote2.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedMidOutputAmount.fee.gtn(0));

          const aToBOne = whirlpoolDataTwo.tokenMintB.equals(midToken);
          const quote = swapQuoteWithParams(
            {
              // T1 <-- T2, ExactOut
              amountSpecifiedIsInput: false,
              aToB: aToBOne,
              tokenAmount: transferFeeIncludedMidOutputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
              whirlpoolData: whirlpoolDataTwo,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataTwo.tickCurrentIndex,
                whirlpoolDataTwo.tickSpacing,
                aToBOne,
                ctx.program.programId,
                whirlpoolTwoKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100),
          );

          const transferFeeIncludedInputAmount = transferFeeInput
           ? calculateTransferFeeIncludedAmount(transferFeeInput, quote.estimatedAmountIn)
            : { amount: quote.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeInput && transferFeeInput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedInputAmount.fee.gtn(0));

          const expectedOwnerAccountInputDelta = transferFeeIncludedInputAmount.amount.neg(); // out
          const expectedOwnerAccountMidDelta = ZERO_BN; // in = out
          const expectedOwnerAccountOutputDelta = outputAmount; // in
          const [expectedVaultAccountTwoADelta, expectedVaultAccountTwoBDelta] = aToBTwo
            ? [quote2.estimatedAmountIn, transferFeeIncludedOutputAmount.amount.neg()]
            : [transferFeeIncludedOutputAmount.amount.neg(), quote2.estimatedAmountIn];
          const [expectedVaultAccountOneADelta, expectedVaultAccountOneBDelta] = aToBOne
            ? [quote.estimatedAmountIn, transferFeeIncludedMidOutputAmount.amount.neg()]
            : [transferFeeIncludedMidOutputAmount.amount.neg(), quote.estimatedAmountIn];
          assert.ok(expectedVaultAccountTwoADelta.eq(aToBTwo ? quote2.estimatedAmountIn : quote2.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountTwoBDelta.eq(aToBTwo ? quote2.estimatedAmountOut.neg() : quote2.estimatedAmountIn));
          assert.ok(expectedVaultAccountOneADelta.eq(aToBOne ? quote.estimatedAmountIn : quote.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountOneBDelta.eq(aToBOne ? quote.estimatedAmountOut.neg() : quote.estimatedAmountIn));

          const pools = aquarium.pools;
          const tokenAccKeys = getTokenAccsForPoolsV2(pools, aquarium.tokenAccounts);
          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);
          const baseIxParams: TwoHopSwapV2Params = {
            ...twoHopQuote,
            amount: outputAmount, // transfer fee excluded
            otherAmountThreshold: transferFeeIncludedInputAmount.amount, // transfer fee included

            tokenAuthority: ctx.wallet.publicKey,
            whirlpoolOne: pools[1].whirlpoolPda.publicKey,
            whirlpoolTwo: pools[0].whirlpoolPda.publicKey,
            tokenMintInput: aToBTwo ? pools[1].tokenMintA : pools[1].tokenMintB,
            tokenMintIntermediate: aToBTwo ? pools[1].tokenMintB : pools[1].tokenMintA,
            tokenMintOutput: aToBOne ? pools[0].tokenMintB : pools[0].tokenMintA,
            tokenProgramInput: aToBTwo ? pools[1].tokenProgramA : pools[1].tokenProgramB,
            tokenProgramIntermediate: aToBTwo ? pools[1].tokenProgramB : pools[1].tokenProgramA,
            tokenProgramOutput: aToBOne ? pools[0].tokenProgramB : pools[0].tokenProgramA,
            tokenOwnerAccountInput: aToBTwo ? tokenAccKeys[2] : tokenAccKeys[3],
            tokenOwnerAccountOutput: aToBOne ? tokenAccKeys[1] : tokenAccKeys[0],
            tokenVaultOneInput: aToBTwo ? pools[1].tokenVaultAKeypair.publicKey : pools[1].tokenVaultBKeypair.publicKey,
            tokenVaultOneIntermediate: aToBTwo ? pools[1].tokenVaultBKeypair.publicKey : pools[1].tokenVaultAKeypair.publicKey,
            tokenVaultTwoIntermediate: aToBOne ? pools[0].tokenVaultAKeypair.publicKey : pools[0].tokenVaultBKeypair.publicKey,
            tokenVaultTwoOutput: aToBOne ? pools[0].tokenVaultBKeypair.publicKey : pools[0].tokenVaultAKeypair.publicKey,
            oracleOne: PDAUtil.getOracle(ctx.program.programId, pools[1].whirlpoolPda.publicKey)
              .publicKey,
            oracleTwo: PDAUtil.getOracle(ctx.program.programId, pools[0].whirlpoolPda.publicKey)
              .publicKey,
          };

          const preVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const preVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const preVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const preVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const preOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const preOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                ...baseIxParams,
                otherAmountThreshold: baseIxParams.otherAmountThreshold.subn(1),
              })
            ).prependInstruction(useMaxCU()).buildAndExecute(), // add CU
            /0x1795/, // AmountInAboveMaximum
          );

          await toTx(
            ctx,
            WhirlpoolIx.twoHopSwapV2Ix(ctx.program, baseIxParams)
          ).prependInstruction(useMaxCU()).buildAndExecute(); // add CU

          const postVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const postVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const postVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const postVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const postOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const postOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          assert.ok(postVaultBalanceOneA.sub(preVaultBalanceOneA).eq(expectedVaultAccountOneADelta));
          assert.ok(postVaultBalanceOneB.sub(preVaultBalanceOneB).eq(expectedVaultAccountOneBDelta));
          assert.ok(postVaultBalanceTwoA.sub(preVaultBalanceTwoA).eq(expectedVaultAccountTwoADelta));
          assert.ok(postVaultBalanceTwoB.sub(preVaultBalanceTwoB).eq(expectedVaultAccountTwoBDelta));
          assert.ok(postOwnerAccountBalanceInput.sub(preOwnerAccountBalanceInput).eq(expectedOwnerAccountInputDelta));
          assert.ok(postOwnerAccountBalanceOutput.sub(preOwnerAccountBalanceOutput).eq(expectedOwnerAccountOutputDelta));

          //console.log(`aToB: ${aToBTwo} ${aToBOne}`);
          //console.log("out", transferFeeIncludedOutputAmount.amount.toString(), transferFeeIncludedOutputAmount.fee.toString());
          //console.log("midin", transferFeeIncludedMidInputAmount.amount.toString(), transferFeeIncludedMidInputAmount.fee.toString());
          //console.log("midout", transferFeeIncludedMidOutputAmount.amount.toString(), transferFeeIncludedMidOutputAmount.fee.toString());
          //console.log("in", transferFeeIncludedInputAmount.amount.toString(), transferFeeIncludedInputAmount.fee.toString());
          //console.log("q2", quote2.estimatedAmountIn.toString(), quote2.estimatedAmountOut.toString());
          //console.log("q1", quote.estimatedAmountIn.toString(), quote.estimatedAmountOut.toString());
        });
      });
    });

    const variationsWith100PercentFee: TokenTrait[][] = [
      [
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: MAX_FEE_BASIS_POINTS },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
      ],
      [
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: MAX_FEE_BASIS_POINTS, transferFeeInitialMax: 99n },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
      ],
      [
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: MAX_FEE_BASIS_POINTS },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
      ],
      [
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: MAX_FEE_BASIS_POINTS, transferFeeInitialMax: 99n },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
      ],
      [
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: MAX_FEE_BASIS_POINTS },
      ],
      [
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0 },
        { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: MAX_FEE_BASIS_POINTS, transferFeeInitialMax: 99n },
      ],
    ];

    variationsWith100PercentFee.forEach(([token0, token1, token2]) => {

      const label0 = `Token0: transfer fee bps = ${token0.transferFeeInitialBps ? ("100%" + (token0.transferFeeInitialMax? " with cap" : " without cap")) : "0%"}`;
      const label1 = `Token1: transfer fee bps = ${token1.transferFeeInitialBps ? ("100%" + (token1.transferFeeInitialMax? " with cap" : " without cap")) : "0%"}`;
      const label2 = `Token2: transfer fee bps = ${token2.transferFeeInitialBps ? ("100%" + (token2.transferFeeInitialMax? " with cap" : " without cap")) : "0%"}`;

      describe(`${label0}, ${label1}, ${label2}`, () => {
        beforeEach(async () => {
          aqConfig = getDefaultAquariumV2();
          // Add a third token and account and a second pool
          aqConfig.initMintParams = [
            { tokenTrait: {isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0} },
            { tokenTrait: {isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0} },
            { tokenTrait: {isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 0} },
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

          aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
          const { pools } = aquarium;

          whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
          whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
          whirlpoolDataOne = (await fetcher.getPool(
            whirlpoolOneKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;
          whirlpoolDataTwo = (await fetcher.getPool(
            whirlpoolTwoKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;


          // update fee config
          await toTx(ctx, {
            cleanupInstructions: [],
            signers: [], // provider.wallet is authority & payer
            instructions: [
              createSetTransferFeeInstruction(
                pools[0].tokenMintA,
                token0.transferFeeInitialBps!,
                token0.transferFeeInitialMax ?? BigInt(U64_MAX.toString()),
                provider.wallet.publicKey,
              ),
              createSetTransferFeeInstruction(
                pools[0].tokenMintB,
                token1.transferFeeInitialBps!,
                token1.transferFeeInitialMax ?? BigInt(U64_MAX.toString()),
                provider.wallet.publicKey,
              ),
              createSetTransferFeeInstruction(
                pools[1].tokenMintB,
                token2.transferFeeInitialBps!,
                token2.transferFeeInitialMax ?? BigInt(U64_MAX.toString()),
                provider.wallet.publicKey,
              )
            ]
          }).buildAndExecute();

          // wait for epoch to enable updated fee rate
          const updatedFeeConfig0 = await fetchTransferFeeConfig(pools[0].tokenMintA);
          await waitEpoch(Number(updatedFeeConfig0.newerTransferFee.epoch));
          assert.ok((await getCurrentEpoch()) >= updatedFeeConfig0.newerTransferFee.epoch);

          const transferFee0 = await getTransferFee(pools[0].tokenMintA);
          const transferFee1 = await getTransferFee(pools[0].tokenMintB);
          const transferFee2 = await getTransferFee(pools[1].tokenMintB);

          assert.equal(transferFee0!.transferFeeBasisPoints, token0.transferFeeInitialBps!);
          assert.equal(transferFee0!.maximumFee, token0.transferFeeInitialMax ?? BigInt(U64_MAX.toString()));
          assert.equal(transferFee1!.transferFeeBasisPoints, token1.transferFeeInitialBps!);
          assert.equal(transferFee1!.maximumFee, token1.transferFeeInitialMax ?? BigInt(U64_MAX.toString()));
          assert.equal(transferFee2!.transferFeeBasisPoints, token2.transferFeeInitialBps!);
          assert.equal(transferFee2!.maximumFee, token2.transferFeeInitialMax ?? BigInt(U64_MAX.toString()));
        });

        it("T0 --> T1 --> T2, ExactIn", async () => {
          const [inputToken, midToken, outputToken] = aquarium.mintKeys;
          const [inputTokenTrait, midTokenTrait, outputTokenTrait] = [token0, token1, token2];

          const transferFeeInput = inputTokenTrait.hasTransferFeeExtension ? await getTransferFee(inputToken) : null;
          const transferFeeMid = midTokenTrait.hasTransferFeeExtension ? await getTransferFee(midToken) : null;
          const transferFeeOutput = outputTokenTrait.hasTransferFeeExtension ? await getTransferFee(outputToken) : null;

          const inputAmount = new BN(1000);
          const aToBOne = whirlpoolDataOne.tokenMintA.equals(inputToken);
          const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(midToken);
          const pools = aquarium.pools;

          // edge-case
          const inputWithoutCap = transferFeeInput!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeInput!.maximumFee === BigInt(U64_MAX.toString());
          const midWithoutCap = transferFeeMid!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeMid!.maximumFee === BigInt(U64_MAX.toString());
          if (inputWithoutCap || midWithoutCap) {
            // we cannot determine input size because all amount will be collected as transfer fee
            const tickArraysOne = await SwapUtils.getTickArrays(
              whirlpoolDataOne.tickCurrentIndex,
              whirlpoolDataOne.tickSpacing,
              aToBOne,
              ctx.program.programId,
              whirlpoolOneKey,
              fetcher,
              IGNORE_CACHE,
            );
            const tickArraysTwo = await SwapUtils.getTickArrays(
              whirlpoolDataTwo.tickCurrentIndex,
              whirlpoolDataTwo.tickSpacing,
              aToBTwo,
              ctx.program.programId,
              whirlpoolTwoKey,
              fetcher,
              IGNORE_CACHE,
            );
  
            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                  amountSpecifiedIsInput: true,
                  amount: inputAmount,
                  otherAmountThreshold: new BN(0),
                  sqrtPriceLimitOne: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
                  sqrtPriceLimitTwo: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
                  aToBOne,
                  aToBTwo,
                  tokenAuthority: ctx.wallet.publicKey,
                  whirlpoolOne: whirlpoolOneKey,
                  whirlpoolTwo: whirlpoolTwoKey,
                  tokenMintInput: inputToken,
                  tokenMintIntermediate: midToken,
                  tokenMintOutput: outputToken,
                  tokenProgramInput: TEST_TOKEN_2022_PROGRAM_ID,
                  tokenProgramIntermediate: TEST_TOKEN_2022_PROGRAM_ID,
                  tokenProgramOutput: TEST_TOKEN_2022_PROGRAM_ID,
                  tokenVaultOneInput: aToBOne ? whirlpoolDataOne.tokenVaultA : whirlpoolDataOne.tokenVaultB,
                  tokenVaultOneIntermediate: aToBOne ? whirlpoolDataOne.tokenVaultB : whirlpoolDataOne.tokenVaultA,
                  tokenVaultTwoIntermediate: aToBTwo ? whirlpoolDataTwo.tokenVaultA : whirlpoolDataTwo.tokenVaultB,
                  tokenVaultTwoOutput: aToBTwo ? whirlpoolDataTwo.tokenVaultB : whirlpoolDataTwo.tokenVaultA,
                  tokenOwnerAccountInput: aToBOne ? pools[0].tokenVaultAKeypair.publicKey : pools[0].tokenVaultBKeypair.publicKey,
                  tokenOwnerAccountOutput: aToBTwo ? pools[1].tokenVaultBKeypair.publicKey : pools[1].tokenVaultAKeypair.publicKey,
                  tickArrayOne0: tickArraysOne[0].address,
                  tickArrayOne1: tickArraysOne[0].address,
                  tickArrayOne2: tickArraysOne[0].address,
                  tickArrayTwo0: tickArraysTwo[0].address,
                  tickArrayTwo1: tickArraysTwo[0].address,
                  tickArrayTwo2: tickArraysTwo[0].address,
                  oracleOne: PDAUtil.getOracle(ctx.program.programId, whirlpoolOneKey).publicKey,
                  oracleTwo: PDAUtil.getOracle(ctx.program.programId, whirlpoolTwoKey).publicKey,
                }),
              ).buildAndExecute(),
              inputWithoutCap
                ? /0x1793/ // ZeroTradableAmount (All amount is collected as transfer fee...)
                : /0x1793/, // ZeroTradableAmount (all intermediate token is collected as transfer fee...)
            );

            return;
          }

          const transferFeeExcludedInputAmount = transferFeeInput
            ? calculateTransferFeeExcludedAmount(transferFeeInput, inputAmount)
            : { amount: inputAmount, fee: ZERO_BN };
          if (transferFeeInput && transferFeeInput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedInputAmount.fee.gtn(0));

          const quote = swapQuoteWithParams(
            {
              // T0 --> T1, ExactIn
              amountSpecifiedIsInput: true,
              aToB: aToBOne,
              tokenAmount: transferFeeExcludedInputAmount.amount,

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
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100),
          );

          /*
          // vault -> owner
          const transferFeeExcludedMidOutputAmount = transferFeeMid
            ? calculateTransferFeeExcludedAmount(transferFeeMid, quote.estimatedAmountOut)
            : { amount: quote.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedMidOutputAmount.fee.gtn(0));

          // owner -> vault
          const transferFeeExcludedMidInputAmount = transferFeeMid
            ? calculateTransferFeeExcludedAmount(transferFeeMid, transferFeeExcludedMidOutputAmount.amount)
            : { amount: transferFeeExcludedMidOutputAmount.amount, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedMidInputAmount.fee.gtn(0));
          */
         
          // vault to vault
          const transferFeeExcludedMidInputAmount = transferFeeMid
            ? calculateTransferFeeExcludedAmount(transferFeeMid, quote.estimatedAmountOut)
            : { amount: quote.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedMidInputAmount.fee.gtn(0));

          const quote2 = swapQuoteWithParams(
            {
              // T1 --> T2, ExactIn
              amountSpecifiedIsInput: true,
              aToB: aToBTwo,
              tokenAmount: transferFeeExcludedMidInputAmount.amount,

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
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later              
            },
            Percentage.fromFraction(0, 100),
          );

          const transferFeeExcludedOutputAmount = transferFeeOutput
           ? calculateTransferFeeExcludedAmount(transferFeeOutput, quote2.estimatedAmountOut)
            : { amount: quote2.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeOutput && transferFeeOutput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedOutputAmount.fee.gtn(0));

          const expectedOwnerAccountInputDelta = inputAmount.neg(); // out
          const expectedOwnerAccountMidDelta = ZERO_BN; // in = out
          const expectedOwnerAccountOutputDelta = transferFeeExcludedOutputAmount.amount; // in
          const [expectedVaultAccountOneADelta, expectedVaultAccountOneBDelta] = aToBOne
            ? [transferFeeExcludedInputAmount.amount, quote.estimatedAmountOut.neg()]
            : [quote.estimatedAmountOut.neg(), transferFeeExcludedInputAmount.amount];
          const [expectedVaultAccountTwoADelta, expectedVaultAccountTwoBDelta] = aToBTwo
            ? [transferFeeExcludedMidInputAmount.amount, quote2.estimatedAmountOut.neg()]
            : [quote2.estimatedAmountOut.neg(), transferFeeExcludedMidInputAmount.amount];
          assert.ok(expectedVaultAccountOneADelta.eq(aToBOne ? quote.estimatedAmountIn : quote.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountOneBDelta.eq(aToBOne ? quote.estimatedAmountOut.neg() : quote.estimatedAmountIn));
          assert.ok(expectedVaultAccountTwoADelta.eq(aToBTwo ? quote2.estimatedAmountIn : quote2.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountTwoBDelta.eq(aToBTwo ? quote2.estimatedAmountOut.neg() : quote2.estimatedAmountIn));

          const tokenAccKeys = getTokenAccsForPoolsV2(pools, aquarium.tokenAccounts);
          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);
          const baseIxParams: TwoHopSwapV2Params = {
            ...twoHopQuote,
            amount: inputAmount, // transfer fee included
            otherAmountThreshold: transferFeeExcludedOutputAmount.amount, // transfer fee excluded

            tokenAuthority: ctx.wallet.publicKey,
            whirlpoolOne: pools[0].whirlpoolPda.publicKey,
            whirlpoolTwo: pools[1].whirlpoolPda.publicKey,
            tokenMintInput: twoHopQuote.aToBOne ? pools[0].tokenMintA : pools[0].tokenMintB,
            tokenMintIntermediate: twoHopQuote.aToBOne ? pools[0].tokenMintB : pools[0].tokenMintA,
            tokenMintOutput: twoHopQuote.aToBTwo ? pools[1].tokenMintB : pools[1].tokenMintA,
            tokenProgramInput: twoHopQuote.aToBOne ? pools[0].tokenProgramA : pools[0].tokenProgramB,
            tokenProgramIntermediate: twoHopQuote.aToBOne ? pools[0].tokenProgramB : pools[0].tokenProgramA,
            tokenProgramOutput: twoHopQuote.aToBTwo ? pools[1].tokenProgramB : pools[1].tokenProgramA,
            tokenOwnerAccountInput: twoHopQuote.aToBOne ? tokenAccKeys[0] : tokenAccKeys[1],
            tokenOwnerAccountOutput: twoHopQuote.aToBTwo ? tokenAccKeys[3] : tokenAccKeys[2],
            tokenVaultOneInput: twoHopQuote.aToBOne ? pools[0].tokenVaultAKeypair.publicKey : pools[0].tokenVaultBKeypair.publicKey,
            tokenVaultOneIntermediate: twoHopQuote.aToBOne ? pools[0].tokenVaultBKeypair.publicKey : pools[0].tokenVaultAKeypair.publicKey,
            tokenVaultTwoIntermediate: twoHopQuote.aToBTwo ? pools[1].tokenVaultAKeypair.publicKey : pools[1].tokenVaultBKeypair.publicKey,
            tokenVaultTwoOutput: twoHopQuote.aToBTwo ? pools[1].tokenVaultBKeypair.publicKey : pools[1].tokenVaultAKeypair.publicKey,
                oracleOne: PDAUtil.getOracle(ctx.program.programId, pools[0].whirlpoolPda.publicKey)
              .publicKey,
            oracleTwo: PDAUtil.getOracle(ctx.program.programId, pools[1].whirlpoolPda.publicKey)
              .publicKey,
          };
    
          const preVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const preVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const preVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const preVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const preOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const preOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                ...baseIxParams,
                otherAmountThreshold: baseIxParams.otherAmountThreshold.addn(1),
              })
            ).prependInstruction(useMaxCU()).buildAndExecute(), // add CU
            /0x1794/, // AmountOutBelowMinimum
          );

          await toTx(
            ctx,
            WhirlpoolIx.twoHopSwapV2Ix(ctx.program, baseIxParams)
          ).prependInstruction(useMaxCU()).buildAndExecute(); // add CU

          const postVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const postVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const postVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const postVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const postOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const postOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          assert.ok(postVaultBalanceOneA.sub(preVaultBalanceOneA).eq(expectedVaultAccountOneADelta));
          assert.ok(postVaultBalanceOneB.sub(preVaultBalanceOneB).eq(expectedVaultAccountOneBDelta));
          assert.ok(postVaultBalanceTwoA.sub(preVaultBalanceTwoA).eq(expectedVaultAccountTwoADelta));
          assert.ok(postVaultBalanceTwoB.sub(preVaultBalanceTwoB).eq(expectedVaultAccountTwoBDelta));
          assert.ok(postOwnerAccountBalanceInput.sub(preOwnerAccountBalanceInput).eq(expectedOwnerAccountInputDelta));
          assert.ok(postOwnerAccountBalanceOutput.sub(preOwnerAccountBalanceOutput).eq(expectedOwnerAccountOutputDelta));

          //console.log(`aToB: ${aToBOne} ${aToBTwo}`);
          //console.log("in", transferFeeExcludedInputAmount.amount.toString(), transferFeeExcludedInputAmount.fee.toString());
          //console.log("midout", transferFeeExcludedMidOutputAmount.amount.toString(), transferFeeExcludedMidOutputAmount.fee.toString());
          //console.log("midin", transferFeeExcludedMidInputAmount.amount.toString(), transferFeeExcludedMidInputAmount.fee.toString());
          //console.log("out", transferFeeExcludedOutputAmount.amount.toString(), transferFeeExcludedOutputAmount.fee.toString());
          //console.log("q1", quote.estimatedAmountIn.toString(), quote.estimatedAmountOut.toString());
          //console.log("q2", quote2.estimatedAmountIn.toString(), quote2.estimatedAmountOut.toString());
        });

        it("T0 <-- T1 <-- T2, ExactIn", async () => {
          const [outputToken, midToken, inputToken] = aquarium.mintKeys;
          const [outputTokenTrait, midTokenTrait, inputTokenTrait] = [token0, token1, token2];

          const transferFeeInput = inputTokenTrait.hasTransferFeeExtension ? await getTransferFee(inputToken) : null;
          const transferFeeMid = midTokenTrait.hasTransferFeeExtension ? await getTransferFee(midToken) : null;
          const transferFeeOutput = outputTokenTrait.hasTransferFeeExtension ? await getTransferFee(outputToken) : null;

          const inputAmount = new BN(100000);
          const aToBTwo = whirlpoolDataTwo.tokenMintA.equals(inputToken);
          const aToBOne = whirlpoolDataOne.tokenMintA.equals(midToken);
          const pools = aquarium.pools;

          // edge-case
          const inputWithoutCap = transferFeeInput!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeInput!.maximumFee === BigInt(U64_MAX.toString());
          const midWithoutCap = transferFeeMid!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeMid!.maximumFee === BigInt(U64_MAX.toString());
          if (inputWithoutCap || midWithoutCap) {
            // we cannot determine input size because all amount will be collected as transfer fee
            const tickArraysOne = await SwapUtils.getTickArrays(
              whirlpoolDataOne.tickCurrentIndex,
              whirlpoolDataOne.tickSpacing,
              aToBOne,
              ctx.program.programId,
              whirlpoolOneKey,
              fetcher,
              IGNORE_CACHE,
            );
            const tickArraysTwo = await SwapUtils.getTickArrays(
              whirlpoolDataTwo.tickCurrentIndex,
              whirlpoolDataTwo.tickSpacing,
              aToBTwo,
              ctx.program.programId,
              whirlpoolTwoKey,
              fetcher,
              IGNORE_CACHE,
            );
  
            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                  amountSpecifiedIsInput: true,
                  amount: inputAmount,
                  otherAmountThreshold: new BN(0),
                  sqrtPriceLimitOne: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
                  sqrtPriceLimitTwo: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
                  aToBOne: aToBTwo,
                  aToBTwo: aToBOne,
                  tokenAuthority: ctx.wallet.publicKey,
                  whirlpoolOne: whirlpoolTwoKey,
                  whirlpoolTwo: whirlpoolOneKey,
                  tokenMintInput: inputToken,
                  tokenMintIntermediate: midToken,
                  tokenMintOutput: outputToken,
                  tokenProgramInput: TEST_TOKEN_2022_PROGRAM_ID,
                  tokenProgramIntermediate: TEST_TOKEN_2022_PROGRAM_ID,
                  tokenProgramOutput: TEST_TOKEN_2022_PROGRAM_ID,
                  tokenVaultOneInput: aToBTwo ? whirlpoolDataTwo.tokenVaultA : whirlpoolDataTwo.tokenVaultB,
                  tokenVaultOneIntermediate: aToBTwo ? whirlpoolDataTwo.tokenVaultB : whirlpoolDataTwo.tokenVaultA,
                  tokenVaultTwoIntermediate: aToBOne ? whirlpoolDataOne.tokenVaultA : whirlpoolDataOne.tokenVaultB,
                  tokenVaultTwoOutput: aToBOne ? whirlpoolDataOne.tokenVaultB : whirlpoolDataOne.tokenVaultA,
                  tokenOwnerAccountInput: aToBTwo ? pools[1].tokenVaultAKeypair.publicKey : pools[1].tokenVaultBKeypair.publicKey,
                  tokenOwnerAccountOutput: aToBOne ? pools[0].tokenVaultBKeypair.publicKey : pools[0].tokenVaultAKeypair.publicKey,
                  tickArrayOne0: tickArraysTwo[0].address,
                  tickArrayOne1: tickArraysTwo[0].address,
                  tickArrayOne2: tickArraysTwo[0].address,
                  tickArrayTwo0: tickArraysOne[0].address,
                  tickArrayTwo1: tickArraysOne[0].address,
                  tickArrayTwo2: tickArraysOne[0].address,
                  oracleOne: PDAUtil.getOracle(ctx.program.programId, whirlpoolTwoKey).publicKey,
                  oracleTwo: PDAUtil.getOracle(ctx.program.programId, whirlpoolOneKey).publicKey,
                }),
              ).buildAndExecute(),
              inputWithoutCap
                ? /0x1793/ // ZeroTradableAmount (All amount is collected as transfer fee...)
                : /0x1793/, // ZeroTradableAmount (all intermediate token is collected as transfer fee...)
            );

            return;
          }

          const transferFeeExcludedInputAmount = transferFeeInput
            ? calculateTransferFeeExcludedAmount(transferFeeInput, inputAmount)
            : { amount: inputAmount, fee: ZERO_BN };
          if (transferFeeInput && transferFeeInput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedInputAmount.fee.gtn(0));

          const quote = swapQuoteWithParams(
            {
              // T1 <-- T2, ExactIn
              amountSpecifiedIsInput: true,
              aToB: aToBTwo,
              tokenAmount: transferFeeExcludedInputAmount.amount,

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
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100),
          );

          /*
          // vault -> owner
          const transferFeeExcludedMidOutputAmount = transferFeeMid
            ? calculateTransferFeeExcludedAmount(transferFeeMid, quote.estimatedAmountOut)
            : { amount: quote.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedMidOutputAmount.fee.gtn(0));

          // owner -> vault
          const transferFeeExcludedMidInputAmount = transferFeeMid
            ? calculateTransferFeeExcludedAmount(transferFeeMid, transferFeeExcludedMidOutputAmount.amount)
            : { amount: transferFeeExcludedMidOutputAmount.amount, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedMidInputAmount.fee.gtn(0));
          */

          // vault to vault
          const transferFeeExcludedMidInputAmount = transferFeeMid
            ? calculateTransferFeeExcludedAmount(transferFeeMid, quote.estimatedAmountOut)
            : { amount: quote.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedMidInputAmount.fee.gtn(0));

          const quote2 = swapQuoteWithParams(
            {
              // T0 <-- T1, ExactIn
              amountSpecifiedIsInput: true,
              aToB: aToBOne,
              tokenAmount: transferFeeExcludedMidInputAmount.amount,

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
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100),
          );

          const transferFeeExcludedOutputAmount = transferFeeOutput
           ? calculateTransferFeeExcludedAmount(transferFeeOutput, quote2.estimatedAmountOut)
            : { amount: quote2.estimatedAmountOut, fee: ZERO_BN };
          if (transferFeeOutput && transferFeeOutput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeExcludedOutputAmount.fee.gtn(0));

          const expectedOwnerAccountInputDelta = inputAmount.neg(); // out
          const expectedOwnerAccountMidDelta = ZERO_BN; // in = out
          const expectedOwnerAccountOutputDelta = transferFeeExcludedOutputAmount.amount; // in
          const [expectedVaultAccountOneADelta, expectedVaultAccountOneBDelta] = aToBOne
            ? [transferFeeExcludedInputAmount.amount, quote.estimatedAmountOut.neg()]
            : [quote.estimatedAmountOut.neg(), transferFeeExcludedInputAmount.amount];
          const [expectedVaultAccountTwoADelta, expectedVaultAccountTwoBDelta] = aToBTwo
            ? [transferFeeExcludedMidInputAmount.amount, quote2.estimatedAmountOut.neg()]
            : [quote2.estimatedAmountOut.neg(), transferFeeExcludedMidInputAmount.amount];
          assert.ok(expectedVaultAccountOneADelta.eq(aToBOne ? quote.estimatedAmountIn : quote.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountOneBDelta.eq(aToBOne ? quote.estimatedAmountOut.neg() : quote.estimatedAmountIn));
          assert.ok(expectedVaultAccountTwoADelta.eq(aToBTwo ? quote2.estimatedAmountIn : quote2.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountTwoBDelta.eq(aToBTwo ? quote2.estimatedAmountOut.neg() : quote2.estimatedAmountIn));

          const tokenAccKeys = getTokenAccsForPoolsV2(pools, aquarium.tokenAccounts);
          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);
          const baseIxParams: TwoHopSwapV2Params = {
            ...twoHopQuote,
            amount: inputAmount, // transfer fee included
            otherAmountThreshold: transferFeeExcludedOutputAmount.amount, // transfer fee excluded

            tokenAuthority: ctx.wallet.publicKey,
            whirlpoolOne: pools[1].whirlpoolPda.publicKey,
            whirlpoolTwo: pools[0].whirlpoolPda.publicKey,
            tokenMintInput: aToBTwo ? pools[1].tokenMintA : pools[1].tokenMintB,
            tokenMintIntermediate: aToBTwo ? pools[1].tokenMintB : pools[1].tokenMintA,
            tokenMintOutput: aToBOne ? pools[0].tokenMintB : pools[0].tokenMintA,
            tokenProgramInput: aToBTwo ? pools[1].tokenProgramA : pools[1].tokenProgramB,
            tokenProgramIntermediate: aToBTwo ? pools[1].tokenProgramB : pools[1].tokenProgramA,
            tokenProgramOutput: aToBOne ? pools[0].tokenProgramB : pools[0].tokenProgramA,
            tokenOwnerAccountInput: aToBTwo ? tokenAccKeys[2] : tokenAccKeys[3],
            tokenOwnerAccountOutput: aToBOne ? tokenAccKeys[1] : tokenAccKeys[0],
            tokenVaultOneInput: aToBTwo ? pools[1].tokenVaultAKeypair.publicKey : pools[1].tokenVaultBKeypair.publicKey,
            tokenVaultOneIntermediate: aToBTwo ? pools[1].tokenVaultBKeypair.publicKey : pools[1].tokenVaultAKeypair.publicKey,
            tokenVaultTwoIntermediate: aToBOne ? pools[0].tokenVaultAKeypair.publicKey : pools[0].tokenVaultBKeypair.publicKey,
            tokenVaultTwoOutput: aToBOne ? pools[0].tokenVaultBKeypair.publicKey : pools[0].tokenVaultAKeypair.publicKey,
                oracleOne: PDAUtil.getOracle(ctx.program.programId, pools[1].whirlpoolPda.publicKey)
              .publicKey,
            oracleTwo: PDAUtil.getOracle(ctx.program.programId, pools[0].whirlpoolPda.publicKey)
              .publicKey,
          };

          const preVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const preVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const preVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const preVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const preOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const preOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                ...baseIxParams,
                otherAmountThreshold: baseIxParams.otherAmountThreshold.addn(1),
              })
            ).prependInstruction(useMaxCU()).buildAndExecute(), // add CU
            /0x1794/, // AmountOutBelowMinimum
          );

          await toTx(
            ctx,
            WhirlpoolIx.twoHopSwapV2Ix(ctx.program, baseIxParams)
          ).prependInstruction(useMaxCU()).buildAndExecute(); // add CU

          const postVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const postVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const postVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const postVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const postOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const postOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          assert.ok(postVaultBalanceOneA.sub(preVaultBalanceOneA).eq(expectedVaultAccountOneADelta));
          assert.ok(postVaultBalanceOneB.sub(preVaultBalanceOneB).eq(expectedVaultAccountOneBDelta));
          assert.ok(postVaultBalanceTwoA.sub(preVaultBalanceTwoA).eq(expectedVaultAccountTwoADelta));
          assert.ok(postVaultBalanceTwoB.sub(preVaultBalanceTwoB).eq(expectedVaultAccountTwoBDelta));
          assert.ok(postOwnerAccountBalanceInput.sub(preOwnerAccountBalanceInput).eq(expectedOwnerAccountInputDelta));
          assert.ok(postOwnerAccountBalanceOutput.sub(preOwnerAccountBalanceOutput).eq(expectedOwnerAccountOutputDelta));

          //console.log(`aToB: ${aToBTwo} ${aToBOne}`);
          //console.log("in", transferFeeExcludedInputAmount.amount.toString(), transferFeeExcludedInputAmount.fee.toString());
          //console.log("midout", transferFeeExcludedMidOutputAmount.amount.toString(), transferFeeExcludedMidOutputAmount.fee.toString());
          //console.log("midin", transferFeeExcludedMidInputAmount.amount.toString(), transferFeeExcludedMidInputAmount.fee.toString());
          //console.log("out", transferFeeExcludedOutputAmount.amount.toString(), transferFeeExcludedOutputAmount.fee.toString());
          //console.log("q1", quote.estimatedAmountIn.toString(), quote.estimatedAmountOut.toString());
          //console.log("q2", quote2.estimatedAmountIn.toString(), quote2.estimatedAmountOut.toString());
        })

        it("T0 --> T1 --> T2, ExactOut", async () => {
          const [inputToken, midToken, outputToken] = aquarium.mintKeys;
          const [inputTokenTrait, midTokenTrait, outputTokenTrait] = [token0, token1, token2];

          const transferFeeInput = inputTokenTrait.hasTransferFeeExtension ? await getTransferFee(inputToken) : null;
          const transferFeeMid = midTokenTrait.hasTransferFeeExtension ? await getTransferFee(midToken) : null;
          const transferFeeOutput = outputTokenTrait.hasTransferFeeExtension ? await getTransferFee(outputToken) : null;

          const outputAmount = new BN(500000);
          const aToBTwo = whirlpoolDataTwo.tokenMintB.equals(outputToken);
          const aToBOne = whirlpoolDataOne.tokenMintB.equals(midToken);
          const pools = aquarium.pools;

          // edge-case
          const inputWithoutCap = transferFeeInput!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeInput!.maximumFee === BigInt(U64_MAX.toString());
          const midWithoutCap = transferFeeMid!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeMid!.maximumFee === BigInt(U64_MAX.toString());
          const outputWithoutCap = transferFeeOutput!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeOutput!.maximumFee === BigInt(U64_MAX.toString());
          if (inputWithoutCap || outputWithoutCap || midWithoutCap) {
            // we cannot determine input/output size because all amount will be collected as transfer fee
            const tickArraysOne = await SwapUtils.getTickArrays(
              whirlpoolDataOne.tickCurrentIndex,
              whirlpoolDataOne.tickSpacing,
              aToBOne,
              ctx.program.programId,
              whirlpoolOneKey,
              fetcher,
              IGNORE_CACHE,
            );
            const tickArraysTwo = await SwapUtils.getTickArrays(
              whirlpoolDataTwo.tickCurrentIndex,
              whirlpoolDataTwo.tickSpacing,
              aToBTwo,
              ctx.program.programId,
              whirlpoolTwoKey,
              fetcher,
              IGNORE_CACHE,
            );
  
            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                  amountSpecifiedIsInput: false,
                  amount: outputAmount,
                  otherAmountThreshold: new BN(U64_MAX.toString()),
                  sqrtPriceLimitOne: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
                  sqrtPriceLimitTwo: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
                  aToBOne,
                  aToBTwo,
                  tokenAuthority: ctx.wallet.publicKey,
                  whirlpoolOne: whirlpoolOneKey,
                  whirlpoolTwo: whirlpoolTwoKey,
                  tokenMintInput: inputToken,
                  tokenMintIntermediate: midToken,
                  tokenMintOutput: outputToken,
                  tokenProgramInput: TEST_TOKEN_2022_PROGRAM_ID,
                  tokenProgramIntermediate: TEST_TOKEN_2022_PROGRAM_ID,
                  tokenProgramOutput: TEST_TOKEN_2022_PROGRAM_ID,
                  tokenVaultOneInput: aToBOne ? whirlpoolDataOne.tokenVaultA : whirlpoolDataOne.tokenVaultB,
                  tokenVaultOneIntermediate: aToBOne ? whirlpoolDataOne.tokenVaultB : whirlpoolDataOne.tokenVaultA,
                  tokenVaultTwoIntermediate: aToBTwo ? whirlpoolDataTwo.tokenVaultA : whirlpoolDataTwo.tokenVaultB,
                  tokenVaultTwoOutput: aToBTwo ? whirlpoolDataTwo.tokenVaultB : whirlpoolDataTwo.tokenVaultA,
                  tokenOwnerAccountInput: aToBOne ? pools[0].tokenVaultAKeypair.publicKey : pools[0].tokenVaultBKeypair.publicKey,
                  tokenOwnerAccountOutput: aToBTwo ? pools[1].tokenVaultBKeypair.publicKey : pools[1].tokenVaultAKeypair.publicKey,
                  tickArrayOne0: tickArraysOne[0].address,
                  tickArrayOne1: tickArraysOne[0].address,
                  tickArrayOne2: tickArraysOne[0].address,
                  tickArrayTwo0: tickArraysTwo[0].address,
                  tickArrayTwo1: tickArraysTwo[0].address,
                  tickArrayTwo2: tickArraysTwo[0].address,
                  oracleOne: PDAUtil.getOracle(ctx.program.programId, whirlpoolOneKey).publicKey,
                  oracleTwo: PDAUtil.getOracle(ctx.program.programId, whirlpoolTwoKey).publicKey,
                }),
              ).buildAndExecute(),
              /0x17a4/, // TransferFeeCalculationError
            );

            return;
          }

          const transferFeeIncludedOutputAmount = transferFeeOutput
            ? calculateTransferFeeIncludedAmount(transferFeeOutput, outputAmount)
            : { amount: outputAmount, fee: ZERO_BN };
          if (transferFeeOutput && transferFeeOutput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedOutputAmount.fee.gtn(0));

          const quote2 = swapQuoteWithParams(
            {
              // T1 --> T2, ExactOut
              amountSpecifiedIsInput: false,
              aToB: aToBTwo,
              tokenAmount: transferFeeIncludedOutputAmount.amount,

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
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100),
          );

          /*
          // owner -> vault
          const transferFeeIncludedMidInputAmount = transferFeeMid
            ? calculateTransferFeeIncludedAmount(transferFeeMid, quote2.estimatedAmountIn)
            : { amount: quote2.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedMidInputAmount.fee.gtn(0));

          // vault -> owner
          const transferFeeIncludedMidOutputAmount = transferFeeMid
            ? calculateTransferFeeIncludedAmount(transferFeeMid, transferFeeIncludedMidInputAmount.amount)
            : { amount: transferFeeIncludedMidInputAmount.amount, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedMidOutputAmount.fee.gtn(0));
          */

          // vault to vault
          const transferFeeIncludedMidOutputAmount = transferFeeMid
            ? calculateTransferFeeIncludedAmount(transferFeeMid, quote2.estimatedAmountIn)
            : { amount: quote2.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedMidOutputAmount.fee.gtn(0));

          const quote = swapQuoteWithParams(
            {
              // T0 --> T1, ExactOut
              amountSpecifiedIsInput: false,
              aToB: aToBOne,
              tokenAmount: transferFeeIncludedMidOutputAmount.amount,

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
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100),
          );

          const transferFeeIncludedInputAmount = transferFeeInput
           ? calculateTransferFeeIncludedAmount(transferFeeInput, quote.estimatedAmountIn)
            : { amount: quote.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeInput && transferFeeInput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedInputAmount.fee.gtn(0));

          const expectedOwnerAccountInputDelta = transferFeeIncludedInputAmount.amount.neg(); // out
          const expectedOwnerAccountMidDelta = ZERO_BN; // in = out
          const expectedOwnerAccountOutputDelta = outputAmount; // in
          const [expectedVaultAccountOneADelta, expectedVaultAccountOneBDelta] = aToBOne
            ? [quote.estimatedAmountIn, transferFeeIncludedMidOutputAmount.amount.neg()]
            : [transferFeeIncludedMidOutputAmount.amount.neg(), quote.estimatedAmountIn];
          const [expectedVaultAccountTwoADelta, expectedVaultAccountTwoBDelta] = aToBTwo
            ? [quote2.estimatedAmountIn, transferFeeIncludedOutputAmount.amount.neg()]
            : [transferFeeIncludedOutputAmount.amount.neg(), quote2.estimatedAmountIn];
          assert.ok(expectedVaultAccountOneADelta.eq(aToBOne ? quote.estimatedAmountIn : quote.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountOneBDelta.eq(aToBOne ? quote.estimatedAmountOut.neg() : quote.estimatedAmountIn));
          assert.ok(expectedVaultAccountTwoADelta.eq(aToBTwo ? quote2.estimatedAmountIn : quote2.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountTwoBDelta.eq(aToBTwo ? quote2.estimatedAmountOut.neg() : quote2.estimatedAmountIn));

          const tokenAccKeys = getTokenAccsForPoolsV2(pools, aquarium.tokenAccounts);
          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);
          const baseIxParams: TwoHopSwapV2Params = {
            ...twoHopQuote,
            amount: outputAmount, // transfer fee excluded
            otherAmountThreshold: transferFeeIncludedInputAmount.amount, // transfer fee included

            tokenAuthority: ctx.wallet.publicKey,
            whirlpoolOne: pools[0].whirlpoolPda.publicKey,
            whirlpoolTwo: pools[1].whirlpoolPda.publicKey,
            tokenMintInput: twoHopQuote.aToBOne ? pools[0].tokenMintA : pools[0].tokenMintB,
            tokenMintIntermediate: twoHopQuote.aToBOne ? pools[0].tokenMintB : pools[0].tokenMintA,
            tokenMintOutput: twoHopQuote.aToBTwo ? pools[1].tokenMintB : pools[1].tokenMintA,
            tokenProgramInput: twoHopQuote.aToBOne ? pools[0].tokenProgramA : pools[0].tokenProgramB,
            tokenProgramIntermediate: twoHopQuote.aToBOne ? pools[0].tokenProgramB : pools[0].tokenProgramA,
            tokenProgramOutput: twoHopQuote.aToBTwo ? pools[1].tokenProgramB : pools[1].tokenProgramA,
            tokenOwnerAccountInput: twoHopQuote.aToBOne ? tokenAccKeys[0] : tokenAccKeys[1],
            tokenOwnerAccountOutput: twoHopQuote.aToBTwo ? tokenAccKeys[3] : tokenAccKeys[2],
            tokenVaultOneInput: twoHopQuote.aToBOne ? pools[0].tokenVaultAKeypair.publicKey : pools[0].tokenVaultBKeypair.publicKey,
            tokenVaultOneIntermediate: twoHopQuote.aToBOne ? pools[0].tokenVaultBKeypair.publicKey : pools[0].tokenVaultAKeypair.publicKey,
            tokenVaultTwoIntermediate: twoHopQuote.aToBTwo ? pools[1].tokenVaultAKeypair.publicKey : pools[1].tokenVaultBKeypair.publicKey,
            tokenVaultTwoOutput: twoHopQuote.aToBTwo ? pools[1].tokenVaultBKeypair.publicKey : pools[1].tokenVaultAKeypair.publicKey,
                oracleOne: PDAUtil.getOracle(ctx.program.programId, pools[0].whirlpoolPda.publicKey)
              .publicKey,
            oracleTwo: PDAUtil.getOracle(ctx.program.programId, pools[1].whirlpoolPda.publicKey)
              .publicKey,
          };

          const preVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const preVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const preVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const preVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const preOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const preOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                ...baseIxParams,
                otherAmountThreshold: baseIxParams.otherAmountThreshold.subn(1),
              })
            ).prependInstruction(useMaxCU()).buildAndExecute(), // add CU
            /0x1795/, // AmountInAboveMaximum
          );

          await toTx(
            ctx,
            WhirlpoolIx.twoHopSwapV2Ix(ctx.program, baseIxParams)
          ).prependInstruction(useMaxCU()).buildAndExecute(); // add CU

          const postVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const postVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const postVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const postVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const postOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const postOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          assert.ok(postVaultBalanceOneA.sub(preVaultBalanceOneA).eq(expectedVaultAccountOneADelta));
          assert.ok(postVaultBalanceOneB.sub(preVaultBalanceOneB).eq(expectedVaultAccountOneBDelta));
          assert.ok(postVaultBalanceTwoA.sub(preVaultBalanceTwoA).eq(expectedVaultAccountTwoADelta));
          assert.ok(postVaultBalanceTwoB.sub(preVaultBalanceTwoB).eq(expectedVaultAccountTwoBDelta));
          assert.ok(postOwnerAccountBalanceInput.sub(preOwnerAccountBalanceInput).eq(expectedOwnerAccountInputDelta));
          assert.ok(postOwnerAccountBalanceOutput.sub(preOwnerAccountBalanceOutput).eq(expectedOwnerAccountOutputDelta));

          //console.log(`aToB: ${aToBOne} ${aToBTwo}`);
          //console.log("out", transferFeeIncludedOutputAmount.amount.toString(), transferFeeIncludedOutputAmount.fee.toString());
          //console.log("midin", transferFeeIncludedMidInputAmount.amount.toString(), transferFeeIncludedMidInputAmount.fee.toString());
          //console.log("midout", transferFeeIncludedMidOutputAmount.amount.toString(), transferFeeIncludedMidOutputAmount.fee.toString());
          //console.log("in", transferFeeIncludedInputAmount.amount.toString(), transferFeeIncludedInputAmount.fee.toString());
          //console.log("q2", quote2.estimatedAmountIn.toString(), quote2.estimatedAmountOut.toString());
          //console.log("q1", quote.estimatedAmountIn.toString(), quote.estimatedAmountOut.toString());
        });

        it("T0 <-- T1 <-- T2, ExactOut", async () => {
          const [outputToken, midToken, inputToken] = aquarium.mintKeys;
          const [outputTokenTrait, midTokenTrait, inputTokenTrait] = [token0, token1, token2];

          const transferFeeInput = inputTokenTrait.hasTransferFeeExtension ? await getTransferFee(inputToken) : null;
          const transferFeeMid = midTokenTrait.hasTransferFeeExtension ? await getTransferFee(midToken) : null;
          const transferFeeOutput = outputTokenTrait.hasTransferFeeExtension ? await getTransferFee(outputToken) : null;

          const outputAmount = new BN(1000);
          const aToBTwo = whirlpoolDataOne.tokenMintB.equals(outputToken);
          const aToBOne = whirlpoolDataTwo.tokenMintB.equals(midToken);
          const pools = aquarium.pools;

          // edge-case
          const inputWithoutCap = transferFeeInput!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeInput!.maximumFee === BigInt(U64_MAX.toString());
          const midWithoutCap = transferFeeMid!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeMid!.maximumFee === BigInt(U64_MAX.toString());
          const outputWithoutCap = transferFeeOutput!.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS && transferFeeOutput!.maximumFee === BigInt(U64_MAX.toString());
          if (inputWithoutCap || outputWithoutCap || midWithoutCap) {
            // we cannot determine input/output size because all amount will be collected as transfer fee
            const tickArraysOne = await SwapUtils.getTickArrays(
              whirlpoolDataOne.tickCurrentIndex,
              whirlpoolDataOne.tickSpacing,
              aToBOne,
              ctx.program.programId,
              whirlpoolOneKey,
              fetcher,
              IGNORE_CACHE,
            );
            const tickArraysTwo = await SwapUtils.getTickArrays(
              whirlpoolDataTwo.tickCurrentIndex,
              whirlpoolDataTwo.tickSpacing,
              aToBTwo,
              ctx.program.programId,
              whirlpoolTwoKey,
              fetcher,
              IGNORE_CACHE,
            );
  
            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                  amountSpecifiedIsInput: false,
                  amount: outputAmount,
                  otherAmountThreshold: new BN(U64_MAX.toString()),
                  sqrtPriceLimitOne: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
                  sqrtPriceLimitTwo: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
                  aToBOne: aToBTwo,
                  aToBTwo: aToBOne,
                  tokenAuthority: ctx.wallet.publicKey,
                  whirlpoolOne: whirlpoolTwoKey,
                  whirlpoolTwo: whirlpoolOneKey,
                  tokenMintInput: inputToken,
                  tokenMintIntermediate: midToken,
                  tokenMintOutput: outputToken,
                  tokenProgramInput: TEST_TOKEN_2022_PROGRAM_ID,
                  tokenProgramIntermediate: TEST_TOKEN_2022_PROGRAM_ID,
                  tokenProgramOutput: TEST_TOKEN_2022_PROGRAM_ID,
                  tokenVaultOneInput: aToBTwo ? whirlpoolDataTwo.tokenVaultA : whirlpoolDataTwo.tokenVaultB,
                  tokenVaultOneIntermediate: aToBTwo ? whirlpoolDataTwo.tokenVaultB : whirlpoolDataTwo.tokenVaultA,
                  tokenVaultTwoIntermediate: aToBOne ? whirlpoolDataOne.tokenVaultA : whirlpoolDataOne.tokenVaultB,
                  tokenVaultTwoOutput: aToBOne ? whirlpoolDataOne.tokenVaultB : whirlpoolDataOne.tokenVaultA,
                  tokenOwnerAccountInput: aToBTwo ? pools[1].tokenVaultAKeypair.publicKey : pools[1].tokenVaultBKeypair.publicKey,
                  tokenOwnerAccountOutput: aToBOne ? pools[0].tokenVaultBKeypair.publicKey : pools[0].tokenVaultAKeypair.publicKey,
                  tickArrayOne0: tickArraysTwo[0].address,
                  tickArrayOne1: tickArraysTwo[0].address,
                  tickArrayOne2: tickArraysTwo[0].address,
                  tickArrayTwo0: tickArraysOne[0].address,
                  tickArrayTwo1: tickArraysOne[0].address,
                  tickArrayTwo2: tickArraysOne[0].address,
                  oracleOne: PDAUtil.getOracle(ctx.program.programId, whirlpoolTwoKey).publicKey,
                  oracleTwo: PDAUtil.getOracle(ctx.program.programId, whirlpoolOneKey).publicKey,
                }),
              ).buildAndExecute(),
              /0x17a4/, // TransferFeeCalculationError
            );

            return;
          }

          const transferFeeIncludedOutputAmount = transferFeeOutput
            ? calculateTransferFeeIncludedAmount(transferFeeOutput, outputAmount)
            : { amount: outputAmount, fee: ZERO_BN };
          if (transferFeeOutput && transferFeeOutput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedOutputAmount.fee.gtn(0));

          const quote2 = swapQuoteWithParams(
            {
              // T0 <-- T1, ExactOut
              amountSpecifiedIsInput: false,
              aToB: aToBTwo,
              tokenAmount: transferFeeIncludedOutputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBTwo),
              whirlpoolData: whirlpoolDataOne,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataOne.tickCurrentIndex,
                whirlpoolDataOne.tickSpacing,
                aToBTwo,
                ctx.program.programId,
                whirlpoolOneKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100),
          );

          /*
          // owner -> vault
          const transferFeeIncludedMidInputAmount = transferFeeMid
            ? calculateTransferFeeIncludedAmount(transferFeeMid, quote2.estimatedAmountIn)
            : { amount: quote2.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedMidInputAmount.fee.gtn(0));

          // vault -> owner
          const transferFeeIncludedMidOutputAmount = transferFeeMid
            ? calculateTransferFeeIncludedAmount(transferFeeMid, transferFeeIncludedMidInputAmount.amount)
            : { amount: transferFeeIncludedMidInputAmount.amount, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedMidOutputAmount.fee.gtn(0));
          */

          // vault to vault
          const transferFeeIncludedMidOutputAmount = transferFeeMid
            ? calculateTransferFeeIncludedAmount(transferFeeMid, quote2.estimatedAmountIn)
            : { amount: quote2.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeMid && transferFeeMid.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedMidOutputAmount.fee.gtn(0));

          const quote = swapQuoteWithParams(
            {
              // T1 <-- T2, ExactOut
              amountSpecifiedIsInput: false,
              aToB: aToBOne,
              tokenAmount: transferFeeIncludedMidOutputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(false),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToBOne),
              whirlpoolData: whirlpoolDataTwo,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolDataTwo.tickCurrentIndex,
                whirlpoolDataTwo.tickSpacing,
                aToBOne,
                ctx.program.programId,
                whirlpoolTwoKey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100),
          );

          const transferFeeIncludedInputAmount = transferFeeInput
           ? calculateTransferFeeIncludedAmount(transferFeeInput, quote.estimatedAmountIn)
            : { amount: quote.estimatedAmountIn, fee: ZERO_BN };
          if (transferFeeInput && transferFeeInput.transferFeeBasisPoints > 0)
            assert.ok(transferFeeIncludedInputAmount.fee.gtn(0));

          const expectedOwnerAccountInputDelta = transferFeeIncludedInputAmount.amount.neg(); // out
          const expectedOwnerAccountMidDelta = ZERO_BN; // in = out
          const expectedOwnerAccountOutputDelta = outputAmount; // in
          const [expectedVaultAccountTwoADelta, expectedVaultAccountTwoBDelta] = aToBTwo
            ? [quote2.estimatedAmountIn, transferFeeIncludedOutputAmount.amount.neg()]
            : [transferFeeIncludedOutputAmount.amount.neg(), quote2.estimatedAmountIn];
          const [expectedVaultAccountOneADelta, expectedVaultAccountOneBDelta] = aToBOne
            ? [quote.estimatedAmountIn, transferFeeIncludedMidOutputAmount.amount.neg()]
            : [transferFeeIncludedMidOutputAmount.amount.neg(), quote.estimatedAmountIn];
          assert.ok(expectedVaultAccountTwoADelta.eq(aToBTwo ? quote2.estimatedAmountIn : quote2.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountTwoBDelta.eq(aToBTwo ? quote2.estimatedAmountOut.neg() : quote2.estimatedAmountIn));
          assert.ok(expectedVaultAccountOneADelta.eq(aToBOne ? quote.estimatedAmountIn : quote.estimatedAmountOut.neg()));
          assert.ok(expectedVaultAccountOneBDelta.eq(aToBOne ? quote.estimatedAmountOut.neg() : quote.estimatedAmountIn));

          const tokenAccKeys = getTokenAccsForPoolsV2(pools, aquarium.tokenAccounts);
          const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);
          const baseIxParams: TwoHopSwapV2Params = {
            ...twoHopQuote,
            amount: outputAmount, // transfer fee excluded
            otherAmountThreshold: transferFeeIncludedInputAmount.amount, // transfer fee included

            tokenAuthority: ctx.wallet.publicKey,
            whirlpoolOne: pools[1].whirlpoolPda.publicKey,
            whirlpoolTwo: pools[0].whirlpoolPda.publicKey,
            tokenMintInput: aToBTwo ? pools[1].tokenMintA : pools[1].tokenMintB,
            tokenMintIntermediate: aToBTwo ? pools[1].tokenMintB : pools[1].tokenMintA,
            tokenMintOutput: aToBOne ? pools[0].tokenMintB : pools[0].tokenMintA,
            tokenProgramInput: aToBTwo ? pools[1].tokenProgramA : pools[1].tokenProgramB,
            tokenProgramIntermediate: aToBTwo ? pools[1].tokenProgramB : pools[1].tokenProgramA,
            tokenProgramOutput: aToBOne ? pools[0].tokenProgramB : pools[0].tokenProgramA,
            tokenOwnerAccountInput: aToBTwo ? tokenAccKeys[2] : tokenAccKeys[3],
            tokenOwnerAccountOutput: aToBOne ? tokenAccKeys[1] : tokenAccKeys[0],
            tokenVaultOneInput: aToBTwo ? pools[1].tokenVaultAKeypair.publicKey : pools[1].tokenVaultBKeypair.publicKey,
            tokenVaultOneIntermediate: aToBTwo ? pools[1].tokenVaultBKeypair.publicKey : pools[1].tokenVaultAKeypair.publicKey,
            tokenVaultTwoIntermediate: aToBOne ? pools[0].tokenVaultAKeypair.publicKey : pools[0].tokenVaultBKeypair.publicKey,
            tokenVaultTwoOutput: aToBOne ? pools[0].tokenVaultBKeypair.publicKey : pools[0].tokenVaultAKeypair.publicKey,
            oracleOne: PDAUtil.getOracle(ctx.program.programId, pools[1].whirlpoolPda.publicKey)
              .publicKey,
            oracleTwo: PDAUtil.getOracle(ctx.program.programId, pools[0].whirlpoolPda.publicKey)
              .publicKey,
          };

          const preVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const preVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const preVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const preVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const preOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const preOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.twoHopSwapV2Ix(ctx.program, {
                ...baseIxParams,
                otherAmountThreshold: baseIxParams.otherAmountThreshold.subn(1),
              })
            ).prependInstruction(useMaxCU()).buildAndExecute(), // add CU
            /0x1795/, // AmountInAboveMaximum
          );

          await toTx(
            ctx,
            WhirlpoolIx.twoHopSwapV2Ix(ctx.program, baseIxParams)
          ).prependInstruction(useMaxCU()).buildAndExecute(); // add CU

          const postVaultBalanceOneA = new BN(await getTokenBalance(provider, pools[1].tokenVaultAKeypair.publicKey));
          const postVaultBalanceOneB = new BN(await getTokenBalance(provider, pools[1].tokenVaultBKeypair.publicKey));
          const postVaultBalanceTwoA = new BN(await getTokenBalance(provider, pools[0].tokenVaultAKeypair.publicKey));
          const postVaultBalanceTwoB = new BN(await getTokenBalance(provider, pools[0].tokenVaultBKeypair.publicKey));
          const postOwnerAccountBalanceInput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountInput));
          const postOwnerAccountBalanceOutput = new BN(await getTokenBalance(provider, baseIxParams.tokenOwnerAccountOutput));

          assert.ok(postVaultBalanceOneA.sub(preVaultBalanceOneA).eq(expectedVaultAccountOneADelta));
          assert.ok(postVaultBalanceOneB.sub(preVaultBalanceOneB).eq(expectedVaultAccountOneBDelta));
          assert.ok(postVaultBalanceTwoA.sub(preVaultBalanceTwoA).eq(expectedVaultAccountTwoADelta));
          assert.ok(postVaultBalanceTwoB.sub(preVaultBalanceTwoB).eq(expectedVaultAccountTwoBDelta));
          assert.ok(postOwnerAccountBalanceInput.sub(preOwnerAccountBalanceInput).eq(expectedOwnerAccountInputDelta));
          assert.ok(postOwnerAccountBalanceOutput.sub(preOwnerAccountBalanceOutput).eq(expectedOwnerAccountOutputDelta));

          //console.log(`aToB: ${aToBTwo} ${aToBOne}`);
          //console.log("out", transferFeeIncludedOutputAmount.amount.toString(), transferFeeIncludedOutputAmount.fee.toString());
          //console.log("midin", transferFeeIncludedMidInputAmount.amount.toString(), transferFeeIncludedMidInputAmount.fee.toString());
          //console.log("midout", transferFeeIncludedMidOutputAmount.amount.toString(), transferFeeIncludedMidOutputAmount.fee.toString());
          //console.log("in", transferFeeIncludedInputAmount.amount.toString(), transferFeeIncludedInputAmount.fee.toString());
          //console.log("q2", quote2.estimatedAmountIn.toString(), quote2.estimatedAmountOut.toString());
          //console.log("q1", quote.estimatedAmountIn.toString(), quote.estimatedAmountOut.toString());
        });
      });
    });
  });

  describe("Special cases", () => {
    // We know that all transfers are executed 2 functions depending on the direction, so 2 test cases.

    let fixture: WhirlpoolTestFixtureV2;
    beforeEach(async () => {
      const mintAmount = new BN(2_000_000_000);
      const tickSpacing = 1;
      const rangeLowerTickIndex = -64;
      const rangeUpperTickIndex = +64;
      const currentTickIndex = 0;
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currentTickIndex,
        rangeLowerTickIndex,
        rangeUpperTickIndex,
        {
          // half deposit (50:50)
          tokenA: mintAmount.divn(2),
          tokenB: mintAmount.divn(2),
        }
      );

      fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 500, transferFeeInitialMax: 100_000n},
        tokenTraitB: { isToken2022: true, hasTransferFeeExtension: true, transferFeeInitialBps: 1000, transferFeeInitialMax: 200_000n},
        tickSpacing,
        // pool has much liquidity in both direction
        positions: [{
          tickLowerIndex: rangeLowerTickIndex,
          tickUpperIndex: rangeUpperTickIndex,
          liquidityAmount: liquidityAmount
        }],
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currentTickIndex),
        mintAmount,
      });
    });

    describe("use current fee rate even if next fee rate exists", () => {
      it("owner to vault", async () => {
        // in A to B, owner to vault is input

        const { poolInitInfo, tokenAccountA, tokenAccountB } = fixture.getInfos();
        const tokenA = poolInitInfo.tokenMintA;
        const tokenB = poolInitInfo.tokenMintB;

        // fee config is initialized with older = newer state
        const initialFeeConfigA = await fetchTransferFeeConfig(tokenA);
        assert.equal(initialFeeConfigA.newerTransferFee.transferFeeBasisPoints, 500);
        assert.equal(initialFeeConfigA.olderTransferFee.transferFeeBasisPoints, 500);

        const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;

        let whirlpoolData = (await fetcher.getPool(whirlpoolPubkey, IGNORE_CACHE)) as WhirlpoolData;

        const aToB = true;
        const inputAmount = new BN(1_000_000);
        const transferFeeA = getEpochFee(initialFeeConfigA, BigInt(await getCurrentEpoch()));
        const transferFeeExcludedInputAmount = calculateTransferFeeExcludedAmount(transferFeeA, inputAmount);

        // non zero, but not limited by maximum
        assert.ok(transferFeeExcludedInputAmount.fee.gtn(0));
        assert.ok(transferFeeExcludedInputAmount.fee.lt(new BN(transferFeeA.maximumFee.toString())));

        const quote = swapQuoteWithParams(
          {
            // A --> B, ExactIn
            amountSpecifiedIsInput: true,
            aToB,
            tokenAmount: transferFeeExcludedInputAmount.amount,

            otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
            whirlpoolData,
            tickArrays: await SwapUtils.getTickArrays(
              whirlpoolData.tickCurrentIndex,
              whirlpoolData.tickSpacing,
              aToB,
              ctx.program.programId,
              whirlpoolPubkey,
              fetcher,
              IGNORE_CACHE,
            ),
            tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
          },
          Percentage.fromFraction(0, 100), // 0% slippage
        );

        const tx = toTx(ctx, WhirlpoolIx.swapV2Ix(ctx.program, {
          ...quote,
          amount: inputAmount,
          otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true), // not interested in this case

          whirlpool: whirlpoolPubkey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenMintA: poolInitInfo.tokenMintA,
          tokenMintB: poolInitInfo.tokenMintB,
          tokenProgramA: poolInitInfo.tokenProgramA,
          tokenProgramB: poolInitInfo.tokenProgramB,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          oracle: PDAUtil.getOracle(ctx.program.programId, whirlpoolPubkey).publicKey,
        }));

        // PREPEND setTransferFee ix
        tx.prependInstruction({
          cleanupInstructions: [],
          signers: [], // provider.wallet is authority & payer
          instructions: [
            createSetTransferFeeInstruction(
              tokenA,
              2000,
              BigInt(U64_MAX.toString()),
              provider.wallet.publicKey,
            )
          ]
        });

        const preWithheldAmount = await fetchTransferFeeWithheldAmount(poolInitInfo.tokenVaultAKeypair.publicKey);
        await tx.buildAndExecute();
        const postWithheldAmount = await fetchTransferFeeWithheldAmount(poolInitInfo.tokenVaultAKeypair.publicKey);

        // fee is based on the current bps
        const withheldDelta = postWithheldAmount.sub(preWithheldAmount);
        assert.ok(withheldDelta.eq(transferFeeExcludedInputAmount.fee));

        // but newer fee bps have been updated
        const updatedFeeConfigA = await fetchTransferFeeConfig(tokenA);
        assert.equal(updatedFeeConfigA.newerTransferFee.transferFeeBasisPoints, 2000);
        assert.equal(updatedFeeConfigA.olderTransferFee.transferFeeBasisPoints, 500);
      });

      it("vault to owner", async () => {
        // in A to B, vault to owner is output

        const { poolInitInfo, tokenAccountA, tokenAccountB } = fixture.getInfos();
        const tokenA = poolInitInfo.tokenMintA;
        const tokenB = poolInitInfo.tokenMintB;

        // fee config is initialized with older = newer state
        const initialFeeConfigB = await fetchTransferFeeConfig(tokenB);
        assert.equal(initialFeeConfigB.newerTransferFee.transferFeeBasisPoints, 1000);
        assert.equal(initialFeeConfigB.olderTransferFee.transferFeeBasisPoints, 1000);

        const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;

        let whirlpoolData = (await fetcher.getPool(whirlpoolPubkey, IGNORE_CACHE)) as WhirlpoolData;

        const aToB = true;
        const inputAmount = new BN(1_000_000);
        const feeConfigA = await fetchTransferFeeConfig(tokenA);
        const transferFeeA = getEpochFee(feeConfigA, BigInt(await getCurrentEpoch()));
        const transferFeeExcludedInputAmount = calculateTransferFeeExcludedAmount(transferFeeA, inputAmount);

        const quote = swapQuoteWithParams(
          {
            // A --> B, ExactIn
            amountSpecifiedIsInput: true,
            aToB,
            tokenAmount: transferFeeExcludedInputAmount.amount,

            otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
            whirlpoolData,
            tickArrays: await SwapUtils.getTickArrays(
              whirlpoolData.tickCurrentIndex,
              whirlpoolData.tickSpacing,
              aToB,
              ctx.program.programId,
              whirlpoolPubkey,
              fetcher,
              IGNORE_CACHE,
            ),
            tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
          },
          Percentage.fromFraction(0, 100), // 0% slippage
        );

        const transferFeeB = getEpochFee(initialFeeConfigB, BigInt(await getCurrentEpoch()));
        const transferFeeExcludedOutputAmount = calculateTransferFeeExcludedAmount(transferFeeB, quote.estimatedAmountOut);

        // non zero, but not limited by maximum
        assert.ok(transferFeeExcludedOutputAmount.fee.gtn(0));
        assert.ok(transferFeeExcludedOutputAmount.fee.lt(new BN(transferFeeB.maximumFee.toString())));

        const tx = toTx(ctx, WhirlpoolIx.swapV2Ix(ctx.program, {
          ...quote,
          amount: inputAmount,
          otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true), // not interested in this case

          whirlpool: whirlpoolPubkey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenMintA: poolInitInfo.tokenMintA,
          tokenMintB: poolInitInfo.tokenMintB,
          tokenProgramA: poolInitInfo.tokenProgramA,
          tokenProgramB: poolInitInfo.tokenProgramB,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
          oracle: PDAUtil.getOracle(ctx.program.programId, whirlpoolPubkey).publicKey,
        }));

        // PREPEND setTransferFee ix
        tx.prependInstruction({
          cleanupInstructions: [],
          signers: [], // provider.wallet is authority & payer
          instructions: [
            createSetTransferFeeInstruction(
              tokenB,
              1500,
              BigInt(U64_MAX.toString()),
              provider.wallet.publicKey,
            )
          ]
        });

        const preWithheldAmount = await fetchTransferFeeWithheldAmount(tokenAccountB);
        await tx.buildAndExecute();
        const postWithheldAmount = await fetchTransferFeeWithheldAmount(tokenAccountB);

        // fee is based on the current bps
        const withheldDelta = postWithheldAmount.sub(preWithheldAmount);
        assert.ok(withheldDelta.eq(transferFeeExcludedOutputAmount.fee));

        // but newer fee bps have been updated
        const updatedFeeConfigB = await fetchTransferFeeConfig(tokenB);
        assert.equal(updatedFeeConfigB.newerTransferFee.transferFeeBasisPoints, 1500);
        assert.equal(updatedFeeConfigB.olderTransferFee.transferFeeBasisPoints, 1000);
      });  
    });

    describe("use updated fee rate once epoch comes", () => {
      it("owner to vault", async () => {
        // in A to B, owner to vault is input

        const { poolInitInfo, tokenAccountA, tokenAccountB } = fixture.getInfos();
        const tokenA = poolInitInfo.tokenMintA;
        const tokenB = poolInitInfo.tokenMintB;

        // fee config is initialized with older = newer state
        const initialFeeConfigA = await fetchTransferFeeConfig(tokenA);
        assert.equal(initialFeeConfigA.newerTransferFee.transferFeeBasisPoints, 500);
        assert.equal(initialFeeConfigA.olderTransferFee.transferFeeBasisPoints, 500);

        const newBpsList = [2000, 3000];
        let oldBps = 500;
        for (let i = 0; i < newBpsList.length; i++) {
          const newBps = newBpsList[i];

          // update fee config
          await toTx(ctx, {
            cleanupInstructions: [],
            signers: [], // provider.wallet is authority & payer
            instructions: [
              createSetTransferFeeInstruction(
                tokenA,
                newBps,
                BigInt(U64_MAX.toString()),
                provider.wallet.publicKey,
              )
            ]
          }).buildAndExecute();

          const updatedFeeConfigA = await fetchTransferFeeConfig(tokenA);
          assert.equal(updatedFeeConfigA.newerTransferFee.transferFeeBasisPoints, newBps);
          assert.equal(updatedFeeConfigA.olderTransferFee.transferFeeBasisPoints, oldBps);

          // wait for epoch to enable updated fee rate
          await waitEpoch(Number(updatedFeeConfigA.newerTransferFee.epoch));
          assert.ok((await getCurrentEpoch()) >= updatedFeeConfigA.newerTransferFee.epoch);

          const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;

          const whirlpoolData = (await fetcher.getPool(whirlpoolPubkey, IGNORE_CACHE)) as WhirlpoolData;

          const aToB = true;
          const inputAmount = new BN(1_000_000);
          const transferFeeA = getEpochFee(updatedFeeConfigA, BigInt(await getCurrentEpoch()));
          assert.ok(transferFeeA.transferFeeBasisPoints === newBps);

          // non zero, but not limited by maximum
          const transferFeeExcludedInputAmount = calculateTransferFeeExcludedAmount(transferFeeA, inputAmount);
          assert.ok(transferFeeExcludedInputAmount.fee.gtn(0));
          assert.ok(transferFeeExcludedInputAmount.fee.lt(new BN(transferFeeA.maximumFee.toString())));

          const quote = swapQuoteWithParams(
            {
              // A --> B, ExactIn
              amountSpecifiedIsInput: true,
              aToB,
              tokenAmount: transferFeeExcludedInputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                aToB,
                ctx.program.programId,
                whirlpoolPubkey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100), // 0% slippage
          );

          const tx = toTx(ctx, WhirlpoolIx.swapV2Ix(ctx.program, {
            ...quote,
            amount: inputAmount,
            otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true), // not interested in this case

            whirlpool: whirlpoolPubkey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            oracle: PDAUtil.getOracle(ctx.program.programId, whirlpoolPubkey).publicKey,
          }));

          const preWithheldAmount = await fetchTransferFeeWithheldAmount(poolInitInfo.tokenVaultAKeypair.publicKey);
          await tx.buildAndExecute();
          const postWithheldAmount = await fetchTransferFeeWithheldAmount(poolInitInfo.tokenVaultAKeypair.publicKey);

          // fee is based on the current bps
          const withheldDelta = postWithheldAmount.sub(preWithheldAmount);
          assert.ok(withheldDelta.eq(transferFeeExcludedInputAmount.fee));

          oldBps = newBps;
        }
      });

      it("vault to owner", async () => {
        const { poolInitInfo, tokenAccountA, tokenAccountB } = fixture.getInfos();
        const tokenA = poolInitInfo.tokenMintA;
        const tokenB = poolInitInfo.tokenMintB;

        // fee config is initialized with older = newer state
        const initialFeeConfigB = await fetchTransferFeeConfig(tokenB);
        assert.equal(initialFeeConfigB.newerTransferFee.transferFeeBasisPoints, 1000);
        assert.equal(initialFeeConfigB.olderTransferFee.transferFeeBasisPoints, 1000);

        const newBpsList = [2000, 3000];
        let oldBps = 1000;
        for (let i = 0; i < newBpsList.length; i++) {
          const newBps = newBpsList[i];

          // update fee config
          await toTx(ctx, {
            cleanupInstructions: [],
            signers: [], // provider.wallet is authority & payer
            instructions: [
              createSetTransferFeeInstruction(
                tokenB,
                newBps,
                BigInt(U64_MAX.toString()),
                provider.wallet.publicKey,
              )
            ]
          }).buildAndExecute();

          const updatedFeeConfigB = await fetchTransferFeeConfig(tokenB);
          assert.equal(updatedFeeConfigB.newerTransferFee.transferFeeBasisPoints, newBps);
          assert.equal(updatedFeeConfigB.olderTransferFee.transferFeeBasisPoints, oldBps);

          // wait for epoch to enable updated fee rate
          await waitEpoch(Number(updatedFeeConfigB.newerTransferFee.epoch));
          assert.ok((await getCurrentEpoch()) >= updatedFeeConfigB.newerTransferFee.epoch);

          const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;

          const whirlpoolData = (await fetcher.getPool(whirlpoolPubkey, IGNORE_CACHE)) as WhirlpoolData;

          const aToB = true;
          const inputAmount = new BN(1_000_000);
          const feeConfigA = await fetchTransferFeeConfig(tokenA);
          const transferFeeA = getEpochFee(feeConfigA, BigInt(await getCurrentEpoch()));
          const transferFeeExcludedInputAmount = calculateTransferFeeExcludedAmount(transferFeeA, inputAmount);
  
          const quote = swapQuoteWithParams(
            {
              // A --> B, ExactIn
              amountSpecifiedIsInput: true,
              aToB,
              tokenAmount: transferFeeExcludedInputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                aToB,
                ctx.program.programId,
                whirlpoolPubkey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100), // 0% slippage
          );

          const transferFeeB = getEpochFee(updatedFeeConfigB, BigInt(await getCurrentEpoch()));
          const transferFeeExcludedOutputAmount = calculateTransferFeeExcludedAmount(transferFeeB, quote.estimatedAmountOut);
  
          // non zero, but not limited by maximum
          assert.ok(transferFeeExcludedOutputAmount.fee.gtn(0));
          assert.ok(transferFeeExcludedOutputAmount.fee.lt(new BN(transferFeeB.maximumFee.toString())));
  
          const tx = toTx(ctx, WhirlpoolIx.swapV2Ix(ctx.program, {
            ...quote,
            amount: inputAmount,
            otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true), // not interested in this case

            whirlpool: whirlpoolPubkey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            oracle: PDAUtil.getOracle(ctx.program.programId, whirlpoolPubkey).publicKey,
          }));

          const preWithheldAmount = await fetchTransferFeeWithheldAmount(tokenAccountB);
          await tx.buildAndExecute();
          const postWithheldAmount = await fetchTransferFeeWithheldAmount(tokenAccountB);
  
          // fee is based on the current bps
          const withheldDelta = postWithheldAmount.sub(preWithheldAmount);
          assert.ok(withheldDelta.eq(transferFeeExcludedOutputAmount.fee));
  
          oldBps = newBps;
        }
      });  
    });

    describe("use maximum limit", () => {
      it("owner to vault", async () => {
        // in A to B, owner to vault is input

        const { poolInitInfo, tokenAccountA, tokenAccountB } = fixture.getInfos();
        const tokenA = poolInitInfo.tokenMintA;
        const tokenB = poolInitInfo.tokenMintB;

        // fee config is initialized with older = newer state
        const initialFeeConfigA = await fetchTransferFeeConfig(tokenA);
        assert.equal(initialFeeConfigA.newerTransferFee.maximumFee, 100_000n);
        assert.equal(initialFeeConfigA.olderTransferFee.maximumFee, 100_000n);

        const newMaximumFeeList = [10_000n, 1_000n];
        let oldMaximumFee = 100_000n;
        for (let i = 0; i < newMaximumFeeList.length; i++) {
          const newMaximumFee = newMaximumFeeList[i];

          // update fee config
          await toTx(ctx, {
            cleanupInstructions: [],
            signers: [], // provider.wallet is authority & payer
            instructions: [
              createSetTransferFeeInstruction(
                tokenA,
                initialFeeConfigA.newerTransferFee.transferFeeBasisPoints, // no change
                newMaximumFee,
                provider.wallet.publicKey,
              )
            ]
          }).buildAndExecute();

          const updatedFeeConfigA = await fetchTransferFeeConfig(tokenA);
          assert.equal(updatedFeeConfigA.newerTransferFee.maximumFee, newMaximumFee);
          assert.equal(updatedFeeConfigA.olderTransferFee.maximumFee, oldMaximumFee);

          // wait for epoch to enable updated fee rate
          await waitEpoch(Number(updatedFeeConfigA.newerTransferFee.epoch));
          assert.ok((await getCurrentEpoch()) >= updatedFeeConfigA.newerTransferFee.epoch);

          const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;

          const whirlpoolData = (await fetcher.getPool(whirlpoolPubkey, IGNORE_CACHE)) as WhirlpoolData;

          const aToB = true;
          const inputAmount = new BN(1_000_000);
          const transferFeeA = getEpochFee(updatedFeeConfigA, BigInt(await getCurrentEpoch()));
          assert.ok(transferFeeA.maximumFee === newMaximumFee);

          // non zero, and limited by maximum
          const transferFeeExcludedInputAmount = calculateTransferFeeExcludedAmount(transferFeeA, inputAmount);
          assert.ok(transferFeeExcludedInputAmount.fee.gtn(0));
          assert.ok(transferFeeExcludedInputAmount.fee.eq(new BN(transferFeeA.maximumFee.toString())));

          const quote = swapQuoteWithParams(
            {
              // A --> B, ExactIn
              amountSpecifiedIsInput: true,
              aToB,
              tokenAmount: transferFeeExcludedInputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                aToB,
                ctx.program.programId,
                whirlpoolPubkey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100), // 0% slippage
          );

          const tx = toTx(ctx, WhirlpoolIx.swapV2Ix(ctx.program, {
            ...quote,
            amount: inputAmount,
            otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true), // not interested in this case

            whirlpool: whirlpoolPubkey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            oracle: PDAUtil.getOracle(ctx.program.programId, whirlpoolPubkey).publicKey,
          }));

          const preWithheldAmount = await fetchTransferFeeWithheldAmount(poolInitInfo.tokenVaultAKeypair.publicKey);
          await tx.buildAndExecute();
          const postWithheldAmount = await fetchTransferFeeWithheldAmount(poolInitInfo.tokenVaultAKeypair.publicKey);

          // fee is based on the current maximum
          const withheldDelta = postWithheldAmount.sub(preWithheldAmount);
          assert.ok(withheldDelta.eq(transferFeeExcludedInputAmount.fee));

          oldMaximumFee = newMaximumFee;
        }
      });

      it("vault to owner", async () => {
        const { poolInitInfo, tokenAccountA, tokenAccountB } = fixture.getInfos();
        const tokenA = poolInitInfo.tokenMintA;
        const tokenB = poolInitInfo.tokenMintB;

        // fee config is initialized with older = newer state
        const initialFeeConfigB = await fetchTransferFeeConfig(tokenB);
        assert.equal(initialFeeConfigB.newerTransferFee.maximumFee, 200_000n);
        assert.equal(initialFeeConfigB.olderTransferFee.maximumFee, 200_000n);

        const newMaximumFeeList = [10_000n, 1_000n];
        let oldMaximumFee = 200_000n;
        for (let i = 0; i < newMaximumFeeList.length; i++) {
          const newMaximumFee = newMaximumFeeList[i];

          // update fee config
          await toTx(ctx, {
            cleanupInstructions: [],
            signers: [], // provider.wallet is authority & payer
            instructions: [
              createSetTransferFeeInstruction(
                tokenB,
                initialFeeConfigB.newerTransferFee.transferFeeBasisPoints, // no change
                newMaximumFee,
                provider.wallet.publicKey,
              )
            ]
          }).buildAndExecute();

          const updatedFeeConfigB = await fetchTransferFeeConfig(tokenB);
          assert.equal(updatedFeeConfigB.newerTransferFee.maximumFee, newMaximumFee);
          assert.equal(updatedFeeConfigB.olderTransferFee.maximumFee, oldMaximumFee);

          // wait for epoch to enable updated fee rate
          await waitEpoch(Number(updatedFeeConfigB.newerTransferFee.epoch));
          assert.ok((await getCurrentEpoch()) >= updatedFeeConfigB.newerTransferFee.epoch);

          const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;

          const whirlpoolData = (await fetcher.getPool(whirlpoolPubkey, IGNORE_CACHE)) as WhirlpoolData;

          const aToB = true;
          const inputAmount = new BN(1_000_000);
          const feeConfigA = await fetchTransferFeeConfig(tokenA);
          const transferFeeA = getEpochFee(feeConfigA, BigInt(await getCurrentEpoch()));
          const transferFeeExcludedInputAmount = calculateTransferFeeExcludedAmount(transferFeeA, inputAmount);
  
          const quote = swapQuoteWithParams(
            {
              // A --> B, ExactIn
              amountSpecifiedIsInput: true,
              aToB,
              tokenAmount: transferFeeExcludedInputAmount.amount,

              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
              sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
              whirlpoolData,
              tickArrays: await SwapUtils.getTickArrays(
                whirlpoolData.tickCurrentIndex,
                whirlpoolData.tickSpacing,
                aToB,
                ctx.program.programId,
                whirlpoolPubkey,
                fetcher,
                IGNORE_CACHE,
              ),
              tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
            },
            Percentage.fromFraction(0, 100), // 0% slippage
          );

          const transferFeeB = getEpochFee(updatedFeeConfigB, BigInt(await getCurrentEpoch()));
          const transferFeeExcludedOutputAmount = calculateTransferFeeExcludedAmount(transferFeeB, quote.estimatedAmountOut);
  
          // non zero, and limited by maximum
          assert.ok(transferFeeExcludedOutputAmount.fee.gtn(0));
          assert.ok(transferFeeExcludedOutputAmount.fee.eq(new BN(transferFeeB.maximumFee.toString())));
  
          const tx = toTx(ctx, WhirlpoolIx.swapV2Ix(ctx.program, {
            ...quote,
            amount: inputAmount,
            otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true), // not interested in this case

            whirlpool: whirlpoolPubkey,
            tokenAuthority: ctx.wallet.publicKey,
            tokenMintA: poolInitInfo.tokenMintA,
            tokenMintB: poolInitInfo.tokenMintB,
            tokenProgramA: poolInitInfo.tokenProgramA,
            tokenProgramB: poolInitInfo.tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
            oracle: PDAUtil.getOracle(ctx.program.programId, whirlpoolPubkey).publicKey,
          }));

          const preWithheldAmount = await fetchTransferFeeWithheldAmount(tokenAccountB);
          await tx.buildAndExecute();
          const postWithheldAmount = await fetchTransferFeeWithheldAmount(tokenAccountB);
  
          // fee is based on the current maximum
          const withheldDelta = postWithheldAmount.sub(preWithheldAmount);
          assert.ok(withheldDelta.eq(transferFeeExcludedOutputAmount.fee));
  
          oldMaximumFee = newMaximumFee;
        }
      });  
    });

    it("logging applied TransferFee config info", async () => {
      const { poolInitInfo, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const tokenA = poolInitInfo.tokenMintA;
      const tokenB = poolInitInfo.tokenMintB;

      const feeConfigA = await fetchTransferFeeConfig(tokenA);
      const feeConfigB = await fetchTransferFeeConfig(tokenB);
      const transferFeeA = getEpochFee(feeConfigA, BigInt(await getCurrentEpoch()));
      const transferFeeB = getEpochFee(feeConfigB, BigInt(await getCurrentEpoch()));

      const whirlpoolPubkey = poolInitInfo.whirlpoolPda.publicKey;

      let whirlpoolData = (await fetcher.getPool(whirlpoolPubkey, IGNORE_CACHE)) as WhirlpoolData;

      const aToB = true;
      const inputAmount = new BN(1_000_000);
      const transferFeeExcludedInputAmount = calculateTransferFeeExcludedAmount(transferFeeA, inputAmount);

      const quote = swapQuoteWithParams(
        {
          // A --> B, ExactIn
          amountSpecifiedIsInput: true,
          aToB,
          tokenAmount: transferFeeExcludedInputAmount.amount,

          otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
          sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
          whirlpoolData,
          tickArrays: await SwapUtils.getTickArrays(
            whirlpoolData.tickCurrentIndex,
            whirlpoolData.tickSpacing,
            aToB,
            ctx.program.programId,
            whirlpoolPubkey,
            fetcher,
            IGNORE_CACHE,
          ),
          tokenExtensionCtx: withNoExtension, // TransferFee is taken into account later
        },
        Percentage.fromFraction(0, 100), // 0% slippage
      );

      const sig =  await toTx(ctx, WhirlpoolIx.swapV2Ix(ctx.program, {
        ...quote,
        amount: inputAmount,
        otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true), // not interested in this case

        whirlpool: whirlpoolPubkey,
        tokenAuthority: ctx.wallet.publicKey,
        tokenMintA: poolInitInfo.tokenMintA,
        tokenMintB: poolInitInfo.tokenMintB,
        tokenProgramA: poolInitInfo.tokenProgramA,
        tokenProgramB: poolInitInfo.tokenProgramB,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
        oracle: PDAUtil.getOracle(ctx.program.programId, whirlpoolPubkey).publicKey,
      })).buildAndExecute();

      const parsedTx = await provider.connection.getParsedTransaction(
        sig,
        {maxSupportedTransactionVersion: 0}
      );

      assert.ok(parsedTx?.meta?.innerInstructions);
      assert.ok(parsedTx!.meta!.innerInstructions.length === 1); // twoHopSwap only (top-level ix)
      const memoLogs = parsedTx!.meta!.innerInstructions[0].instructions
        .filter((ix) => ix.programId.equals(MEMO_PROGRAM_ADDRESS));
      
      assert.ok(memoLogs.length === 2);
      assert.ok((memoLogs[0] as any).parsed === `TFe: ${transferFeeA.transferFeeBasisPoints}, ${transferFeeA.maximumFee}`);
      assert.ok((memoLogs[1] as any).parsed === `TFe: ${transferFeeB.transferFeeBasisPoints}, ${transferFeeB.maximumFee}`);
    });
  });
});
