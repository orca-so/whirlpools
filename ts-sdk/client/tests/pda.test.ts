import { address } from "@solana/kit";
import assert from "assert";
import { describe, it } from "vitest";
import { WhirlpoolDeployment } from "../src/config";
import { getFeeTierAddress } from "../src/pda/feeTier";
import { getLockConfigAddress } from "../src/pda/lockConfig";
import { getOracleAddress } from "../src/pda/oracle";
import { getPositionAddress } from "../src/pda/position";
import {
  getBundledPositionAddress,
  getPositionBundleAddress,
} from "../src/pda/positionBundle";
import { getTickArrayAddress } from "../src/pda/tickArray";
import { getTokenBadgeAddress } from "../src/pda/tokenBadge";
import { getWhirlpoolAddress } from "../src/pda/whirlpool";
import { getWhirlpoolsConfigExtensionAddress } from "../src/pda/whirlpoolsConfigExtension";

const testCases = [
  {
    name: "mutable whirlpool",
    whirlpoolDeployment: WhirlpoolDeployment.mainnet,
    feeTierFeeIndex: 2,
    positionAddress: address("2EtH4ZZStW8Ffh2CbbW4baekdtWgPLcBXfYQ6FRmMVsq"),
    positionMint: address("6sf6fSK6tTubFA2LMCeTzt4c6DeNVyA6WpDDgtWs7a5p"),
    whirlpoolAddress: address("2kJmUjxWBwL2NGPBV2PiA5hWtmLCqcKY6reQgkrPtaeS"),
    nativeMint: address("So11111111111111111111111111111111111111112"),
    tokenMintA: address("So11111111111111111111111111111111111111112"),
    tokenMintB: address("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"),
    feeTierExpected: "BH9LXGqLhZV3hdvShYZhgQQEjPVKhHPyHwjnsxjETFRr",
    lockConfigExpected: "3MaMYjnnqyZSs5kD7vbPKTyx3RkD6qHuSF94kvvKukKx",
    oracleExpected: "821SHenpVGYY7BCXUzNhs8Xi4grG557fqRw4wzgaPQcS",
    positionExpected: "2EtH4ZZStW8Ffh2CbbW4baekdtWgPLcBXfYQ6FRmMVsq",
    positionBundleExpected: "At1QvbnANV6imkdNkfB4h1XsY4jbTzPAmScgjLCnM7jy",
    bundledPositionExpected: "4GRbpiDX46zi2AdZ2b9Ho4zfpLXhpsYBhRzkp2AeZej3",
    tickArrayExpected: "8PhPzk7n4wU98Z6XCbVtPai2LtXSxYnfjkmgWuoAU8Zy",
    tokenBadgeExpected: "HX5iftnCxhtu11ys3ZuWbvUqo7cyPYaVNZBrLL67Hrbm",
    whirlpoolExpected: "JDQ9GDphXV5ENDrAQtRFvT98m3JwsVJJk8BYHoX8uTAg",
    extensionExpected: "777H5H3Tp9U11uRVRzFwM8BinfiakbaLT8vQpeuhvEiH",
  },
  {
    name: "immutable whirlpool",
    whirlpoolDeployment: WhirlpoolDeployment.mainnetImmutable,
    feeTierFeeIndex: 1025,
    positionAddress: address("28nFQJH8FHYxUvXc5orSZzcjmzWoByvzfBwi75Ep3f9u"),
    positionMint: address("6LdmNS8p3qLYrGcPeYby6zHRvZPq7cYDZTiBXCC3FNDs"),
    whirlpoolAddress: address("DcMZ4NEbLkh7aAfy7Q4vPcAWVik6tSwfUf3FHDoRBvTG"),
    nativeMint: address("So11111111111111111111111111111111111111112"),
    tokenMintA: address("CgH9igg7DmCYcQzh76o2VdcevuVmVUVAej7HcGeCwho2"),
    tokenMintB: address("E3fyHm5B2ddYnCBgMpt3nVYMXxxLdSZTUCKt9GhLdfLc"),
    feeTierExpected: "eDDRZSrsaprxbkmhRzDWY3gxAGKQj438e2TXcbobQME",
    lockConfigExpected: "DvyANpxwUgtvSGT1AXeuoMjJR6JVBS1TBZDXkpBvg4aX",
    oracleExpected: "F7hHjRkVMEGsgEgyF1N9RrQKBPSU5QL1xmKGCYUwBY9M",
    positionExpected: "28nFQJH8FHYxUvXc5orSZzcjmzWoByvzfBwi75Ep3f9u",
    positionBundleExpected: "CVTZ5u8yjGngtpZ5WRx536ty8jiMCFkzwrr5TJW5FpR7",
    bundledPositionExpected: "FMAeLNU3RRb31UXJTmHcVwDYBJQwy7DhZepFk9Vwc1Mi",
    tickArrayExpected: "38qJYa1ZPJHa23wN3Azrt6Pkp7vEiV2Xbxzuz5rdotGh",
    tokenBadgeExpected: "2JRo82M5t7AymysW2acamjFfAg4qaY7beeSegmsDCAv8",
    whirlpoolExpected: "DcMZ4NEbLkh7aAfy7Q4vPcAWVik6tSwfUf3FHDoRBvTG",
    extensionExpected: "4Bsw8VVuegLmKQh2reevMBr2xw5R76WaJRKCvvxgcQrN",
  },
];

