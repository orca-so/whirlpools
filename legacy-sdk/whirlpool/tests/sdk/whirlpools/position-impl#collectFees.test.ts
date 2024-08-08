import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { MathUtil } from "@orca-so/common-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as assert from "assert";
import Decimal from "decimal.js";
import type { Whirlpool, WhirlpoolClient } from "../../../src";
import {
  PDAUtil,
  WhirlpoolContext,
  WhirlpoolIx,
  buildWhirlpoolClient,
  collectFeesQuote,
  toTx,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { TEST_TOKEN_2022_PROGRAM_ID, TickSpacing, ZERO_BN } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import { TokenExtensionUtil } from "../../../src/utils/public/token-extension-util";
import { WhirlpoolTestFixtureV2 } from "../../utils/v2/fixture-v2";

interface SharedTestContext {
  provider: anchor.AnchorProvider;
  program: Whirlpool;
  whirlpoolCtx: WhirlpoolContext;
  whirlpoolClient: WhirlpoolClient;
}

describe("PositionImpl#collectFees()", () => {
  let testCtx: SharedTestContext;
  const tickLowerIndex = 29440;
  const tickUpperIndex = 33536;
  const tickSpacing = TickSpacing.Standard;
  const liquidityAmount = new BN(10_000_000);

  before(() => {
    const provider = anchor.AnchorProvider.local(
      undefined,
      defaultConfirmOptions,
    );

    anchor.setProvider(provider);
    const program = anchor.workspace.Whirlpool;
    const whirlpoolCtx = WhirlpoolContext.fromWorkspace(provider, program);
    const whirlpoolClient = buildWhirlpoolClient(whirlpoolCtx);

    testCtx = {
      provider,
      program,
      whirlpoolCtx,
      whirlpoolClient,
    };
  });

  async function accrueFees(fixture: WhirlpoolTestFixture) {
    const ctx = testCtx.whirlpoolCtx;
    const {
      poolInitInfo,
      positions: [positionInfo],
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();

    const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } =
      poolInitInfo;

    const tickArrayPda = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpoolPda.publicKey,
      22528,
    );
    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);
    const position = await testCtx.whirlpoolClient.getPosition(
      positionInfo.publicKey,
    );

    // Accrue fees in token A
    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new BN(200_000),
        otherAmountThreshold: ZERO_BN,
        sqrtPriceLimit: MathUtil.toX64(new Decimal(4)),
        amountSpecifiedIsInput: true,
        aToB: true,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
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
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new BN(200_000),
        otherAmountThreshold: ZERO_BN,
        sqrtPriceLimit: MathUtil.toX64(new Decimal(5)),
        amountSpecifiedIsInput: true,
        aToB: false,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: ctx.wallet.publicKey,
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

    const poolData = await pool.refreshData();
    const positionData = await position.refreshData();
    const tickLowerData = position.getLowerTickData();
    const tickUpperData = position.getLowerTickData();

    const quote = collectFeesQuote({
      whirlpool: poolData,
      position: positionData,
      tickLower: tickLowerData,
      tickUpper: tickUpperData,
      tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
        ctx.fetcher,
        poolData,
        IGNORE_CACHE,
      ),
    });

    assert.ok(quote.feeOwedA.gtn(0) || quote.feeOwedB.gtn(0));
  }

  context("when the whirlpool is SPL-only", () => {
    it("should collect fees", async () => {
      const fixture = await new WhirlpoolTestFixture(testCtx.whirlpoolCtx).init(
        {
          tickSpacing,
          positions: [
            { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position
          ],
        },
      );

      await accrueFees(fixture);

      const { positions, poolInitInfo } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
      );
      const position = await testCtx.whirlpoolClient.getPosition(
        positions[0].publicKey,
      );

      const positionDataBefore = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        IGNORE_CACHE,
      );

      const otherWallet = anchor.web3.Keypair.generate();

      const poolData = await pool.refreshData();
      const positionData = await position.refreshData();
      const tickLowerData = position.getLowerTickData();
      const tickUpperData = position.getLowerTickData();

      const quote = collectFeesQuote({
        whirlpool: poolData,
        position: positionData,
        tickLower: tickLowerData,
        tickUpper: tickUpperData,
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
          testCtx.whirlpoolCtx.fetcher,
          poolData,
          IGNORE_CACHE,
        ),
      });

      assert.notEqual(positionDataBefore, null);

      const tx = await position.collectFees(
        true,
        undefined,
        otherWallet.publicKey,
        testCtx.provider.wallet.publicKey,
        testCtx.provider.wallet.publicKey,
        IGNORE_CACHE,
      );

      await tx.buildAndExecute();

      const positionDataAfter = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        IGNORE_CACHE,
      );

      assert.notEqual(positionDataAfter, null);

      const accountAPubkey = getAssociatedTokenAddressSync(
        poolInitInfo.tokenMintA,
        otherWallet.publicKey,
      );
      const accountA = await testCtx.whirlpoolCtx.fetcher.getTokenInfo(
        accountAPubkey,
        IGNORE_CACHE,
      );
      assert.ok(
        accountA && new BN(accountA.amount.toString()).eq(quote.feeOwedA),
      );

      const accountBPubkey = getAssociatedTokenAddressSync(
        poolInitInfo.tokenMintB,
        otherWallet.publicKey,
      );
      const accountB = await testCtx.whirlpoolCtx.fetcher.getTokenInfo(
        accountBPubkey,
        IGNORE_CACHE,
      );
      assert.ok(
        accountB && new BN(accountB.amount.toString()).eq(quote.feeOwedB),
      );
    });
  });

  context("when the whirlpool is SOL-SPL", () => {
    it("should collect fees", async () => {
      const fixture = await new WhirlpoolTestFixture(testCtx.whirlpoolCtx).init(
        {
          tickSpacing,
          positions: [
            { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position
          ],
          tokenAIsNative: true,
        },
      );

      await accrueFees(fixture);

      const { positions, poolInitInfo } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
      );
      const position = await testCtx.whirlpoolClient.getPosition(
        positions[0].publicKey,
      );

      const positionDataBefore = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        IGNORE_CACHE,
      );

      const otherWallet = anchor.web3.Keypair.generate();

      const poolData = await pool.refreshData();
      const positionData = await position.refreshData();
      const tickLowerData = position.getLowerTickData();
      const tickUpperData = position.getLowerTickData();

      const quote = collectFeesQuote({
        whirlpool: poolData,
        position: positionData,
        tickLower: tickLowerData,
        tickUpper: tickUpperData,
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
          testCtx.whirlpoolCtx.fetcher,
          poolData,
          IGNORE_CACHE,
        ),
      });

      const solBalanceBefore = await testCtx.provider.connection.getBalance(
        otherWallet.publicKey,
      );
      assert.notEqual(positionDataBefore, null);

      const tx = await position.collectFees(
        true,
        undefined,
        otherWallet.publicKey,
        testCtx.provider.wallet.publicKey,
        testCtx.provider.wallet.publicKey,
        IGNORE_CACHE,
      );

      await tx.addSigner(otherWallet).buildAndExecute();

      const positionDataAfter = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        IGNORE_CACHE,
      );

      assert.notEqual(positionDataAfter, null);

      const solBalanceAfter = await testCtx.provider.connection.getBalance(
        otherWallet.publicKey,
      );
      const minAccountExempt =
        await testCtx.whirlpoolCtx.fetcher.getAccountRentExempt();
      assert.equal(
        solBalanceAfter - solBalanceBefore,
        quote.feeOwedA.toNumber() + minAccountExempt,
      );

      const accountBPubkey = getAssociatedTokenAddressSync(
        poolInitInfo.tokenMintB,
        otherWallet.publicKey,
      );
      const accountB = await testCtx.whirlpoolCtx.fetcher.getTokenInfo(
        accountBPubkey,
        IGNORE_CACHE,
      );
      assert.ok(
        accountB && new BN(accountB.amount.toString()).eq(quote.feeOwedB),
      );
    });
  });

  async function accrueFeesV2(fixture: WhirlpoolTestFixtureV2) {
    const ctx = testCtx.whirlpoolCtx;
    const {
      poolInitInfo,
      positions: [positionInfo],
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();

    const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } =
      poolInitInfo;

    const tickArrayPda = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpoolPda.publicKey,
      22528,
    );
    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);
    const position = await testCtx.whirlpoolClient.getPosition(
      positionInfo.publicKey,
    );

    const tokenExtensionCtx =
      await TokenExtensionUtil.buildTokenExtensionContext(
        ctx.fetcher,
        pool.getData(),
        IGNORE_CACHE,
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
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: tokenVaultBKeypair.publicKey,
        tickArray0: tickArrayPda.publicKey,
        tickArray1: tickArrayPda.publicKey,
        tickArray2: tickArrayPda.publicKey,
        oracle: oraclePda.publicKey,
        tokenMintA: tokenExtensionCtx.tokenMintWithProgramA.address,
        tokenMintB: tokenExtensionCtx.tokenMintWithProgramB.address,
        tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
        tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
        ...(await TokenExtensionUtil.getExtraAccountMetasForTransferHookForPool(
          ctx.connection,
          tokenExtensionCtx,
          tokenAccountA,
          tokenVaultAKeypair.publicKey,
          ctx.wallet.publicKey,
          tokenVaultBKeypair.publicKey,
          tokenAccountB,
          whirlpoolPda.publicKey,
        )),
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
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: tokenVaultBKeypair.publicKey,
        tickArray0: tickArrayPda.publicKey,
        tickArray1: tickArrayPda.publicKey,
        tickArray2: tickArrayPda.publicKey,
        oracle: oraclePda.publicKey,
        tokenMintA: tokenExtensionCtx.tokenMintWithProgramA.address,
        tokenMintB: tokenExtensionCtx.tokenMintWithProgramB.address,
        tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
        tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
        ...(await TokenExtensionUtil.getExtraAccountMetasForTransferHookForPool(
          ctx.connection,
          tokenExtensionCtx,
          tokenVaultAKeypair.publicKey,
          tokenAccountA,
          whirlpoolPda.publicKey,
          tokenAccountB,
          tokenVaultBKeypair.publicKey,
          ctx.wallet.publicKey,
        )),
      }),
    ).buildAndExecute();

    const poolData = await pool.refreshData();
    const positionData = await position.refreshData();
    const tickLowerData = position.getLowerTickData();
    const tickUpperData = position.getLowerTickData();

    const quote = collectFeesQuote({
      whirlpool: poolData,
      position: positionData,
      tickLower: tickLowerData,
      tickUpper: tickUpperData,
      tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
        ctx.fetcher,
        poolData,
        IGNORE_CACHE,
      ),
    });

    assert.ok(quote.feeOwedA.gtn(0) || quote.feeOwedB.gtn(0));
  }

  context("when the whirlpool is SPL-only (TokenExtension)", () => {
    it("should collect fees", async () => {
      const fixture = await new WhirlpoolTestFixtureV2(
        testCtx.whirlpoolCtx,
      ).init({
        tokenTraitA: { isToken2022: true, hasTransferHookExtension: true },
        tokenTraitB: { isToken2022: true, hasTransferHookExtension: true },
        tickSpacing,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position
        ],
      });

      await accrueFeesV2(fixture);

      const { positions, poolInitInfo } = fixture.getInfos();

      const pool = await testCtx.whirlpoolClient.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
      );
      const position = await testCtx.whirlpoolClient.getPosition(
        positions[0].publicKey,
      );

      const positionDataBefore = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        IGNORE_CACHE,
      );

      const otherWallet = anchor.web3.Keypair.generate();

      const poolData = await pool.refreshData();
      const positionData = await position.refreshData();
      const tickLowerData = position.getLowerTickData();
      const tickUpperData = position.getLowerTickData();

      const quote = collectFeesQuote({
        whirlpool: poolData,
        position: positionData,
        tickLower: tickLowerData,
        tickUpper: tickUpperData,
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
          testCtx.whirlpoolCtx.fetcher,
          poolData,
          IGNORE_CACHE,
        ),
      });

      assert.notEqual(positionDataBefore, null);

      const tx = await position.collectFees(
        true,
        undefined,
        otherWallet.publicKey,
        testCtx.provider.wallet.publicKey,
        testCtx.provider.wallet.publicKey,
        IGNORE_CACHE,
      );

      await tx.buildAndExecute();

      const positionDataAfter = await testCtx.whirlpoolCtx.fetcher.getPosition(
        position.getAddress(),
        IGNORE_CACHE,
      );

      assert.notEqual(positionDataAfter, null);

      const accountAPubkey = getAssociatedTokenAddressSync(
        poolInitInfo.tokenMintA,
        otherWallet.publicKey,
        undefined,
        TEST_TOKEN_2022_PROGRAM_ID,
      );
      const accountA = await testCtx.whirlpoolCtx.fetcher.getTokenInfo(
        accountAPubkey,
        IGNORE_CACHE,
      );
      assert.ok(
        accountA && new BN(accountA.amount.toString()).eq(quote.feeOwedA),
      );

      const accountBPubkey = getAssociatedTokenAddressSync(
        poolInitInfo.tokenMintB,
        otherWallet.publicKey,
        undefined,
        TEST_TOKEN_2022_PROGRAM_ID,
      );
      const accountB = await testCtx.whirlpoolCtx.fetcher.getTokenInfo(
        accountBPubkey,
        IGNORE_CACHE,
      );
      assert.ok(
        accountB && new BN(accountB.amount.toString()).eq(quote.feeOwedB),
      );
    });
  });
});
