import * as anchor from "@coral-xyz/anchor";
import type { PDA } from "@orca-so/common-sdk";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";
import * as assert from "assert";
import type {
  InitPoolParams,
  PositionBundleData,
  PositionData,
  WhirlpoolContext,
} from "../../../src";
import {
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  PDAUtil,
  PriceMath,
  POSITION_BUNDLE_SIZE,
  TickUtil,
  toTx,
  WhirlpoolIx,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import {
  approveToken,
  createAssociatedTokenAccount,
  ONE_SOL,
  systemTransferTx,
  TickSpacing,
  transferToken,
  ZERO_BN,
  expireBlockhash,
  initializeLiteSVMEnvironment,
  SENTINEL_MIN,
  SENTINEL_MAX,
  snapTickDown,
  snapTickUp,
} from "../../utils";
import { TICK_RENT_AMOUNT } from "../../utils/const";
import {
  initializePositionBundle,
  initTestPool,
  openBundledPosition,
} from "../../utils/init-utils";
import { pollForCondition } from "../../utils/litesvm";

describe("open_bundled_position", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    program = env.program;
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  it("emit PositionOpened event (bundled)", async () => {
    const positionBundleInfo = await initializePositionBundle(ctx);
    const bundleIndex = 0;
    const lower = 0;
    const upper = 128;

    // event verification
    let eventVerified = false;
    let detectedSignature: string | null = null;
    const listener = ctx.program.addEventListener(
      "positionOpened",
      (event, _slot, signature) => {
        detectedSignature = signature;
        // verify whirlpool and ticks; position pubkey checked after
        assert.ok(event.whirlpool.equals(whirlpoolPda.publicKey));
        assert.strictEqual(event.tickLowerIndex, lower);
        assert.strictEqual(event.tickUpperIndex, upper);
        eventVerified = true;
      },
    );

    const { params, txId } = await openBundledPosition(
      ctx,
      whirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      lower,
      upper,
    );

    await pollForCondition(
      async () => ({ detectedSignature, eventVerified }),
      (r) => r.detectedSignature === txId && r.eventVerified,
      { maxRetries: 200, delayMs: 5 },
    );
    assert.equal(txId, detectedSignature);
    assert.ok(eventVerified);

    // Ensure the event's position matches created bundled position PDA
    const position = (await fetcher.getPosition(
      params.bundledPositionPda.publicKey,
      IGNORE_CACHE,
    )) as PositionData;
    assert.strictEqual(position.tickLowerIndex, lower);
    assert.strictEqual(position.tickUpperIndex, upper);

    ctx.program.removeEventListener(listener);
  });

  const tickLowerIndex = 0;
  const tickUpperIndex = 32768;
  let poolInitInfo: InitPoolParams;
  let whirlpoolPda: PDA;
  let fullRangeOnlyPoolInitInfo: InitPoolParams;
  let fullRangeOnlyWhirlpoolPda: PDA;
  const funderKeypair = anchor.web3.Keypair.generate();

  beforeAll(async () => {
    poolInitInfo = (await initTestPool(ctx, TickSpacing.Standard)).poolInitInfo;
    whirlpoolPda = poolInitInfo.whirlpoolPda;

    fullRangeOnlyPoolInitInfo = (
      await initTestPool(ctx, TickSpacing.FullRangeOnly)
    ).poolInitInfo;
    fullRangeOnlyWhirlpoolPda = fullRangeOnlyPoolInitInfo.whirlpoolPda;

    await systemTransferTx(
      provider,
      funderKeypair.publicKey,
      ONE_SOL,
    ).buildAndExecute();
  });

  async function createOpenBundledPositionTx(
    ctx: WhirlpoolContext,
    positionBundleMint: PublicKey,
    bundleIndex: number,
    overwrite: object,
  ) {
    const bundledPositionPda = PDAUtil.getBundledPosition(
      ctx.program.programId,
      positionBundleMint,
      bundleIndex,
    );
    const positionBundle = PDAUtil.getPositionBundle(
      ctx.program.programId,
      positionBundleMint,
    ).publicKey;
    const positionBundleTokenAccount = getAssociatedTokenAddressSync(
      positionBundleMint,
      ctx.wallet.publicKey,
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

    const ix = program.instruction.openBundledPosition(
      bundleIndex,
      tickLowerIndex,
      tickUpperIndex,
      {
        accounts: {
          ...defaultAccounts,
          ...overwrite,
        },
      },
    );

    return toTx(ctx, {
      instructions: [ix],
      cleanupInstructions: [],
      signers: [],
    });
  }

  function checkPositionAccountContents(
    position: PositionData,
    mint: PublicKey,
    whirlpool: PublicKey = poolInitInfo.whirlpoolPda.publicKey,
    lowerTick: number = tickLowerIndex,
    upperTick: number = tickUpperIndex,
  ) {
    assert.strictEqual(position.tickLowerIndex, lowerTick);
    assert.strictEqual(position.tickUpperIndex, upperTick);
    assert.ok(position.whirlpool.equals(whirlpool));
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

  function checkBitmapIsOpened(
    account: PositionBundleData,
    bundleIndex: number,
  ): boolean {
    if (bundleIndex < 0 || bundleIndex >= POSITION_BUNDLE_SIZE)
      throw Error("bundleIndex is out of bounds");

    const bitmapIndex = Math.floor(bundleIndex / 8);
    const bitmapOffset = bundleIndex % 8;
    return (account.positionBitmap[bitmapIndex] & (1 << bitmapOffset)) > 0;
  }

  function checkBitmapIsClosed(
    account: PositionBundleData,
    bundleIndex: number,
  ): boolean {
    if (bundleIndex < 0 || bundleIndex >= POSITION_BUNDLE_SIZE)
      throw Error("bundleIndex is out of bounds");

    const bitmapIndex = Math.floor(bundleIndex / 8);
    const bitmapOffset = bundleIndex % 8;
    return (account.positionBitmap[bitmapIndex] & (1 << bitmapOffset)) === 0;
  }

  function checkBitmap(
    account: PositionBundleData,
    openedBundleIndexes: number[],
  ) {
    for (let i = 0; i < POSITION_BUNDLE_SIZE; i++) {
      if (openedBundleIndexes.includes(i)) {
        assert.ok(checkBitmapIsOpened(account, i));
      } else {
        assert.ok(checkBitmapIsClosed(account, i));
      }
    }
  }

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
    const { bundledPositionPda } = positionInitInfo.params;

    const position = (await fetcher.getPosition(
      bundledPositionPda.publicKey,
    )) as PositionData;
    checkPositionAccountContents(
      position,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
    );

    const positionBundle = (await fetcher.getPositionBundle(
      positionBundleInfo.positionBundlePda.publicKey,
      IGNORE_CACHE,
    )) as PositionBundleData;
    checkBitmap(positionBundle, [bundleIndex]);
  });

  it("successfully opens bundled position when funder is different than account paying for transaction fee", async () => {
    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
    );

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

    const position = (await fetcher.getPosition(
      bundledPositionPda.publicKey,
    )) as PositionData;
    checkPositionAccountContents(
      position,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
    );

    const positionBundle = (await fetcher.getPositionBundle(
      positionBundleInfo.positionBundlePda.publicKey,
      IGNORE_CACHE,
    )) as PositionBundleData;
    checkBitmap(positionBundle, [bundleIndex]);
  });

  it("should reserve some rent for tick initialization", async () => {
    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
    );

    const positionInitInfo = await openBundledPosition(
      ctx,
      whirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      0,
      tickLowerIndex,
      tickUpperIndex,
      ctx.wallet.publicKey,
      funderKeypair,
    );

    const positionPda = positionInitInfo.params.bundledPositionPda.publicKey;
    const position = await ctx.connection.getAccountInfo(positionPda);
    assert.ok(position);
    const minRent = await ctx.connection.getMinimumBalanceForRentExemption(
      position.data.length,
    );
    assert.equal(position.lamports, minRent + TICK_RENT_AMOUNT * 2);
  });

  it("successfully opens multiple bundled position and verify bitmap", async () => {
    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
    );

    const bundleIndexes = [1, 7, 8, 64, 127, 128, 254, 255];
    for (const bundleIndex of bundleIndexes) {
      const positionInitInfo = await openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex,
      );
      const { bundledPositionPda } = positionInitInfo.params;

      const position = (await fetcher.getPosition(
        bundledPositionPda.publicKey,
      )) as PositionData;
      checkPositionAccountContents(
        position,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
      );
    }

    const positionBundle = (await fetcher.getPositionBundle(
      positionBundleInfo.positionBundlePda.publicKey,
      IGNORE_CACHE,
    )) as PositionBundleData;
    checkBitmap(positionBundle, bundleIndexes);
  });

  it("successfully opens bundled position for full-range only pool", async () => {
    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
    );

    const [lowerTickIndex, upperTickIndex] = TickUtil.getFullRangeTickIndex(
      TickSpacing.FullRangeOnly,
    );

    const bundleIndex = 0;
    const positionInitInfo = await openBundledPosition(
      ctx,
      fullRangeOnlyWhirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      lowerTickIndex,
      upperTickIndex,
    );
    const { bundledPositionPda } = positionInitInfo.params;

    const position = (await fetcher.getPosition(
      bundledPositionPda.publicKey,
    )) as PositionData;
    checkPositionAccountContents(
      position,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      fullRangeOnlyWhirlpoolPda.publicKey,
      lowerTickIndex,
      upperTickIndex,
    );

    const positionBundle = (await fetcher.getPositionBundle(
      positionBundleInfo.positionBundlePda.publicKey,
      IGNORE_CACHE,
    )) as PositionBundleData;
    checkBitmap(positionBundle, [bundleIndex]);
  });

  describe("invalid bundle index", () => {
    it("should be failed: invalid bundle index (< 0)", async () => {
      const positionBundleInfo = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );

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
        /It must be >= 0 and <= 65535/, // rejected by client
      );
    });

    it("should be failed: invalid bundle index (POSITION_BUNDLE_SIZE)", async () => {
      const positionBundleInfo = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );

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
        /0x179b/, // InvalidBundleIndex
      );
    });

    it("should be failed: invalid bundle index (u16 max)", async () => {
      const positionBundleInfo = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );

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
        /0x179b/, // InvalidBundleIndex
      );
    });
  });

  describe("invalid tick index", () => {
    async function assertTicksFail(lowerTick: number, upperTick: number) {
      const positionBundleInfo = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );
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
          funderKeypair,
        ),
        /0x177a/, // InvalidTickIndex
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
    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
    );

    const bundleIndex = 0;
    await openBundledPosition(
      ctx,
      whirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      tickLowerIndex,
      tickUpperIndex,
    );

    const positionBundle = (await fetcher.getPositionBundle(
      positionBundleInfo.positionBundlePda.publicKey,
      IGNORE_CACHE,
    )) as PositionBundleData;
    assert.ok(checkBitmapIsOpened(positionBundle, bundleIndex));

    await assert.rejects(
      openBundledPosition(
        ctx,
        whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex,
      ),
      (err) => {
        const errorString = err instanceof Error ? err.message : String(err);
        return errorString.includes("already in use");
      },
    );
  });

  describe("invalid input account", () => {
    it("should be failed: invalid bundled position", async () => {
      const positionBundleInfo = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );

      const tx = await createOpenBundledPositionTx(
        ctx,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        0,
        {
          // invalid parameter
          bundledPosition: PDAUtil.getBundledPosition(
            ctx.program.programId,
            positionBundleInfo.positionBundleMintKeypair.publicKey,
            1, // another bundle index
          ).publicKey,
        },
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d6/, // ConstraintSeeds
      );
    });

    it("should be failed: invalid position bundle", async () => {
      const positionBundleInfo = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );
      const otherPositionBundleInfo = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );

      const tx = await createOpenBundledPositionTx(
        ctx,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        0,
        {
          // invalid parameter
          positionBundle: otherPositionBundleInfo.positionBundlePda.publicKey,
        },
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d6/, // ConstraintSeeds
      );
    });

    it("should be failed: invalid ATA (amount is zero)", async () => {
      const positionBundleInfo = await initializePositionBundle(
        ctx,
        funderKeypair.publicKey,
        funderKeypair,
      );

      const ata = await createAssociatedTokenAccount(
        provider,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        ctx.wallet.publicKey,
        ctx.wallet.publicKey,
      );

      const tx = await createOpenBundledPositionTx(
        ctx,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        0,
        {
          // invalid parameter
          positionBundleTokenAccount: ata,
        },
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d3/, // ConstraintRaw (amount == 1)
      );
    });

    it("should be failed: invalid ATA (invalid mint)", async () => {
      const positionBundleInfo = await initializePositionBundle(
        ctx,
        funderKeypair.publicKey,
        funderKeypair,
      );
      const otherPositionBundleInfo = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );

      const tx = await createOpenBundledPositionTx(
        ctx,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        0,
        {
          // invalid parameter
          positionBundleTokenAccount:
            otherPositionBundleInfo.positionBundleTokenAccount,
        },
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d3/, // ConstraintRaw (mint == position_bundle.position_bundle_mint)
      );
    });

    it("should be failed: invalid position bundle authority", async () => {
      const positionBundleInfo = await initializePositionBundle(
        ctx,
        funderKeypair.publicKey,
        funderKeypair,
      );

      const tx = await createOpenBundledPositionTx(
        ctx,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        0,
        {
          positionBundleTokenAccount:
            positionBundleInfo.positionBundleTokenAccount,
          // invalid parameter
          positionBundleAuthority: ctx.wallet.publicKey,
        },
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x1783/, // MissingOrInvalidDelegate
      );
    });

    it("should be failed: invalid whirlpool", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

      const tx = await createOpenBundledPositionTx(
        ctx,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        0,
        {
          // invalid parameter
          whirlpool: positionBundleInfo.positionBundlePda.publicKey,
        },
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbba/, // AccountDiscriminatorMismatch
      );
    });

    it("should be failed: invalid system program", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

      const tx = await createOpenBundledPositionTx(
        ctx,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        0,
        {
          // invalid parameter
          systemProgram: TOKEN_PROGRAM_ID,
        },
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc0/, // InvalidProgramId
      );
    });

    it("should be failed: invalid rent", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

      const tx = await createOpenBundledPositionTx(
        ctx,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        0,
        {
          // invalid parameter
          rent: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        },
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc7/, // AccountSysvarMismatch
      );
    });
  });

  describe("authority delegation", () => {
    it("successfully opens bundled position with delegated authority", async () => {
      const positionBundleInfo = await initializePositionBundle(
        ctx,
        funderKeypair.publicKey,
        funderKeypair,
      );

      const tx = await createOpenBundledPositionTx(
        ctx,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        0,
        {
          positionBundleTokenAccount:
            positionBundleInfo.positionBundleTokenAccount,
          positionBundleAuthority: ctx.wallet.publicKey,
        },
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x1783/, // MissingOrInvalidDelegate
      );

      // delegate 1 token from funder to ctx.wallet
      await approveToken(
        provider,
        positionBundleInfo.positionBundleTokenAccount,
        ctx.wallet.publicKey,
        1,
        funderKeypair,
      );

      // Expire blockhash and rebuild transaction (litesvm requires fresh tx)
      expireBlockhash();
      const tx2 = await createOpenBundledPositionTx(
        ctx,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        0,
        {
          positionBundleTokenAccount:
            positionBundleInfo.positionBundleTokenAccount,
          positionBundleAuthority: ctx.wallet.publicKey,
        },
      );

      await tx2.buildAndExecute();
      const positionBundle = await fetcher.getPositionBundle(
        positionBundleInfo.positionBundlePda.publicKey,
        IGNORE_CACHE,
      );
      checkBitmapIsOpened(positionBundle!, 0);
    });

    it("successfully opens bundled position even if delegation exists", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);

      const tx = await createOpenBundledPositionTx(
        ctx,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        0,
        {
          positionBundleTokenAccount:
            positionBundleInfo.positionBundleTokenAccount,
          positionBundleAuthority: ctx.wallet.publicKey,
        },
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
      const positionBundle = await fetcher.getPositionBundle(
        positionBundleInfo.positionBundlePda.publicKey,
        IGNORE_CACHE,
      );
      checkBitmapIsOpened(positionBundle!, 0);
    });

    it("should be failed: delegated amount is zero", async () => {
      const positionBundleInfo = await initializePositionBundle(
        ctx,
        funderKeypair.publicKey,
        funderKeypair,
      );

      const tx = await createOpenBundledPositionTx(
        ctx,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        0,
        {
          positionBundleTokenAccount:
            positionBundleInfo.positionBundleTokenAccount,
          positionBundleAuthority: ctx.wallet.publicKey,
        },
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x1783/, // MissingOrInvalidDelegate
      );

      // delegate ZERO token from funder to ctx.wallet
      await approveToken(
        provider,
        positionBundleInfo.positionBundleTokenAccount,
        ctx.wallet.publicKey,
        0,
        funderKeypair,
      );

      // Expire blockhash and rebuild transaction (litesvm requires fresh tx)
      expireBlockhash();
      const tx2 = await createOpenBundledPositionTx(
        ctx,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        0,
        {
          positionBundleTokenAccount:
            positionBundleInfo.positionBundleTokenAccount,
          positionBundleAuthority: ctx.wallet.publicKey,
        },
      );

      await assert.rejects(
        tx2.buildAndExecute(),
        /0x1784/, // InvalidPositionTokenAmount
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
        1,
      );

      const tokenInfo = await fetcher.getTokenInfo(funderATA, IGNORE_CACHE);
      assert.ok(tokenInfo?.amount === 1n);

      const tx = toTx(
        ctx,
        WhirlpoolIx.openBundledPositionIx(ctx.program, {
          bundledPositionPda: PDAUtil.getBundledPosition(
            ctx.program.programId,
            positionBundleInfo.positionBundleMintKeypair.publicKey,
            0,
          ),
          bundleIndex: 0,
          funder: funderKeypair.publicKey,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleAuthority: funderKeypair.publicKey,
          positionBundleTokenAccount: funderATA,
          tickLowerIndex,
          tickUpperIndex,
          whirlpool: whirlpoolPda.publicKey,
        }),
      );
      tx.addSigner(funderKeypair);

      await tx.buildAndExecute();
      const positionBundle = await fetcher.getPositionBundle(
        positionBundleInfo.positionBundlePda.publicKey,
        IGNORE_CACHE,
      );
      checkBitmapIsOpened(positionBundle!, 0);
    });
  });

  it("fail when opening a non-full range position in an full-range only pool", async () => {
    const [fullRangeTickLowerIndex, fullRangeTickUpperIndex] =
      TickUtil.getFullRangeTickIndex(fullRangeOnlyPoolInitInfo.tickSpacing);

    assert.notEqual(fullRangeTickLowerIndex, tickLowerIndex);
    assert.notEqual(fullRangeTickUpperIndex, tickUpperIndex);

    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
    );
    const bundleIndex = 0;
    await assert.rejects(
      openBundledPosition(
        ctx,
        fullRangeOnlyWhirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
        tickLowerIndex,
        tickUpperIndex,
      ),
      /0x17a6/, // FullRangeOnlyPool
    );
  });

  describe("one-sided (sentinel) open bundled position", () => {
    it("snaps correctly when current price is exactly on an initializable tick (bundled)", async () => {
      // Initialize a fresh pool where sqrt price is exactly on tick 0
      const onTickSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(0);
      const { poolInitInfo: onTickPool } = await initTestPool(
        ctx,
        TickSpacing.Standard,
        onTickSqrtPrice,
      );

      const whirlpool = await fetcher.getPool(
        onTickPool.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );
      if (!whirlpool) throw new Error("whirlpool not found");
      const spacing = whirlpool.tickSpacing;
      const curr = whirlpool.tickCurrentIndex;
      // When on-tick, ceil(current) === current and floor(current) === current
      const expectedLower = snapTickUp(curr, spacing);
      const expectedUpper = snapTickDown(curr, spacing);

      const positionBundleInfo = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );
      const bundleIndex = 0;

      // Lower sentinel case: expect lower snapped to ceil(current)
      {
        const upper = expectedLower + spacing;
        const positionInitInfo = await openBundledPosition(
          ctx,
          onTickPool.whirlpoolPda.publicKey,
          positionBundleInfo.positionBundleMintKeypair.publicKey,
          bundleIndex,
          SENTINEL_MIN,
          upper,
        );
        const { bundledPositionPda } = positionInitInfo.params;
        const position = (await fetcher.getPosition(
          bundledPositionPda.publicKey,
          IGNORE_CACHE,
        )) as PositionData;
        checkPositionAccountContents(
          position,
          positionBundleInfo.positionBundleMintKeypair.publicKey,
          onTickPool.whirlpoolPda.publicKey,
          expectedLower,
          upper,
        );
      }

      // Upper sentinel case: expect upper snapped to floor(current)
      {
        const lower = expectedUpper - spacing;
        const positionInitInfo = await openBundledPosition(
          ctx,
          onTickPool.whirlpoolPda.publicKey,
          positionBundleInfo.positionBundleMintKeypair.publicKey,
          bundleIndex + 1,
          lower,
          SENTINEL_MAX,
        );
        const { bundledPositionPda } = positionInitInfo.params;
        const position = (await fetcher.getPosition(
          bundledPositionPda.publicKey,
          IGNORE_CACHE,
        )) as PositionData;
        checkPositionAccountContents(
          position,
          positionBundleInfo.positionBundleMintKeypair.publicKey,
          onTickPool.whirlpoolPda.publicKey,
          lower,
          expectedUpper,
        );
      }
    });

    it("snaps lower to ceil(current) when lower sentinel is used (bundled)", async () => {
      const whirlpool = await fetcher.getPool(whirlpoolPda.publicKey);
      if (!whirlpool) throw new Error("whirlpool not found");
      const spacing = whirlpool.tickSpacing;
      const curr = whirlpool.tickCurrentIndex;
      const expectedLower = snapTickUp(curr, spacing);
      const upper = expectedLower + spacing;

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
        SENTINEL_MIN,
        upper,
      );
      const { bundledPositionPda } = positionInitInfo.params;
      const position = (await fetcher.getPosition(
        bundledPositionPda.publicKey,
      )) as PositionData;
      checkPositionAccountContents(
        position,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        poolInitInfo.whirlpoolPda.publicKey,
        expectedLower,
        upper,
      );
    });

    it("snaps upper to floor(current) when upper sentinel is used (bundled)", async () => {
      const whirlpool = await fetcher.getPool(whirlpoolPda.publicKey);
      if (!whirlpool) throw new Error("whirlpool not found");
      const spacing = whirlpool.tickSpacing;
      const curr = whirlpool.tickCurrentIndex;
      const expectedUpper = snapTickDown(curr, spacing);
      const lower = expectedUpper - spacing;

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
        lower,
        SENTINEL_MAX,
      );
      const { bundledPositionPda } = positionInitInfo.params;
      const position = (await fetcher.getPosition(
        bundledPositionPda.publicKey,
      )) as PositionData;
      checkPositionAccountContents(
        position,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        poolInitInfo.whirlpoolPda.publicKey,
        lower,
        expectedUpper,
      );
    });

    it("fails if both sentinels are used (bundled)", async () => {
      const positionBundleInfo = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );
      const bundleIndex = 0;
      await assert.rejects(
        openBundledPosition(
          ctx,
          whirlpoolPda.publicKey,
          positionBundleInfo.positionBundleMintKeypair.publicKey,
          bundleIndex,
          SENTINEL_MIN,
          SENTINEL_MAX,
        ),
        /0x177a/, // InvalidTickIndex
      );
    });

    it("fails if snapped range collapses (lower >= upper) (bundled)", async () => {
      const whirlpool = await fetcher.getPool(whirlpoolPda.publicKey);
      if (!whirlpool) throw new Error("whirlpool not found");
      const spacing = whirlpool.tickSpacing;
      const curr = whirlpool.tickCurrentIndex;
      const expectedLower = snapTickUp(curr, spacing);
      const upperEqualsLower = expectedLower;

      const positionBundleInfo = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );
      const bundleIndex = 0;
      await assert.rejects(
        openBundledPosition(
          ctx,
          whirlpoolPda.publicKey,
          positionBundleInfo.positionBundleMintKeypair.publicKey,
          bundleIndex,
          SENTINEL_MIN,
          upperEqualsLower,
        ),
        /0x177a/, // InvalidTickIndex
      );
    });
  });
});
