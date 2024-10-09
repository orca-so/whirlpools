import { address } from "@solana/web3.js";
import assert from "assert";
import { getFeeTierAddress } from "../src/pda/feeTier";
import { getOracleAddress } from "../src/pda/oracle";
import { getPositionAddress } from "../src/pda/position";
import { getPositionBundleAddress } from "../src/pda/positionBundle";
import { getTickArrayAddress } from "../src/pda/tickArray";
import { getTokenBadgeAddress } from "../src/pda/tokenBadge";
import { getWhirlpoolAddress } from "../src/pda/whirlpool";
import { getWhirlpoolsConfigExtensionAddress } from "../src/pda/whirlpoolsConfigExtension";

const TEST_WHIRLPOOLS_CONFIG_ADDRESS = address(
  "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
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

describe("derive program accounts", () => {
  it("FeeTier", async () => {
    const address = await getFeeTierAddress(TEST_WHIRLPOOLS_CONFIG_ADDRESS, 1);
    assert.strictEqual(
      address[0],
      "62dSkn5ktwY1PoKPNMArZA4bZsvyemuknWUnnQ2ATTuN",
    );
  });

  it("Oracle", async () => {
    const address = await getOracleAddress(TEST_WHIRLPOOL_ADDRESS);
    assert.strictEqual(
      address[0],
      "821SHenpVGYY7BCXUzNhs8Xi4grG557fqRw4wzgaPQcS",
    );
  });

  it("Position", async () => {
    const address = await getPositionAddress(TEST_POSITION_MINT_ADDRESS);
    assert.strictEqual(
      address[0],
      "2EtH4ZZStW8Ffh2CbbW4baekdtWgPLcBXfYQ6FRmMVsq",
    );
  });

  it("PositionBundle", async () => {
    const address = await getPositionBundleAddress(TEST_POSITION_MINT_ADDRESS);
    assert.strictEqual(
      address[0],
      "2EtH4ZZStW8Ffh2CbbW4baekdtWgPLcBXfYQ6FRmMVsq",
    );
  });

  it("TickArray", async () => {
    const address = await getTickArrayAddress(TEST_WHIRLPOOL_ADDRESS, -2894848);
    assert.strictEqual(
      address[0],
      "7me8W7puQ5tNA15r7ocNX9tFQD9pwtzFDTSdHMMSmDRt",
    );
  });

  it("TokenBadge", async () => {
    const address = await getTokenBadgeAddress(
      TEST_WHIRLPOOLS_CONFIG_ADDRESS,
      TEST_TOKEN_MINT_ADDRESS,
    );
    assert.strictEqual(
      address[0],
      "HX5iftnCxhtu11ys3ZuWbvUqo7cyPYaVNZBrLL67Hrbm",
    );
  });

  it("Whirlpool", async () => {
    const address = await getWhirlpoolAddress(
      TEST_WHIRLPOOLS_CONFIG_ADDRESS,
      TEST_NATIVE_MINT_ADDRESS,
      TEST_TOKEN_MINT_ADDRESS,
      2,
    );
    assert.strictEqual(
      address[0],
      "JDQ9GDphXV5ENDrAQtRFvT98m3JwsVJJk8BYHoX8uTAg",
    );
  });

  it("WhilrpoolsConfigExtension", async () => {
    const address = await getWhirlpoolsConfigExtensionAddress(
      TEST_WHIRLPOOLS_CONFIG_ADDRESS,
    );
    assert.strictEqual(
      address[0],
      "777H5H3Tp9U11uRVRzFwM8BinfiakbaLT8vQpeuhvEiH",
    );
  });
});
