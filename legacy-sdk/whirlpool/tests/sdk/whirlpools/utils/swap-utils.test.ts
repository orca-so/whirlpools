import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import * as assert from "assert";
import type { TickArray, TickArrayData, TickData } from "../../../../src";
import {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PDAUtil,
  SwapDirection,
  SwapUtils,
  TICK_ARRAY_SIZE,
} from "../../../../src";
import type { WhirlpoolContext } from "../../../../src/context";
import { initializeLiteSVMEnvironment } from "../../../utils/litesvm";
import { testWhirlpoolData } from "../../../utils/testDataTypes";
import BN from "bn.js";
import { TickSpacing } from "../../../utils";

describe("SwapUtils tests", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    anchor.setProvider(provider);
  });

  describe("getSwapDirection", () => {
    it("SwapToken is tokenA and is an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = SwapUtils.getSwapDirection(
        whirlpoolData,
        whirlpoolData.tokenMintA,
        true,
      );
      assert.equal(result, SwapDirection.AtoB);
    });

    it("SwapToken is tokenB and is an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = SwapUtils.getSwapDirection(
        whirlpoolData,
        whirlpoolData.tokenMintB,
        true,
      );
      assert.equal(result, SwapDirection.BtoA);
    });

    it("SwapToken is tokenA and is not an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = SwapUtils.getSwapDirection(
        whirlpoolData,
        whirlpoolData.tokenMintA,
        false,
      );
      assert.equal(result, SwapDirection.BtoA);
    });

    it("SwapToken is tokenB and is not an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = SwapUtils.getSwapDirection(
        whirlpoolData,
        whirlpoolData.tokenMintB,
        false,
      );
      assert.equal(result, SwapDirection.AtoB);
    });

    it("SwapToken is a random mint and is an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = SwapUtils.getSwapDirection(
        whirlpoolData,
        Keypair.generate().publicKey,
        true,
      );
      assert.equal(result, undefined);
    });

    it("SwapToken is a random mint and is not an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = SwapUtils.getSwapDirection(
        whirlpoolData,
        Keypair.generate().publicKey,
        false,
      );
      assert.equal(result, undefined);
    });
  });

  describe("getTickArrayPublicKeys", () => {
    it("a->b, ts = 64, tickCurrentIndex = 0", () => {
      const programId = ctx.program.programId;
      const whirlpoolPubkey = Keypair.generate().publicKey;
      const tickSpacing = 64;
      const ticksInArray = tickSpacing * TICK_ARRAY_SIZE;
      const aToB = true;
      const tickCurrentIndex = 0;

      const result = SwapUtils.getTickArrayPublicKeys(
        tickCurrentIndex,
        tickSpacing,
        aToB,
        ctx.program.programId,
        whirlpoolPubkey,
      );

      const expected = [
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 0)
          .publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * -1)
          .publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * -2)
          .publicKey,
      ];
      result.forEach((k, i) =>
        assert.equal(k.toBase58(), expected[i].toBase58()),
      );
    });

    it("a->b, ts = 64, tickCurrentIndex = 64*TICK_ARRAY_SIZE - 64", () => {
      const programId = ctx.program.programId;
      const whirlpoolPubkey = Keypair.generate().publicKey;
      const tickSpacing = 64;
      const ticksInArray = tickSpacing * TICK_ARRAY_SIZE;
      const aToB = true;
      const tickCurrentIndex = tickSpacing * TICK_ARRAY_SIZE - tickSpacing;

      const result = SwapUtils.getTickArrayPublicKeys(
        tickCurrentIndex,
        tickSpacing,
        aToB,
        ctx.program.programId,
        whirlpoolPubkey,
      );

      const expected = [
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 0)
          .publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * -1)
          .publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * -2)
          .publicKey,
      ];
      result.forEach((k, i) =>
        assert.equal(k.toBase58(), expected[i].toBase58()),
      );
    });

    it("a->b, ts = 64, tickCurrentIndex = 64*TICK_ARRAY_SIZE - 1", () => {
      const programId = ctx.program.programId;
      const whirlpoolPubkey = Keypair.generate().publicKey;
      const tickSpacing = 64;
      const ticksInArray = tickSpacing * TICK_ARRAY_SIZE;
      const aToB = true;
      const tickCurrentIndex = tickSpacing * TICK_ARRAY_SIZE - 1;

      const result = SwapUtils.getTickArrayPublicKeys(
        tickCurrentIndex,
        tickSpacing,
        aToB,
        ctx.program.programId,
        whirlpoolPubkey,
      );

      const expected = [
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 0)
          .publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * -1)
          .publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * -2)
          .publicKey,
      ];
      result.forEach((k, i) =>
        assert.equal(k.toBase58(), expected[i].toBase58()),
      );
    });

    it("b->a, shifted, ts = 64, tickCurrentIndex = 0", () => {
      const programId = ctx.program.programId;
      const whirlpoolPubkey = Keypair.generate().publicKey;
      const tickSpacing = 64;
      const ticksInArray = tickSpacing * TICK_ARRAY_SIZE;
      const aToB = false;
      const tickCurrentIndex = 0;

      const result = SwapUtils.getTickArrayPublicKeys(
        tickCurrentIndex,
        tickSpacing,
        aToB,
        ctx.program.programId,
        whirlpoolPubkey,
      );

      const expected = [
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 0)
          .publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 1)
          .publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 2)
          .publicKey,
      ];
      result.forEach((k, i) =>
        assert.equal(k.toBase58(), expected[i].toBase58()),
      );
    });

    it("b->a, shifted, ts = 64, tickCurrentIndex = 64*TICK_ARRAY_SIZE - 64 - 1", () => {
      const programId = ctx.program.programId;
      const whirlpoolPubkey = Keypair.generate().publicKey;
      const tickSpacing = 64;
      const ticksInArray = tickSpacing * TICK_ARRAY_SIZE;
      const aToB = false;
      const tickCurrentIndex = tickSpacing * TICK_ARRAY_SIZE - tickSpacing - 1;

      const result = SwapUtils.getTickArrayPublicKeys(
        tickCurrentIndex,
        tickSpacing,
        aToB,
        ctx.program.programId,
        whirlpoolPubkey,
      );

      const expected = [
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 0)
          .publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 1)
          .publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 2)
          .publicKey,
      ];
      result.forEach((k, i) =>
        assert.equal(k.toBase58(), expected[i].toBase58()),
      );
    });

    it("b->a, shifted, ts = 64, tickCurrentIndex = 64*TICK_ARRAY_SIZE - 64", () => {
      const programId = ctx.program.programId;
      const whirlpoolPubkey = Keypair.generate().publicKey;
      const tickSpacing = 64;
      const ticksInArray = tickSpacing * TICK_ARRAY_SIZE;
      const aToB = false;
      const tickCurrentIndex = tickSpacing * TICK_ARRAY_SIZE - tickSpacing;

      const result = SwapUtils.getTickArrayPublicKeys(
        tickCurrentIndex,
        tickSpacing,
        aToB,
        ctx.program.programId,
        whirlpoolPubkey,
      );

      const expected = [
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 1)
          .publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 2)
          .publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 3)
          .publicKey,
      ];
      result.forEach((k, i) =>
        assert.equal(k.toBase58(), expected[i].toBase58()),
      );
    });

    it("b->a, shifted, ts = 64, tickCurrentIndex = 64*TICK_ARRAY_SIZE - 1", () => {
      const programId = ctx.program.programId;
      const whirlpoolPubkey = Keypair.generate().publicKey;
      const tickSpacing = 64;
      const ticksInArray = tickSpacing * TICK_ARRAY_SIZE;
      const aToB = false;
      const tickCurrentIndex = tickSpacing * TICK_ARRAY_SIZE - 1;

      const result = SwapUtils.getTickArrayPublicKeys(
        tickCurrentIndex,
        tickSpacing,
        aToB,
        ctx.program.programId,
        whirlpoolPubkey,
      );

      const expected = [
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 1)
          .publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 2)
          .publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 3)
          .publicKey,
      ];
      result.forEach((k, i) =>
        assert.equal(k.toBase58(), expected[i].toBase58()),
      );
    });
  });

  describe("interpolateUninitializedTickArrays", () => {
    const whirlpoolAddress = Keypair.generate().publicKey;
    const tickSpacing = TickSpacing.Standard;
    const initializedTick: TickData = {
      initialized: true,
      liquidityNet: new BN(100),
      liquidityGross: new BN(100),
      feeGrowthOutsideA: new BN(100),
      feeGrowthOutsideB: new BN(100),
      rewardGrowthsOutside: [new BN(100), new BN(100), new BN(100)],
    };
    const initializedTickArrayData: TickArrayData = {
      startTickIndex: 0,
      ticks: Array(TICK_ARRAY_SIZE).fill(initializedTick),
      whirlpool: whirlpoolAddress,
    };

    it("no uninitialized tick arrays", async () => {
      const tickArrays: TickArray[] = [
        {
          address: whirlpoolAddress,
          startTickIndex: tickSpacing * TICK_ARRAY_SIZE * 0,
          data: initializedTickArrayData,
        },
        {
          address: whirlpoolAddress,
          startTickIndex: tickSpacing * TICK_ARRAY_SIZE * 1,
          data: initializedTickArrayData,
        },
        {
          address: whirlpoolAddress,
          startTickIndex: tickSpacing * TICK_ARRAY_SIZE * 2,
          data: initializedTickArrayData,
        },
      ];
      const result = SwapUtils.interpolateUninitializedTickArrays(
        whirlpoolAddress,
        tickArrays,
      );

      // no change
      assert.ok(result[0].data === initializedTickArrayData);
      assert.ok(result[1].data === initializedTickArrayData);
      assert.ok(result[2].data === initializedTickArrayData);
    });

    it("1 uninitialized tick arrays", async () => {
      const tickArrays: TickArray[] = [
        {
          address: whirlpoolAddress,
          startTickIndex: tickSpacing * TICK_ARRAY_SIZE * 0,
          data: initializedTickArrayData,
        },
        {
          address: whirlpoolAddress,
          startTickIndex: tickSpacing * TICK_ARRAY_SIZE * 1,
          data: null,
        },
        {
          address: whirlpoolAddress,
          startTickIndex: tickSpacing * TICK_ARRAY_SIZE * 2,
          data: initializedTickArrayData,
        },
      ];
      const result = SwapUtils.interpolateUninitializedTickArrays(
        whirlpoolAddress,
        tickArrays,
      );

      // no change
      assert.ok(result[0].data === initializedTickArrayData);
      assert.ok(
        result[1].data !== null &&
          result[1].data.startTickIndex === result[1].startTickIndex,
      );
      for (let i = 0; i < TICK_ARRAY_SIZE; i++) {
        const tick = result[1].data.ticks[i];
        assert.ok(tick.initialized === false);
        assert.ok(tick.liquidityNet.eqn(0));
        assert.ok(tick.liquidityGross.eqn(0));
        assert.ok(tick.feeGrowthOutsideA.eqn(0));
        assert.ok(tick.feeGrowthOutsideB.eqn(0));
        assert.ok(tick.rewardGrowthsOutside[0].eqn(0));
        assert.ok(tick.rewardGrowthsOutside[1].eqn(0));
        assert.ok(tick.rewardGrowthsOutside[2].eqn(0));
      }
      assert.ok(result[2].data === initializedTickArrayData);
    });

    it("3 uninitialized tick arrays", async () => {
      const tickArrays: TickArray[] = [
        {
          address: whirlpoolAddress,
          startTickIndex: tickSpacing * TICK_ARRAY_SIZE * 0,
          data: null,
        },
        {
          address: whirlpoolAddress,
          startTickIndex: tickSpacing * TICK_ARRAY_SIZE * 1,
          data: null,
        },
        {
          address: whirlpoolAddress,
          startTickIndex: tickSpacing * TICK_ARRAY_SIZE * 2,
          data: null,
        },
      ];
      const result = SwapUtils.interpolateUninitializedTickArrays(
        whirlpoolAddress,
        tickArrays,
      );

      for (let i = 0; i < 3; i++) {
        assert.ok(
          result[i].data !== null &&
            result[i].data!.startTickIndex === result[i].startTickIndex,
        );
        for (let j = 0; j < TICK_ARRAY_SIZE; j++) {
          const tick = result[i].data!.ticks[j];
          assert.ok(tick.initialized === false);
          assert.ok(tick.liquidityNet.eqn(0));
          assert.ok(tick.liquidityGross.eqn(0));
          assert.ok(tick.feeGrowthOutsideA.eqn(0));
          assert.ok(tick.feeGrowthOutsideB.eqn(0));
          assert.ok(tick.rewardGrowthsOutside[0].eqn(0));
          assert.ok(tick.rewardGrowthsOutside[1].eqn(0));
          assert.ok(tick.rewardGrowthsOutside[2].eqn(0));
        }
      }
    });
  });

  describe("getFallbackTickArrayPublicKey", () => {
    const whirlpoolAddress = Keypair.generate().publicKey;

    it("ts = 64, a --> b, normal range", async () => {
      const tickSpacing = 64;
      const aToB = true;

      // [ta2: -11264 ][ta1: -5632  ][ta0: 0      ][fallback: 5632 ]
      const tickArrays = await SwapUtils.getTickArrays(
        128,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
        ctx.fetcher,
      );
      assert.equal(tickArrays[0].startTickIndex, 0);
      assert.equal(tickArrays[1].startTickIndex, -5632);
      assert.equal(tickArrays[2].startTickIndex, -11264);

      const result = SwapUtils.getFallbackTickArrayPublicKey(
        tickArrays,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
      );

      const expected = PDAUtil.getTickArray(
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
        5632,
      );
      assert.ok(result?.toBase58() === expected.publicKey.toBase58());
    });

    it("ts = 64, a --> b, right most", async () => {
      const tickSpacing = 64;
      const aToB = true;

      // [ta2: 428032 ][ta1: 433664 ][ta0: 439296 ] (no fallback)
      const tickArrays = await SwapUtils.getTickArrays(
        439296 + 128,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
        ctx.fetcher,
      );
      assert.equal(tickArrays[0].startTickIndex, 439296);
      assert.equal(tickArrays[1].startTickIndex, 433664);
      assert.equal(tickArrays[2].startTickIndex, 428032);

      const result = SwapUtils.getFallbackTickArrayPublicKey(
        tickArrays,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
      );

      assert.ok(result === undefined);
    });

    it("ts = 64, a <-- b, normal range", async () => {
      const tickSpacing = 64;
      const aToB = false;

      // [fallback: -5632 ][ta0: 0      ][ta1: 5632   ][ta2: 11264  ]
      const tickArrays = await SwapUtils.getTickArrays(
        128,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
        ctx.fetcher,
      );
      assert.equal(tickArrays[0].startTickIndex, 0);
      assert.equal(tickArrays[1].startTickIndex, 5632);
      assert.equal(tickArrays[2].startTickIndex, 11264);

      const result = SwapUtils.getFallbackTickArrayPublicKey(
        tickArrays,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
      );

      const expected = PDAUtil.getTickArray(
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
        -5632,
      );
      assert.ok(result?.toBase58() === expected.publicKey.toBase58());
    });

    it("ts = 64, a <-- b, left most", async () => {
      const tickSpacing = 64;
      const aToB = false;

      // (no fallback) [ta0: -444928][ta1: -439296][ta2: -433664]
      const tickArrays = await SwapUtils.getTickArrays(
        -439296 - 128,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
        ctx.fetcher,
      );
      assert.equal(tickArrays[0].startTickIndex, -444928);
      assert.equal(tickArrays[1].startTickIndex, -439296);
      assert.equal(tickArrays[2].startTickIndex, -433664);

      const result = SwapUtils.getFallbackTickArrayPublicKey(
        tickArrays,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
      );

      assert.ok(result === undefined);
    });

    it("ts = 64, a <-- b, shifted", async () => {
      const tickSpacing = 64;
      const aToB = false;

      // [fallback: -444928][ta0: -439296][ta1: -433664][ta2: -428032]
      const tickArrays = await SwapUtils.getTickArrays(
        -439296 - 32,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
        ctx.fetcher,
      );
      assert.equal(tickArrays[0].startTickIndex, -439296);
      assert.equal(tickArrays[1].startTickIndex, -433664);
      assert.equal(tickArrays[2].startTickIndex, -428032);

      const result = SwapUtils.getFallbackTickArrayPublicKey(
        tickArrays,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
      );

      const expected = PDAUtil.getTickArray(
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
        -444928,
      );
      assert.ok(result?.toBase58() === expected.publicKey.toBase58());
    });

    it("ts = 32768, a --> b", async () => {
      const tickSpacing = 32768;
      const aToB = true;

      // [ta0: -2883584][fallback: 0 ]
      const tickArrays = await SwapUtils.getTickArrays(
        -128,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
        ctx.fetcher,
      );
      assert.equal(tickArrays[0].startTickIndex, -2883584);
      assert.equal(tickArrays.length, 1);

      const result = SwapUtils.getFallbackTickArrayPublicKey(
        tickArrays,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
      );

      const expected = PDAUtil.getTickArray(
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
        0,
      );
      assert.ok(result?.toBase58() === expected.publicKey.toBase58());
    });

    it("ts = 32768, a --> b, rightmost", async () => {
      const tickSpacing = 32768;
      const aToB = true;

      // [ta1: -2883584][ta0: 0      ] (no fallback)
      const tickArrays = await SwapUtils.getTickArrays(
        128,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
        ctx.fetcher,
      );
      assert.equal(tickArrays[0].startTickIndex, 0);
      assert.equal(tickArrays[1].startTickIndex, -2883584);
      assert.equal(tickArrays.length, 2);

      const result = SwapUtils.getFallbackTickArrayPublicKey(
        tickArrays,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
      );

      assert.ok(result === undefined);
    });

    it("ts = 32768, a <-- b", async () => {
      const tickSpacing = 32768;
      const aToB = false;

      // [fallback: -2883584][ta0: 0       ]
      const tickArrays = await SwapUtils.getTickArrays(
        128,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
        ctx.fetcher,
      );
      assert.equal(tickArrays[0].startTickIndex, 0);
      assert.equal(tickArrays.length, 1);

      const result = SwapUtils.getFallbackTickArrayPublicKey(
        tickArrays,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
      );

      const expected = PDAUtil.getTickArray(
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
        -2883584,
      );
      assert.ok(result?.toBase58() === expected.publicKey.toBase58());
    });

    it("ts = 32768, a <-- b, leftmost", async () => {
      const tickSpacing = 32768;
      const aToB = false;

      // (no fallback) [ta0: -2883584][ta1: 0      ]
      const tickArrays = await SwapUtils.getTickArrays(
        -65536,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
        ctx.fetcher,
      );
      assert.equal(tickArrays[0].startTickIndex, -2883584);
      assert.equal(tickArrays[1].startTickIndex, 0);
      assert.equal(tickArrays.length, 2);

      const result = SwapUtils.getFallbackTickArrayPublicKey(
        tickArrays,
        tickSpacing,
        aToB,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolAddress,
      );

      assert.ok(result === undefined);
    });
  });
});
