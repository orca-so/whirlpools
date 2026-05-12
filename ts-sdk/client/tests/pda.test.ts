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

const TEST_POSITON_ADDRESS = address(
  "2EtH4ZZStW8Ffh2CbbW4baekdtWgPLcBXfYQ6FRmMVsq",
);
const TEST_POSITION_MINT_ADDRESS = address(
  "6sf6fSK6tTubFA2LMCeTzt4c6DeNVyA6WpDDgtWs7a5p",
);
const TEST_WHIRLPOOL_ADDRESS = address(
  "2kJmUjxWBwL2NGPBV2PiA5hWtmLCqcKY6reQgkrPtaeS",
);
const TEST_TOKEN_MINT_ADDRESS = address(
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
);
const TEST_NATIVE_MINT_ADDRESS = address(
  "So11111111111111111111111111111111111111112",
);

const TEST_IMMUTABLE_WHIRLPOOL_ADDRESS = address(
  "DcMZ4NEbLkh7aAfy7Q4vPcAWVik6tSwfUf3FHDoRBvTG",
);
const TEST_IMMUTABLE_POSITION_ADDRESS = address(
  "28nFQJH8FHYxUvXc5orSZzcjmzWoByvzfBwi75Ep3f9u",
);
const TEST_IMMUTABLE_POSITION_MINT_ADDRESS = address(
  "6LdmNS8p3qLYrGcPeYby6zHRvZPq7cYDZTiBXCC3FNDs",
);
const TEST_IMMUTABLE_TOKEN_MINT_A = address(
  "CgH9igg7DmCYcQzh76o2VdcevuVmVUVAej7HcGeCwho2",
);
const TEST_IMMUTABLE_TOKEN_MINT_B = address(
  "E3fyHm5B2ddYnCBgMpt3nVYMXxxLdSZTUCKt9GhLdfLc",
);

describe("derive program accounts (mutable whirlpool)", () => {
  it("FeeTier", async () => {
    const [feeTier] = await getFeeTierAddress(1);
    assert.strictEqual(feeTier, "62dSkn5ktwY1PoKPNMArZA4bZsvyemuknWUnnQ2ATTuN");
  });

  it("LockConfig", async () => {
    const [lockConfig] = await getLockConfigAddress(TEST_POSITON_ADDRESS);
    assert.strictEqual(
      lockConfig,
      "3MaMYjnnqyZSs5kD7vbPKTyx3RkD6qHuSF94kvvKukKx",
    );
  });

  it("Oracle", async () => {
    const [oracle] = await getOracleAddress(TEST_WHIRLPOOL_ADDRESS);
    assert.strictEqual(oracle, "821SHenpVGYY7BCXUzNhs8Xi4grG557fqRw4wzgaPQcS");
  });

  it("Position", async () => {
    const [position] = await getPositionAddress(TEST_POSITION_MINT_ADDRESS);
    assert.strictEqual(
      position,
      "2EtH4ZZStW8Ffh2CbbW4baekdtWgPLcBXfYQ6FRmMVsq",
    );
  });

  it("PositionBundle", async () => {
    const [positionBundle] = await getPositionBundleAddress(
      TEST_POSITION_MINT_ADDRESS,
    );
    assert.strictEqual(
      positionBundle,
      "At1QvbnANV6imkdNkfB4h1XsY4jbTzPAmScgjLCnM7jy",
    );
  });

  it("BundledPosition", async () => {
    const [bundledPosition] = await getBundledPositionAddress(
      TEST_POSITION_MINT_ADDRESS,
      0,
    );
    assert.strictEqual(
      bundledPosition,
      "9Zj8oWYVQdBCtqMn9Z3YyGo8o7hVXLEUZ5x5no5ykVm6",
    );
  });

  it("TickArray", async () => {
    const [tickArray] = await getTickArrayAddress(TEST_WHIRLPOOL_ADDRESS, 0);
    assert.strictEqual(
      tickArray,
      "8PhPzk7n4wU98Z6XCbVtPai2LtXSxYnfjkmgWuoAU8Zy",
    );
  });

  it("TokenBadge", async () => {
    const [tokenBadge] = await getTokenBadgeAddress(TEST_TOKEN_MINT_ADDRESS);
    assert.strictEqual(
      tokenBadge,
      "HX5iftnCxhtu11ys3ZuWbvUqo7cyPYaVNZBrLL67Hrbm",
    );
  });

  it("Whirlpool", async () => {
    const [whirlpool] = await getWhirlpoolAddress(
      TEST_NATIVE_MINT_ADDRESS,
      TEST_TOKEN_MINT_ADDRESS,
      2,
    );
    assert.strictEqual(
      whirlpool,
      "JDQ9GDphXV5ENDrAQtRFvT98m3JwsVJJk8BYHoX8uTAg",
    );
  });

  it("WhirlpoolsConfigExtension", async () => {
    const [extension] = await getWhirlpoolsConfigExtensionAddress(
      WhirlpoolDeployment.mainnet,
    );
    assert.strictEqual(
      extension,
      "777H5H3Tp9U11uRVRzFwM8BinfiakbaLT8vQpeuhvEiH",
    );
  });
});

