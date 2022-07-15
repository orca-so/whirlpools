import * as assert from "assert";
import { TokenType, PoolUtil } from "../../../../src";
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
});
