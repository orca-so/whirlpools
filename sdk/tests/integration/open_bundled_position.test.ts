import * as anchor from "@coral-xyz/anchor";
import { PDA } from "@orca-so/common-sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as assert from "assert";
import {
  InitPoolParams,
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  PDAUtil,
  POSITION_BUNDLE_SIZE,
  PositionBundleData,
  PositionData,
  TickUtil,
  toTx,
  WhirlpoolContext,
  WhirlpoolIx
} from "../../src";
import { IGNORE_CACHE } from "../../src/network/public/fetcher";
import {
  approveToken,
  createAssociatedTokenAccount,
  ONE_SOL,
  systemTransferTx,
  TickSpacing,
  transferToken,
  ZERO_BN
} from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { initializePositionBundle, initTestPool, openBundledPosition } from "../utils/init-utils";

describe("open_bundled_position", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);


  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  const tickLowerIndex = 0;
  const tickUpperIndex = 32768;
  let poolInitInfo: InitPoolParams;
  let whirlpoolPda: PDA;
  let infinityPoolInitInfo: InitPoolParams;
  let infinityWhirlpoolPda: PDA;
  const funderKeypair = anchor.web3.Keypair.generate();

  before(async () => {
    poolInitInfo = (await initTestPool(ctx, TickSpacing.Standard)).poolInitInfo;
    whirlpoolPda = poolInitInfo.whirlpoolPda;

    infinityPoolInitInfo = (await initTestPool(ctx, TickSpacing.Infinity)).poolInitInfo;
    infinityWhirlpoolPda = infinityPoolInitInfo.whirlpoolPda;

    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();
  });

  async function createOpenBundledPositionTx(
    ctx: WhirlpoolContext,
    positionBundleMint: PublicKey,
    bundleIndex: number,
    overwrite: any,
  ) {
    const bundledPositionPda = PDAUtil.getBundledPosition(ctx.program.programId, positionBundleMint, bundleIndex);
    const positionBundle = PDAUtil.getPositionBundle(ctx.program.programId, positionBundleMint).publicKey;
    const positionBundleTokenAccount = getAssociatedTokenAddressSync(
      positionBundleMint,
      ctx.wallet.publicKey
    );
    const defaultAccounts = {
      bundledPosition: bundledPositionPda.publicKey,
      positionBundle,
      positionBundleTokenAccount,
      positionBundleAuthority: ctx.wallet.publicKey,
      whirlpool: whirlpoolPda.publicKey,
      funder: ctx.wallet.publicKey,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    };

    const ix = program.instruction.openBundledPosition(bundleIndex, tickLowerIndex, tickUpperIndex, {
      accounts: {
        ...defaultAccounts,
        ...overwrite,
      }
    });

    return toTx(ctx, {
      instructions: [ix],
      cleanupInstructions: [],
      signers: [],
    });
  }

  function checkPositionAccountContents(position: PositionData, mint: PublicKey, lowerTick: number = tickLowerIndex, upperTick: number = tickUpperIndex) {
    assert.strictEqual(position.tickLowerIndex, lowerTick);
    assert.strictEqual(position.tickUpperIndex, upperTick);
    assert.ok(position.whirlpool.equals(poolInitInfo.whirlpoolPda.publicKey));
    assert.ok(position.positionMint.equals(mint));
    assert.ok(position.liquidity.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointA.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointB.eq(ZERO_BN));
    assert.ok(position.feeOwedA.eq(ZERO_BN));
    assert.ok(position.feeOwedB.eq(ZERO_BN));
    assert.ok(position.rewardInfos[0].amountOwed.eq(ZERO_BN));
    assert.ok(position.rewardInfos[1].amountOwed.eq(ZERO_BN));
    assert.ok(position.rewardInfos[2].amountOwed.eq(ZERO_BN));
    assert.ok(position.rewardInfos[0].growthInsideCheckpoint.eq(ZERO_BN));
    assert.ok(position.rewardInfos[1].growthInsideCheckpoint.eq(ZERO_BN));
    assert.ok(position.rewardInfos[2].growthInsideCheckpoint.eq(ZERO_BN));
  }

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

  it("successfully opens bundled position and verify position address contents", async () => {
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

    const position = (await fetcher.getPosition(bundledPositionPda.publicKey)) as PositionData;
    checkPositionAccountContents(position, positionBundleInfo.positionBundleMintKeypair.publicKey);

    const positionBundle = (await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE)) as PositionBundleData;
    checkBitmap(positionBundle, [bundleIndex]);
  });

  it("successfully opens bundled position when funder is different than account paying for transaction fee", async () => {
    const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

    const preBalance = await ctx.connection.getBalance(ctx.wallet.publicKey);

    const bundleIndex = POSITION_BUNDLE_SIZE - 1;
    const positionInitInfo = await openBundledPosition(
      ctx,
      whirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      tickLowerIndex,
      tickUpperIndex,
      ctx.wallet.publicKey,
      funderKeypair,
    );
    const { bundledPositionPda } = positionInitInfo.params;

    const postBalance = await ctx.connection.getBalance(ctx.wallet.publicKey);
    const diffBalance = preBalance - postBalance;
    const minRent = await ctx.connection.getMinimumBalanceForRentExemption(0);
    assert.ok(diffBalance < minRent); // ctx.wallet didn't any rent

    const position = (await fetcher.getPosition(bundledPositionPda.publicKey)) as PositionData;
    checkPositionAccountContents(position, positionBundleInfo.positionBundleMintKeypair.publicKey);

    const positionBundle = (await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE)) as PositionBundleData;
    checkBitmap(positionBundle, [bundleIndex]);
  });

  it("successfully opens multiple bundled position and verify bitmap", async () => {
    const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

    const bundleIndexes = [1, 7, 8, 64, 127, 128, 254, 255];
    for (const bundleIndex of bundleIndexes) {
      const positionInitInfo = await openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex
      );
      const { bundledPositionPda } = positionInitInfo.params;

      const position = (await fetcher.getPosition(bundledPositionPda.publicKey)) as PositionData;
      checkPositionAccountContents(position, positionBundleInfo.positionBundleMintKeypair.publicKey);
    }

    const positionBundle = (await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE)) as PositionBundleData;
    checkBitmap(positionBundle, bundleIndexes);
  });

  it("successfully opens bundled position for infinity pool", async () => {
    const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

    const [lowerTickIndex, upperTickIndex] = TickUtil.getFullRangeTickIndex(TickSpacing.Infinity);

    const bundleIndex = 0;
    const positionInitInfo = await openBundledPosition(
      ctx,
      infinityWhirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      lowerTickIndex,
      upperTickIndex
    );
    const { bundledPositionPda } = positionInitInfo.params;

    const position = (await fetcher.getPosition(bundledPositionPda.publicKey)) as PositionData;
    checkPositionAccountContents(position, positionBundleInfo.positionBundleMintKeypair.publicKey, lowerTickIndex, upperTickIndex);

    const positionBundle = (await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE)) as PositionBundleData;
    checkBitmap(positionBundle, [bundleIndex]);
  });

  describe("invalid bundle index", () => {
    it("should be failed: invalid bundle index (< 0)", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

      const bundleIndex = -1;
      await assert.rejects(
        openBundledPosition(
          ctx,
          whirlpoolPda.publicKey,
          positionBundleInfo.positionBundleMintKeypair.publicKey,
          bundleIndex,
          tickLowerIndex,
          tickUpperIndex,
        ),
        /It must be >= 0 and <= 65535/ // rejected by client
      );
    });

    it("should be failed: invalid bundle index (POSITION_BUNDLE_SIZE)", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

      const bundleIndex = POSITION_BUNDLE_SIZE;
      await assert.rejects(
        openBundledPosition(
          ctx,
          whirlpoolPda.publicKey,
          positionBundleInfo.positionBundleMintKeypair.publicKey,
          bundleIndex,
          tickLowerIndex,
          tickUpperIndex,
        ),
        /0x179b/ // InvalidBundleIndex
      );
    });


    it("should be failed: invalid bundle index (u16 max)", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

      const bundleIndex = 2 ** 16 - 1;
      await assert.rejects(
        openBundledPosition(
          ctx,
          whirlpoolPda.publicKey,
          positionBundleInfo.positionBundleMintKeypair.publicKey,
          bundleIndex,
          tickLowerIndex,
          tickUpperIndex,
        ),
        /0x179b/ // InvalidBundleIndex
      );
    });
  });

  describe("invalid tick index", () => {
    async function assertTicksFail(lowerTick: number, upperTick: number) {
      const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);
      const bundleIndex = 0;
      await assert.rejects(
        openBundledPosition(
          ctx,
          whirlpoolPda.publicKey,
          positionBundleInfo.positionBundleMintKeypair.publicKey,
          bundleIndex,
          lowerTick,
          upperTick,
          provider.wallet.publicKey,
          funderKeypair
        ),
        /0x177a/ // InvalidTickIndex
      );
    }

    it("should be failed: user pass in an out of bound tick index for upper-index", async () => {
      await assertTicksFail(0, MAX_TICK_INDEX + 1);
    });

    it("should be failed: user pass in a lower tick index that is higher than the upper-index", async () => {
      await assertTicksFail(-22534, -22534 - 1);
    });

    it("should be failed: user pass in a lower tick index that equals the upper-index", async () => {
      await assertTicksFail(22365, 22365);
    });

    it("should be failed: user pass in an out of bound tick index for lower-index", async () => {
      await assertTicksFail(MIN_TICK_INDEX - 1, 0);
    });

    it("should be failed: user pass in a non-initializable tick index for upper-index", async () => {
      await assertTicksFail(0, 1);
    });

    it("should be failed: user pass in a non-initializable tick index for lower-index", async () => {
      await assertTicksFail(1, 2);
    });
  });

  it("should be fail: user opens bundled position with bundle index whose state is opened", async () => {
    const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

    const bundleIndex = 0;
    await openBundledPosition(
      ctx,
      whirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      tickLowerIndex,
      tickUpperIndex
    );

    const positionBundle = (await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE)) as PositionBundleData;
    assert.ok(checkBitmapIsOpened(positionBundle, bundleIndex));

    await assert.rejects(
      openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex
      ),
      (err) => { return JSON.stringify(err).includes("already in use") }
    );
  });

  describe("invalid input account", () => {
    it("should be failed: invalid bundled position", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

      const tx = await createOpenBundledPositionTx(
        ctx, positionBundleInfo.positionBundleMintKeypair.publicKey, 0, {
        // invalid parameter
        bundledPosition: PDAUtil.getBundledPosition(
          ctx.program.programId,
          positionBundleInfo.positionBundleMintKeypair.publicKey,
          1 // another bundle index
        ).publicKey
      }
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d6/ // ConstraintSeeds
      );
    });

    it("should be failed: invalid position bundle", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);
      const otherPositionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

      const tx = await createOpenBundledPositionTx(
        ctx, positionBundleInfo.positionBundleMintKeypair.publicKey, 0, {
        // invalid parameter
        positionBundle: otherPositionBundleInfo.positionBundlePda.publicKey,
      }
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d6/ // ConstraintSeeds
      );
    });

    it("should be failed: invalid ATA (amount is zero)", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx, funderKeypair.publicKey, funderKeypair);

      const ata = await createAssociatedTokenAccount(
        provider,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        ctx.wallet.publicKey,
        ctx.wallet.publicKey
      );

      const tx = await createOpenBundledPositionTx(
        ctx, positionBundleInfo.positionBundleMintKeypair.publicKey, 0, {
        // invalid parameter
        positionBundleTokenAccount: ata,
      }
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d3/ // ConstraintRaw (amount == 1)
      );
    });

    it("should be failed: invalid ATA (invalid mint)", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx, funderKeypair.publicKey, funderKeypair);
      const otherPositionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);

      const tx = await createOpenBundledPositionTx(
        ctx, positionBundleInfo.positionBundleMintKeypair.publicKey, 0, {
        // invalid parameter
        positionBundleTokenAccount: otherPositionBundleInfo.positionBundleTokenAccount,
      }
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d3/ // ConstraintRaw (mint == position_bundle.position_bundle_mint)
      );
    });

    it("should be failed: invalid position bundle authority", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx, funderKeypair.publicKey, funderKeypair);

      const tx = await createOpenBundledPositionTx(
        ctx, positionBundleInfo.positionBundleMintKeypair.publicKey, 0, {
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        // invalid parameter
        positionBundleAuthority: ctx.wallet.publicKey,
      }
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x1783/ // MissingOrInvalidDelegate
      );
    });

    it("should be failed: invalid whirlpool", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

      const tx = await createOpenBundledPositionTx(
        ctx, positionBundleInfo.positionBundleMintKeypair.publicKey, 0, {
        // invalid parameter
        whirlpool: positionBundleInfo.positionBundlePda.publicKey,
      }
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbba/ // AccountDiscriminatorMismatch
      );
    });


    it("should be failed: invalid system program", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

      const tx = await createOpenBundledPositionTx(
        ctx, positionBundleInfo.positionBundleMintKeypair.publicKey, 0, {
        // invalid parameter
        systemProgram: TOKEN_PROGRAM_ID,
      }
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });

    it("should be failed: invalid rent", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

      const tx = await createOpenBundledPositionTx(
        ctx, positionBundleInfo.positionBundleMintKeypair.publicKey, 0, {
        // invalid parameter
        rent: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      }
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc7/ // AccountSysvarMismatch
      );
    });
  });

  describe("authority delegation", () => {
    it("successfully opens bundled position with delegated authority", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx, funderKeypair.publicKey, funderKeypair);

      const tx = await createOpenBundledPositionTx(
        ctx, positionBundleInfo.positionBundleMintKeypair.publicKey, 0, {
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        positionBundleAuthority: ctx.wallet.publicKey,
      }
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x1783/ // MissingOrInvalidDelegate
      );

      // delegate 1 token from funder to ctx.wallet
      await approveToken(
        provider,
        positionBundleInfo.positionBundleTokenAccount,
        ctx.wallet.publicKey,
        1,
        funderKeypair
      );
      await tx.buildAndExecute();
      const positionBundle = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
      checkBitmapIsOpened(positionBundle!, 0);
    });

    it("successfully opens bundled position even if delegation exists", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

      const tx = await createOpenBundledPositionTx(
        ctx, positionBundleInfo.positionBundleMintKeypair.publicKey, 0, {
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        positionBundleAuthority: ctx.wallet.publicKey,
      }
      );

      // delegate 1 token from ctx.wallet to funder
      await approveToken(
        provider,
        positionBundleInfo.positionBundleTokenAccount,
        funderKeypair.publicKey,
        1,
      );
      // owner can open even if delegation exists
      await tx.buildAndExecute();
      const positionBundle = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
      checkBitmapIsOpened(positionBundle!, 0);
    });


    it("should be failed: delegated amount is zero", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx, funderKeypair.publicKey, funderKeypair);

      const tx = await createOpenBundledPositionTx(
        ctx, positionBundleInfo.positionBundleMintKeypair.publicKey, 0, {
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        positionBundleAuthority: ctx.wallet.publicKey,
      }
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x1783/ // MissingOrInvalidDelegate
      );

      // delegate ZERO token from funder to ctx.wallet
      await approveToken(
        provider,
        positionBundleInfo.positionBundleTokenAccount,
        ctx.wallet.publicKey,
        0,
        funderKeypair
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x1784/ // InvalidPositionTokenAmount
      );
    });
  });

  describe("transfer position bundle", () => {
    it("successfully opens bundled position after position bundle token transfer", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

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
        WhirlpoolIx.openBundledPositionIx(ctx.program, {
          bundledPositionPda: PDAUtil.getBundledPosition(ctx.program.programId, positionBundleInfo.positionBundleMintKeypair.publicKey, 0),
          bundleIndex: 0,
          funder: funderKeypair.publicKey,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: funderKeypair.publicKey,
          positionBundleTokenAccount: funderATA,
          tickLowerIndex,
          tickUpperIndex,
          whirlpool: whirlpoolPda.publicKey,
        })
      );
      tx.addSigner(funderKeypair);

      await tx.buildAndExecute();
      const positionBundle = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
      checkBitmapIsOpened(positionBundle!, 0);
    });
  });

  it("fail when opening a non-full range position in an infinity pool", async () => {
    const positionBundleInfo = await initializePositionBundle(ctx, ctx.wallet.publicKey);
    const bundleIndex = 0;
    await assert.rejects(
      openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex
      ),
      /0x17a6/ // NonFullRangePositionDisallowed
    );
  });

});
