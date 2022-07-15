import * as assert from "assert";
import { SwapUtils, SwapDirection } from "../../../../src";
import { testWhirlpoolData } from "../../../utils/testDataTypes";
import { Keypair } from "@solana/web3.js";

describe("SwapUtils tests", () => {
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
});