testCases.forEach((tc) => {
  describe(`derive program accounts (${tc.name})`, () => {
    it("FeeTier", async () => {
      const [feeTier] = await getFeeTierAddress(
        tc.feeTierFeeIndex,
        tc.whirlpoolDeployment,
      );
      assert.strictEqual(feeTier, tc.feeTierExpected);
    });

    it("LockConfig", async () => {
      const [lockConfig] = await getLockConfigAddress(
        tc.positionAddress,
        tc.whirlpoolDeployment.programId,
      );
      assert.strictEqual(lockConfig, tc.lockConfigExpected);
    });

    it("Oracle", async () => {
      const [oracle] = await getOracleAddress(
        tc.whirlpoolAddress,
        tc.whirlpoolDeployment.programId,
      );
      assert.strictEqual(oracle, tc.oracleExpected);
    });

    it("Position", async () => {
      const [position] = await getPositionAddress(
        tc.positionMint,
        tc.whirlpoolDeployment.programId,
      );
      assert.strictEqual(position, tc.positionExpected);
    });

    it("PositionBundle", async () => {
      const [positionBundle] = await getPositionBundleAddress(
        tc.positionMint,
        tc.whirlpoolDeployment.programId,
      );
      assert.strictEqual(positionBundle, tc.positionBundleExpected);
    });

    it("BundledPosition", async () => {
      const [positionBundleAddress] = await getPositionBundleAddress(
        tc.positionMint,
        tc.whirlpoolDeployment.programId,
      );
      const [bundledPosition] = await getBundledPositionAddress(
        positionBundleAddress,
        0,
        tc.whirlpoolDeployment.programId,
      );
      assert.strictEqual(bundledPosition, tc.bundledPositionExpected);
    });

    it("TickArray", async () => {
      const [tickArray] = await getTickArrayAddress(
        tc.whirlpoolAddress,
        0,
        tc.whirlpoolDeployment.programId,
      );
      assert.strictEqual(tickArray, tc.tickArrayExpected);
    });

    it("TokenBadge", async () => {
      const [tokenBadge] = await getTokenBadgeAddress(
        tc.tokenMintB,
        tc.whirlpoolDeployment,
      );
      assert.strictEqual(tokenBadge, tc.tokenBadgeExpected);
    });

    it("Whirlpool", async () => {
      const [whirlpool] = await getWhirlpoolAddress(
        tc.tokenMintA,
        tc.tokenMintB,
        tc.feeTierFeeIndex,
        tc.whirlpoolDeployment,
      );
      assert.strictEqual(whirlpool, tc.whirlpoolExpected);
    });

    it("WhirlpoolsConfigExtension", async () => {
      const [extension] = await getWhirlpoolsConfigExtensionAddress(
        tc.whirlpoolDeployment,
      );
      assert.strictEqual(extension, tc.extensionExpected);
    });
  });
});
