import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { MathUtil, Percentage, TransactionBuilder } from "@orca-so/common-sdk";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  increaseLiquidityQuoteByLiquidityWithParams,
  PDAUtil,
  toTx,
  WhirlpoolAccountFetcherInterface,
  WhirlpoolClient,
  WhirlpoolContext,
  WhirlpoolIx,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { TickSpacing, ZERO_BN } from "../../utils";
import {
  startLiteSVM,
  createLiteSVMProvider,
  warpClock,
  pollForCondition,
} from "../../utils/litesvm";
import { WhirlpoolTestFixtureV2 } from "../../utils/v2/fixture-v2";
import { createTokenAccountV2 } from "../../utils/v2/token-2022";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { NO_TOKEN_EXTENSION_CONTEXT } from "../../../src/utils/public/token-extension-util";
import { generateDefaultOpenPositionWithTokenExtensionsParams } from "../../utils/test-builders";
import { initTestPool } from "../../utils/init-utils";
import { Keypair } from "@solana/web3.js";
import type { PublicKey } from "@solana/web3.js";

describe("position with token extensions management tests (litesvm)", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let ctx: WhirlpoolContext;
  let client: WhirlpoolClient;
  let fetcher: WhirlpoolAccountFetcherInterface;

  beforeAll(async () => {
    await startLiteSVM();
    provider = await createLiteSVMProvider();

    const programId = new anchor.web3.PublicKey(
      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    );

    const idl = require("../../../src/artifacts/whirlpool.json");
    program = new anchor.Program(idl, programId, provider);

    anchor.setProvider(provider);
    ctx = WhirlpoolContext.fromWorkspace(provider, program);
    client = buildWhirlpoolClient(ctx);
    fetcher = ctx.fetcher;
  });

  async function getRent(address: PublicKey): Promise<number> {
    const rent = (await ctx.connection.getAccountInfo(address))?.lamports;
    assert.ok(rent !== undefined);
    return rent;
  }

  async function checkClosed(address: PublicKey): Promise<void> {
    assert.equal(await provider.connection.getAccountInfo(address), undefined);
  }

  const isToken2022Variations = [false, true];

  isToken2022Variations.forEach((isToken2022) => {
    it(`open, deposit, update fees and reward, withdraw, collect fees, collect reward, close (${isToken2022 ? "V2" : "V1"} instructions)`, async () => {
      // In same tick array - start index 22528
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;

      // pool init
      const tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022 },
        tokenTraitB: { isToken2022 },
        tickSpacing,
        positions: [
          {
            tickLowerIndex,
            tickUpperIndex,
            liquidityAmount: new anchor.BN(1000),
          }, // In range position
        ],
        rewards: [
          {
            rewardTokenTrait: { isToken2022: false },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(1_000_000),
          },
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
        tokenAccountA: tokenOwnerAccountA,
        tokenAccountB: tokenOwnerAccountB,
      } = fixture.getInfos();

      const pool = await client.getPool(whirlpoolPda.publicKey);
      const tokenVaultA = tokenVaultAKeypair.publicKey;
      const tokenVaultB = tokenVaultBKeypair.publicKey;
      const tickArrayPda = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpoolPda.publicKey,
        22528,
      );
      const tickArrayLower = tickArrayPda.publicKey;
      const tickArrayUpper = tickArrayPda.publicKey;
      const oraclePda = PDAUtil.getOracle(
        ctx.program.programId,
        whirlpoolPda.publicKey,
      );

      // open position
      const { params, mint } =
        await generateDefaultOpenPositionWithTokenExtensionsParams(
          ctx,
          whirlpoolPda.publicKey,
          true,
          tickLowerIndex,
          tickUpperIndex,
          provider.wallet.publicKey,
        );
      await toTx(
        ctx,
        WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
      )
        .addSigner(mint)
        .buildAndExecute();

      const position = params.positionPda.publicKey;
      const positionTokenAccount = params.positionTokenAccount;
      const baseParams = {
        position,
        positionTokenAccount,
        positionAuthority: ctx.wallet.publicKey,
        tokenMintA,
        tokenMintB,
        tokenOwnerAccountA,
        tokenOwnerAccountB,
        tokenProgramA,
        tokenProgramB,
        tokenVaultA,
        tokenVaultB,
        whirlpool: whirlpoolPda.publicKey,
        tickArrayLower,
        tickArrayUpper,
      };

      // deposit
      const depositQuote = increaseLiquidityQuoteByLiquidityWithParams({
        liquidity: new anchor.BN(10_000_000),
        slippageTolerance: Percentage.fromFraction(0, 1000),
        tickLowerIndex,
        tickUpperIndex,
        sqrtPrice: pool.getData().sqrtPrice,
        tickCurrentIndex: pool.getData().tickCurrentIndex,
        tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
      });
      await toTx(
        ctx,
        isToken2022
          ? // test V2
            WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
              liquidityAmount: depositQuote.liquidityAmount,
              tokenMaxA: depositQuote.tokenMaxA,
              tokenMaxB: depositQuote.tokenMaxB,
              ...baseParams,
            })
          : // test V1
            WhirlpoolIx.increaseLiquidityIx(ctx.program, {
              liquidityAmount: depositQuote.liquidityAmount,
              tokenMaxA: depositQuote.tokenMaxA,
              tokenMaxB: depositQuote.tokenMaxB,
              ...baseParams,
            }),
      ).buildAndExecute();

      // Wait for finalized state transition in LiteSVM
      const positionStep1 = await pollForCondition(
        () => fetcher.getPosition(position, IGNORE_CACHE),
        (pos) => pos!.liquidity.eq(depositQuote.liquidityAmount),
        {
          accountToReload: position,
          connection: ctx.connection,
        },
      );
      assert.ok(positionStep1!.liquidity.eq(depositQuote.liquidityAmount));

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
          tokenOwnerAccountA,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB,
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
          tokenOwnerAccountA,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tickArray0: tickArrayPda.publicKey,
          tickArray1: tickArrayPda.publicKey,
          tickArray2: tickArrayPda.publicKey,
          oracle: oraclePda.publicKey,
        }),
      ).buildAndExecute();

      // accrue rewards
      warpClock(2000);

      const positionStep2 = await fetcher.getPosition(position, IGNORE_CACHE);
      assert.ok(positionStep2!.feeOwedA.isZero());
      assert.ok(positionStep2!.feeOwedB.isZero());
      assert.ok(positionStep2!.rewardInfos[0].amountOwed.isZero());

      // update fees and rewards
      await toTx(
        ctx,
        WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          position,
          tickArrayLower,
          tickArrayUpper,
        }),
      ).buildAndExecute();

      // Wait for finalized state transition in LiteSVM
      const positionStep3 = await pollForCondition(
        () => fetcher.getPosition(position, IGNORE_CACHE),
        (pos) =>
          pos!.feeOwedA.gtn(0) &&
          pos!.feeOwedB.gtn(0) &&
          pos!.rewardInfos[0].amountOwed.gtn(0),
        {
          accountToReload: position,
          connection: ctx.connection,
        },
      );
      assert.ok(!positionStep3!.feeOwedA.isZero());
      assert.ok(!positionStep3!.feeOwedB.isZero());
      assert.ok(!positionStep3!.rewardInfos[0].amountOwed.isZero());

      // withdraw
      await toTx(
        ctx,
        isToken2022
          ? // test V2
            WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
              liquidityAmount: depositQuote.liquidityAmount,
              tokenMinA: ZERO_BN,
              tokenMinB: ZERO_BN,
              ...baseParams,
            })
          : // test V1
            WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
              liquidityAmount: depositQuote.liquidityAmount,
              tokenMinA: ZERO_BN,
              tokenMinB: ZERO_BN,
              ...baseParams,
            }),
      ).buildAndExecute();

      // Wait for finalized state transition in LiteSVM
      const positionStep4 = await pollForCondition(
        () => fetcher.getPosition(position, IGNORE_CACHE),
        (pos) => pos!.liquidity.isZero(),
        {
          accountToReload: position,
          connection: ctx.connection,
        },
      );
      assert.ok(positionStep4!.liquidity.isZero());

      // collect fees
      const feeAccountA = await createTokenAccountV2(
        provider,
        { isToken2022 },
        tokenMintA,
        provider.wallet.publicKey,
      );
      const feeAccountB = await createTokenAccountV2(
        provider,
        { isToken2022 },
        tokenMintB,
        provider.wallet.publicKey,
      );
      await toTx(
        ctx,
        isToken2022
          ? // test V2
            WhirlpoolIx.collectFeesV2Ix(ctx.program, {
              ...baseParams,
              tokenOwnerAccountA: feeAccountA,
              tokenOwnerAccountB: feeAccountB,
            })
          : // test V1
            WhirlpoolIx.collectFeesIx(ctx.program, {
              ...baseParams,
              tokenOwnerAccountA: feeAccountA,
              tokenOwnerAccountB: feeAccountB,
            }),
      ).buildAndExecute();

      // Wait for finalized state transition in LiteSVM
      const positionStep5 = await pollForCondition(
        () => fetcher.getPosition(position, IGNORE_CACHE),
        (pos) => pos!.feeOwedA.isZero() && pos!.feeOwedB.isZero(),
        {
          accountToReload: position,
          connection: ctx.connection,
        },
      );
      assert.ok(positionStep5!.feeOwedA.isZero());
      assert.ok(positionStep5!.feeOwedB.isZero());

      // collect reward
      const rewardAccount = await createTokenAccountV2(
        provider,
        { isToken2022: false },
        pool.getData().rewardInfos[0].mint,
        provider.wallet.publicKey,
      );
      await toTx(
        ctx,
        isToken2022
          ? // test V2
            WhirlpoolIx.collectRewardV2Ix(ctx.program, {
              ...baseParams,
              rewardIndex: 0,
              rewardMint: pool.getData().rewardInfos[0].mint,
              rewardOwnerAccount: rewardAccount,
              rewardVault: pool.getData().rewardInfos[0].vault,
              rewardTokenProgram: TOKEN_PROGRAM_ID,
            })
          : // test V1
            WhirlpoolIx.collectRewardIx(ctx.program, {
              ...baseParams,
              rewardIndex: 0,
              rewardOwnerAccount: rewardAccount,
              rewardVault: pool.getData().rewardInfos[0].vault,
            }),
      ).buildAndExecute();

      // Wait for finalized state transition in LiteSVM
      const positionStep6 = await pollForCondition(
        () => fetcher.getPosition(position, IGNORE_CACHE),
        (pos) => pos!.rewardInfos[0].amountOwed.isZero(),
        {
          accountToReload: position,
          connection: ctx.connection,
        },
      );
      assert.ok(positionStep6!.rewardInfos[0].amountOwed.isZero());

      // close position
      await toTx(
        ctx,
        WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
          positionAuthority: ctx.wallet.publicKey,
          receiver: ctx.wallet.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMint,
          positionTokenAccount: params.positionTokenAccount,
        }),
      ).buildAndExecute();

      checkClosed(params.positionPda.publicKey);
    });
  });

  it("successfully opens and closes a position in one transaction", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const tickLowerIndex = 0;
    const tickUpperIndex = 128;

    const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
    const receiver = Keypair.generate();

    // open
    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        provider.wallet.publicKey,
      );

    builder
      .addInstruction(
        WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
      )
      .addSigner(mint);

    // close
    builder.addInstruction(
      WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
        positionAuthority: ctx.wallet.publicKey,
        receiver: receiver.publicKey,
        position: params.positionPda.publicKey,
        positionMint: params.positionMint,
        positionTokenAccount: params.positionTokenAccount,
      }),
    );

    await builder.buildAndExecute();

    checkClosed(params.positionPda.publicKey);
    checkClosed(params.positionMint);
    checkClosed(params.positionTokenAccount);

    // receiver received the rent (= transaction have been executed)
    const received = await getRent(receiver.publicKey);
    assert.ok(received > 0);
  });

  it("successfully opens and closes a position repeatedly with same Mint keypair (one transaction)", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const tickLowerIndex = 0;
    const tickUpperIndex = 128;

    const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
    const receiver = Keypair.generate();

    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        provider.wallet.publicKey,
      );

    const numRepeat = 3;
    for (let i = 0; i < numRepeat; i++) {
      // open
      builder
        .addInstruction(
          WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
        )
        .addSigner(mint);

      // close
      builder.addInstruction(
        WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
          positionAuthority: ctx.wallet.publicKey,
          receiver: receiver.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMint,
          positionTokenAccount: params.positionTokenAccount,
        }),
      );
    }

    await builder.buildAndExecute();

    checkClosed(params.positionPda.publicKey);
    checkClosed(params.positionMint);
    checkClosed(params.positionTokenAccount);

    // receiver received the rent (= transaction have been executed)
    const received = await getRent(receiver.publicKey);
    assert.ok(received > 0);
  });

  it("successfully opens and closes a position repeatedly with same Mint keypair (different transactions)", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const tickLowerIndex = 0;
    const tickUpperIndex = 128;

    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        provider.wallet.publicKey,
      );

    const numRepeat = 3;
    for (let i = 0; i < numRepeat; i++) {
      const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
      const receiver = Keypair.generate();

      // open
      builder
        .addInstruction(
          WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
        )
        .addSigner(mint);

      // close
      builder.addInstruction(
        WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
          positionAuthority: ctx.wallet.publicKey,
          receiver: receiver.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMint,
          positionTokenAccount: params.positionTokenAccount,
        }),
      );

      await builder.buildAndExecute(undefined, { skipPreflight: true });

      checkClosed(params.positionPda.publicKey);
      checkClosed(params.positionMint);
      checkClosed(params.positionTokenAccount);

      // receiver received the rent (= transaction have been executed)
      const received = await getRent(receiver.publicKey);
      assert.ok(received > 0);
    }
  });
});