describe("derive program accounts (immutable whirlpool)", () => {
  it("FeeTier", async () => {
    const [feeTier] = await getFeeTierAddress(
      1025,
      WhirlpoolDeployment.mainnetImmutable,
    );
    assert.strictEqual(feeTier, "eDDRZSrsaprxbkmhRzDWY3gxAGKQj438e2TXcbobQME");
  });

  it("LockConfig", async () => {
    const [lockConfig] = await getLockConfigAddress(
      TEST_IMMUTABLE_POSITION_MINT_ADDRESS,
      WhirlpoolDeployment.mainnetImmutable.programId,
    );
    assert.strictEqual(
      lockConfig,
      "3k4JPPrK1yiEZUgHWugbckRkkUrpnnCA4ujmerJzxENU",
    );
  });

  it("Oracle", async () => {
    const [oracle] = await getOracleAddress(
      TEST_IMMUTABLE_WHIRLPOOL_ADDRESS,
      WhirlpoolDeployment.mainnetImmutable.programId,
    );
    assert.strictEqual(oracle, "F7hHjRkVMEGsgEgyF1N9RrQKBPSU5QL1xmKGCYUwBY9M");
  });

  it("Position", async () => {
    const [position] = await getPositionAddress(
      TEST_IMMUTABLE_POSITION_MINT_ADDRESS,
      WhirlpoolDeployment.mainnetImmutable.programId,
    );
    assert.strictEqual(
      position,
      "28nFQJH8FHYxUvXc5orSZzcjmzWoByvzfBwi75Ep3f9u",
    );
  });

  it("PositionBundle", async () => {
    const [positionBundle] = await getPositionBundleAddress(
      TEST_IMMUTABLE_POSITION_MINT_ADDRESS,
      WhirlpoolDeployment.mainnetImmutable.programId,
    );
    assert.strictEqual(
      positionBundle,
      "CVTZ5u8yjGngtpZ5WRx536ty8jiMCFkzwrr5TJW5FpR7",
    );
  });

  it("BundledPosition", async () => {
    const [bundledPosition] = await getBundledPositionAddress(
      TEST_IMMUTABLE_POSITION_ADDRESS,
      0,
      WhirlpoolDeployment.mainnetImmutable.programId,
    );
    assert.strictEqual(
      bundledPosition,
      "Ew84d962t5uHAnwKifZyotxmxjrZ5xokCtgtxD1ToRzh",
    );
  });

  it("TickArray", async () => {
    const [tickArray] = await getTickArrayAddress(
      TEST_IMMUTABLE_WHIRLPOOL_ADDRESS,
      0,
      WhirlpoolDeployment.mainnetImmutable.programId,
    );
    assert.strictEqual(
      tickArray,
      "38qJYa1ZPJHa23wN3Azrt6Pkp7vEiV2Xbxzuz5rdotGh",
    );
  });

  it("TokenBadge", async () => {
    const [tokenBadge] = await getTokenBadgeAddress(
      TEST_IMMUTABLE_TOKEN_MINT_A,
      WhirlpoolDeployment.mainnetImmutable,
    );
    assert.strictEqual(
      tokenBadge,
      "DsFspoBifWBAZTqo2c6JEXxqxYEuDyNbr8tgATgRYCBu",
    );
  });

  it("Whirlpool", async () => {
    const [whirlpool] = await getWhirlpoolAddress(
      TEST_IMMUTABLE_TOKEN_MINT_A,
      TEST_IMMUTABLE_TOKEN_MINT_B,
      1025,
      WhirlpoolDeployment.mainnetImmutable,
    );
    assert.strictEqual(
      whirlpool,
      "DcMZ4NEbLkh7aAfy7Q4vPcAWVik6tSwfUf3FHDoRBvTG",
    );
  });

  it("WhirlpoolsConfigExtension", async () => {
    const [extension] = await getWhirlpoolsConfigExtensionAddress(
      WhirlpoolDeployment.mainnetImmutable,
    );
    assert.strictEqual(
      extension,
      "4Bsw8VVuegLmKQh2reevMBr2xw5R76WaJRKCvvxgcQrN",
    );
  });
});
