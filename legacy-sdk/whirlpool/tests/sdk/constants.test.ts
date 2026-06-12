import * as assert from "assert";
import { PublicKey } from "@solana/web3.js";
import {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  ORCA_WHIRLPOOL_PROGRAM_ID_IMMUTABLE,
  ORCA_WHIRLPOOLS_CONFIG,
  ORCA_WHIRLPOOLS_CONFIG_IMMUTABLE,
} from "../../src";

describe("immutable whirlpool constants", () => {
  it("expose the documented immutable program id and config addresses", () => {
    assert.equal(
      ORCA_WHIRLPOOL_PROGRAM_ID_IMMUTABLE.toBase58(),
      "iwhrLHdsgrvmnwU8GF2FSmyabSMjfHwFGJAX2ufJ3ZN",
    );
    assert.equal(
      ORCA_WHIRLPOOLS_CONFIG_IMMUTABLE.toBase58(),
      "8pm8erUsaMpmZ47LttHAPgnDx7xGZUvxY4q47vTCs5Nj",
    );
  });

  it("are valid 32-byte public keys", () => {
    assert.ok(ORCA_WHIRLPOOL_PROGRAM_ID_IMMUTABLE instanceof PublicKey);
    assert.ok(ORCA_WHIRLPOOLS_CONFIG_IMMUTABLE instanceof PublicKey);
    assert.equal(ORCA_WHIRLPOOL_PROGRAM_ID_IMMUTABLE.toBytes().length, 32);
    assert.equal(ORCA_WHIRLPOOLS_CONFIG_IMMUTABLE.toBytes().length, 32);
  });

  it("are distinct from their mutable counterparts", () => {
    // The immutable deployment is a separate program with its own config; reusing the
    // mutable addresses here would silently point callers at the wrong deployment.
    assert.ok(
      !ORCA_WHIRLPOOL_PROGRAM_ID_IMMUTABLE.equals(ORCA_WHIRLPOOL_PROGRAM_ID),
    );
    assert.ok(!ORCA_WHIRLPOOLS_CONFIG_IMMUTABLE.equals(ORCA_WHIRLPOOLS_CONFIG));
  });
});
