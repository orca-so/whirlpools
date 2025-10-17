import * as anchor from "@coral-xyz/anchor";
import type { PDA } from "@orca-so/common-sdk";
import * as assert from "assert";
import type {
  InitPoolParams,
  PositionData,
  WhirlpoolContext,
} from "../../../src";
import {
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  PDAUtil,
  PoolUtil,
  TickUtil,
  WhirlpoolIx,
  toTx,
} from "../../../src";
import {
  ONE_SOL,
  TickSpacing,
  ZERO_BN,
  systemTransferTx,
  loadPreloadAccount,
} from "../../utils";
import {
  initializeLiteSVMEnvironment,
  pollForCondition,
} from "../../utils/litesvm";
import { TICK_RENT_AMOUNT } from "../../utils/const";
import {
  initializePositionBundle,
  initTestPool,
  openBundledPosition,
  openPosition,
} from "../../utils/init-utils";
import type { PublicKey } from "@solana/web3.js";
import { generateDefaultOpenPositionWithTokenExtensionsParams } from "../../utils/test-builders";
import { useMaxCU } from "../../utils/v2/init-utils-v2";
import preloadWalletSecret from "../../preload_account/reset_position_range/owner_wallet_secret.json";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

describe("reset_position_range", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;

    // Load all preload accounts needed for this test
    loadPreloadAccount("reset_position_range/whirlpool.json");
    loadPreloadAccount("reset_position_range/position.json");
    loadPreloadAccount("reset_position_range/position_mint.json");
    loadPreloadAccount("reset_position_range/position_ata.json");
    loadPreloadAccount("reset_position_range/token_a.json");
    loadPreloadAccount("reset_position_range/token_b.json");
    loadPreloadAccount("reset_position_range/token_a_ata.json");
    loadPreloadAccount("reset_position_range/token_b_ata.json");
    loadPreloadAccount("reset_position_range/vault_a.json");
    loadPreloadAccount("reset_position_range/vault_b.json");
    loadPreloadAccount("reset_position_range/fixed_tick_array_lower.json");
    loadPreloadAccount("reset_position_range/fixed_tick_array_upper.json");
    loadPreloadAccount("reset_position_range/owner_wallet.json");
  });

  const tickLowerIndex = 0;
  const tickUpperIndex = 32768;
  let poolInitInfo: InitPoolParams;
  let whirlpoolPda: PDA;
  let fullRangeOnlyPoolInitInfo: InitPoolParams;
  let fullRangeOnlyWhirlpoolPda: PDA;
  let funderKeypair: anchor.web3.Keypair;

  beforeAll(async () => {
    poolInitInfo = (await initTestPool(ctx, TickSpacing.Standard)).poolInitInfo;
    whirlpoolPda = poolInitInfo.whirlpoolPda;

    fullRangeOnlyPoolInitInfo = (
      await initTestPool(ctx, TickSpacing.FullRangeOnly)
    ).poolInitInfo;
    fullRangeOnlyWhirlpoolPda = fullRangeOnlyPoolInitInfo.whirlpoolPda;
  });

  beforeEach(async () => {
    funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(
      provider,
      funderKeypair.publicKey,
      ONE_SOL,
    ).buildAndExecute();
  });

  async function initializeDefaultPosition(
    whirlpool: PublicKey,
    lowerTick: number = tickLowerIndex,
    upperTick: number = tickUpperIndex,
  ) {
    const positionInitInfo = await openPosition(
      ctx,
      whirlpool,
      lowerTick,
      upperTick,
    );
    const { positionPda, positionMintAddress } = positionInitInfo.params;

    await validatePosition(
      positionPda.publicKey,
      positionMintAddress,
      whirlpool,
      0,
      lowerTick,
      upperTick,
    );

    return positionInitInfo;
  }

  async function validatePosition(
    positionKey: PublicKey,
    positionMintAddress: PublicKey,
    whirlpool: PublicKey = whirlpoolPda.publicKey,
    tickSpacingDiff: number = poolInitInfo.tickSpacing,
    lowerIndex: number = tickLowerIndex,
    upperIndex: number = tickUpperIndex,
  ) {
    const position = (await fetcher.getPosition(positionKey, {
      maxAge: 0,
    })) as PositionData;

    assert.strictEqual(position.tickLowerIndex, lowerIndex + tickSpacingDiff);
    assert.strictEqual(position.tickUpperIndex, upperIndex - tickSpacingDiff);
    assert.ok(position.whirlpool.equals(whirlpool));
    assert.ok(position.positionMint.equals(positionMintAddress));
    assert.ok(position.liquidity.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointA.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointB.eq(ZERO_BN));
    assert.ok(position.feeOwedA.eq(ZERO_BN));
    assert.ok(position.feeOwedB.eq(ZERO_BN));
  }

  it("successfully resets position and verify position address contents", async () => {
    const { positionPda, positionMintAddress, positionTokenAccount } = (
      await initializeDefaultPosition(whirlpoolPda.publicKey)
    ).params;

    await toTx(
      ctx,
      WhirlpoolIx.resetPositionRangeIx(ctx.program, {
        funder: funderKeypair.publicKey,
        positionAuthority: provider.wallet.publicKey,
        whirlpool: whirlpoolPda.publicKey,
        position: positionPda.publicKey,
        positionTokenAccount,
        tickLowerIndex: tickLowerIndex + poolInitInfo.tickSpacing,
        tickUpperIndex: tickUpperIndex - poolInitInfo.tickSpacing,
      }),
    )
      .addSigner(funderKeypair)
      .buildAndExecute();

    await pollForCondition(
      async () => fetcher.getPosition(positionPda.publicKey, { maxAge: 0 }),
      (p: PositionData | null) =>
        Boolean(
          p &&
            p.tickLowerIndex === tickLowerIndex + poolInitInfo.tickSpacing &&
            p.tickUpperIndex === tickUpperIndex - poolInitInfo.tickSpacing,
        ),
      {
        accountToReload: positionPda.publicKey,
        connection: provider.connection,
        maxRetries: 200,
        delayMs: 5,
      },
    );

    await validatePosition(positionPda.publicKey, positionMintAddress);
  });

  it("successfully resets position when funder and position authority are the same", async () => {
    const { positionPda, positionMintAddress, positionTokenAccount } = (
      await initializeDefaultPosition(whirlpoolPda.publicKey)
    ).params;

    await toTx(
      ctx,
      WhirlpoolIx.resetPositionRangeIx(ctx.program, {
        funder: provider.wallet.publicKey,
        positionAuthority: provider.wallet.publicKey,
        whirlpool: whirlpoolPda.publicKey,
        position: positionPda.publicKey,
        positionTokenAccount,
        tickLowerIndex: tickLowerIndex + poolInitInfo.tickSpacing,
        tickUpperIndex: tickUpperIndex - poolInitInfo.tickSpacing,
      }),
    ).buildAndExecute();

    await pollForCondition(
      async () => fetcher.getPosition(positionPda.publicKey, { maxAge: 0 }),
      (p: PositionData | null) =>
        Boolean(
          p &&
            p.tickLowerIndex === tickLowerIndex + poolInitInfo.tickSpacing &&
            p.tickUpperIndex === tickUpperIndex - poolInitInfo.tickSpacing,
        ),
      {
        accountToReload: positionPda.publicKey,
        connection: provider.connection,
        maxRetries: 200,
        delayMs: 5,
      },
    );

    await validatePosition(positionPda.publicKey, positionMintAddress);
  });

  it("successfully resets token extensions position", async () => {
    const withTokenMetadataExtension = true;

    // open position
    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        withTokenMetadataExtension,
        tickLowerIndex,
        tickUpperIndex,
        provider.wallet.publicKey,
      );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
    )
      .addSigner(mint)
      .prependInstruction(useMaxCU())
      .buildAndExecute();

    await toTx(
      ctx,
      WhirlpoolIx.resetPositionRangeIx(ctx.program, {
        funder: funderKeypair.publicKey,
        positionAuthority: provider.wallet.publicKey,
        whirlpool: whirlpoolPda.publicKey,
        position: params.positionPda.publicKey,
        positionTokenAccount: params.positionTokenAccount,
        tickLowerIndex: tickLowerIndex + poolInitInfo.tickSpacing,
        tickUpperIndex: tickUpperIndex - poolInitInfo.tickSpacing,
      }),
    )
      .addSigner(funderKeypair)
      .buildAndExecute();

    await pollForCondition(
      async () =>
        fetcher.getPosition(params.positionPda.publicKey, { maxAge: 0 }),
      (p: PositionData | null) =>
        Boolean(
          p &&
            p.tickLowerIndex === tickLowerIndex + poolInitInfo.tickSpacing &&
            p.tickUpperIndex === tickUpperIndex - poolInitInfo.tickSpacing,
        ),
      {
        accountToReload: params.positionPda.publicKey,
        connection: provider.connection,
        maxRetries: 200,
        delayMs: 5,
      },
    );

    await validatePosition(params.positionPda.publicKey, params.positionMint);
  });

  it("fails to reset range for full-range only pool", async () => {
    const [lowerTickIndex, upperTickIndex] = TickUtil.getFullRangeTickIndex(
      TickSpacing.FullRangeOnly,
    );

    const positionInitInfo = await initializeDefaultPosition(
      fullRangeOnlyWhirlpoolPda.publicKey,
      lowerTickIndex,
      upperTickIndex,
    );
    const { positionPda, positionTokenAccount } = positionInitInfo.params;

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.resetPositionRangeIx(ctx.program, {
          funder: funderKeypair.publicKey,
          positionAuthority: provider.wallet.publicKey,
          whirlpool: fullRangeOnlyWhirlpoolPda.publicKey,
          position: positionPda.publicKey,
          positionTokenAccount,
          tickLowerIndex: lowerTickIndex - TickSpacing.FullRangeOnly,
          tickUpperIndex: upperTickIndex + TickSpacing.FullRangeOnly,
        }),
      )
        .addSigner(funderKeypair)
        .buildAndExecute(),
      /0x177a/, // InvalidTickIndex
    );
  });

  it("fails to reset range to same tick range", async () => {
    const { positionPda, positionTokenAccount } = (
      await initializeDefaultPosition(whirlpoolPda.publicKey)
    ).params;

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.resetPositionRangeIx(ctx.program, {
          funder: funderKeypair.publicKey,
          positionAuthority: provider.wallet.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          position: positionPda.publicKey,
          positionTokenAccount,
          tickLowerIndex: tickLowerIndex,
          tickUpperIndex: tickUpperIndex,
        }),
      )
        .addSigner(funderKeypair)
        .buildAndExecute(),
      /0x17ac/, // SameTickRangeNotAllowed
    );
  });

  it("successfully opens bundled position and verify position address contents", async () => {
    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
    );

    const bundleIndex = 0;
    const positionInitInfo = await openBundledPosition(
      ctx,
      whirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      tickLowerIndex,
      tickUpperIndex,
    );
    const { params } = positionInitInfo;
    const { bundledPositionPda } = params;

    await validatePosition(
      bundledPositionPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      whirlpoolPda.publicKey,
      0,
    );

    await toTx(
      ctx,
      WhirlpoolIx.resetPositionRangeIx(ctx.program, {
        funder: funderKeypair.publicKey,
        positionAuthority: provider.wallet.publicKey,
        whirlpool: whirlpoolPda.publicKey,
        position: bundledPositionPda.publicKey,
        positionTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        tickLowerIndex: tickLowerIndex + poolInitInfo.tickSpacing,
        tickUpperIndex: tickUpperIndex - poolInitInfo.tickSpacing,
      }),
    )
      .addSigner(funderKeypair)
      .buildAndExecute();

    // Wait until position reflects the new tick indexes
    await pollForCondition(
      async () =>
        fetcher.getPosition(bundledPositionPda.publicKey, { maxAge: 0 }),
      (p: PositionData | null) =>
        Boolean(
          p &&
            p.tickLowerIndex === tickLowerIndex + poolInitInfo.tickSpacing &&
            p.tickUpperIndex === tickUpperIndex - poolInitInfo.tickSpacing,
        ),
      {
        accountToReload: bundledPositionPda.publicKey,
        connection: provider.connection,
        maxRetries: 200,
        delayMs: 5,
      },
    );

    await validatePosition(
      bundledPositionPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
    );
  });

  describe("invalid ticks for reset range", () => {
    async function assertResetRangeFails(lowerTick: number, upperTick: number) {
      const { positionPda, positionTokenAccount } = (
        await initializeDefaultPosition(whirlpoolPda.publicKey)
      ).params;
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.resetPositionRangeIx(ctx.program, {
            funder: funderKeypair.publicKey,
            positionAuthority: provider.wallet.publicKey,
            whirlpool: whirlpoolPda.publicKey,
            position: positionPda.publicKey,
            positionTokenAccount,
            tickLowerIndex: lowerTick,
            tickUpperIndex: upperTick,
          }),
        )
          .addSigner(funderKeypair)
          .buildAndExecute(),
        /0x177a/, // InvalidTickIndex
      );
    }

    it("fail when user pass in an out of bound tick index for upper-index", async () => {
      await assertResetRangeFails(
        0,
        (Math.ceil(MAX_TICK_INDEX / TickSpacing.Standard) + 1) *
          TickSpacing.Standard,
      );
    });

    it("fail when user pass in a lower tick index that is higher than the upper-index", async () => {
      await assertResetRangeFails(
        -TickSpacing.Standard,
        -TickSpacing.Standard * 2,
      );
    });

    it("fail when user pass in a lower tick index that equals the upper-index", async () => {
      await assertResetRangeFails(-TickSpacing.Standard, -TickSpacing.Standard);
    });

    it("fail when user pass in an out of bound tick index for lower-index", async () => {
      await assertResetRangeFails(
        Math.floor(MIN_TICK_INDEX / TickSpacing.Standard - 1) *
          TickSpacing.Standard,
        0,
      );
    });

    it("fail when user pass in a non-initializable tick index for upper-index", async () => {
      await assertResetRangeFails(0, TickSpacing.Standard - 1);
    });

    it("fail when user pass in a non-initializable tick index for lower-index", async () => {
      await assertResetRangeFails(1, TickSpacing.Standard);
    });
  });

  describe("rent collection", () => {
    async function calculateRents(positionKey: PublicKey) {
      const positionAccountInfo =
        await provider.connection.getAccountInfo(positionKey);
      assert.ok(positionAccountInfo);

      const positionRentReq =
        await provider.connection.getMinimumBalanceForRentExemption(
          positionAccountInfo.data.length,
        );

      const tickRentReq = TICK_RENT_AMOUNT * 2;
      const allRentReq = positionRentReq + tickRentReq;

      return {
        positionRentReq,
        allRentReq,
        tickRentReq,
      };
    }

    async function ensurePositionBalance(
      positionKey: PublicKey,
      targetBalance: number,
    ) {
      let position_balance = await provider.connection.getBalance(positionKey);
      if (position_balance > targetBalance) {
        // Because the position is owned by the Whirlpool program
        // only the whirlpool program can transfer the lamports unless the position is closed
      } else if (position_balance < targetBalance) {
        // If the position doesn't have enough balance, we transfer just enough from the wallet to the position
        await systemTransferTx(
          provider,
          positionKey,
          targetBalance - position_balance,
        ).buildAndExecute();

        position_balance = await provider.connection.getBalance(positionKey);
        assert.strictEqual(position_balance, targetBalance);
      }
    }

    async function validateRentBalances(
      positionKey: PublicKey,
      positionTokenAccount: PublicKey,
      postiionMintAddress: PublicKey,
      preFunderBalance: number,
      postFunderBalance: number,
      ensuredPositionBalance: number,
      postPositionBalance: number,
    ) {
      let balance = await provider.connection.getBalance(
        funderKeypair.publicKey,
      );
      assert.strictEqual(balance, preFunderBalance);
      await ensurePositionBalance(positionKey, ensuredPositionBalance);

      await toTx(
        ctx,
        WhirlpoolIx.resetPositionRangeIx(ctx.program, {
          funder: funderKeypair.publicKey,
          positionAuthority: provider.wallet.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          position: positionKey,
          positionTokenAccount,
          tickLowerIndex: tickLowerIndex + poolInitInfo.tickSpacing,
          tickUpperIndex: tickUpperIndex - poolInitInfo.tickSpacing,
        }),
      )
        .addSigner(funderKeypair)
        .buildAndExecute();

      // Wait for position to reflect the new tick indexes before validation
      await pollForCondition(
        async () => fetcher.getPosition(positionKey, { maxAge: 0 }),
        (p: PositionData | null) =>
          Boolean(
            p &&
              p.tickLowerIndex === tickLowerIndex + poolInitInfo.tickSpacing &&
              p.tickUpperIndex === tickUpperIndex - poolInitInfo.tickSpacing,
          ),
        {
          accountToReload: positionKey,
          connection: provider.connection,
          maxRetries: 200,
          delayMs: 5,
        },
      );

      balance = await provider.connection.getBalance(funderKeypair.publicKey);
      assert.strictEqual(balance, postFunderBalance);
      assert.strictEqual(
        await provider.connection.getBalance(positionKey),
        postPositionBalance,
      );
      await validatePosition(positionKey, postiionMintAddress);
    }

    it("successfully collects rent for position with insufficient balance", async () => {
      // preload whirlpool and position without additional rent for ticks
      const preloadWalletKeypair = anchor.web3.Keypair.fromSecretKey(
        new Uint8Array(preloadWalletSecret),
      );

      const preloadWhirlpoolAddress = new anchor.web3.PublicKey(
        "EgxU92G34jw6QDG9RuTX9StFg1PmHuDqkRKAE5kVEiZ4",
      );
      const preloadPositionAddress = new anchor.web3.PublicKey(
        "J6DFYFKUsoMYgxkbeAqVnpSb8fniA9tHR44ZQu8KBgMS",
      );

      const preloadWhirlpool = await fetcher.getPool(preloadWhirlpoolAddress);
      const preloadPosition = await fetcher.getPosition(preloadPositionAddress);
      assert.ok(preloadWhirlpool);
      assert.ok(preloadPosition);

      const preloadPositionMintAddress = preloadPosition.positionMint;
      const preloadPositionMint = await fetcher.getMintInfo(
        preloadPositionMintAddress,
      );
      assert.ok(preloadPositionMint);
      const preloadPositionTokenAccount = getAssociatedTokenAddressSync(
        preloadPositionMintAddress,
        preloadWalletKeypair.publicKey,
        undefined,
        preloadPositionMint.tokenProgram,
      );

      const { positionRentReq, allRentReq, tickRentReq } = await calculateRents(
        preloadPositionAddress,
      );

      // reset position range (Fixed Tick Arrays -> Dynamic Tick Arrays)

      const preFunderBalance = ONE_SOL;
      const postFunderBalance = ONE_SOL - tickRentReq;

      const ensuredPositionBalance = positionRentReq;
      const postPositionBalance = allRentReq;

      // ticks on different tick arrays
      const newTickLowerIndex = -118272 + 64;
      const newTickUpperIndex = -112640 + 64;

      assert.ok(preloadPosition.tickLowerIndex !== newTickLowerIndex);
      assert.ok(preloadPosition.tickUpperIndex !== newTickUpperIndex);

      let balance = await provider.connection.getBalance(
        funderKeypair.publicKey,
      );
      assert.strictEqual(balance, preFunderBalance);
      await ensurePositionBalance(
        preloadPositionAddress,
        ensuredPositionBalance,
      );

      await toTx(
        ctx,
        WhirlpoolIx.resetPositionRangeIx(ctx.program, {
          funder: funderKeypair.publicKey,
          positionAuthority: preloadWalletKeypair.publicKey,
          whirlpool: preloadWhirlpoolAddress,
          position: preloadPositionAddress,
          positionTokenAccount: preloadPositionTokenAccount,
          tickLowerIndex: newTickLowerIndex,
          tickUpperIndex: newTickUpperIndex,
        }),
      )
        .addSigner(funderKeypair)
        .addSigner(preloadWalletKeypair)
        .buildAndExecute();

      balance = await provider.connection.getBalance(funderKeypair.publicKey);
      assert.strictEqual(balance, postFunderBalance);
      assert.strictEqual(
        await provider.connection.getBalance(preloadPositionAddress),
        postPositionBalance,
      );
      await validatePosition(
        preloadPositionAddress,
        preloadPositionMintAddress,
        preloadWhirlpoolAddress,
        0,
        newTickLowerIndex,
        newTickUpperIndex,
      );

      // initialize Dynamic Tick Arrays
      const dynamicTickArrayLowerPda = PDAUtil.getTickArray(
        ctx.program.programId,
        preloadWhirlpoolAddress,
        -118272,
      );
      await toTx(
        ctx,
        WhirlpoolIx.initDynamicTickArrayIx(ctx.program, {
          whirlpool: preloadWhirlpoolAddress,
          funder: ctx.wallet.publicKey,
          startTick: -118272,
          tickArrayPda: dynamicTickArrayLowerPda,
        }),
      ).buildAndExecute();
      const dynamicTickArrayUpperPda = PDAUtil.getTickArray(
        ctx.program.programId,
        preloadWhirlpoolAddress,
        -112640,
      );
      await toTx(
        ctx,
        WhirlpoolIx.initDynamicTickArrayIx(ctx.program, {
          whirlpool: preloadWhirlpoolAddress,
          funder: ctx.wallet.publicKey,
          startTick: -112640,
          tickArrayPda: dynamicTickArrayUpperPda,
        }),
      ).buildAndExecute();

      // increase liquidity
      const tokenMaxA = new anchor.BN(10_000_000_000);
      const tokenMaxB = new anchor.BN(10_000_000);
      const maxLiquidity = PoolUtil.estimateMaxLiquidityFromTokenAmounts(
        preloadWhirlpool.sqrtPrice,
        newTickLowerIndex,
        newTickUpperIndex,
        { tokenA: tokenMaxA, tokenB: tokenMaxB },
      );

      const preRentDynamicTickArrayLower = (
        await ctx.connection.getAccountInfo(dynamicTickArrayLowerPda.publicKey)
      )?.lamports;
      const preRentDynamicTickArrayUpper = (
        await ctx.connection.getAccountInfo(dynamicTickArrayUpperPda.publicKey)
      )?.lamports;
      const preRentPosition = (
        await ctx.connection.getAccountInfo(preloadPositionAddress)
      )?.lamports;
      assert.ok(preRentDynamicTickArrayLower);
      assert.ok(preRentDynamicTickArrayUpper);
      assert.ok(preRentPosition);

      await toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          liquidityAmount: maxLiquidity,
          positionAuthority: preloadWalletKeypair.publicKey,
          position: preloadPositionAddress,
          positionTokenAccount: preloadPositionTokenAccount,
          whirlpool: preloadWhirlpoolAddress,
          tickArrayLower: dynamicTickArrayLowerPda.publicKey,
          tickArrayUpper: dynamicTickArrayUpperPda.publicKey,
          tokenOwnerAccountA: getAssociatedTokenAddressSync(
            preloadWhirlpool.tokenMintA,
            preloadWalletKeypair.publicKey,
          ),
          tokenOwnerAccountB: getAssociatedTokenAddressSync(
            preloadWhirlpool.tokenMintB,
            preloadWalletKeypair.publicKey,
          ),
          tokenMaxA,
          tokenMaxB,
          tokenVaultA: preloadWhirlpool.tokenVaultA,
          tokenVaultB: preloadWhirlpool.tokenVaultB,
        }),
      )
        .addSigner(preloadWalletKeypair)
        .buildAndExecute();

      const postRentDynamicTickArrayLower = (
        await ctx.connection.getAccountInfo(dynamicTickArrayLowerPda.publicKey)
      )?.lamports;
      const postRentDynamicTickArrayUpper = (
        await ctx.connection.getAccountInfo(dynamicTickArrayUpperPda.publicKey)
      )?.lamports;
      const postRentPosition = (
        await ctx.connection.getAccountInfo(preloadPositionAddress)
      )?.lamports;
      assert.ok(postRentDynamicTickArrayLower);
      assert.ok(postRentDynamicTickArrayUpper);
      assert.ok(postRentPosition);

      const rentDiffDynamicTickArrayLower =
        postRentDynamicTickArrayLower - preRentDynamicTickArrayLower;
      const rentDiffDynamicTickArrayUpper =
        postRentDynamicTickArrayUpper - preRentDynamicTickArrayUpper;
      const rentDiffPosition = preRentPosition - postRentPosition;

      assert.ok(rentDiffPosition > 0);
      assert.ok(rentDiffPosition === tickRentReq);
      assert.ok(
        rentDiffPosition ===
          rentDiffDynamicTickArrayLower + rentDiffDynamicTickArrayUpper,
      );
      assert.ok(
        rentDiffDynamicTickArrayLower === rentDiffDynamicTickArrayUpper,
      );
    });

    it("successfully doesn't collect rent for position with exactly enough balance", async () => {
      const { positionPda, positionMintAddress, positionTokenAccount } = (
        await initializeDefaultPosition(whirlpoolPda.publicKey)
      ).params;

      const { allRentReq } = await calculateRents(positionPda.publicKey);
      await validateRentBalances(
        positionPda.publicKey,
        positionTokenAccount,
        positionMintAddress,
        ONE_SOL,
        ONE_SOL,
        allRentReq,
        allRentReq,
      );
    });

    it("successfully doesn't collect rent for position with more than enough balance", async () => {
      const { positionPda, positionMintAddress, positionTokenAccount } = (
        await initializeDefaultPosition(whirlpoolPda.publicKey)
      ).params;

      const { allRentReq } = await calculateRents(positionPda.publicKey);
      await validateRentBalances(
        positionPda.publicKey,
        positionTokenAccount,
        positionMintAddress,
        ONE_SOL,
        ONE_SOL,
        allRentReq + 10,
        allRentReq + 10,
      );
    });
  });
});
