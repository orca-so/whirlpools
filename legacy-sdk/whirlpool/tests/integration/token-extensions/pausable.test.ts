import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Percentage } from "@orca-so/common-sdk";
import * as assert from "assert";
import type { WhirlpoolData } from "../../../src";
import {
  NO_ORACLE_DATA,
  PDAUtil,
  swapQuoteWithParams,
  SwapUtils,
  toTx,
  WhirlpoolContext,
  WhirlpoolIx,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import {
  getTokenBalance,
  TEST_TOKEN_2022_PROGRAM_ID,
  TickSpacing,
} from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import {
  fundPositionsV2,
  initTestPoolWithTokensV2,
} from "../../utils/v2/init-utils-v2";
import type { PublicKey } from "@solana/web3.js";
import { initTickArrayRange } from "../../utils/init-utils";
import { TokenExtensionUtil } from "../../../src/utils/public/token-extension-util";
import {
  createPauseInstruction,
  createResumeInstruction,
  getMint,
  getPausableConfig,
} from "@solana/spl-token";

describe("TokenExtension/Pausable", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  // Since Pausable mint is no different from normal mint as far as paused is disabled,
  // swap_v2 is executed to check the owner to vault and vault to owner logic.

  // |----------|-----*S*T*|****------| (*: liquidity, S: start, T: end)
  it("swap_v2 (covers both owner to vault and vault to owner transfer)", async () => {
    const { whirlpoolPda, poolInitInfo, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokensV2(
        ctx,
        {
          isToken2022: true,
          hasPausableExtension: true,
        },
        {
          isToken2022: true,
          hasPausableExtension: true,
        },
        TickSpacing.Standard,
      );

    // verify Pausable extension is set correctly

    const mintA = await getMint(
      provider.connection,
      poolInitInfo.tokenMintA,
      undefined,
      TEST_TOKEN_2022_PROGRAM_ID,
    );
    const pausableConfigA = getPausableConfig(mintA);
    assert.ok(pausableConfigA && !pausableConfigA.paused);
    const mintB = await getMint(
      provider.connection,
      poolInitInfo.tokenMintB,
      undefined,
      TEST_TOKEN_2022_PROGRAM_ID,
    );
    const pausableConfigB = getPausableConfig(mintB);
    assert.ok(pausableConfigB && !pausableConfigB.paused);

    // now we can assure that Pausable extension is set correctly

    const aToB = false;
    await initTickArrayRange(
      ctx,
      whirlpoolPda.publicKey,
      22528, // to 33792
      3,
      TickSpacing.Standard,
      aToB,
    );

    await fundPositionsV2(ctx, poolInitInfo, tokenAccountA, tokenAccountB, [
      {
        liquidityAmount: new anchor.BN(10_000_000),
        tickLowerIndex: 29440,
        tickUpperIndex: 33536,
      },
    ]);

    const oraclePubkey = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    ).publicKey;

    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolData = (await fetcher.getPool(
      whirlpoolKey,
      IGNORE_CACHE,
    )) as WhirlpoolData;

    // tick: 32190 -> 32269
    const quoteBToA = swapQuoteWithParams(
      {
        amountSpecifiedIsInput: true,
        aToB: false,
        tokenAmount: new BN(200000),
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
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
          fetcher,
          whirlpoolData,
          IGNORE_CACHE,
        ),
        oracleData: NO_ORACLE_DATA,
      },
      Percentage.fromFraction(0, 100),
    );

    assert.ok(quoteBToA.estimatedAmountIn.gtn(0));
    assert.ok(quoteBToA.estimatedAmountOut.gtn(0));

    const ix = WhirlpoolIx.swapV2Ix(ctx.program, {
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
    });

    // pause the mintA
    await pause(ctx, poolInitInfo.tokenMintA);
    await assert.rejects(
      toTx(ctx, ix).buildAndExecute(),
      /Transferring, minting, and burning is paused on this mint/,
    );
    await resume(ctx, poolInitInfo.tokenMintA);

    // resume the mintB
    await pause(ctx, poolInitInfo.tokenMintB);
    await assert.rejects(
      toTx(ctx, ix).buildAndExecute(),
      /Transferring, minting, and burning is paused on this mint/,
    );
    await resume(ctx, poolInitInfo.tokenMintB);

    const balanceA0 = new BN(await getTokenBalance(provider, tokenAccountA));
    const balanceB0 = new BN(await getTokenBalance(provider, tokenAccountB));
    await toTx(ctx, ix).buildAndExecute();
    const balanceA1 = new BN(await getTokenBalance(provider, tokenAccountA));
    const balanceB1 = new BN(await getTokenBalance(provider, tokenAccountB));

    const diffA = balanceA1.sub(balanceA0);
    const diffB = balanceB1.sub(balanceB0);
    assert.ok(diffA.eq(quoteBToA.estimatedAmountOut));
    assert.ok(diffB.eq(quoteBToA.estimatedAmountIn.neg()));
  });
});

async function pause(ctx: WhirlpoolContext, mint: PublicKey) {
  const pauseIx = createPauseInstruction(
    mint,
    ctx.wallet.publicKey,
    undefined,
    TEST_TOKEN_2022_PROGRAM_ID,
  );
  await toTx(ctx, {
    instructions: [pauseIx],
    cleanupInstructions: [],
    signers: [],
  }).buildAndExecute();

  const mintData = await getMint(
    ctx.connection,
    mint,
    undefined,
    TEST_TOKEN_2022_PROGRAM_ID,
  );
  const pausableConfig = getPausableConfig(mintData);
  assert.ok(pausableConfig && pausableConfig.paused);
}

async function resume(ctx: WhirlpoolContext, mint: PublicKey) {
  const resumeIx = createResumeInstruction(
    mint,
    ctx.wallet.publicKey,
    undefined,
    TEST_TOKEN_2022_PROGRAM_ID,
  );
  await toTx(ctx, {
    instructions: [resumeIx],
    cleanupInstructions: [],
    signers: [],
  }).buildAndExecute();

  const mintData = await getMint(
    ctx.connection,
    mint,
    undefined,
    TEST_TOKEN_2022_PROGRAM_ID,
  );
  const pausableConfig = getPausableConfig(mintData);
  assert.ok(pausableConfig && !pausableConfig.paused);
}
