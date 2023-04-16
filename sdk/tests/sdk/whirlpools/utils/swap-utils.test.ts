import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import * as assert from "assert";
import { PDAUtil, SwapDirection, SwapUtils, TICK_ARRAY_SIZE } from "../../../../src";
import { WhirlpoolContext } from "../../../../src/context";
import { defaultConfirmOptions } from "../../../utils/const";
import { testWhirlpoolData } from "../../../utils/testDataTypes";

describe("SwapUtils tests", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);

  describe("getSwapDirection", () => {
    it("SwapToken is tokenA and is an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = SwapUtils.getSwapDirection(whirlpoolData, whirlpoolData.tokenMintA, true);
      assert.equal(result, SwapDirection.AtoB);
    });

    it("SwapToken is tokenB and is an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = SwapUtils.getSwapDirection(whirlpoolData, whirlpoolData.tokenMintB, true);
      assert.equal(result, SwapDirection.BtoA);
    });

    it("SwapToken is tokenA and is not an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = SwapUtils.getSwapDirection(whirlpoolData, whirlpoolData.tokenMintA, false);
      assert.equal(result, SwapDirection.BtoA);
    });

    it("SwapToken is tokenB and is not an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = SwapUtils.getSwapDirection(whirlpoolData, whirlpoolData.tokenMintB, false);
      assert.equal(result, SwapDirection.AtoB);
    });

    it("SwapToken is a random mint and is an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = SwapUtils.getSwapDirection(whirlpoolData, Keypair.generate().publicKey, true);
      assert.equal(result, undefined);
    });

    it("SwapToken is a random mint and is not an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = SwapUtils.getSwapDirection(whirlpoolData, Keypair.generate().publicKey, false);
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
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 0).publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * -1).publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * -2).publicKey,
      ];
      result.forEach((k, i) => assert.equal(k.toBase58(), expected[i].toBase58()));
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
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 0).publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * -1).publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * -2).publicKey,
      ];
      result.forEach((k, i) => assert.equal(k.toBase58(), expected[i].toBase58()));
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
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 0).publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * -1).publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * -2).publicKey,
      ];
      result.forEach((k, i) => assert.equal(k.toBase58(), expected[i].toBase58()));
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
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 0).publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 1).publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 2).publicKey,
      ];
      result.forEach((k, i) => assert.equal(k.toBase58(), expected[i].toBase58()));
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
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 0).publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 1).publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 2).publicKey,
      ];
      result.forEach((k, i) => assert.equal(k.toBase58(), expected[i].toBase58()));
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
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 1).publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 2).publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 3).publicKey,
      ];
      result.forEach((k, i) => assert.equal(k.toBase58(), expected[i].toBase58()));
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
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 1).publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 2).publicKey,
        PDAUtil.getTickArray(programId, whirlpoolPubkey, ticksInArray * 3).publicKey,
      ];
      result.forEach((k, i) => assert.equal(k.toBase58(), expected[i].toBase58()));
    });
  });

});
