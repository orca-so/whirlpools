import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { MathUtil, PDA, Percentage } from "@orca-so/common-sdk";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  collectRewardsQuote,
  DecreaseLiquidityQuote,
  decreaseLiquidityQuoteByLiquidityWithParams,
  InitPoolV2Params,
  NUM_REWARDS,
  PDAUtil,
  PoolUtil,
  PositionData,
  PriceMath,
  SwapQuote,
  swapQuoteWithParams,
  SwapUtils,
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
  TickSpacing,
  ZERO_BN,
} from "../../../utils";
import { defaultConfirmOptions } from "../../../utils/const";
import { WhirlpoolTestFixtureV2 } from "../../../utils/v2/fixture-v2";
import {
  FundedPositionV2Params,
  fundPositionsV2,
  initTestPoolWithTokensV2,
  useMaxCU,
} from "../../../utils/v2/init-utils-v2";
import {
  createTokenAccountV2,
} from "../../../utils/v2/token-2022";
import { AccountMeta, ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import { initTickArrayRange } from "../../../utils/init-utils";
import {
  InitAquariumV2Params,
  buildTestAquariumsV2,
  getDefaultAquariumV2,
  getTokenAccsForPoolsV2,
} from "../../../utils/v2/aquarium-v2";
import { getExtraAccountMetasForTestTransferHookProgram, getTestTransferHookCounter, updateTransferHookProgram } from "../../../utils/v2/test-transfer-hook-program";
import { TokenExtensionUtil } from "../../../../src/utils/token-extension-util";

describe("TokenExtension/TransferHook", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);

  describe("collect_fees_v2, collect_protocol_fees_v2", () => {
    let fixture: WhirlpoolTestFixtureV2;
    let feeAccountA: PublicKey;
    let feeAccountB: PublicKey;
    let tokenTransferHookAccountsA: AccountMeta[] | undefined;
    let tokenTransferHookAccountsB: AccountMeta[] | undefined;

    beforeEach(async () => {
      // In same tick array - start index 22528
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;

      const tickSpacing = TickSpacing.Standard;
      fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true, hasTransferHookExtension: true },
        tokenTraitB: { isToken2022: true, hasTransferHookExtension: true },
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
        22528
      );
      const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

      // TransferHook
      tokenTransferHookAccountsA = await getExtraAccountMetasForTestTransferHookProgram(provider, tokenMintA);
      tokenTransferHookAccountsB = await getExtraAccountMetasForTestTransferHookProgram(provider, tokenMintB);

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
          tokenTransferHookAccountsA, // TransferHook
          tokenTransferHookAccountsB, // TransferHook
        })
      ).prependInstruction(useMaxCU()).buildAndExecute();

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
          tokenTransferHookAccountsA, // TransferHook
          tokenTransferHookAccountsB, // TransferHook
        })
      ).prependInstruction(useMaxCU()).buildAndExecute();

      await toTx(
        ctx,
        WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          position: positions[0].publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        })
      ).buildAndExecute();

      const whirlpoolData = (await fetcher.getPool(whirlpoolPda.publicKey, IGNORE_CACHE))!;
      assert.ok(!whirlpoolData.protocolFeeOwedA.isZero());
      assert.ok(!whirlpoolData.protocolFeeOwedB.isZero());

      const positionBeforeCollect = (await fetcher.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE
      )) as PositionData;
      assert.ok(!positionBeforeCollect.feeOwedA.isZero());
      assert.ok(!positionBeforeCollect.feeOwedB.isZero());

      feeAccountA = await createTokenAccountV2(
        provider,
        { isToken2022: true },
        tokenMintA,
        provider.wallet.publicKey
      );
      feeAccountB = await createTokenAccountV2(
        provider,
        { isToken2022: true },
        tokenMintB,
        provider.wallet.publicKey
      );
    });

    it("collect_fees_v2: with transfer hook", async () => {
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

      const preCounterA = await getTestTransferHookCounter(provider, tokenMintA);
      const preCounterB = await getTestTransferHookCounter(provider, tokenMintB);

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
          tokenTransferHookAccountsA, // TransferHook
          tokenTransferHookAccountsB, // TransferHook
        })
      ).buildAndExecute();
      const feeBalanceA = await getTokenBalance(provider, feeAccountA);
      const feeBalanceB = await getTokenBalance(provider, feeAccountB);
      assert.ok(new BN(feeBalanceA).gtn(0));
      assert.ok(new BN(feeBalanceB).gtn(0));

      const postCounterA = await getTestTransferHookCounter(provider, tokenMintA);
      const postCounterB = await getTestTransferHookCounter(provider, tokenMintB);
      assert.equal(postCounterA, preCounterA + 1);
      assert.equal(postCounterB, preCounterB + 1);
    });

    it("collect_fees_v2: without transfer hook (has extension, but set null)", async () => {
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

      const preCounterA = await getTestTransferHookCounter(provider, tokenMintA);
      const preCounterB = await getTestTransferHookCounter(provider, tokenMintB);

      await updateTransferHookProgram(provider, tokenMintA, PublicKey.default);
      await updateTransferHookProgram(provider, tokenMintB, PublicKey.default);

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
          tokenTransferHookAccountsA: undefined, // TransferHook
          tokenTransferHookAccountsB: undefined, // TransferHook
        })
      ).buildAndExecute();
      const feeBalanceA = await getTokenBalance(provider, feeAccountA);
      const feeBalanceB = await getTokenBalance(provider, feeAccountB);
      assert.ok(new BN(feeBalanceA).gtn(0));
      assert.ok(new BN(feeBalanceB).gtn(0));

      const postCounterA = await getTestTransferHookCounter(provider, tokenMintA);
      const postCounterB = await getTestTransferHookCounter(provider, tokenMintB);

      assert.equal(postCounterA, preCounterA);
      assert.equal(postCounterB, preCounterB);
    });

    it("collect_fees_v2: [Fail] with transfer hook, but no extra accounts provided for A", async () => {
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

      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA: undefined, // TransferHook (not provided)
            tokenTransferHookAccountsB, // TransferHook
          })
        ).buildAndExecute(),
        /0x17a2/ // NoExtraAccountsForTransferHook
      );
    });

    it("collect_fees_v2: [Fail] with transfer hook, but no extra accounts provided for B", async () => {
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

      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA, // TransferHook
            tokenTransferHookAccountsB: undefined, // TransferHook (not provided)
          })
        ).buildAndExecute(),
        /0x17a2/ // NoExtraAccountsForTransferHook
      );
    });

    it("collect_fees_v2: [Fail] with transfer hook, but extra accounts provided for A is insufficient(counter)", async () => {
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

      // counter account is missing
      const insufficientTransferHookAccountsA = tokenTransferHookAccountsA!.slice(1);

      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA: insufficientTransferHookAccountsA,
            tokenTransferHookAccountsB, // TransferHook
          })
        ).buildAndExecute(),
        // Errors on tlv-account-resolution
        // https://github.com/solana-labs/solana-program-library/blob/dbf609206a60ed5698644f4840ddbd117d2c83d8/libraries/tlv-account-resolution/src/error.rs#L6
        /0xa261c2c0/ // IncorrectAccount (2724315840)
      );
    });

    it("collect_fees_v2: [Fail] with transfer hook, but extra accounts provided for A is insufficient(ExtraAccountMetas)", async () => {
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

      // ExtraAccountMetas is missing
      const insufficientTransferHookAccountsA = [
        ...tokenTransferHookAccountsA!.slice(0,1),
        ...tokenTransferHookAccountsA!.slice(2)
      ];

      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA: insufficientTransferHookAccountsA,
            tokenTransferHookAccountsB, // TransferHook
          })
        ).buildAndExecute(),
        // Errors on transfer-hook-interface
        // https://github.com/solana-labs/solana-program-library/blob/dbf609206a60ed5698644f4840ddbd117d2c83d8/token/transfer-hook/interface/src/error.rs#L6
        /0x7dc8348c/ // IncorrectAccount (2110272652)
      );
    });

    it("collect_fees_v2: [Fail] with transfer hook, but extra accounts provided for A is insufficient(HookProgram)", async () => {
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

      // HookProgram is missing
      const insufficientTransferHookAccountsA = tokenTransferHookAccountsA!.slice(0,2);

      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA: insufficientTransferHookAccountsA,
            tokenTransferHookAccountsB, // TransferHook
          })
        ).buildAndExecute(),
        // Errors on transfer-hook-interface
        // https://github.com/solana-labs/solana-program-library/blob/dbf609206a60ed5698644f4840ddbd117d2c83d8/token/transfer-hook/interface/src/error.rs#L6
        /0x7dc8348c/ // IncorrectAccount (2110272652)
      );
    });

    it("collect_protocol_fees_v2: with transfer hook", async () => {
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

      const preCounterA = await getTestTransferHookCounter(provider, tokenMintA);
      const preCounterB = await getTestTransferHookCounter(provider, tokenMintB);

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
          tokenTransferHookAccountsA, // TransferHook
          tokenTransferHookAccountsB, // TransferHook
        })
      )
        .addSigner(collectProtocolFeesAuthorityKeypair)
        .buildAndExecute();
      const feeBalanceA = await getTokenBalance(provider, feeAccountA);
      const feeBalanceB = await getTokenBalance(provider, feeAccountB);
      assert.ok(new BN(feeBalanceA).gtn(0));
      assert.ok(new BN(feeBalanceB).gtn(0));

      const postCounterA = await getTestTransferHookCounter(provider, tokenMintA);
      const postCounterB = await getTestTransferHookCounter(provider, tokenMintB);
      assert.equal(postCounterA, preCounterA + 1);
      assert.equal(postCounterB, preCounterB + 1);
    });

    it("collect_protocol_fees_v2: [Fail] with transfer hook, but no extra accounts provided for A", async () => {
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

      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA: undefined, // TransferHook (not provided)
            tokenTransferHookAccountsB, // TransferHook
          })
        )
          .addSigner(collectProtocolFeesAuthorityKeypair)
          .buildAndExecute(),
        /0x17a2/ // NoExtraAccountsForTransferHook
      );    
    });

    it("collect_protocol_fees_v2: [Fail] with transfer hook, but no extra accounts provided for B", async () => {
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

      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA, // TransferHook
            tokenTransferHookAccountsB: undefined, // TransferHook (not provided)
          })
        )
          .addSigner(collectProtocolFeesAuthorityKeypair)
          .buildAndExecute(),
        /0x17a2/ // NoExtraAccountsForTransferHook
      );    
    });
  });

  describe("collect_reward_v2", () => {
    let fixture: WhirlpoolTestFixtureV2;
    let rewardAccounts: PublicKey[];
    let tokenTransferHookAccounts: (AccountMeta[] | undefined)[];

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
            rewardTokenTrait: { isToken2022: true, hasTransferHookExtension: true },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: { isToken2022: true, hasTransferHookExtension: true },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: { isToken2022: true, hasTransferHookExtension: true },
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
        })
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
      }

      rewardAccounts = await Promise.all(
        rewards.map((reward) => {
          return createTokenAccountV2(
            provider,
            { isToken2022: true },
            reward.rewardMint,
            provider.wallet.publicKey
          );
        })
      );

      tokenTransferHookAccounts = await Promise.all(
        rewards.map((reward) => {
          return getExtraAccountMetasForTestTransferHookProgram(provider, reward.rewardMint)
        })
      );
    });

    it("collect_reward_v2: with transfer hook", async () => {
      const {
        poolInitInfo: { whirlpoolPda },
        positions,
        rewards,
      } = fixture.getInfos();

      for (let i = 0; i < NUM_REWARDS; i++) {
        const preCounter = await getTestTransferHookCounter(provider, rewards[i].rewardMint);

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
            rewardTransferHookAccounts: tokenTransferHookAccounts[i], // TransferHook
          })
        ).buildAndExecute();
        const rewardBalance = await getTokenBalance(provider, rewardAccounts[i]);
        assert.ok(new BN(rewardBalance).gtn(0));

        const postCounter = await getTestTransferHookCounter(provider, rewards[i].rewardMint);
        assert.equal(postCounter, preCounter + 1);
      }
    });

    it("collect_reward_v2: [Fail] with transfer hook, but no extra accounts provided for rewardToken", async () => {
      const {
        poolInitInfo: { whirlpoolPda },
        positions,
        rewards,
      } = fixture.getInfos();

      for (let i = 0; i < NUM_REWARDS; i++) {
        const preCounter = await getTestTransferHookCounter(provider, rewards[i].rewardMint);

        await assert.rejects(
          toTx(
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
              rewardTransferHookAccounts: undefined, // TransferHook (not provided)
            })
          ).buildAndExecute(),
          /0x17a2/ // NoExtraAccountsForTransferHook
        );
      }
    });
  });

  describe("increase_liquidity_v2", () => {
    const tickLowerIndex = 7168;
    const tickUpperIndex = 8960;
    const currTick = Math.round((tickLowerIndex + tickUpperIndex) / 2);

    let fixture: WhirlpoolTestFixtureV2;
    let tokenTransferHookAccountsA: AccountMeta[] | undefined;
    let tokenTransferHookAccountsB: AccountMeta[] | undefined;

    beforeEach(async () => {
      fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true, hasTransferHookExtension: true},
        tokenTraitB: { isToken2022: true, hasTransferHookExtension: true},
        tickSpacing: TickSpacing.Standard,
        positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN }],
        initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
      });
      const { poolInitInfo } = fixture.getInfos();

      // TransferHook
      tokenTransferHookAccountsA = await getExtraAccountMetasForTestTransferHookProgram(provider, poolInitInfo.tokenMintA);
      tokenTransferHookAccountsB = await getExtraAccountMetasForTestTransferHookProgram(provider, poolInitInfo.tokenMintB);
    });

    it("increase_liquidity_v2: with transfer hook", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const positionInitInfo = positions[0];

      const tokenAmount = toTokenAmount(1_000_000, 1_000_000);
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount
      );

      const preCounterA = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintA);
      const preCounterB = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintB);

      const preVaultBalanceA = await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey);
      const preVaultBalanceB = await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey);

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
          tokenTransferHookAccountsA, // TransferHook
          tokenTransferHookAccountsB, // TransferHook
        })
      ).buildAndExecute();

      const postVaultBalanceA = await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey);
      const postVaultBalanceB = await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey);
      assert.ok(new BN(postVaultBalanceA).gt(new BN(preVaultBalanceA)));
      assert.ok(new BN(postVaultBalanceB).gt(new BN(preVaultBalanceB)));

      const postCounterA = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintA);
      const postCounterB = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintB);
      assert.equal(postCounterA, preCounterA + 1);
      assert.equal(postCounterB, preCounterB + 1);
    });

    it("increase_liquidity_v2: without transfer hook (has extension, but set null)", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const positionInitInfo = positions[0];

      const tokenAmount = toTokenAmount(1_000_000, 1_000_000);
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount
      );

      const preCounterA = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintA);
      const preCounterB = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintB);

      const preVaultBalanceA = await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey);
      const preVaultBalanceB = await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey);

      await updateTransferHookProgram(provider, poolInitInfo.tokenMintA, PublicKey.default);
      await updateTransferHookProgram(provider, poolInitInfo.tokenMintB, PublicKey.default);

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
          tokenTransferHookAccountsA: undefined, // TransferHook
          tokenTransferHookAccountsB: undefined, // TransferHook
        })
      ).buildAndExecute();

      const postVaultBalanceA = await getTokenBalance(provider, poolInitInfo.tokenVaultAKeypair.publicKey);
      const postVaultBalanceB = await getTokenBalance(provider, poolInitInfo.tokenVaultBKeypair.publicKey);
      assert.ok(new BN(postVaultBalanceA).gt(new BN(preVaultBalanceA)));
      assert.ok(new BN(postVaultBalanceB).gt(new BN(preVaultBalanceB)));

      const postCounterA = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintA);
      const postCounterB = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintB);
      assert.equal(postCounterA, preCounterA);
      assert.equal(postCounterB, preCounterB);
    });

    it("increase_liquidity_v2: [Fail] with transfer hook, but no extra accounts provided for A", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const positionInitInfo = positions[0];

      const tokenAmount = toTokenAmount(1_000_000, 1_000_000);
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount
      );

      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA: undefined, // TransferHook (not provided)
            tokenTransferHookAccountsB, // TransferHook
          })
        ).buildAndExecute(),
        /0x17a2/ // NoExtraAccountsForTransferHook
      );
    });

    it("increase_liquidity_v2: [Fail] with transfer hook, but no extra accounts provided for B", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const positionInitInfo = positions[0];

      const tokenAmount = toTokenAmount(1_000_000, 1_000_000);
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount
      );

      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA, // TransferHook
            tokenTransferHookAccountsB: undefined, // TransferHook (not provided)
          })
        ).buildAndExecute(),
        /0x17a2/ // NoExtraAccountsForTransferHook
      );
    });

    it("increase_liquidity_v2: [Fail] with transfer hook, but extra accounts provided for A is insufficient(counter)", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const positionInitInfo = positions[0];

      const tokenAmount = toTokenAmount(1_000_000, 1_000_000);
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount
      );

      // counter account is missing
      const insufficientTransferHookAccountsA = tokenTransferHookAccountsA!.slice(1);

      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA: insufficientTransferHookAccountsA,
            tokenTransferHookAccountsB, // TransferHook
          })
        ).buildAndExecute(),
        // Errors on tlv-account-resolution
        // https://github.com/solana-labs/solana-program-library/blob/dbf609206a60ed5698644f4840ddbd117d2c83d8/libraries/tlv-account-resolution/src/error.rs#L6
        /0xa261c2c0/ // IncorrectAccount (2724315840)
      );
    });

    it("increase_liquidity_v2: [Fail] with transfer hook, but extra accounts provided for A is insufficient(ExtraAccountMetas)", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const positionInitInfo = positions[0];

      const tokenAmount = toTokenAmount(1_000_000, 1_000_000);
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount
      );

      // ExtraAccountMetas is missing
      const insufficientTransferHookAccountsA = [
        ...tokenTransferHookAccountsA!.slice(0,1),
        ...tokenTransferHookAccountsA!.slice(2)
      ];

      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA: insufficientTransferHookAccountsA,
            tokenTransferHookAccountsB, // TransferHook
          })
        ).buildAndExecute(),
        // Errors on transfer-hook-interface
        // https://github.com/solana-labs/solana-program-library/blob/dbf609206a60ed5698644f4840ddbd117d2c83d8/token/transfer-hook/interface/src/error.rs#L6
        /0x7dc8348c/ // IncorrectAccount (2110272652)
      );
    });

    it("increase_liquidity_v2: [Fail] with transfer hook, but extra accounts provided for A is insufficient(HookProgram)", async () => {
      const { poolInitInfo, positions, tokenAccountA, tokenAccountB } = fixture.getInfos();
      const positionInitInfo = positions[0];

      const tokenAmount = toTokenAmount(1_000_000, 1_000_000);
      const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
        currTick,
        tickLowerIndex,
        tickUpperIndex,
        tokenAmount
      );

      // HookProgram is missing
      const insufficientTransferHookAccountsA = tokenTransferHookAccountsA!.slice(0,2);

      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA: insufficientTransferHookAccountsA,
            tokenTransferHookAccountsB, // TransferHook
          })
        ).buildAndExecute(),
        // Errors on transfer-hook-interface
        // https://github.com/solana-labs/solana-program-library/blob/dbf609206a60ed5698644f4840ddbd117d2c83d8/token/transfer-hook/interface/src/error.rs#L6
        /0x7dc8348c/ // IncorrectAccount (2110272652)
      );
    });
  });

  describe("decrease_liquidity_v2", () => {
    let fixture: WhirlpoolTestFixtureV2;
    let removalQuote: DecreaseLiquidityQuote;
    let destAccountA: PublicKey;
    let destAccountB: PublicKey;
    let tokenTransferHookAccountsA: AccountMeta[] | undefined;
    let tokenTransferHookAccountsB: AccountMeta[] | undefined;

    beforeEach(async () => {
      const liquidityAmount = new anchor.BN(1_250_000);
      const tickLower = 7168,
        tickUpper = 8960;
      fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true, hasTransferHookExtension: true },
        tokenTraitB: { isToken2022: true, hasTransferHookExtension: true },
        tickSpacing: TickSpacing.Standard,
        initialSqrtPrice: MathUtil.toX64(new Decimal(1.48)),
        positions: [{ tickLowerIndex: tickLower, tickUpperIndex: tickUpper, liquidityAmount }],
      });
      const { poolInitInfo } = fixture.getInfos();
      const { whirlpoolPda } = poolInitInfo;
      const poolBefore = (await fetcher.getPool(
        whirlpoolPda.publicKey,
        IGNORE_CACHE
      )) as WhirlpoolData;

      removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
        liquidity: new anchor.BN(1_000_000),
        sqrtPrice: poolBefore.sqrtPrice,
        slippageTolerance: Percentage.fromFraction(1, 100),
        tickCurrentIndex: poolBefore.tickCurrentIndex,
        tickLowerIndex: tickLower,
        tickUpperIndex: tickUpper,
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(fetcher, poolBefore, IGNORE_CACHE),
      });
      assert.ok(!removalQuote.tokenEstA.isZero());
      assert.ok(!removalQuote.tokenEstB.isZero());

      destAccountA = await createTokenAccountV2(
        provider,
        { isToken2022: true },
        poolInitInfo.tokenMintA,
        provider.wallet.publicKey
      );
      destAccountB = await createTokenAccountV2(
        provider,
        { isToken2022: true },
        poolInitInfo.tokenMintB,
        provider.wallet.publicKey
      );

      // TransferHook
      tokenTransferHookAccountsA = await getExtraAccountMetasForTestTransferHookProgram(provider, poolInitInfo.tokenMintA);
      tokenTransferHookAccountsB = await getExtraAccountMetasForTestTransferHookProgram(provider, poolInitInfo.tokenMintB);      
    });

    it("decrease_liquidity_v2: with transfer hook", async () => {
      const { poolInitInfo, positions } = fixture.getInfos();

      const preCounterA = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintA);
      const preCounterB = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintB);

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
          tokenTransferHookAccountsA, // TransferHook
          tokenTransferHookAccountsB, // TransferHook
        })
      ).buildAndExecute();
      const destBalanceA = await getTokenBalance(provider, destAccountA);
      const destBalanceB = await getTokenBalance(provider, destAccountB);
      assert.ok(new BN(destBalanceA).gtn(0));
      assert.ok(new BN(destBalanceB).gtn(0));

      const postCounterA = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintA);
      const postCounterB = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintB);
      assert.equal(postCounterA, preCounterA + 1);
      assert.equal(postCounterB, preCounterB + 1);
    });
  
    it("decrease_liquidity_v2: [Fail] with transfer hook, but no extra accounts provided for A", async () => {
      const { poolInitInfo, positions } = fixture.getInfos();

      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA: undefined, // TransferHook (not provided)
            tokenTransferHookAccountsB, // TransferHook
          })
        ).buildAndExecute(),
        /0x17a2/ // NoExtraAccountsForTransferHook
      );
    });

    it("decrease_liquidity_v2: [Fail] with transfer hook, but no extra accounts provided for B", async () => {
      const { poolInitInfo, positions } = fixture.getInfos();

      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA, // TransferHook
            tokenTransferHookAccountsB: undefined, // TransferHook (not provided)
          })
        ).buildAndExecute(),
        /0x17a2/ // NoExtraAccountsForTransferHook
      );
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
    let tokenTransferHookAccountsA: AccountMeta[] | undefined;
    let tokenTransferHookAccountsB: AccountMeta[] | undefined;

    beforeEach(async () => {
      const init = await initTestPoolWithTokensV2(
        ctx,
        { isToken2022: true, hasTransferHookExtension: true },
        { isToken2022: true, hasTransferHookExtension: true },
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
        aToB
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

      const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
      const whirlpoolData = (await fetcher.getPool(whirlpoolKey, IGNORE_CACHE)) as WhirlpoolData;

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
            IGNORE_CACHE
          ),
          tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(fetcher, whirlpoolData, IGNORE_CACHE),
        },
        Percentage.fromFraction(100, 100) // 100% slippage
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
            IGNORE_CACHE
          ),
          tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(fetcher, whirlpoolData, IGNORE_CACHE),
        },
        Percentage.fromFraction(100, 100) // 100% slippage
      );

      // TransferHook
      tokenTransferHookAccountsA = await getExtraAccountMetasForTestTransferHookProgram(provider, poolInitInfo.tokenMintA);
      tokenTransferHookAccountsB = await getExtraAccountMetasForTestTransferHookProgram(provider, poolInitInfo.tokenMintB);
    });

    it("swap_v2: with transfer hook, a to b", async () => {
      const preCounterA = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintA);
      const preCounterB = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintB);

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
          tokenTransferHookAccountsA, // TransferHook
          tokenTransferHookAccountsB, // TransferHook
        })
      ).buildAndExecute();

      const postCounterA = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintA);
      const postCounterB = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintB);
      assert.equal(postCounterA, preCounterA + 1);
      assert.equal(postCounterB, preCounterB + 1);
    });

    it("swap_v2: with transfer hook, b to a", async () => {
      const preCounterA = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintA);
      const preCounterB = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintB);

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
          tokenTransferHookAccountsA, // TransferHook
          tokenTransferHookAccountsB, // TransferHook
        })
      ).buildAndExecute();

      const postCounterA = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintA);
      const postCounterB = await getTestTransferHookCounter(provider, poolInitInfo.tokenMintB);
      assert.equal(postCounterA, preCounterA + 1);
      assert.equal(postCounterB, preCounterB + 1);
    });

    it("swap_v2: [Fail] with transfer hook, a to b, but no extra accounts provided for A", async () => {
      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA: undefined, // TransferHook (not provided)
            tokenTransferHookAccountsB, // TransferHook
          })
        ).buildAndExecute(),
        /0x17a2/ // NoExtraAccountsForTransferHook
      );
    });

    it("swap_v2: [Fail] with transfer hook, a to b, but no extra accounts provided for B", async () => {
      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA, // TransferHook
            tokenTransferHookAccountsB: undefined, // TransferHook (not provided)
          })
        ).buildAndExecute(),
        /0x17a2/ // NoExtraAccountsForTransferHook
      );
    });

    it("swap_v2: [Fail] with transfer hook, b to a, but no extra accounts provided for A", async () => {
      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA: undefined, // TransferHook (not provided)
            tokenTransferHookAccountsB, // TransferHook
          })
        ).buildAndExecute(),
        /0x17a2/ // NoExtraAccountsForTransferHook
      );
    });

    it("swap_v2: [Fail] with transfer hook, b to a, but no extra accounts provided for B", async () => {
      await assert.rejects(
        toTx(
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
            tokenTransferHookAccountsA, // TransferHook
            tokenTransferHookAccountsB: undefined, // TransferHook (not provided)
          })
        ).buildAndExecute(),
        /0x17a2/ // NoExtraAccountsForTransferHook
      );
    });
  });

  describe("two_hop_swap", () => {
    let aqConfig: InitAquariumV2Params;
    let baseIxParams: TwoHopSwapV2Params;
    let tokenMintIn: PublicKey;
    let tokenMintOut: PublicKey;
    let tokenMintMid: PublicKey;
    let tokenTransferHookAccountsInput: AccountMeta[] | undefined;
    let tokenTransferHookAccountsMid: AccountMeta[] | undefined;
    let tokenTransferHookAccountsOutput: AccountMeta[] | undefined;

    beforeEach(async () => {
      aqConfig = getDefaultAquariumV2();
      // Add a third token and account and a second pool
      aqConfig.initMintParams = [
        { tokenTrait: { isToken2022: true, hasTransferHookExtension: true } },
        { tokenTrait: { isToken2022: true, hasTransferHookExtension: true } },
        { tokenTrait: { isToken2022: true, hasTransferHookExtension: true } },
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

      const aquarium = (await buildTestAquariumsV2(ctx, [aqConfig]))[0];
      const { tokenAccounts, mintKeys, pools } = aquarium;

      const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
      const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
      const whirlpoolDataOne = (await fetcher.getPool(
        whirlpoolOneKey,
        IGNORE_CACHE
      )) as WhirlpoolData;
      const whirlpoolDataTwo = (await fetcher.getPool(
        whirlpoolTwoKey,
        IGNORE_CACHE
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
            IGNORE_CACHE
          ),
          tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(fetcher, whirlpoolDataOne, IGNORE_CACHE),
        },
        Percentage.fromFraction(1, 100)
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
            IGNORE_CACHE
          ),
          tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(fetcher, whirlpoolDataTwo, IGNORE_CACHE),
        },
        Percentage.fromFraction(1, 100)
      );

      const tokenAccKeys = getTokenAccsForPoolsV2(pools, tokenAccounts);
      const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote, quote2);
      baseIxParams = {
        ...twoHopQuote,
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
      
      // TransferHook
      tokenMintIn = baseIxParams.tokenMintInput;
      tokenMintOut = baseIxParams.tokenMintOutput;
      tokenMintMid = baseIxParams.tokenMintIntermediate;
      tokenTransferHookAccountsInput = await getExtraAccountMetasForTestTransferHookProgram(provider, baseIxParams.tokenMintInput);
      tokenTransferHookAccountsMid = await getExtraAccountMetasForTestTransferHookProgram(provider, baseIxParams.tokenMintIntermediate);
      tokenTransferHookAccountsOutput = await getExtraAccountMetasForTestTransferHookProgram(provider, baseIxParams.tokenMintOutput);
    });

    it("two_hop_swap_v2: with transfer hook", async () => {
      const preCounterIn = await getTestTransferHookCounter(provider, tokenMintIn);
      const preCounterOut = await getTestTransferHookCounter(provider, tokenMintOut);
      const preCounterMid = await getTestTransferHookCounter(provider, tokenMintMid);

      const tx = toTx(
        ctx,
        WhirlpoolIx.twoHopSwapV2Ix(
          ctx.program, {
            ...baseIxParams,
            // TransferHook
            tokenTransferHookAccountsInput,
            tokenTransferHookAccountsIntermediate: tokenTransferHookAccountsMid,
            tokenTransferHookAccountsOutput,
          }
        )
      );

      // add Compute units (because it calls 4 external hooks)
      tx.prependInstruction(useMaxCU());

      await tx.buildAndExecute();

      const postCounterIn = await getTestTransferHookCounter(provider, tokenMintIn);
      const postCounterOut = await getTestTransferHookCounter(provider, tokenMintOut);
      const postCounterMid = await getTestTransferHookCounter(provider, tokenMintMid);
      assert.equal(postCounterIn, preCounterIn + 1);
      assert.equal(postCounterOut, preCounterOut + 1);
      assert.equal(postCounterMid, preCounterMid + 1 /* must be 1 (vault to vault) */);
    });

    it("two_hop_swap_v2: without transfer hook (has extension, but set null)", async () => {
      const preCounterIn = await getTestTransferHookCounter(provider, tokenMintIn);
      const preCounterOut = await getTestTransferHookCounter(provider, tokenMintOut);
      const preCounterMid = await getTestTransferHookCounter(provider, tokenMintMid);

      await updateTransferHookProgram(provider, tokenMintIn, PublicKey.default);
      await updateTransferHookProgram(provider, tokenMintOut, PublicKey.default);
      await updateTransferHookProgram(provider, tokenMintMid, PublicKey.default);

      const tx = toTx(
        ctx,
        WhirlpoolIx.twoHopSwapV2Ix(
          ctx.program, {
            ...baseIxParams,
            // TransferHook
            tokenTransferHookAccountsInput: undefined,
            tokenTransferHookAccountsIntermediate: undefined,
            tokenTransferHookAccountsOutput: undefined,
          }
        )
      );

      // add Compute units (because it calls 4 external hooks)
      tx.prependInstruction({
        cleanupInstructions: [],
        signers: [],
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({
            units: 400_000
          })
        ]
      });

      await tx.buildAndExecute();

      const postCounterIn = await getTestTransferHookCounter(provider, tokenMintIn);
      const postCounterOut = await getTestTransferHookCounter(provider, tokenMintOut);
      const postCounterMid = await getTestTransferHookCounter(provider, tokenMintMid);
      assert.equal(postCounterIn, preCounterIn);
      assert.equal(postCounterOut, preCounterOut);
      assert.equal(postCounterMid, preCounterMid);
    });

    it("two_hop_swap_v2: [Fail] with transfer hook, but no extra accounts provided for tokenInput", async () => {
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.twoHopSwapV2Ix(
            ctx.program, {
              ...baseIxParams,
              // TransferHook
              tokenTransferHookAccountsInput: undefined,
              tokenTransferHookAccountsIntermediate: tokenTransferHookAccountsMid,
              tokenTransferHookAccountsOutput,
            }
          )
        // add Compute units (because it calls 4 external hooks)
        ).prependInstruction(useMaxCU()).buildAndExecute(),
        /0x17a2/ // NoExtraAccountsForTransferHook
      );
    });

    it("two_hop_swap_v2: [Fail] with transfer hook, but no extra accounts provided for tokenIntermediate", async () => {
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.twoHopSwapV2Ix(
            ctx.program, {
              ...baseIxParams,
              // TransferHook
              tokenTransferHookAccountsInput,
              tokenTransferHookAccountsIntermediate: undefined,
              tokenTransferHookAccountsOutput,
            }
          )
        // add Compute units (because it calls 4 external hooks)
        ).prependInstruction(useMaxCU()).buildAndExecute(),
        /0x17a2/ // NoExtraAccountsForTransferHook
      );
    });
    
    it("two_hop_swap_v2: [Fail] with transfer hook, but no extra accounts provided for tokenOutput", async () => {
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.twoHopSwapV2Ix(
            ctx.program, {
              ...baseIxParams,
              // TransferHook
              tokenTransferHookAccountsInput,
              tokenTransferHookAccountsIntermediate: tokenTransferHookAccountsMid,
              tokenTransferHookAccountsOutput: undefined,
            }
          )
        // add Compute units (because it calls 4 external hooks)
        ).prependInstruction(useMaxCU()).buildAndExecute(),
        /0x17a2/ // NoExtraAccountsForTransferHook
      );
    });
  });

  describe("Special Errors", () => {
    describe("TransferHook program rejects transfer", () => {
      const TOO_LARGE_THRESHOLD_U64 = new BN(1_000_000_000_000);

      // We know that all transfers are executed 2 functions depending on the direction, so 2 test cases.

      it("[FAIL] owner to vault, amount too large", async () => {
        // tokenA has transfer hook (so increase liquidity with large tokenB amount will not fail)
        const mintAmount = TOO_LARGE_THRESHOLD_U64.muln(2);

        const tickSpacing = 1;
        const rangeLowerTickIndex = -1;
        const rangeUpperTickIndex = +1;
        const currentTickIndex = +2;
        const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
          currentTickIndex, // price is above range ([-1, +1] p)
          rangeLowerTickIndex,
          rangeUpperTickIndex,
          {
            tokenA: mintAmount,
            tokenB: mintAmount,
          }
        );

        const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
          // tokenA has transfer hook
          tokenTraitA: { isToken2022: true, hasTransferHookExtension: true},
          tokenTraitB: { isToken2022: true, hasTransferHookExtension: false},
          tickSpacing,
          positions: [{
            tickLowerIndex: rangeLowerTickIndex,
            tickUpperIndex: rangeUpperTickIndex,
            liquidityAmount: liquidityAmount
          }],
          initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currentTickIndex),
          mintAmount,
        });
        const { poolInitInfo, tokenAccountA, tokenAccountB } = fixture.getInfos();

        const inputTokenAmount = TOO_LARGE_THRESHOLD_U64.addn(1); // exceed threshold by 1
        const whirlpoolData = await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey, IGNORE_CACHE) as WhirlpoolData;
        const aToB = true;
        const quote = swapQuoteWithParams(
          {
            amountSpecifiedIsInput: true,
            aToB,
            tokenAmount: inputTokenAmount,
            otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
            whirlpoolData,
            tickArrays: await SwapUtils.getTickArrays(
              whirlpoolData.tickCurrentIndex,
              whirlpoolData.tickSpacing,
              aToB,
              ctx.program.programId,
              poolInitInfo.whirlpoolPda.publicKey,
              fetcher,
              IGNORE_CACHE
            ),
            tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(fetcher, whirlpoolData, IGNORE_CACHE),
          },
          Percentage.fromFraction(1, 100)
        );
        assert.ok(quote.estimatedAmountIn.gt(TOO_LARGE_THRESHOLD_U64));
          
        // TransferHook
        const tokenTransferHookAccountsA = await getExtraAccountMetasForTestTransferHookProgram(provider, poolInitInfo.tokenMintA);
        const tokenTransferHookAccountsB = undefined;

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quote,
              whirlpool: poolInitInfo.whirlpoolPda.publicKey,
              tokenAuthority: ctx.wallet.publicKey,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
              oracle: PDAUtil.getOracle(ctx.program.programId, poolInitInfo.whirlpoolPda.publicKey).publicKey,
              tokenTransferHookAccountsA,
              tokenTransferHookAccountsB,
            })
          ).buildAndExecute(),
          (err) => {
            // error code is 0x1770 from transfer hook program and it is ambiguous, so use message string
            return JSON.stringify(err).includes("AmountTooBig");
          }
        );  
      });

      it("[FAIL] vault to owner, amount too large", async () => {
        // all tokenB is deposited into [-1, +1] (one side)
        const mintAmount = TOO_LARGE_THRESHOLD_U64.muln(2);

        const tickSpacing = 1;
        const rangeLowerTickIndex = -1;
        const rangeUpperTickIndex = +1;
        const currentTickIndex = +2;
        const liquidityAmount = PoolUtil.estimateLiquidityFromTokenAmounts(
          currentTickIndex, // price is above range ([-1, +1] p)
          rangeLowerTickIndex,
          rangeUpperTickIndex,
          {
            tokenA: TOO_LARGE_THRESHOLD_U64.muln(3).divn(4), // 3/4 of threshold
            tokenB: TOO_LARGE_THRESHOLD_U64.muln(3).divn(4), // 3/4 of threshold
          }
        );

        const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
          // tokenB has transfer hook
          tokenTraitA: { isToken2022: true, hasTransferHookExtension: false},
          tokenTraitB: { isToken2022: true, hasTransferHookExtension: true},
          tickSpacing,
          positions: [
            // to avoid large amount increase liquidity, 2 3/4 deposit will be made.
            {
              tickLowerIndex: rangeLowerTickIndex,
              tickUpperIndex: rangeUpperTickIndex,
              liquidityAmount: liquidityAmount
            },
            {
              tickLowerIndex: rangeLowerTickIndex,
              tickUpperIndex: rangeUpperTickIndex,
              liquidityAmount: liquidityAmount
            },
          ],
          initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currentTickIndex),
          mintAmount,
        });
        const { poolInitInfo, tokenAccountA, tokenAccountB } = fixture.getInfos();

        const inputTokenAmount = TOO_LARGE_THRESHOLD_U64.muln(130).divn(100); // 130% of threshold
        const whirlpoolData = await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey, IGNORE_CACHE) as WhirlpoolData;
        const aToB = true;
        const quote = swapQuoteWithParams(
          {
            amountSpecifiedIsInput: true,
            aToB,
            tokenAmount: inputTokenAmount,
            otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
            whirlpoolData,
            tickArrays: await SwapUtils.getTickArrays(
              whirlpoolData.tickCurrentIndex,
              whirlpoolData.tickSpacing,
              aToB,
              ctx.program.programId,
              poolInitInfo.whirlpoolPda.publicKey,
              fetcher,
              IGNORE_CACHE
            ),
            tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(fetcher, whirlpoolData, IGNORE_CACHE),
          },
          Percentage.fromFraction(1, 100)
        );
        assert.ok(quote.estimatedAmountOut.gt(TOO_LARGE_THRESHOLD_U64));
          
        // TransferHook
        const tokenTransferHookAccountsA = undefined;
        const tokenTransferHookAccountsB = await getExtraAccountMetasForTestTransferHookProgram(provider, poolInitInfo.tokenMintB);

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              ...quote,
              whirlpool: poolInitInfo.whirlpoolPda.publicKey,
              tokenAuthority: ctx.wallet.publicKey,
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: poolInitInfo.tokenProgramA,
              tokenProgramB: poolInitInfo.tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenVaultA: poolInitInfo.tokenVaultAKeypair.publicKey,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultB: poolInitInfo.tokenVaultBKeypair.publicKey,
              oracle: PDAUtil.getOracle(ctx.program.programId, poolInitInfo.whirlpoolPda.publicKey).publicKey,
              tokenTransferHookAccountsA,
              tokenTransferHookAccountsB,
            })
          ).buildAndExecute(),
          (err) => {
            // error code is 0x1770 from transfer hook program and it is ambiguous, so use message string
            return JSON.stringify(err).includes("AmountTooBig");
          }
        );  
      })
    })
  });
});
