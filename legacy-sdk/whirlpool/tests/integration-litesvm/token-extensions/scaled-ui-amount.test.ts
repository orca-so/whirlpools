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
  getProviderWalletKeypair,
  getTokenBalance,
  TEST_TOKEN_2022_PROGRAM_ID,
  TickSpacing,
} from "../../utils";
import { startLiteSVM, createLiteSVMProvider } from "../../utils/litesvm";
import {
  fundPositionsV2,
  initTestPoolWithTokensV2,
} from "../../utils/v2/init-utils-v2";
import type { PublicKey } from "@solana/web3.js";
import { initTickArrayRange } from "../../utils/init-utils";
import { TokenExtensionUtil } from "../../../src/utils/public/token-extension-util";
import { amountToUiAmount } from "@solana/spl-token";

describe("TokenExtension/ScaledUiAmount (litesvm)", () => {
  let provider: anchor.AnchorProvider;

  let program: anchor.Program;

  let ctx: WhirlpoolContext;

  let fetcher: any;


  beforeAll(async () => {

    await startLiteSVM();

    provider = await createLiteSVMProvider();

    const programId = new anchor.web3.PublicKey(

      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"

    );

    const idl = require("../../../src/artifacts/whirlpool.json");

    program = new anchor.Program(idl, programId, provider);
  // program initialized in beforeAll
  ctx = WhirlpoolContext.fromWorkspace(provider, program);
  fetcher = ctx.fetcher;

  });

  const providerWalletKeypair = getProviderWalletKeypair(provider);

  async function rawAmountToUIAmount(
    mint: PublicKey,
    rawAmount: BN,
  ): Promise<string> {
    const result = await amountToUiAmount(
      ctx.connection,
      providerWalletKeypair,
      mint,
      rawAmount.toNumber(),
      TEST_TOKEN_2022_PROGRAM_ID,
    );
    if (typeof result === "string") {
      return result;
    }
    throw new Error("Failed to convert raw amount to UI amount");
  }

  // Since ScaledUiAmount is no different from normal mint as far as handling raw amounts (u64 amounts),
  // swap_v2 is executed to check the owner to vault and vault to owner logic.

  // |----------|-----*S*T*|****------| (*: liquidity, S: start, T: end)
  it("swap_v2 (covers both owner to vault and vault to owner transfer)", async () => {
    const multiplierA = 2;
    const multiplierB = 5;

    const { whirlpoolPda, poolInitInfo, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokensV2(
        ctx,
        {
          isToken2022: true,
          hasScaledUiAmountExtension: true,
          scaledUiAmountMultiplier: multiplierA,
        },
        {
          isToken2022: true,
          hasScaledUiAmountExtension: true,
          scaledUiAmountMultiplier: multiplierB,
        },
        TickSpacing.Standard,
      );

    // verify multiplier is set correctly

    const initialRawBalanceA = new BN(
      await getTokenBalance(provider, tokenAccountA),
    );
    const initialRawBalanceB = new BN(
      await getTokenBalance(provider, tokenAccountB),
    );
    const initialUIBalanceA = await rawAmountToUIAmount(
      poolInitInfo.tokenMintA,
      initialRawBalanceA,
    );
    const initialUIBalanceB = await rawAmountToUIAmount(
      poolInitInfo.tokenMintB,
      initialRawBalanceB,
    );

    assert.ok(
      initialRawBalanceA
        .muln(multiplierA)
        .eq(new BN(Number.parseInt(initialUIBalanceA))),
    );
    assert.ok(
      initialRawBalanceB
        .muln(multiplierB)
        .eq(new BN(Number.parseInt(initialUIBalanceB))),
    );

    // now we can assure that ScaledUiAmount works as expected on both tokens

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

    const balanceA0 = new BN(await getTokenBalance(provider, tokenAccountA));
    const balanceB0 = new BN(await getTokenBalance(provider, tokenAccountB));
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
    const balanceA1 = new BN(await getTokenBalance(provider, tokenAccountA));
    const balanceB1 = new BN(await getTokenBalance(provider, tokenAccountB));

    const diffA = balanceA1.sub(balanceA0);
    const diffB = balanceB1.sub(balanceB0);
    assert.ok(diffA.eq(quoteBToA.estimatedAmountOut));
    assert.ok(diffB.eq(quoteBToA.estimatedAmountIn.neg()));
  });
});
