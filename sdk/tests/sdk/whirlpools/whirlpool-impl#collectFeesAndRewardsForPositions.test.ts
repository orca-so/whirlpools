import * as anchor from "@coral-xyz/anchor";
import { deriveATA, MathUtil, SendTxRequest, TransactionBuilder, TransactionProcessor, ZERO } from "@orca-so/common-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, Token, TOKEN_PROGRAM_ID, u64 } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  collectFeesQuote,
  collectRewardsQuote,
  NUM_REWARDS,
  PDAUtil,
  PoolUtil,
  toTx,
  Whirlpool,
  WhirlpoolClient,
  WhirlpoolContext,
  WhirlpoolIx
} from "../../../src";
import { TickSpacing, ZERO_BN } from "../../utils";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import { FundedPositionInfo } from "../../utils/init-utils";

interface SharedTestContext {
  provider: anchor.AnchorProvider;
  program: Whirlpool;
  whirlpoolCtx: WhirlpoolContext;
  whirlpoolClient: WhirlpoolClient;
}

describe("WhirlpoolImpl#collectFeesAndRewardsForPositions()", () => {
  let testCtx: SharedTestContext;
  const tickLowerIndex = 29440;
  const tickUpperIndex = 33536;
  const tickSpacing = TickSpacing.Standard;
  const vaultStartBalance = 1_000_000;
  const liquidityAmount = new u64(10_000_000);
  const sleep = (second: number) => new Promise(resolve => setTimeout(resolve, second * 1000))

  before(() => {
    const provider = anchor.AnchorProvider.local(undefined, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });

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
      positions,
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();

    const { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair } = poolInitInfo;

    const tickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpoolPda.publicKey, 22528);
    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);

    // Accrue fees in token A
    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new u64(200_000),
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
      })
    ).buildAndExecute();

    // Accrue fees in token B
    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
        amount: new u64(200_000),
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
      })
    ).buildAndExecute();

    // all position should get some fees
    for (const positionInfo of positions) {
      const position = await testCtx.whirlpoolClient.getPosition(positionInfo.publicKey);

      const poolData = await pool.refreshData();
      const positionData = await position.refreshData();
      const tickLowerData = position.getLowerTickData();
      const tickUpperData = position.getLowerTickData();

      const quote = collectFeesQuote({
        whirlpool: poolData,
        position: positionData,
        tickLower: tickLowerData,
        tickUpper: tickUpperData,
      });

      assert.ok(quote.feeOwedA.gtn(0) || quote.feeOwedB.gtn(0));
    }
  }

  async function stopRewardsEmission(fixture: WhirlpoolTestFixture) {
    const ctx = testCtx.whirlpoolCtx;
    const { poolInitInfo, configKeypairs } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;

    const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);

    for (let i = 0; i < NUM_REWARDS; i++) {
      await toTx(
        ctx,
        WhirlpoolIx.setRewardEmissionsIx(ctx.program, {
          whirlpool: pool.getAddress(),
          rewardVaultKey: pool.getData().rewardInfos[i].vault,
          rewardAuthority: configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          rewardIndex: i,
          emissionsPerSecondX64: ZERO,
        })
      ).addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair).buildAndExecute();
    }
  }

  async function burnAndCloseATAs(fixture: WhirlpoolTestFixture) {
    const ctx = testCtx.whirlpoolCtx;
    const { poolInitInfo, configKeypairs } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;

    const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);

    const mintA = pool.getTokenAInfo().mint;
    const mintB = pool.getTokenBInfo().mint;
    const ataA = await deriveATA(ctx.wallet.publicKey, mintA);
    const ataB = await deriveATA(ctx.wallet.publicKey, mintB);
    await burnAndCloseATA(ctx, ataA);
    await burnAndCloseATA(ctx, ataB);

    for (let i = 0; i < NUM_REWARDS; i++) {
      if (PoolUtil.isRewardInitialized(pool.getRewardInfos()[i])) {
        const mintReward = pool.getRewardInfos()[i].mint;
        const ataReward = await deriveATA(ctx.wallet.publicKey, mintReward);
        await burnAndCloseATA(ctx, ataReward);
      }
    }
  }

  async function burnAndCloseATA(ctx: WhirlpoolContext, ata: PublicKey) {
    const account = await ctx.fetcher.getTokenInfo(ata, true);
    if (account === null) return;

    const burnIx = Token.createBurnInstruction(
      TOKEN_PROGRAM_ID,
      account.mint,
      ata,
      ctx.wallet.publicKey,
      [],
      account.amount
    );

    const closeIx = Token.createCloseAccountInstruction(
      TOKEN_PROGRAM_ID,
      ata,
      ctx.wallet.publicKey,
      ctx.wallet.publicKey,
      []
    );

    const tx = new TransactionBuilder(ctx.connection, ctx.wallet);
    tx.addInstruction({
      instructions: [burnIx, closeIx],
      cleanupInstructions: [],
      signers: [],
    });
    await tx.buildAndExecute();
  }

  async function createATAs(fixture: WhirlpoolTestFixture) {
    const ctx = testCtx.whirlpoolCtx;
    const { poolInitInfo, configKeypairs } = fixture.getInfos();
    const { whirlpoolPda } = poolInitInfo;

    const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);

    const mintA = pool.getTokenAInfo().mint;
    const mintB = pool.getTokenBInfo().mint;
    const ataA = await deriveATA(ctx.wallet.publicKey, mintA);
    const ataB = await deriveATA(ctx.wallet.publicKey, mintB);
    await createATA(ctx, ataA, mintA);
    await createATA(ctx, ataB, mintB);

    for (let i = 0; i < NUM_REWARDS; i++) {
      if (PoolUtil.isRewardInitialized(pool.getRewardInfos()[i])) {
        const mintReward = pool.getRewardInfos()[i].mint;
        const ataReward = await deriveATA(ctx.wallet.publicKey, mintReward);
        await createATA(ctx, ataReward, mintReward);
      }
    }
  }

  async function createATA(ctx: WhirlpoolContext, ata: PublicKey, mint: PublicKey) {
    if (mint.equals(NATIVE_MINT)) return;

    const account = await ctx.fetcher.getTokenInfo(ata, true);
    if (account !== null) return;

    const createATAIx = Token.createAssociatedTokenAccountInstruction(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mint,
      ata,
      ctx.wallet.publicKey,
      ctx.wallet.publicKey
    );

    const tx = new TransactionBuilder(ctx.connection, ctx.wallet);
    tx.addInstruction({
      instructions: [createATAIx],
      cleanupInstructions: [],
      signers: [],
    });
    await tx.buildAndExecute();
  }

  async function baseTestSenario(tokenAIsNative: boolean, ataExists: boolean) {
    const fixtures: WhirlpoolTestFixture[] = [];
    const positions: FundedPositionInfo[] = [];
    const numOfPool = 3;

    for (let i = 0; i < numOfPool; i++) {
      const fixture = await new WhirlpoolTestFixture(testCtx.whirlpoolCtx).init({
        tokenAIsNative,
        tickSpacing,
        positions: [
          // 3 Positions / pool
          { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position
          { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position
          { tickLowerIndex, tickUpperIndex, liquidityAmount }, // In range position
        ],
        rewards: [
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new u64(vaultStartBalance),
          },
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new u64(vaultStartBalance),
          },
          {
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new u64(vaultStartBalance),
          },
        ],
      });

      fixtures.push(fixture);
      positions.push(...fixture.getInfos().positions);
    }

    await sleep(2); // accrueRewards
    for (const fixture of fixtures) {
      await accrueFees(fixture);
      await (ataExists ? createATAs : burnAndCloseATAs)(fixture);
      await stopRewardsEmission(fixture);
    }

    // check all positions have fees and rewards
    for (const positionInfo of positions) {
      const position = await testCtx.whirlpoolClient.getPosition(positionInfo.publicKey);

      const poolData = await testCtx.whirlpoolCtx.fetcher.getPool(position.getData().whirlpool, true);
      const positionData = await position.refreshData();
      const tickLowerData = position.getLowerTickData();
      const tickUpperData = position.getLowerTickData();

      const feeQuote = collectFeesQuote({
        whirlpool: poolData!,
        position: positionData,
        tickLower: tickLowerData,
        tickUpper: tickUpperData,
      });

      const rewardQuote = collectRewardsQuote({
        whirlpool: poolData!,
        position: positionData,
        tickLower: tickLowerData,
        tickUpper: tickUpperData,
        timeStampInSeconds: poolData!.rewardLastUpdatedTimestamp,
      });

      assert.ok(feeQuote.feeOwedA.gt(ZERO));
      assert.ok(feeQuote.feeOwedB.gt(ZERO));
      assert.ok(rewardQuote[0]?.gt(ZERO));
      assert.ok(rewardQuote[1]?.gt(ZERO));
      assert.ok(rewardQuote[2]?.gt(ZERO));
    }

    const txs = await testCtx.whirlpoolClient.collectFeesAndRewardsForPositions(
      positions.map((p) => p.publicKey),
      true,
    );
    assert.ok(txs.length >= 2);

    const requests: SendTxRequest[] = [];
    for (const tx of txs) {
      requests.push(await tx.build());
    }

    const parallel = true;
    const processor = new TransactionProcessor(testCtx.whirlpoolCtx.connection, testCtx.whirlpoolCtx.wallet);
    const { execute } = await processor.signAndConstructTransactions(requests, parallel);

    const txResults = await execute();
    for (const result of txResults) {
      assert.ok(result.status === "fulfilled");
    }

    // check all positions have no fees and rewards
    for (const positionInfo of positions) {
      const position = await testCtx.whirlpoolClient.getPosition(positionInfo.publicKey);

      const poolData = await testCtx.whirlpoolCtx.fetcher.getPool(position.getData().whirlpool, true);
      const positionData = await position.refreshData();
      const tickLowerData = position.getLowerTickData();
      const tickUpperData = position.getLowerTickData();

      const feeQuote = collectFeesQuote({
        whirlpool: poolData!,
        position: positionData,
        tickLower: tickLowerData,
        tickUpper: tickUpperData,
      });

      const rewardQuote = collectRewardsQuote({
        whirlpool: poolData!,
        position: positionData,
        tickLower: tickLowerData,
        tickUpper: tickUpperData,
        timeStampInSeconds: poolData!.rewardLastUpdatedTimestamp,
      });

      assert.ok(feeQuote.feeOwedA.eq(ZERO));
      assert.ok(feeQuote.feeOwedB.eq(ZERO));
      assert.ok(rewardQuote[0]?.eq(ZERO));
      assert.ok(rewardQuote[1]?.eq(ZERO));
      assert.ok(rewardQuote[2]?.eq(ZERO));
    }
  }

  context("when the whirlpool is SPL-only", () => {
    it("should collect fees and rewards, create all ATAs", async () => {
      const tokenAIsNative = false;
      const ataExists = false;
      await baseTestSenario(tokenAIsNative, ataExists);
    });

    it("should collect fees and rewards, all ATAs exists", async () => {
      const tokenAIsNative = false;
      const ataExists = true;
      await baseTestSenario(tokenAIsNative, ataExists);
    });
  });

  context("when the whirlpool is SOL-SPL", () => {
    it("should collect fees and rewards, create all ATAs", async () => {
      const tokenAIsNative = true;
      const ataExists = false;
      await baseTestSenario(tokenAIsNative, ataExists);
    });

    it("should collect fees and rewards, all ATAs exists", async () => {
      const tokenAIsNative = true;
      const ataExists = true;
      await baseTestSenario(tokenAIsNative, ataExists);
    });
  });
});
