import { address } from "@solana/kit";
import assert from "assert";
import { describe, it } from "vitest";
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

const TEST_WHIRLPOOLS_CONFIG_ADDRESS = address(
  "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
);
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

describe("derive program accounts", () => {
  it("FeeTier", async () => {
    const address = await getFeeTierAddress(TEST_WHIRLPOOLS_CONFIG_ADDRESS, 1);
    assert.strictEqual(
      address[0],
      "62dSkn5ktwY1PoKPNMArZA4bZsvyemuknWUnnQ2ATTuN",
    );
  });

  it("LockConfig", async () => {
    const address = await getLockConfigAddress(TEST_POSITON_ADDRESS);
    assert.strictEqual(
      address[0],
      "3MaMYjnnqyZSs5kD7vbPKTyx3RkD6qHuSF94kvvKukKx",
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
      "At1QvbnANV6imkdNkfB4h1XsY4jbTzPAmScgjLCnM7jy",
    );
  });

  it("BundledPosition", async () => {
    const address = await getBundledPositionAddress(
      TEST_POSITION_MINT_ADDRESS,
      0,
    );
    assert.strictEqual(
      address[0],
      "9Zj8oWYVQdBCtqMn9Z3YyGo8o7hVXLEUZ5x5no5ykVm6",
    );
  });

  it("TickArray", async () => {
    const address = await getTickArrayAddress(TEST_WHIRLPOOL_ADDRESS, 0);
    assert.strictEqual(
      address[0],
      "8PhPzk7n4wU98Z6XCbVtPai2LtXSxYnfjkmgWuoAU8Zy",
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

describe("runtime program selector", () => {
  it("WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS matches the canonical pubkey", async () => {
    const { WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS } = await import(
      "../src/program"
    );
    assert.strictEqual(
      WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS,
      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    );
  });

  it("WHIRLPOOL_IMMUTABLE_PROGRAM_ADDRESS matches the canonical pubkey", async () => {
    const { WHIRLPOOL_IMMUTABLE_PROGRAM_ADDRESS } = await import(
      "../src/program"
    );
    assert.strictEqual(
      WHIRLPOOL_IMMUTABLE_PROGRAM_ADDRESS,
      "iwhrLHdsgrvmnwU8GF2FSmyabSMjfHwFGJAX2ufJ3ZN",
    );
  });

  it("getWhirlpoolProgramAddress defaults to the mutable program", async () => {
    const {
      WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS,
      getWhirlpoolProgramAddress,
      resetWhirlpoolProgram,
    } = await import("../src/program");
    try {
      resetWhirlpoolProgram();
      assert.strictEqual(
        getWhirlpoolProgramAddress(),
        WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS,
      );
    } finally {
      resetWhirlpoolProgram();
    }
  });

  it("setWhirlpoolProgram returns the previously selected address", async () => {
    const {
      WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS,
      WHIRLPOOL_IMMUTABLE_PROGRAM_ADDRESS,
      resetWhirlpoolProgram,
      setWhirlpoolProgram,
    } = await import("../src/program");
    try {
      resetWhirlpoolProgram();
      // Default state -> immutable returns mutable.
      const previousFromMutable = setWhirlpoolProgram("immutable");
      assert.strictEqual(
        previousFromMutable,
        WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS,
      );
      // Immutable -> mutable returns immutable.
      const previousFromImmutable = setWhirlpoolProgram("mutable");
      assert.strictEqual(
        previousFromImmutable,
        WHIRLPOOL_IMMUTABLE_PROGRAM_ADDRESS,
      );
    } finally {
      resetWhirlpoolProgram();
    }
  });

  it("setWhirlpoolProgram accepts an arbitrary address", async () => {
    const {
      getWhirlpoolProgramAddress,
      resetWhirlpoolProgram,
      setWhirlpoolProgram,
    } = await import("../src/program");
    const fork = address("11111111111111111111111111111111");
    try {
      setWhirlpoolProgram(fork);
      assert.strictEqual(getWhirlpoolProgramAddress(), fork);
    } finally {
      resetWhirlpoolProgram();
    }
  });

  it("resetWhirlpoolProgram restores the mutable default", async () => {
    const {
      WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS,
      getWhirlpoolProgramAddress,
      resetWhirlpoolProgram,
      setWhirlpoolProgram,
    } = await import("../src/program");
    setWhirlpoolProgram("immutable");
    resetWhirlpoolProgram();
    assert.strictEqual(
      getWhirlpoolProgramAddress(),
      WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS,
    );
  });

  it("PDA derivation flips when switching to the immutable program", async () => {
    const { resetWhirlpoolProgram, setWhirlpoolProgram } = await import(
      "../src/program"
    );

    try {
      setWhirlpoolProgram("mutable");
      const mutable = await getWhirlpoolAddress(
        TEST_WHIRLPOOLS_CONFIG_ADDRESS,
        TEST_NATIVE_MINT_ADDRESS,
        TEST_TOKEN_MINT_ADDRESS,
        2,
      );

      setWhirlpoolProgram("immutable");
      const immutable = await getWhirlpoolAddress(
        TEST_WHIRLPOOLS_CONFIG_ADDRESS,
        TEST_NATIVE_MINT_ADDRESS,
        TEST_TOKEN_MINT_ADDRESS,
        2,
      );

      assert.notStrictEqual(mutable[0], immutable[0]);
    } finally {
      resetWhirlpoolProgram();
    }
  });

  it("every PDA helper picks up the immutable program", async () => {
    const { resetWhirlpoolProgram, setWhirlpoolProgram } = await import(
      "../src/program"
    );

    const helpers = [
      () =>
        getWhirlpoolAddress(
          TEST_WHIRLPOOLS_CONFIG_ADDRESS,
          TEST_NATIVE_MINT_ADDRESS,
          TEST_TOKEN_MINT_ADDRESS,
          2,
        ),
      () => getFeeTierAddress(TEST_WHIRLPOOLS_CONFIG_ADDRESS, 1),
      () => getOracleAddress(TEST_WHIRLPOOL_ADDRESS),
      () => getPositionAddress(TEST_POSITION_MINT_ADDRESS),
      () => getPositionBundleAddress(TEST_POSITION_MINT_ADDRESS),
      () => getBundledPositionAddress(TEST_POSITION_MINT_ADDRESS, 0),
      () => getTickArrayAddress(TEST_WHIRLPOOL_ADDRESS, 0),
      () =>
        getTokenBadgeAddress(
          TEST_WHIRLPOOLS_CONFIG_ADDRESS,
          TEST_TOKEN_MINT_ADDRESS,
        ),
      () => getLockConfigAddress(TEST_POSITON_ADDRESS),
      () => getWhirlpoolsConfigExtensionAddress(TEST_WHIRLPOOLS_CONFIG_ADDRESS),
    ];

    try {
      setWhirlpoolProgram("mutable");
      const mutableAddresses = await Promise.all(helpers.map((fn) => fn()));

      setWhirlpoolProgram("immutable");
      const immutableAddresses = await Promise.all(helpers.map((fn) => fn()));

      mutableAddresses.forEach((mutable, i) => {
        assert.notStrictEqual(
          mutable[0],
          immutableAddresses[i][0],
          `PDA helper #${i} did not flip when the selector changed`,
        );
      });
    } finally {
      resetWhirlpoolProgram();
    }
  });

  it("returning to mutable yields identical addresses to the baseline", async () => {
    const { resetWhirlpoolProgram, setWhirlpoolProgram } = await import(
      "../src/program"
    );
    try {
      setWhirlpoolProgram("mutable");
      const baseline = await getWhirlpoolAddress(
        TEST_WHIRLPOOLS_CONFIG_ADDRESS,
        TEST_NATIVE_MINT_ADDRESS,
        TEST_TOKEN_MINT_ADDRESS,
        2,
      );

      setWhirlpoolProgram("immutable");
      setWhirlpoolProgram("mutable");

      const restored = await getWhirlpoolAddress(
        TEST_WHIRLPOOLS_CONFIG_ADDRESS,
        TEST_NATIVE_MINT_ADDRESS,
        TEST_TOKEN_MINT_ADDRESS,
        2,
      );

      assert.strictEqual(baseline[0], restored[0]);
    } finally {
      resetWhirlpoolProgram();
    }
  });
});
