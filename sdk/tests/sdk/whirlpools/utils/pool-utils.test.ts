import * as assert from "assert";
import { PoolUtil, SwapDirection, TokenType } from "../../../../src";
import { testWhirlpoolData } from "../../../utils/testDataTypes";
import { Keypair } from "@solana/web3.js";

describe("PoolUtils tests", () => {
  describe("getTokenType", () => {
    it("Token is tokenA", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = PoolUtil.getTokenType(whirlpoolData, whirlpoolData.tokenMintA);
      assert.equal(result, TokenType.TokenA);
    });

    it("Token is tokenB", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = PoolUtil.getTokenType(whirlpoolData, whirlpoolData.tokenMintB);
      assert.equal(result, TokenType.TokenB);
    });

    it("Token is some other token", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = PoolUtil.getTokenType(whirlpoolData, Keypair.generate().publicKey);
      assert.ok(result === undefined);
    });
  });

  describe("getSwapDirection", () => {
    it("SwapToken is tokenA and is an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = PoolUtil.getSwapDirection(whirlpoolData, whirlpoolData.tokenMintA, true);
      assert.equal(result, SwapDirection.AtoB);
    });

    it("SwapToken is tokenB and is an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = PoolUtil.getSwapDirection(whirlpoolData, whirlpoolData.tokenMintB, true);
      assert.equal(result, SwapDirection.BtoA);
    });

    it("SwapToken is tokenA and is not an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = PoolUtil.getSwapDirection(whirlpoolData, whirlpoolData.tokenMintA, false);
      assert.equal(result, SwapDirection.BtoA);
    });

    it("SwapToken is tokenB and is not an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = PoolUtil.getSwapDirection(whirlpoolData, whirlpoolData.tokenMintB, false);
      assert.equal(result, SwapDirection.AtoB);
    });

    it("SwapToken is a random mint and is an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = PoolUtil.getSwapDirection(whirlpoolData, Keypair.generate().publicKey, true);
      assert.equal(result, undefined);
    });

    it("SwapToken is a random mint and is not an input", async () => {
      const whirlpoolData = testWhirlpoolData;
      const result = PoolUtil.getSwapDirection(whirlpoolData, Keypair.generate().publicKey, false);
      assert.equal(result, undefined);
    });
  });
});
