import * as anchor from "@coral-xyz/anchor";
import { PDA, Percentage } from "@orca-so/common-sdk";
import * as assert from "assert";
import BN from "bn.js";
import {
  InitPoolParams,
  POSITION_BUNDLE_SIZE,
  PositionBundleData,
  WhirlpoolContext,
  WhirlpoolIx,
  buildWhirlpoolClient,
  increaseLiquidityQuoteByInputTokenWithParamsUsingPriceSlippage,
  toTx
} from "../../src";
import { IGNORE_CACHE } from "../../src/network/public/fetcher";
import {
  ONE_SOL,
  TickSpacing,
  approveToken, createAssociatedTokenAccount,
  systemTransferTx,
  transferToken
} from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { initTestPool, initializePositionBundle, openBundledPosition, openPosition } from "../utils/init-utils";
import { mintTokensToTestAccount } from "../utils/test-builders";
import { TokenExtensionUtil } from "../../src/utils/public/token-extension-util";

describe("close_bundled_position", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const client = buildWhirlpoolClient(ctx);
  const fetcher = ctx.fetcher;

  const tickLowerIndex = 0;
  const tickUpperIndex = 128;
  let poolInitInfo: InitPoolParams;
  let whirlpoolPda: PDA;
  const funderKeypair = anchor.web3.Keypair.generate();

  before(async () => {
    poolInitInfo = (await initTestPool(ctx, TickSpacing.Standard)).poolInitInfo;
    whirlpoolPda = poolInitInfo.whirlpoolPda;
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();

    const pool = await client.getPool(whirlpoolPda.publicKey);
    await (await pool.initTickArrayForTicks([0]))?.buildAndExecute();
  });

  function checkBitmapIsOpened(account: PositionBundleData, bundleIndex: number): boolean {
    if (bundleIndex < 0 || bundleIndex >= POSITION_BUNDLE_SIZE) throw Error("bundleIndex is out of bounds");

    const bitmapIndex = Math.floor(bundleIndex / 8);
    const bitmapOffset = bundleIndex % 8;
    return (account.positionBitmap[bitmapIndex] & (1 << bitmapOffset)) > 0;
  }

  function checkBitmapIsClosed(account: PositionBundleData, bundleIndex: number): boolean {
    if (bundleIndex < 0 || bundleIndex >= POSITION_BUNDLE_SIZE) throw Error("bundleIndex is out of bounds");

    const bitmapIndex = Math.floor(bundleIndex / 8);
    const bitmapOffset = bundleIndex % 8;
    return (account.positionBitmap[bitmapIndex] & (1 << bitmapOffset)) === 0;
  }

  function checkBitmap(account: PositionBundleData, openedBundleIndexes: number[]) {
    for (let i = 0; i < POSITION_BUNDLE_SIZE; i++) {
      if (openedBundleIndexes.includes(i)) {
        assert.ok(checkBitmapIsOpened(account, i));
      }
      else {
        assert.ok(checkBitmapIsClosed(account, i));
      }
    }
  }

  it("successfully closes an opened bundled position", async () => {
    const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

    const bundleIndex = 0;
    const positionInitInfo = await openBundledPosition(
      ctx,
      whirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      tickLowerIndex,
      tickUpperIndex
    );
    const { bundledPositionPda } = positionInitInfo.params;

    const preAccount = await fetcher.getPosition(bundledPositionPda.publicKey, IGNORE_CACHE);
    const prePositionBundle = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
    checkBitmap(prePositionBundle!, [bundleIndex]);
    assert.ok(preAccount !== null);

    const receiverKeypair = anchor.web3.Keypair.generate();
    await toTx(
      ctx,
      WhirlpoolIx.closeBundledPositionIx(ctx.program, {
        bundledPosition: bundledPositionPda.publicKey,
        bundleIndex,
        positionBundle: positionBundleInfo.positionBundlePda.publicKey,
        positionBundleAuthority: ctx.wallet.publicKey,
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        receiver: receiverKeypair.publicKey,
      })
    ).buildAndExecute();
    const postAccount = await fetcher.getPosition(bundledPositionPda.publicKey, IGNORE_CACHE);
    const postPositionBundle = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
    checkBitmap(postPositionBundle!, []);
    assert.ok(postAccount === null);

    const receiverAccount = await provider.connection.getAccountInfo(receiverKeypair.publicKey);
    const lamports = receiverAccount?.lamports;
    assert.ok(lamports != undefined && lamports > 0);
  });

  it("should be failed: invalid bundle index", async () => {
    const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

    const bundleIndex = 0;
    const positionInitInfo = await openBundledPosition(
      ctx,
      whirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      tickLowerIndex,
      tickUpperIndex
    );
    const { bundledPositionPda } = positionInitInfo.params;

    const tx = await toTx(
      ctx,
      WhirlpoolIx.closeBundledPositionIx(ctx.program, {
        bundledPosition: bundledPositionPda.publicKey,
        bundleIndex: 1, // invalid
        positionBundle: positionBundleInfo.positionBundlePda.publicKey,
        positionBundleAuthority: ctx.wallet.publicKey,
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        receiver: ctx.wallet.publicKey,
      })
    );
    await assert.rejects(
      tx.buildAndExecute(),
      /0x7d6/ // ConstraintSeeds (seed constraint was violated)
    );
  });

  it("should be failed: user closes bundled position already closed", async () => {
    const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

    const bundleIndex = 0;
    const positionInitInfo = await openBundledPosition(
      ctx,
      whirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      tickLowerIndex,
      tickUpperIndex
    );
    const { bundledPositionPda } = positionInitInfo.params;

    const tx = toTx(
      ctx,
      WhirlpoolIx.closeBundledPositionIx(ctx.program, {
        bundledPosition: bundledPositionPda.publicKey,
        bundleIndex,
        positionBundle: positionBundleInfo.positionBundlePda.publicKey,
        positionBundleAuthority: ctx.wallet.publicKey,
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        receiver: ctx.wallet.publicKey,
      })
    );

    // close...
    await tx.buildAndExecute();
    // re-close...
    await assert.rejects(
      tx.buildAndExecute(),
      /0xbc4/ // AccountNotInitialized
    );
  });

  it("should be failed: bundled position is not empty", async () => {
    const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

    const bundleIndex = 0;
    const positionInitInfo = await openBundledPosition(
      ctx,
      whirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      tickLowerIndex,
      tickUpperIndex
    );
    const { bundledPositionPda } = positionInitInfo.params;

    // deposit
    const pool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey, IGNORE_CACHE);
    const quote = increaseLiquidityQuoteByInputTokenWithParamsUsingPriceSlippage({
      tokenMintA: poolInitInfo.tokenMintA,
      tokenMintB: poolInitInfo.tokenMintB,
      sqrtPrice: pool.getData().sqrtPrice,
      slippageTolerance: Percentage.fromFraction(0, 100),
      tickLowerIndex,
      tickUpperIndex,
      tickCurrentIndex: pool.getData().tickCurrentIndex,
      inputTokenMint: poolInitInfo.tokenMintB,
      inputTokenAmount: new BN(1_000_000),
      tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(fetcher, pool.getData(), IGNORE_CACHE),
    });

    await mintTokensToTestAccount(
      provider,
      poolInitInfo.tokenMintA,
      quote.tokenMaxA.toNumber(),
      poolInitInfo.tokenMintB,
      quote.tokenMaxB.toNumber(),
      ctx.wallet.publicKey
    );

    const position = await client.getPosition(bundledPositionPda.publicKey, IGNORE_CACHE);
    await (await position.increaseLiquidity(quote)).buildAndExecute();
    assert.ok((await position.refreshData()).liquidity.gtn(0));

    // try to close...
    const tx = toTx(
      ctx,
      WhirlpoolIx.closeBundledPositionIx(ctx.program, {
        bundledPosition: bundledPositionPda.publicKey,
        bundleIndex,
        positionBundle: positionBundleInfo.positionBundlePda.publicKey,
        positionBundleAuthority: ctx.wallet.publicKey,
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        receiver: ctx.wallet.publicKey,
      })
    );
    await assert.rejects(
      tx.buildAndExecute(),
      /0x1775/ // ClosePositionNotEmpty
    );
  });

  describe("invalid input account", () => {
    it("should be failed: invalid bundled position", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

      const positionInitInfo0 = await openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        0,
        tickLowerIndex,
        tickUpperIndex
      );

      const positionInitInfo1 = await openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        1,
        tickLowerIndex,
        tickUpperIndex
      );
      const tx = toTx(
        ctx,
        WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: positionInitInfo1.params.bundledPositionPda.publicKey, // invalid
          bundleIndex: 0,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          receiver: ctx.wallet.publicKey,
        })
      );
      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d6/ // ConstraintSeeds (seed constraint was violated)
      );
    });

    it("should be failed: invalid position bundle", async () => {
      const positionBundleInfo0 = await initializePositionBundle(ctx, ctx.wallet.publicKey);
      const positionBundleInfo1 = await initializePositionBundle(ctx, ctx.wallet.publicKey);

      const bundleIndex = 0;
      const positionInitInfo = await openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo0.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex
      );
      const tx = toTx(
        ctx,
        WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: positionInitInfo.params.bundledPositionPda.publicKey,
          bundleIndex,
          positionBundle: positionBundleInfo1.positionBundlePda.publicKey, // invalid
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo0.positionBundleTokenAccount,
          receiver: ctx.wallet.publicKey,
        })
      );
      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d6/ // ConstraintSeeds (seed constraint was violated)
      );
    });

    it("should be failed: invalid ATA (amount is zero)", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

      const bundleIndex = 0;
      const positionInitInfo = await openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex
      );

      const ata = await createAssociatedTokenAccount(
        provider,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        funderKeypair.publicKey,
        ctx.wallet.publicKey,
      );
      const tx = toTx(
        ctx,
        WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: positionInitInfo.params.bundledPositionPda.publicKey,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: ata,  // invalid
          receiver: ctx.wallet.publicKey,
        })
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d3/ // ConstraintRaw (amount == 1)
      );
    });

    it("should be failed: invalid ATA (invalid mint)", async () => {
      const positionBundleInfo0 = await initializePositionBundle(ctx, ctx.wallet.publicKey);
      const positionBundleInfo1 = await initializePositionBundle(ctx, ctx.wallet.publicKey);

      const bundleIndex = 0;
      const positionInitInfo = await openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo0.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex
      );
      const tx = toTx(
        ctx,
        WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: positionInitInfo.params.bundledPositionPda.publicKey,
          bundleIndex,
          positionBundle: positionBundleInfo0.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo1.positionBundleTokenAccount,  // invalid
          receiver: ctx.wallet.publicKey,
        })
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d3/ // ConstraintRaw (mint == position_bundle.position_bundle_mint)
      );
    });

    it("should be failed: invalid position bundle authority", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

      const bundleIndex = 0;
      const positionInitInfo = await openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex
      );
      const tx = toTx(
        ctx,
        WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: positionInitInfo.params.bundledPositionPda.publicKey,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: funderKeypair.publicKey, // invalid
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          receiver: ctx.wallet.publicKey,
        })
      );
      tx.addSigner(funderKeypair);

      await assert.rejects(
        tx.buildAndExecute(),
        /0x1783/ // MissingOrInvalidDelegate
      );
    });
  });

  describe("authority delegation", () => {
    it("successfully closes bundled position with delegated authority", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

      const bundleIndex = 0;
      const positionInitInfo = await openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex
      );

      const tx = toTx(
        ctx,
        WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: positionInitInfo.params.bundledPositionPda.publicKey,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: funderKeypair.publicKey, // should be delegated
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          receiver: ctx.wallet.publicKey,
        })
      );
      tx.addSigner(funderKeypair);

      await assert.rejects(
        tx.buildAndExecute(),
        /0x1783/ // MissingOrInvalidDelegate
      );

      // delegate 1 token from ctx.wallet to funder
      await approveToken(
        provider,
        positionBundleInfo.positionBundleTokenAccount,
        funderKeypair.publicKey,
        1,
      );
      await tx.buildAndExecute();
      const positionBundle = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
      checkBitmapIsClosed(positionBundle!, 0);
    });

    it("successfully closes bundled position even if delegation exists", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

      const bundleIndex = 0;
      const positionInitInfo = await openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex
      );

      const tx = toTx(
        ctx,
        WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: positionInitInfo.params.bundledPositionPda.publicKey,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          receiver: ctx.wallet.publicKey,
        })
      );

      // delegate 1 token from ctx.wallet to funder
      await approveToken(
        provider,
        positionBundleInfo.positionBundleTokenAccount,
        funderKeypair.publicKey,
        1,
      );

      // owner can close even if delegation exists
      await tx.buildAndExecute();
      const positionBundle = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
      checkBitmapIsClosed(positionBundle!, 0);
    });

    it("should be faild: delegated amount is zero", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

      const bundleIndex = 0;
      const positionInitInfo = await openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex
      );

      const tx = toTx(
        ctx,
        WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: positionInitInfo.params.bundledPositionPda.publicKey,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: funderKeypair.publicKey, // should be delegated
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          receiver: ctx.wallet.publicKey,
        })
      );
      tx.addSigner(funderKeypair);

      await assert.rejects(
        tx.buildAndExecute(),
        /0x1783/ // MissingOrInvalidDelegate
      );

      // delegate ZERO token from ctx.wallet to funder
      await approveToken(
        provider,
        positionBundleInfo.positionBundleTokenAccount,
        funderKeypair.publicKey,
        0,
      );
      await assert.rejects(
        tx.buildAndExecute(),
        /0x1784/ // InvalidPositionTokenAmount
      );
    });
  });

  describe("transfer position bundle", () => {
    it("successfully closes bundled position after position bundle token transfer", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

      const bundleIndex = 0;
      const positionInitInfo = await openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex
      );

      const funderATA = await createAssociatedTokenAccount(
        provider,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        funderKeypair.publicKey,
        ctx.wallet.publicKey,
      );

      await transferToken(
        provider,
        positionBundleInfo.positionBundleTokenAccount,
        funderATA,
        1
      );

      const tokenInfo = await fetcher.getTokenInfo(funderATA, IGNORE_CACHE);
      assert.ok(tokenInfo?.amount === 1n);

      const tx = toTx(
        ctx,
        WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: positionInitInfo.params.bundledPositionPda.publicKey,
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: funderKeypair.publicKey, // new owner
          positionBundleTokenAccount: funderATA,
          receiver: funderKeypair.publicKey
        })
      );
      tx.addSigner(funderKeypair);

      await tx.buildAndExecute();
      const positionBundle = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
      checkBitmapIsClosed(positionBundle!, 0);
    });
  });

  describe("non-bundled position", () => {
    it("should be failed: try to close NON-bundled position", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

      const bundleIndex = 0;

      const positionInitInfo = await openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex
      );

      // open NON-bundled position
      const { params } = await openPosition(ctx, poolInitInfo.whirlpoolPda.publicKey, 0, 128);

      const tx = toTx(
        ctx,
        WhirlpoolIx.closeBundledPositionIx(ctx.program, {
          bundledPosition: params.positionPda.publicKey, // NON-bundled position
          bundleIndex,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          receiver: ctx.wallet.publicKey,
        })
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d6/ // ConstraintSeeds (seed constraint was violated)
      );
    });
  });

});
