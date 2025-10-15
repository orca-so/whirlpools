import * as anchor from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import { TransactionBuilder, U64_MAX } from "@orca-so/common-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import BN from "bn.js";
import type { WhirlpoolData } from "../../../src";
import { PDAUtil, TICK_ARRAY_SIZE, WhirlpoolIx, toTx } from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { ZERO_BN } from "../../utils";
import {
  startLiteSVM,
  createLiteSVMProvider,
  resetLiteSVM,
} from "../../utils/litesvm";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import { initializePositionBundle } from "../../utils/init-utils";

type PositionBundleFixture = Awaited<
  ReturnType<typeof initializePositionBundle>
>;

describe("dynamic tick array multi ix tests (litesvm)", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let ctx: WhirlpoolContext;

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
  });

  async function buildTestFixture(tickSpacing: number) {
    // create test pool
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [],
      rewards: [],
    });

    const whirlpool = fixture.getInfos().poolInitInfo.whirlpoolPda.publicKey;

    const ticksInArray = tickSpacing * TICK_ARRAY_SIZE;
    const startTickNeg = -ticksInArray;
    const startTickPos = 0;
    const tickArrayPdaNeg = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpool,
      startTickNeg,
    );
    const tickArrayPdaPos = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpool,
      startTickPos,
    );

    // initialize 2 dynamic tickarrays around tick index 0
    await toTx(
      ctx,
      WhirlpoolIx.initDynamicTickArrayIx(ctx.program, {
        whirlpool,
        tickArrayPda: tickArrayPdaNeg,
        startTick: startTickNeg,
        funder: ctx.wallet.publicKey,
      }),
    ).buildAndExecute();
    await toTx(
      ctx,
      WhirlpoolIx.initDynamicTickArrayIx(ctx.program, {
        whirlpool,
        tickArrayPda: tickArrayPdaPos,
        startTick: startTickPos,
        funder: ctx.wallet.publicKey,
      }),
    ).buildAndExecute();

    const positionBundle = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
    );

    return {
      whirlpool,
      startTickNeg,
      startTickPos,
      tickArrayNeg: tickArrayPdaNeg.publicKey,
      tickArrayPos: tickArrayPdaPos.publicKey,
      positionBundle,
    };
  }

  function openBundledPosition(params: {
    positionBundle: PositionBundleFixture;
    bundleIndex: number;
    whirlpool: PublicKey;
    tickLowerIndex: number;
    tickUpperIndex: number;
  }): Instruction {
    const {
      positionBundle,
      bundleIndex,
      whirlpool,
      tickLowerIndex,
      tickUpperIndex,
    } = params;

    const bundledPositionPda = PDAUtil.getBundledPosition(
      ctx.program.programId,
      positionBundle.positionBundleMintKeypair.publicKey,
      bundleIndex,
    );
    return WhirlpoolIx.openBundledPositionIx(ctx.program, {
      positionBundle: positionBundle.positionBundlePda.publicKey,
      bundleIndex,
      bundledPositionPda,
      positionBundleAuthority: ctx.wallet.publicKey,
      positionBundleTokenAccount: positionBundle.positionBundleTokenAccount,
      whirlpool,
      tickLowerIndex,
      tickUpperIndex,
      funder: ctx.wallet.publicKey,
    });
  }
  function increaseLiquidity(params: {
    positionBundle: PositionBundleFixture;
    bundleIndex: number;
    whirlpool: PublicKey;
    whirlpoolData: WhirlpoolData;
    tickArrayLower: PublicKey;
    tickArrayUpper: PublicKey;
    liquidity: BN;
  }): Instruction {
    const {
      positionBundle,
      bundleIndex,
      whirlpool,
      whirlpoolData,
      tickArrayLower,
      tickArrayUpper,
      liquidity,
    } = params;
    const wallet = ctx.wallet.publicKey;
    const bundledPositionPda = PDAUtil.getBundledPosition(
      ctx.program.programId,
      positionBundle.positionBundleMintKeypair.publicKey,
      bundleIndex,
    );
    return WhirlpoolIx.increaseLiquidityIx(ctx.program, {
      position: bundledPositionPda.publicKey,
      positionAuthority: wallet,
      positionTokenAccount: positionBundle.positionBundleTokenAccount,
      tickArrayLower,
      tickArrayUpper,
      tokenMaxA: U64_MAX,
      tokenMaxB: U64_MAX,
      whirlpool,
      liquidityAmount: liquidity,
      tokenOwnerAccountA: getAssociatedTokenAddressSync(
        whirlpoolData.tokenMintA,
        wallet,
      ),
      tokenOwnerAccountB: getAssociatedTokenAddressSync(
        whirlpoolData.tokenMintB,
        wallet,
      ),
      tokenVaultA: whirlpoolData.tokenVaultA,
      tokenVaultB: whirlpoolData.tokenVaultB,
    });
  }
  function decreaseLiquidity(params: {
    positionBundle: PositionBundleFixture;
    bundleIndex: number;
    whirlpool: PublicKey;
    whirlpoolData: WhirlpoolData;
    tickArrayLower: PublicKey;
    tickArrayUpper: PublicKey;
    liquidity: BN;
  }): Instruction {
    const {
      positionBundle,
      bundleIndex,
      whirlpool,
      whirlpoolData,
      tickArrayLower,
      tickArrayUpper,
      liquidity,
    } = params;
    const wallet = ctx.wallet.publicKey;
    const bundledPositionPda = PDAUtil.getBundledPosition(
      ctx.program.programId,
      positionBundle.positionBundleMintKeypair.publicKey,
      bundleIndex,
    );
    return WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
      position: bundledPositionPda.publicKey,
      positionAuthority: wallet,
      positionTokenAccount: positionBundle.positionBundleTokenAccount,
      tickArrayLower,
      tickArrayUpper,
      tokenMinA: ZERO_BN,
      tokenMinB: ZERO_BN,
      whirlpool,
      liquidityAmount: liquidity,
      tokenOwnerAccountA: getAssociatedTokenAddressSync(
        whirlpoolData.tokenMintA,
        wallet,
      ),
      tokenOwnerAccountB: getAssociatedTokenAddressSync(
        whirlpoolData.tokenMintB,
        wallet,
      ),
      tokenVaultA: whirlpoolData.tokenVaultA,
      tokenVaultB: whirlpoolData.tokenVaultB,
    });
  }
  function closeBundledPosition(params: {
    positionBundle: PositionBundleFixture;
    bundleIndex: number;
    receiver?: PublicKey;
  }): Instruction {
    const { positionBundle, bundleIndex, receiver } = params;

    const bundledPositionPda = PDAUtil.getBundledPosition(
      ctx.program.programId,
      positionBundle.positionBundleMintKeypair.publicKey,
      bundleIndex,
    );
    return WhirlpoolIx.closeBundledPositionIx(ctx.program, {
      positionBundle: positionBundle.positionBundlePda.publicKey,
      bundleIndex,
      bundledPosition: bundledPositionPda.publicKey,
      positionBundleAuthority: ctx.wallet.publicKey,
      positionBundleTokenAccount: positionBundle.positionBundleTokenAccount,
      receiver: receiver ?? ctx.wallet.publicKey,
    });
  }

  async function executeIxs(instructions: Instruction[]) {
    const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
    for (const ix of instructions) {
      builder.addInstruction(ix);
    }
    return builder.buildAndExecute();
  }

  function expectedDynamicTickArrayAccountSize(initialized: number) {
    const uninitialized = TICK_ARRAY_SIZE - initialized;
    return 8 + 4 + 32 + 16 + initialized * (1 + 112) + uninitialized * 1; // DISC, start tick index, whirlpool, tick bitmap, ticks
  }

  async function verifyAccountSize(address: PublicKey, expectedSize: number) {
    const accountInfo = await ctx.connection.getAccountInfo(address);
    assert.ok(accountInfo);
    assert.equal(accountInfo.data.length, expectedSize);
  }

  async function verifyDynamicTickArrayAccountSize(
    address: PublicKey,
    initialized: number,
  ) {
    const expectedSize = expectedDynamicTickArrayAccountSize(initialized);
    await verifyAccountSize(address, expectedSize);
  }

  async function verifyRentExempt(address: PublicKey) {
    const accountInfo = await ctx.connection.getAccountInfo(address);
    assert.ok(accountInfo);
    assert.ok(
      accountInfo.lamports >=
        (await ctx.connection.getMinimumBalanceForRentExemption(
          accountInfo.data.length,
        )),
    );
  }

  async function getRent(address: PublicKey): Promise<number> {
    const accountInfo = await ctx.connection.getAccountInfo(address);
    assert.ok(accountInfo);
    return accountInfo.lamports;
  }

  async function getTickBitmap(address: PublicKey): Promise<boolean[]> {
    const accountInfo = await ctx.connection.getAccountInfo(address);
    assert.ok(accountInfo);
    const start = 8 + 32 + 4;
    const bitmap = new BN(accountInfo.data.slice(start, start + 16), "le");
    const bits: boolean[] = [];
    for (let i = 0; i < TICK_ARRAY_SIZE; i++) {
      bits.push(bitmap.testn(i));
    }
    return bits;
  }

  async function verifyTickBitmap(
    address: PublicKey,
    shouldBeInitializedIf: (offset: number) => boolean,
  ) {
    const bitmap = await getTickBitmap(address);
    for (let i = 0; i < TICK_ARRAY_SIZE; i++) {
      assert.ok(bitmap[i] === shouldBeInitializedIf(i));
    }
  }

  describe("multiple transactions (litesvm)", () => {
    describe("initialize all ticks then uninitialize them (two DynamicTickArray) (litesvm)", () => {
      async function test(
        tickSpacing: number,
        initializeOrder: number[],
        uninitializeOrder: number[],
      ) {
        const {
          positionBundle,
          whirlpool,
          tickArrayNeg,
          tickArrayPos,
          startTickNeg,
          startTickPos,
        } = await buildTestFixture(tickSpacing);
        const whirlpoolData = (await ctx.fetcher.getPool(
          whirlpool,
          IGNORE_CACHE,
        )) as WhirlpoolData;

        const sharedParams = {
          positionBundle,
          whirlpool,
          whirlpoolData,
          tickArrayLower: tickArrayNeg,
          tickArrayUpper: tickArrayPos,
        };

        const preTickArrayNegData = await ctx.fetcher.getTickArray(
          tickArrayNeg,
          IGNORE_CACHE,
        );
        const preTickArrayPosData = await ctx.fetcher.getTickArray(
          tickArrayPos,
          IGNORE_CACHE,
        );

        assert.ok(preTickArrayNegData);
        assert.ok(preTickArrayNegData.startTickIndex == startTickNeg);
        assert.ok(preTickArrayNegData.whirlpool.equals(whirlpool));
        assert.ok(preTickArrayNegData.ticks.every((tick) => !tick.initialized));
        assert.ok(preTickArrayPosData);
        assert.ok(preTickArrayPosData.startTickIndex == startTickPos);
        assert.ok(preTickArrayPosData.whirlpool.equals(whirlpool));
        assert.ok(preTickArrayPosData.ticks.every((tick) => !tick.initialized));

        await verifyDynamicTickArrayAccountSize(tickArrayNeg, 0);
        await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
        await verifyRentExempt(tickArrayNeg);
        await verifyRentExempt(tickArrayPos);
        await verifyTickBitmap(tickArrayNeg, () => false);
        await verifyTickBitmap(tickArrayPos, () => false);

        const initialRentNeg = await getRent(tickArrayNeg);
        const initialRentPos = await getRent(tickArrayPos);

        // initialize all ticks
        let initialized = 0;
        for (const offset of initializeOrder) {
          const tickLowerIndex = startTickNeg + tickSpacing * offset;
          const tickUpperIndex = startTickPos + tickSpacing * offset;
          const liquidity = new BN(1000 + offset);
          await executeIxs([
            openBundledPosition({
              ...sharedParams,
              bundleIndex: offset,
              tickLowerIndex,
              tickUpperIndex,
            }),
            increaseLiquidity({
              ...sharedParams,
              bundleIndex: offset,
              liquidity,
            }),
          ]);
          initialized += 1;
          await verifyDynamicTickArrayAccountSize(tickArrayNeg, initialized);
          await verifyDynamicTickArrayAccountSize(tickArrayPos, initialized);
          await verifyRentExempt(tickArrayNeg);
          await verifyRentExempt(tickArrayPos);
          await verifyTickBitmap(tickArrayNeg, (offset) =>
            initializeOrder.slice(0, initialized).includes(offset),
          );
          await verifyTickBitmap(tickArrayPos, (offset) =>
            initializeOrder.slice(0, initialized).includes(offset),
          );
        }

        const initializedTickArrayNegData = await ctx.fetcher.getTickArray(
          tickArrayNeg,
          IGNORE_CACHE,
        );
        const initializedTickArrayPosData = await ctx.fetcher.getTickArray(
          tickArrayPos,
          IGNORE_CACHE,
        );
        assert.ok(initializedTickArrayNegData);
        assert.ok(initializedTickArrayNegData.startTickIndex == startTickNeg);
        assert.ok(initializedTickArrayNegData.whirlpool.equals(whirlpool));
        assert.ok(
          initializedTickArrayNegData.ticks.every(
            (tick, offset) =>
              tick.initialized && tick.liquidityNet.eq(new BN(1000 + offset)),
          ),
        );
        assert.ok(initializedTickArrayPosData);
        assert.ok(initializedTickArrayPosData.startTickIndex == startTickPos);
        assert.ok(initializedTickArrayPosData.whirlpool.equals(whirlpool));
        assert.ok(
          initializedTickArrayPosData.ticks.every(
            (tick, offset) =>
              tick.initialized &&
              tick.liquidityNet.eq(new BN(1000 + offset).neg()),
          ),
        );

        await verifyTickBitmap(tickArrayNeg, () => true);
        await verifyTickBitmap(tickArrayPos, () => true);

        // uninitialize all ticks
        let uninitialized = 0;
        for (const offset of uninitializeOrder) {
          await executeIxs([
            decreaseLiquidity({
              ...sharedParams,
              bundleIndex: offset,
              liquidity: new BN(1000 + offset),
            }),
            closeBundledPosition({ ...sharedParams, bundleIndex: offset }),
          ]);
          uninitialized += 1;
          await verifyDynamicTickArrayAccountSize(
            tickArrayNeg,
            TICK_ARRAY_SIZE - uninitialized,
          );
          await verifyDynamicTickArrayAccountSize(
            tickArrayPos,
            TICK_ARRAY_SIZE - uninitialized,
          );
          await verifyRentExempt(tickArrayNeg);
          await verifyRentExempt(tickArrayPos);
          await verifyTickBitmap(
            tickArrayNeg,
            (offset) =>
              !uninitializeOrder.slice(0, uninitialized).includes(offset),
          );
          await verifyTickBitmap(
            tickArrayPos,
            (offset) =>
              !uninitializeOrder.slice(0, uninitialized).includes(offset),
          );
        }

        const uninitializedTickArrayNegData = await ctx.fetcher.getTickArray(
          tickArrayNeg,
          IGNORE_CACHE,
        );
        const uninitializedTickArrayPosData = await ctx.fetcher.getTickArray(
          tickArrayPos,
          IGNORE_CACHE,
        );
        assert.ok(uninitializedTickArrayNegData);
        assert.ok(uninitializedTickArrayNegData.startTickIndex == startTickNeg);
        assert.ok(uninitializedTickArrayNegData.whirlpool.equals(whirlpool));
        assert.ok(
          uninitializedTickArrayNegData.ticks.every(
            (tick) => !tick.initialized,
          ),
        );
        assert.ok(uninitializedTickArrayPosData);
        assert.ok(uninitializedTickArrayPosData.startTickIndex == startTickPos);
        assert.ok(uninitializedTickArrayPosData.whirlpool.equals(whirlpool));
        assert.ok(
          uninitializedTickArrayPosData.ticks.every(
            (tick) => !tick.initialized,
          ),
        );

        await verifyDynamicTickArrayAccountSize(tickArrayNeg, 0);
        await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
        await verifyRentExempt(tickArrayNeg);
        await verifyRentExempt(tickArrayPos);
        await verifyTickBitmap(tickArrayNeg, () => false);
        await verifyTickBitmap(tickArrayPos, () => false);

        const lastRentNeg = await getRent(tickArrayNeg);
        const lastRentPos = await getRent(tickArrayPos);
        assert.ok(lastRentNeg == initialRentNeg);
        assert.ok(lastRentPos == initialRentPos);
      }

      const ASC = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
        20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37,
        38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55,
        56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73,
        74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87,
      ];
      const DESC = [
        87, 86, 85, 84, 83, 82, 81, 80, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70,
        69, 68, 67, 66, 65, 64, 63, 62, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52,
        51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34,
        33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16,
        15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
      ];
      const PINGPONG = [
        0, 87, 1, 86, 2, 85, 3, 84, 4, 83, 5, 82, 6, 81, 7, 80, 8, 79, 9, 78,
        10, 77, 11, 76, 12, 75, 13, 74, 14, 73, 15, 72, 16, 71, 17, 70, 18, 69,
        19, 68, 20, 67, 21, 66, 22, 65, 23, 64, 24, 63, 25, 62, 26, 61, 27, 60,
        28, 59, 29, 58, 30, 57, 31, 56, 32, 55, 33, 54, 34, 53, 35, 52, 36, 51,
        37, 50, 38, 49, 39, 48, 40, 47, 41, 46, 42, 45, 43, 44,
      ];
      const PONGPING = [
        44, 43, 45, 42, 46, 41, 47, 40, 48, 39, 49, 38, 50, 37, 51, 36, 52, 35,
        53, 34, 54, 33, 55, 32, 56, 31, 57, 30, 58, 29, 59, 28, 60, 27, 61, 26,
        62, 25, 63, 24, 64, 23, 65, 22, 66, 21, 67, 20, 68, 19, 69, 18, 70, 17,
        71, 16, 72, 15, 73, 14, 74, 13, 75, 12, 76, 11, 77, 10, 78, 9, 79, 8,
        80, 7, 81, 6, 82, 5, 83, 4, 84, 3, 85, 2, 86, 1, 87, 0,
      ];

      it("initialize: ASC, uninitialize: ASC", async () => {
        await test(64, ASC, ASC);
      });
      it("initialize: ASC, uninitialize: DESC", async () => {
        await test(64, ASC, DESC);
      });
      it("initialize: DESC, uninitialize: DESC", async () => {
        await test(64, DESC, DESC);
      });
      it("initialize: DESC, uninitialize: ASC", async () => {
        await test(64, DESC, ASC);
      });
      it("initialize: PINGPONG, uninitialize: PINGPONG", async () => {
        await test(64, PINGPONG, PINGPONG);
      });
      it("initialize: PINGPONG, uninitialize: PONGPING", async () => {
        await test(64, PINGPONG, PONGPING);
      });
      it("initialize: PONGPING, uninitialize: PONGPING", async () => {
        await test(64, PONGPING, PONGPING);
      });
      it("initialize: PONGPING, uninitialize: PINGPONG", async () => {
        await test(64, PONGPING, PINGPONG);
      });
      it("initialize: random, uninitialize: random", async () => {
        const randomOrder1 = [...Array(88).keys()].sort(
          () => Math.random() - 0.5,
        );
        const randomOrder2 = [...Array(88).keys()].sort(
          () => Math.random() - 0.5,
        );
        await test(64, randomOrder1, randomOrder2);
      });
    });

    it("initialize all ticks then uninitialize them (one DynamicTickArray)", async () => {
      // Reset LiteSVM to avoid SOL depletion from previous heavy tests
      resetLiteSVM();
      await startLiteSVM();
      provider = await createLiteSVMProvider();
      const programId = new anchor.web3.PublicKey(
        "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
      );
      const idl = require("../../../src/artifacts/whirlpool.json");
      program = new anchor.Program(idl, programId, provider);
      anchor.setProvider(provider);
      ctx = WhirlpoolContext.fromWorkspace(provider, program);

      const tickSpacing = 64;

      const { positionBundle, whirlpool, tickArrayPos, startTickPos } =
        await buildTestFixture(tickSpacing);
      const whirlpoolData = (await ctx.fetcher.getPool(
        whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      const sharedParams = {
        positionBundle,
        whirlpool,
        whirlpoolData,
        tickArrayLower: tickArrayPos,
        tickArrayUpper: tickArrayPos,
      };

      const preTickArrayPosData = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );

      assert.ok(preTickArrayPosData);
      assert.ok(preTickArrayPosData.startTickIndex == startTickPos);
      assert.ok(preTickArrayPosData.whirlpool.equals(whirlpool));
      assert.ok(preTickArrayPosData.ticks.every((tick) => !tick.initialized));

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, () => false);

      const initialRentPos = await getRent(tickArrayPos);

      // initialize all ticks
      let initialized = 0;
      assert.ok(TICK_ARRAY_SIZE % 2 === 0);
      for (
        let offsetLower = 0;
        offsetLower < TICK_ARRAY_SIZE / 2;
        offsetLower++
      ) {
        const offsetUpper = TICK_ARRAY_SIZE / 2 + offsetLower;
        const tickLowerIndex = startTickPos + tickSpacing * offsetLower;
        const tickUpperIndex = startTickPos + tickSpacing * offsetUpper;
        const liquidity = new BN(1000 + offsetLower);
        await executeIxs([
          openBundledPosition({
            ...sharedParams,
            bundleIndex: offsetLower,
            tickLowerIndex,
            tickUpperIndex,
          }),
          increaseLiquidity({
            ...sharedParams,
            bundleIndex: offsetLower,
            liquidity,
          }),
        ]);
        initialized += 2;
        await verifyDynamicTickArrayAccountSize(tickArrayPos, initialized);
        await verifyRentExempt(tickArrayPos);
      }

      const initializedTickArrayPosData = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(initializedTickArrayPosData);
      assert.ok(initializedTickArrayPosData.startTickIndex == startTickPos);
      assert.ok(initializedTickArrayPosData.whirlpool.equals(whirlpool));
      assert.ok(
        initializedTickArrayPosData.ticks
          .slice(0, TICK_ARRAY_SIZE / 2)
          .every(
            (tick, offset) =>
              tick.initialized && tick.liquidityNet.eq(new BN(1000 + offset)),
          ),
      );
      assert.ok(
        initializedTickArrayPosData.ticks
          .slice(TICK_ARRAY_SIZE / 2)
          .every(
            (tick, offset) =>
              tick.initialized &&
              tick.liquidityNet.eq(new BN(1000 + offset).neg()),
          ),
      );

      await verifyTickBitmap(tickArrayPos, () => true);

      // uninitialize all ticks
      let uninitialized = 0;
      for (
        let offsetLower = 0;
        offsetLower < TICK_ARRAY_SIZE / 2;
        offsetLower++
      ) {
        await executeIxs([
          decreaseLiquidity({
            ...sharedParams,
            bundleIndex: offsetLower,
            liquidity: new BN(1000 + offsetLower),
          }),
          closeBundledPosition({ ...sharedParams, bundleIndex: offsetLower }),
        ]);
        uninitialized += 2;
        await verifyDynamicTickArrayAccountSize(
          tickArrayPos,
          TICK_ARRAY_SIZE - uninitialized,
        );
        await verifyRentExempt(tickArrayPos);
      }

      const uninitializedTickArrayPosData = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(uninitializedTickArrayPosData);
      assert.ok(uninitializedTickArrayPosData.startTickIndex == startTickPos);
      assert.ok(uninitializedTickArrayPosData.whirlpool.equals(whirlpool));
      assert.ok(
        uninitializedTickArrayPosData.ticks.every((tick) => !tick.initialized),
      );

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, () => false);

      const lastRentPos = await getRent(tickArrayPos);
      assert.ok(lastRentPos == initialRentPos);
    });

    it("open multiple positions on the same ticks", async () => {
      // Reset LiteSVM to avoid SOL depletion from previous heavy tests
      resetLiteSVM();
      await startLiteSVM();
      provider = await createLiteSVMProvider();
      const programId = new anchor.web3.PublicKey(
        "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
      );
      const idl = require("../../../src/artifacts/whirlpool.json");
      program = new anchor.Program(idl, programId, provider);
      anchor.setProvider(provider);
      ctx = WhirlpoolContext.fromWorkspace(provider, program);

      const tickSpacing = 64;

      const { positionBundle, whirlpool, tickArrayPos, startTickPos } =
        await buildTestFixture(tickSpacing);
      const whirlpoolData = (await ctx.fetcher.getPool(
        whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      const sharedParams = {
        positionBundle,
        whirlpool,
        whirlpoolData,
        tickArrayLower: tickArrayPos,
        tickArrayUpper: tickArrayPos,
      };

      const preTickArrayPosData = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );

      assert.ok(preTickArrayPosData);
      assert.ok(preTickArrayPosData.ticks.every((tick) => !tick.initialized));

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);

      const tickLowerIndex = startTickPos + tickSpacing * 0;
      const tickUpperIndex = startTickPos + tickSpacing * 1;
      const liquidity = new BN(1000);

      // initialize 2 ticks
      await executeIxs([
        openBundledPosition({
          ...sharedParams,
          bundleIndex: 0,
          tickLowerIndex,
          tickUpperIndex,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
      ]);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 2);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, (offset) => offset < 2);

      const initialRentPos = await getRent(tickArrayPos);

      // add more positions on the same ticks
      let positions = 1;
      for (let bundleIndex = 1; bundleIndex <= 10; bundleIndex++) {
        await executeIxs([
          openBundledPosition({
            ...sharedParams,
            bundleIndex,
            tickLowerIndex,
            tickUpperIndex,
          }),
          increaseLiquidity({ ...sharedParams, bundleIndex, liquidity }),
        ]);
        positions += 1;

        await verifyDynamicTickArrayAccountSize(tickArrayPos, 2);
        await verifyRentExempt(tickArrayPos);
        await verifyTickBitmap(tickArrayPos, (offset) => offset < 2);

        const totalLiquidity = new BN(1000).muln(positions);

        const initializedTickArrayPosData = await ctx.fetcher.getTickArray(
          tickArrayPos,
          IGNORE_CACHE,
        );
        assert.ok(initializedTickArrayPosData);
        assert.ok(
          initializedTickArrayPosData.ticks[0].initialized &&
            initializedTickArrayPosData.ticks[0].liquidityNet.eq(
              totalLiquidity,
            ),
        );
        assert.ok(
          initializedTickArrayPosData.ticks[1].initialized &&
            initializedTickArrayPosData.ticks[1].liquidityNet.eq(
              totalLiquidity.neg(),
            ),
        );
      }

      // remove added positions
      for (let bundleIndex = 1; bundleIndex <= 10; bundleIndex++) {
        await executeIxs([
          decreaseLiquidity({ ...sharedParams, bundleIndex, liquidity }),
          closeBundledPosition({ ...sharedParams, bundleIndex }),
        ]);
        positions -= 1;

        await verifyDynamicTickArrayAccountSize(tickArrayPos, 2);
        await verifyRentExempt(tickArrayPos);
        await verifyTickBitmap(tickArrayPos, (offset) => offset < 2);

        const totalLiquidity = new BN(1000).muln(positions);

        const initializedTickArrayPosData = await ctx.fetcher.getTickArray(
          tickArrayPos,
          IGNORE_CACHE,
        );
        assert.ok(initializedTickArrayPosData);
        assert.ok(
          initializedTickArrayPosData.ticks[0].initialized &&
            initializedTickArrayPosData.ticks[0].liquidityNet.eq(
              totalLiquidity,
            ),
        );
        assert.ok(
          initializedTickArrayPosData.ticks[1].initialized &&
            initializedTickArrayPosData.ticks[1].liquidityNet.eq(
              totalLiquidity.neg(),
            ),
        );
      }

      assert.ok(positions === 1);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 2);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, (offset) => offset < 2);

      const lastRentPos = await getRent(tickArrayPos);
      assert.ok(lastRentPos == initialRentPos);
    });
  });

  describe("single transaction (atomic execution) (litesvm)", () => {
    beforeEach(async () => {
      // Reset LiteSVM before each test to avoid SOL depletion
      resetLiteSVM();
      await startLiteSVM();
      provider = await createLiteSVMProvider();
      const programId = new anchor.web3.PublicKey(
        "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
      );
      const idl = require("../../../src/artifacts/whirlpool.json");
      program = new anchor.Program(idl, programId, provider);
      anchor.setProvider(provider);
      ctx = WhirlpoolContext.fromWorkspace(provider, program);
    });

    it("1st tx: open 6 positions, 2nd tx: close 6 positions (different ticks)", async () => {
      const tickSpacing = 64;
      const numPosition = 6;

      const { positionBundle, whirlpool, tickArrayPos, startTickPos } =
        await buildTestFixture(tickSpacing);
      const whirlpoolData = (await ctx.fetcher.getPool(
        whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      const sharedParams = {
        positionBundle,
        whirlpool,
        whirlpoolData,
        tickArrayLower: tickArrayPos,
        tickArrayUpper: tickArrayPos,
      };

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);

      const liquidity = new BN(1000);

      const openIxs = [];
      for (let offset = 0; offset < numPosition; offset++) {
        const tickLowerIndex = startTickPos + tickSpacing * (2 * offset);
        const tickUpperIndex = startTickPos + tickSpacing * (2 * offset + 1);
        openIxs.push(
          openBundledPosition({
            ...sharedParams,
            bundleIndex: offset,
            tickLowerIndex,
            tickUpperIndex,
          }),
        );
        openIxs.push(
          increaseLiquidity({
            ...sharedParams,
            bundleIndex: offset,
            liquidity: liquidity.addn(offset),
          }),
        );
      }

      await executeIxs(openIxs);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 2 * numPosition);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(
        tickArrayPos,
        (offset) => offset < 2 * numPosition,
      );

      const tickArrayData = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayData);
      assert.ok(tickArrayData.startTickIndex == startTickPos);
      assert.ok(tickArrayData.whirlpool.equals(whirlpool));
      for (let offset = 0; offset < numPosition; offset++) {
        assert.ok(
          tickArrayData.ticks[2 * offset].initialized &&
            tickArrayData.ticks[2 * offset].liquidityNet.eq(
              liquidity.addn(offset),
            ),
        );
        assert.ok(
          tickArrayData.ticks[2 * offset + 1].initialized &&
            tickArrayData.ticks[2 * offset + 1].liquidityNet.eq(
              liquidity.addn(offset).neg(),
            ),
        );
      }

      const closeIxs = [];
      for (let offset = 0; offset < numPosition; offset++) {
        closeIxs.push(
          decreaseLiquidity({
            ...sharedParams,
            bundleIndex: offset,
            liquidity: liquidity.addn(offset),
          }),
        );
        closeIxs.push(
          closeBundledPosition({ ...sharedParams, bundleIndex: offset }),
        );
      }

      await executeIxs(closeIxs);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, () => false);

      const tickArrayDataAfter = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayDataAfter);
      assert.ok(tickArrayDataAfter.startTickIndex == startTickPos);
      assert.ok(tickArrayDataAfter.whirlpool.equals(whirlpool));
      assert.ok(tickArrayDataAfter.ticks.every((tick) => !tick.initialized));
    });

    it("1st tx: open 6 positions, 2nd tx: close 6 positions (same ticks)", async () => {
      const tickSpacing = 64;
      const numPosition = 6;

      const { positionBundle, whirlpool, tickArrayPos, startTickPos } =
        await buildTestFixture(tickSpacing);
      const whirlpoolData = (await ctx.fetcher.getPool(
        whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      const sharedParams = {
        positionBundle,
        whirlpool,
        whirlpoolData,
        tickArrayLower: tickArrayPos,
        tickArrayUpper: tickArrayPos,
      };

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);

      const tickLowerIndex = startTickPos;
      const tickUpperIndex = startTickPos + (TICK_ARRAY_SIZE - 1) * tickSpacing;
      const liquidity = new BN(1000);

      const openIxs = [];
      for (let offset = 0; offset < numPosition; offset++) {
        openIxs.push(
          openBundledPosition({
            ...sharedParams,
            bundleIndex: offset,
            tickLowerIndex,
            tickUpperIndex,
          }),
        );
        openIxs.push(
          increaseLiquidity({
            ...sharedParams,
            bundleIndex: offset,
            liquidity,
          }),
        );
      }

      await executeIxs(openIxs);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 2);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, (offset) =>
        [0, TICK_ARRAY_SIZE - 1].includes(offset),
      );

      const tickArrayData = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayData);
      assert.ok(tickArrayData.startTickIndex == startTickPos);
      assert.ok(tickArrayData.whirlpool.equals(whirlpool));
      assert.ok(
        tickArrayData.ticks[0].initialized &&
          tickArrayData.ticks[0].liquidityNet.eq(liquidity.muln(numPosition)),
      );
      assert.ok(
        tickArrayData.ticks[TICK_ARRAY_SIZE - 1].initialized &&
          tickArrayData.ticks[TICK_ARRAY_SIZE - 1].liquidityNet.eq(
            liquidity.muln(numPosition).neg(),
          ),
      );

      const closeIxs = [];
      for (let offset = 0; offset < numPosition; offset++) {
        closeIxs.push(
          decreaseLiquidity({
            ...sharedParams,
            bundleIndex: offset,
            liquidity,
          }),
        );
        closeIxs.push(
          closeBundledPosition({ ...sharedParams, bundleIndex: offset }),
        );
      }

      await executeIxs(closeIxs);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, () => false);

      const tickArrayDataAfter = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayDataAfter);
      assert.ok(tickArrayDataAfter.startTickIndex == startTickPos);
      assert.ok(tickArrayDataAfter.whirlpool.equals(whirlpool));
      assert.ok(tickArrayDataAfter.ticks.every((tick) => !tick.initialized));
    });

    it("open 3 positions and close 3 positions (different ticks)", async () => {
      const tickSpacing = 64;

      const { positionBundle, whirlpool, tickArrayPos, startTickPos } =
        await buildTestFixture(tickSpacing);
      const whirlpoolData = (await ctx.fetcher.getPool(
        whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      const sharedParams = {
        positionBundle,
        whirlpool,
        whirlpoolData,
        tickArrayLower: tickArrayPos,
        tickArrayUpper: tickArrayPos,
      };

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);

      const liquidity = new BN(1000);

      // open bundled position: 0, 1, 2
      await executeIxs([
        openBundledPosition({
          ...sharedParams,
          bundleIndex: 0,
          tickLowerIndex: startTickPos + tickSpacing * 0,
          tickUpperIndex: startTickPos + tickSpacing * 1,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        openBundledPosition({
          ...sharedParams,
          bundleIndex: 1,
          tickLowerIndex: startTickPos + tickSpacing * 2,
          tickUpperIndex: startTickPos + tickSpacing * 3,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 1, liquidity }),
        openBundledPosition({
          ...sharedParams,
          bundleIndex: 2,
          tickLowerIndex: startTickPos + tickSpacing * 4,
          tickUpperIndex: startTickPos + tickSpacing * 5,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 2, liquidity }),
      ]);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 2 * 3);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, (offset) =>
        [0, 1, 2, 3, 4, 5].includes(offset),
      );

      const tickArrayData = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayData);
      assert.ok(
        tickArrayData.ticks
          .slice(0, 6)
          .every(
            (tick, offset) =>
              tick.initialized &&
              tick.liquidityNet.eq(
                offset % 2 == 0 ? liquidity : liquidity.neg(),
              ),
          ),
      );
      assert.ok(
        tickArrayData.ticks.slice(6, 12).every((tick) => !tick.initialized),
      );

      // close bundled position: 0, 1, 2
      // open bundled position: 3, 4, 5
      await executeIxs([
        openBundledPosition({
          ...sharedParams,
          bundleIndex: 3,
          tickLowerIndex: startTickPos + tickSpacing * 6,
          tickUpperIndex: startTickPos + tickSpacing * 7,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 3, liquidity }),

        decreaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        closeBundledPosition({ ...sharedParams, bundleIndex: 0 }),

        openBundledPosition({
          ...sharedParams,
          bundleIndex: 4,
          tickLowerIndex: startTickPos + tickSpacing * 8,
          tickUpperIndex: startTickPos + tickSpacing * 9,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 4, liquidity }),

        decreaseLiquidity({ ...sharedParams, bundleIndex: 1, liquidity }),
        closeBundledPosition({ ...sharedParams, bundleIndex: 1 }),

        openBundledPosition({
          ...sharedParams,
          bundleIndex: 5,
          tickLowerIndex: startTickPos + tickSpacing * 10,
          tickUpperIndex: startTickPos + tickSpacing * 11,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 5, liquidity }),

        decreaseLiquidity({ ...sharedParams, bundleIndex: 2, liquidity }),
        closeBundledPosition({ ...sharedParams, bundleIndex: 2 }),
      ]);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 2 * 3);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, (offset) =>
        [6, 7, 8, 9, 10, 11].includes(offset),
      );

      const tickArrayDataAfter = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayDataAfter);
      assert.ok(
        tickArrayDataAfter.ticks.slice(0, 6).every((tick) => !tick.initialized),
      );
      assert.ok(
        tickArrayDataAfter.ticks
          .slice(6, 12)
          .every(
            (tick, offset) =>
              tick.initialized &&
              tick.liquidityNet.eq(
                offset % 2 == 0 ? liquidity : liquidity.neg(),
              ),
          ),
      );
    });

    it("open 4 positions and close 2 positions (different ticks, extend)", async () => {
      const tickSpacing = 64;

      const { positionBundle, whirlpool, tickArrayPos, startTickPos } =
        await buildTestFixture(tickSpacing);
      const whirlpoolData = (await ctx.fetcher.getPool(
        whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      const sharedParams = {
        positionBundle,
        whirlpool,
        whirlpoolData,
        tickArrayLower: tickArrayPos,
        tickArrayUpper: tickArrayPos,
      };

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);

      const liquidity = new BN(1000);

      // open bundled position: 0, 4
      await executeIxs([
        openBundledPosition({
          ...sharedParams,
          bundleIndex: 0,
          tickLowerIndex: startTickPos + tickSpacing * 0,
          tickUpperIndex: startTickPos + tickSpacing * 1,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        openBundledPosition({
          ...sharedParams,
          bundleIndex: 4,
          tickLowerIndex: startTickPos + tickSpacing * 8,
          tickUpperIndex: startTickPos + tickSpacing * 9,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 4, liquidity }),
      ]);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 2 * 2);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, (offset) =>
        [0, 1, 8, 9].includes(offset),
      );

      const tickArrayData = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayData);
      assert.ok(
        [0, 8].every(
          (offset) =>
            tickArrayData.ticks[offset].initialized &&
            tickArrayData.ticks[offset].liquidityNet.eq(liquidity),
        ),
      );
      assert.ok(
        [1, 9].every(
          (offset) =>
            tickArrayData.ticks[offset].initialized &&
            tickArrayData.ticks[offset].liquidityNet.eq(liquidity.neg()),
        ),
      );
      assert.ok(
        [2, 3, 4, 5, 6, 7, 10, 11].every(
          (offset) => !tickArrayData.ticks[offset].initialized,
        ),
      );

      // close bundled position: 0, 4
      // open bundled position: 1, 2, 3, 5
      await executeIxs([
        openBundledPosition({
          ...sharedParams,
          bundleIndex: 1,
          tickLowerIndex: startTickPos + tickSpacing * 2,
          tickUpperIndex: startTickPos + tickSpacing * 3,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 1, liquidity }),

        openBundledPosition({
          ...sharedParams,
          bundleIndex: 2,
          tickLowerIndex: startTickPos + tickSpacing * 4,
          tickUpperIndex: startTickPos + tickSpacing * 5,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 2, liquidity }),

        decreaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        closeBundledPosition({ ...sharedParams, bundleIndex: 0 }),

        decreaseLiquidity({ ...sharedParams, bundleIndex: 4, liquidity }),
        closeBundledPosition({ ...sharedParams, bundleIndex: 4 }),

        openBundledPosition({
          ...sharedParams,
          bundleIndex: 3,
          tickLowerIndex: startTickPos + tickSpacing * 6,
          tickUpperIndex: startTickPos + tickSpacing * 7,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 3, liquidity }),

        openBundledPosition({
          ...sharedParams,
          bundleIndex: 5,
          tickLowerIndex: startTickPos + tickSpacing * 10,
          tickUpperIndex: startTickPos + tickSpacing * 11,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 5, liquidity }),
      ]);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 2 * 4);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, (offset) =>
        [2, 3, 4, 5, 6, 7, 10, 11].includes(offset),
      );

      const tickArrayDataAfter = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayDataAfter);
      assert.ok(
        [2, 4, 6, 10].every(
          (offset) =>
            tickArrayDataAfter.ticks[offset].initialized &&
            tickArrayDataAfter.ticks[offset].liquidityNet.eq(liquidity),
        ),
      );
      assert.ok(
        [3, 5, 7, 11].every(
          (offset) =>
            tickArrayDataAfter.ticks[offset].initialized &&
            tickArrayDataAfter.ticks[offset].liquidityNet.eq(liquidity.neg()),
        ),
      );
      assert.ok(
        [0, 1, 8, 9].every(
          (offset) => !tickArrayDataAfter.ticks[offset].initialized,
        ),
      );
    });

    it("open 2 positions and close 4 positions (different ticks, shrink)", async () => {
      const tickSpacing = 64;

      const { positionBundle, whirlpool, tickArrayPos, startTickPos } =
        await buildTestFixture(tickSpacing);
      const whirlpoolData = (await ctx.fetcher.getPool(
        whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      const sharedParams = {
        positionBundle,
        whirlpool,
        whirlpoolData,
        tickArrayLower: tickArrayPos,
        tickArrayUpper: tickArrayPos,
      };

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);

      const liquidity = new BN(1000);

      // open bundled position: 1, 2, 3, 4
      await executeIxs([
        openBundledPosition({
          ...sharedParams,
          bundleIndex: 1,
          tickLowerIndex: startTickPos + tickSpacing * 2,
          tickUpperIndex: startTickPos + tickSpacing * 3,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 1, liquidity }),
        openBundledPosition({
          ...sharedParams,
          bundleIndex: 2,
          tickLowerIndex: startTickPos + tickSpacing * 4,
          tickUpperIndex: startTickPos + tickSpacing * 5,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 2, liquidity }),
        openBundledPosition({
          ...sharedParams,
          bundleIndex: 3,
          tickLowerIndex: startTickPos + tickSpacing * 6,
          tickUpperIndex: startTickPos + tickSpacing * 7,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 3, liquidity }),
        openBundledPosition({
          ...sharedParams,
          bundleIndex: 4,
          tickLowerIndex: startTickPos + tickSpacing * 8,
          tickUpperIndex: startTickPos + tickSpacing * 9,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 4, liquidity }),
      ]);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 2 * 4);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, (offset) =>
        [2, 3, 4, 5, 6, 7, 8, 9].includes(offset),
      );

      const tickArrayData = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayData);
      assert.ok(
        [2, 4, 6, 8].every(
          (offset) =>
            tickArrayData.ticks[offset].initialized &&
            tickArrayData.ticks[offset].liquidityNet.eq(liquidity),
        ),
      );
      assert.ok(
        [3, 5, 7, 9].every(
          (offset) =>
            tickArrayData.ticks[offset].initialized &&
            tickArrayData.ticks[offset].liquidityNet.eq(liquidity.neg()),
        ),
      );
      assert.ok(
        [0, 1, 10, 11].every(
          (offset) => !tickArrayData.ticks[offset].initialized,
        ),
      );

      // close bundled position: 1, 2, 3, 4
      // open bundled position: 0, 5
      await executeIxs([
        openBundledPosition({
          ...sharedParams,
          bundleIndex: 5,
          tickLowerIndex: startTickPos + tickSpacing * 10,
          tickUpperIndex: startTickPos + tickSpacing * 11,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 5, liquidity }),

        decreaseLiquidity({ ...sharedParams, bundleIndex: 4, liquidity }),
        closeBundledPosition({ ...sharedParams, bundleIndex: 4 }),

        decreaseLiquidity({ ...sharedParams, bundleIndex: 1, liquidity }),
        closeBundledPosition({ ...sharedParams, bundleIndex: 1 }),

        decreaseLiquidity({ ...sharedParams, bundleIndex: 2, liquidity }),
        closeBundledPosition({ ...sharedParams, bundleIndex: 2 }),

        openBundledPosition({
          ...sharedParams,
          bundleIndex: 0,
          tickLowerIndex: startTickPos + tickSpacing * 0,
          tickUpperIndex: startTickPos + tickSpacing * 1,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),

        decreaseLiquidity({ ...sharedParams, bundleIndex: 3, liquidity }),
        closeBundledPosition({ ...sharedParams, bundleIndex: 3 }),
      ]);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 2 * 2);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, (offset) =>
        [0, 1, 10, 11].includes(offset),
      );

      const tickArrayDataAfter = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayDataAfter);
      assert.ok(
        [0, 10].every(
          (offset) =>
            tickArrayDataAfter.ticks[offset].initialized &&
            tickArrayDataAfter.ticks[offset].liquidityNet.eq(liquidity),
        ),
      );
      assert.ok(
        [1, 11].every(
          (offset) =>
            tickArrayDataAfter.ticks[offset].initialized &&
            tickArrayDataAfter.ticks[offset].liquidityNet.eq(liquidity.neg()),
        ),
      );
      assert.ok(
        [2, 3, 4, 5, 6, 7, 8, 9].every(
          (offset) => !tickArrayDataAfter.ticks[offset].initialized,
        ),
      );
    });

    it("open/close x 4 (same ticks)", async () => {
      const tickSpacing = 64;
      const numOpenClose = 4;

      const { positionBundle, whirlpool, tickArrayPos, startTickPos } =
        await buildTestFixture(tickSpacing);
      const whirlpoolData = (await ctx.fetcher.getPool(
        whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      const sharedParams = {
        positionBundle,
        whirlpool,
        whirlpoolData,
        tickArrayLower: tickArrayPos,
        tickArrayUpper: tickArrayPos,
      };

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);

      const tickLowerIndex = startTickPos;
      const tickUpperIndex = startTickPos + (TICK_ARRAY_SIZE - 1) * tickSpacing;
      const liquidity = new BN(1000);

      const ixs = [];
      for (let i = 0; i < numOpenClose; i++) {
        ixs.push(
          openBundledPosition({
            ...sharedParams,
            bundleIndex: 0,
            tickLowerIndex,
            tickUpperIndex,
          }),
        );
        ixs.push(
          increaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        );
        ixs.push(
          decreaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        );
        ixs.push(closeBundledPosition({ ...sharedParams, bundleIndex: 0 }));
      }

      await executeIxs(ixs);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, () => false);

      const tickArrayData = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayData);
      assert.ok(tickArrayData.startTickIndex == startTickPos);
      assert.ok(tickArrayData.whirlpool.equals(whirlpool));
      assert.ok(tickArrayData.ticks.every((tick) => !tick.initialized));
    });

    it("open/close x 2 (different ticks)", async () => {
      const tickSpacing = 64;
      const numOpenClose = 2;

      const { positionBundle, whirlpool, tickArrayPos, startTickPos } =
        await buildTestFixture(tickSpacing);
      const whirlpoolData = (await ctx.fetcher.getPool(
        whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      const sharedParams = {
        positionBundle,
        whirlpool,
        whirlpoolData,
        tickArrayLower: tickArrayPos,
        tickArrayUpper: tickArrayPos,
      };

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);

      const tickLowerIndex1 = startTickPos;
      const tickUpperIndex1 =
        startTickPos + (TICK_ARRAY_SIZE - 1) * tickSpacing;
      const tickLowerIndex2 = startTickPos + tickSpacing;
      const tickUpperIndex2 =
        startTickPos + (TICK_ARRAY_SIZE - 2) * tickSpacing;
      const liquidity = new BN(1000);

      const ixs = [];
      for (let i = 0; i < numOpenClose; i++) {
        ixs.push(
          openBundledPosition({
            ...sharedParams,
            bundleIndex: 0,
            tickLowerIndex: tickLowerIndex1,
            tickUpperIndex: tickUpperIndex1,
          }),
        );
        ixs.push(
          openBundledPosition({
            ...sharedParams,
            bundleIndex: 1,
            tickLowerIndex: tickLowerIndex2,
            tickUpperIndex: tickUpperIndex2,
          }),
        );
        ixs.push(
          increaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        );
        ixs.push(
          increaseLiquidity({ ...sharedParams, bundleIndex: 1, liquidity }),
        );
        ixs.push(
          decreaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        );
        ixs.push(
          decreaseLiquidity({ ...sharedParams, bundleIndex: 1, liquidity }),
        );
        ixs.push(closeBundledPosition({ ...sharedParams, bundleIndex: 0 }));
        ixs.push(closeBundledPosition({ ...sharedParams, bundleIndex: 1 }));
      }

      await executeIxs(ixs);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, () => false);

      const tickArrayData = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayData);
      assert.ok(tickArrayData.startTickIndex == startTickPos);
      assert.ok(tickArrayData.whirlpool.equals(whirlpool));
      assert.ok(tickArrayData.ticks.every((tick) => !tick.initialized));
    });

    it("1st tx: open/inc/inc/inc, 2nd tx: inc/inc/inc", async () => {
      const tickSpacing = 64;

      const { positionBundle, whirlpool, tickArrayPos, startTickPos } =
        await buildTestFixture(tickSpacing);
      const whirlpoolData = (await ctx.fetcher.getPool(
        whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      const sharedParams = {
        positionBundle,
        whirlpool,
        whirlpoolData,
        tickArrayLower: tickArrayPos,
        tickArrayUpper: tickArrayPos,
      };

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);

      const tickLowerIndex = startTickPos;
      const tickUpperIndex = startTickPos + (TICK_ARRAY_SIZE - 1) * tickSpacing;
      const liquidity = new BN(1000);

      await executeIxs([
        openBundledPosition({
          ...sharedParams,
          bundleIndex: 0,
          tickLowerIndex,
          tickUpperIndex,
        }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
      ]);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 2);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, (offset) =>
        [0, TICK_ARRAY_SIZE - 1].includes(offset),
      );

      const tickArrayData = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayData);
      assert.ok(
        tickArrayData.ticks[0].initialized &&
          tickArrayData.ticks[0].liquidityNet.eq(liquidity.muln(3)),
      );
      assert.ok(
        tickArrayData.ticks[TICK_ARRAY_SIZE - 1].initialized &&
          tickArrayData.ticks[TICK_ARRAY_SIZE - 1].liquidityNet.eq(
            liquidity.muln(3).neg(),
          ),
      );

      const rent = await getRent(tickArrayPos);

      await executeIxs([
        increaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        increaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
      ]);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 2);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, (offset) =>
        [0, TICK_ARRAY_SIZE - 1].includes(offset),
      );

      const tickArrayDataAfter = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayDataAfter);
      assert.ok(
        tickArrayDataAfter.ticks[0].initialized &&
          tickArrayDataAfter.ticks[0].liquidityNet.eq(liquidity.muln(6)),
      );
      assert.ok(
        tickArrayDataAfter.ticks[TICK_ARRAY_SIZE - 1].initialized &&
          tickArrayDataAfter.ticks[TICK_ARRAY_SIZE - 1].liquidityNet.eq(
            liquidity.muln(6).neg(),
          ),
      );

      const rentAfter = await getRent(tickArrayPos);
      assert.ok(rentAfter == rent);
    });

    it("1st tx: open/inc, 2nd tx: dec/dec/dec, 3rd tx: dec/dec/dec", async () => {
      const tickSpacing = 64;

      const { positionBundle, whirlpool, tickArrayPos, startTickPos } =
        await buildTestFixture(tickSpacing);
      const whirlpoolData = (await ctx.fetcher.getPool(
        whirlpool,
        IGNORE_CACHE,
      )) as WhirlpoolData;

      const sharedParams = {
        positionBundle,
        whirlpool,
        whirlpoolData,
        tickArrayLower: tickArrayPos,
        tickArrayUpper: tickArrayPos,
      };

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);

      const tickLowerIndex = startTickPos;
      const tickUpperIndex = startTickPos + (TICK_ARRAY_SIZE - 1) * tickSpacing;
      const liquidity = new BN(1000);

      await executeIxs([
        openBundledPosition({
          ...sharedParams,
          bundleIndex: 0,
          tickLowerIndex,
          tickUpperIndex,
        }),
        increaseLiquidity({
          ...sharedParams,
          bundleIndex: 0,
          liquidity: liquidity.muln(6),
        }),
      ]);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 2);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, (offset) =>
        [0, TICK_ARRAY_SIZE - 1].includes(offset),
      );

      const tickArrayData = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayData);
      assert.ok(
        tickArrayData.ticks[0].initialized &&
          tickArrayData.ticks[0].liquidityNet.eq(liquidity.muln(6)),
      );
      assert.ok(
        tickArrayData.ticks[TICK_ARRAY_SIZE - 1].initialized &&
          tickArrayData.ticks[TICK_ARRAY_SIZE - 1].liquidityNet.eq(
            liquidity.muln(6).neg(),
          ),
      );

      const rent = await getRent(tickArrayPos);

      await executeIxs([
        decreaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        decreaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        decreaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
      ]);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 2);
      await verifyRentExempt(tickArrayPos);
      await verifyTickBitmap(tickArrayPos, (offset) =>
        [0, TICK_ARRAY_SIZE - 1].includes(offset),
      );

      const tickArrayDataAfter = await ctx.fetcher.getTickArray(
        tickArrayPos,
        IGNORE_CACHE,
      );
      assert.ok(tickArrayDataAfter);
      assert.ok(
        tickArrayDataAfter.ticks[0].initialized &&
          tickArrayDataAfter.ticks[0].liquidityNet.eq(liquidity.muln(3)),
      );
      assert.ok(
        tickArrayDataAfter.ticks[TICK_ARRAY_SIZE - 1].initialized &&
          tickArrayDataAfter.ticks[TICK_ARRAY_SIZE - 1].liquidityNet.eq(
            liquidity.muln(3).neg(),
          ),
      );

      const rentAfter = await getRent(tickArrayPos);
      assert.ok(rentAfter == rent);

      await executeIxs([
        decreaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        decreaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
        decreaseLiquidity({ ...sharedParams, bundleIndex: 0, liquidity }),
      ]);

      await verifyDynamicTickArrayAccountSize(tickArrayPos, 0);
      await verifyRentExempt(tickArrayPos);

      const rentAfterAfter = await getRent(tickArrayPos);
      assert.ok(rentAfterAfter < rent);
    });
  });
});
