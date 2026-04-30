import { describe, it, afterAll, afterEach } from "vitest";
import * as config from "../src/config";
import {
  DEFAULT_ADDRESS,
  FUNDER,
  SLIPPAGE_TOLERANCE_BPS,
  SOLANA_MAINNET_WHIRLPOOLS_IMMUTABLE_CONFIG_ADDRESS,
  SOLANA_MAINNET_WHIRLPOOLS_IMMUTABLE_CONFIG_EXTENSION_ADDRESS,
  getWhirlpoolProgram,
  resetConfiguration,
  setDefaultFunder,
  setDefaultSlippageToleranceBps,
  setNativeMintWrappingStrategy,
  setWhirlpoolProgram,
  setWhirlpoolsConfig,
  NATIVE_MINT_WRAPPING_STRATEGY,
  WHIRLPOOLS_CONFIG_ADDRESS,
  WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
  DEFAULT_SLIPPAGE_TOLERANCE_BPS,
  DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY,
  DEFAULT_WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
  DEFAULT_WHIRLPOOLS_CONFIG_ADDRESSES,
  ENFORCE_TOKEN_BALANCE_CHECK,
  DEFAULT_ENFORCE_TOKEN_BALANCE_CHECK,
  setEnforceTokenBalanceCheck,
} from "../src/config";
import {
  WHIRLPOOL_IMMUTABLE_PROGRAM_ADDRESS,
  WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS,
  getWhirlpoolAddress,
} from "@orca-so/whirlpools-client";
import assert from "assert";
import { address, createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";

// Tests in order, which is important here

describe("Configuration", () => {
  afterAll(() => {
    resetConfiguration();
  });

  it("Should be able to set whirlpool config", async () => {
    await setWhirlpoolsConfig(
      address("GdDMspJi2oQaKDtABKE24wAQgXhGBoxq8sC21st7GJ3E"),
    );
    assert.strictEqual(
      WHIRLPOOLS_CONFIG_ADDRESS,
      "GdDMspJi2oQaKDtABKE24wAQgXhGBoxq8sC21st7GJ3E",
    );
    assert.strictEqual(
      WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
      "Ez4MMUVb7VrKFcTSbi9Yz2ivXwdwCqJicnDaRHbe96Yk",
    );
  });

  it("Should be able to set whirlpools config based on network", async () => {
    await setWhirlpoolsConfig("eclipseTestnet");
    assert.strictEqual(
      WHIRLPOOLS_CONFIG_ADDRESS,
      DEFAULT_WHIRLPOOLS_CONFIG_ADDRESSES.eclipseTestnet,
    );
    assert.strictEqual(
      WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
      "6gUEB962oFdZtwoVyXNya9TfGWnBEbYNYt8UdvzT6PSf",
    );
  });

  it("Should be able to set default funder to an address", () => {
    setDefaultFunder(DEFAULT_ADDRESS);
    assert.strictEqual(FUNDER.address, DEFAULT_ADDRESS);
  });

  it("Should be able to set default funder to a signer", async () => {
    const bytes = new Uint8Array(32);
    const signer = await createKeyPairSignerFromPrivateKeyBytes(bytes);
    setDefaultFunder(signer);
    assert.strictEqual(FUNDER.address, signer.address);
  });

  it("Should be able to set the default slippage tolerance", () => {
    setDefaultSlippageToleranceBps(200);
    assert.strictEqual(SLIPPAGE_TOLERANCE_BPS, 200);
  });

  it("Should be able to set the native mint wrapping strategy", () => {
    setNativeMintWrappingStrategy("ata");
    assert.strictEqual(NATIVE_MINT_WRAPPING_STRATEGY, "ata");
  });

  it("Should be able to set the enforce token balance check", () => {
    setEnforceTokenBalanceCheck(true);
    assert.strictEqual(ENFORCE_TOKEN_BALANCE_CHECK, true);

    setEnforceTokenBalanceCheck(false);
    assert.strictEqual(ENFORCE_TOKEN_BALANCE_CHECK, false);
  });

  it("Should be able to reset the configuration", () => {
    resetConfiguration();
    assert.strictEqual(
      WHIRLPOOLS_CONFIG_ADDRESS,
      DEFAULT_WHIRLPOOLS_CONFIG_ADDRESSES.solanaMainnet,
    );
    assert.strictEqual(
      WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
      DEFAULT_WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
    );
    assert.strictEqual(FUNDER.address, DEFAULT_ADDRESS);
    assert.strictEqual(SLIPPAGE_TOLERANCE_BPS, DEFAULT_SLIPPAGE_TOLERANCE_BPS);
    assert.strictEqual(
      NATIVE_MINT_WRAPPING_STRATEGY,
      DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY,
    );
    assert.strictEqual(
      ENFORCE_TOKEN_BALANCE_CHECK,
      DEFAULT_ENFORCE_TOKEN_BALANCE_CHECK,
    );
  });
});

describe("Whirlpool program selector", () => {
  // Restore state after each test so leaks don't bleed into the rest of the
  // suite — tests that rely on default `current_whirlpool_id()` would
  // otherwise observe immutable state and derive unexpected PDAs.
  afterEach(() => {
    resetConfiguration();
  });

  it("getWhirlpoolProgram defaults to the mutable program", () => {
    resetConfiguration();
    assert.strictEqual(
      getWhirlpoolProgram(),
      WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS,
    );
  });

  it("setWhirlpoolProgram('immutable') flips the active program", () => {
    setWhirlpoolProgram("immutable");
    assert.strictEqual(
      getWhirlpoolProgram(),
      WHIRLPOOL_IMMUTABLE_PROGRAM_ADDRESS,
    );
  });

  it("setWhirlpoolProgram('immutable') snaps the config addresses to the immutable pair", () => {
    resetConfiguration();
    setWhirlpoolProgram("immutable");
    // Re-read via the module so we observe the live binding, not the
    // imported snapshot from before the mutation.
    assert.strictEqual(
      config.WHIRLPOOLS_CONFIG_ADDRESS,
      SOLANA_MAINNET_WHIRLPOOLS_IMMUTABLE_CONFIG_ADDRESS,
    );
    assert.strictEqual(
      config.WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
      SOLANA_MAINNET_WHIRLPOOLS_IMMUTABLE_CONFIG_EXTENSION_ADDRESS,
    );
  });

  it("setWhirlpoolProgram('mutable') restores the mutable mainnet config pair", () => {
    setWhirlpoolProgram("immutable");
    setWhirlpoolProgram("mutable");
    assert.strictEqual(
      config.WHIRLPOOLS_CONFIG_ADDRESS,
      DEFAULT_WHIRLPOOLS_CONFIG_ADDRESSES.solanaMainnet,
    );
    assert.strictEqual(
      config.WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
      DEFAULT_WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
    );
  });

  it("setWhirlpoolProgram returns the previously selected address", () => {
    resetConfiguration();
    const previous = setWhirlpoolProgram("immutable");
    assert.strictEqual(previous, WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS);
  });

  it("setWhirlpoolProgram accepts an arbitrary address (forks/localnet)", () => {
    // Pre-condition: drift the config so we can observe it staying put.
    setWhirlpoolProgram("immutable");
    const fork = address("11111111111111111111111111111111");
    setWhirlpoolProgram(fork);

    assert.strictEqual(getWhirlpoolProgram(), fork);
    // Custom addresses must NOT touch the config pair — otherwise targeting
    // a fork would silently lose the user's WhirlpoolsConfig selection.
    assert.strictEqual(
      config.WHIRLPOOLS_CONFIG_ADDRESS,
      SOLANA_MAINNET_WHIRLPOOLS_IMMUTABLE_CONFIG_ADDRESS,
    );
    assert.strictEqual(
      config.WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
      SOLANA_MAINNET_WHIRLPOOLS_IMMUTABLE_CONFIG_EXTENSION_ADDRESS,
    );
  });

  it("resetConfiguration restores the mutable default program", () => {
    setWhirlpoolProgram("immutable");
    resetConfiguration();
    assert.strictEqual(
      getWhirlpoolProgram(),
      WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS,
    );
  });

  it("PDA helpers reflect the high-level setter", async () => {
    const config = address("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ");
    const tokenA = address("So11111111111111111111111111111111111111112");
    const tokenB = address("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo");

    setWhirlpoolProgram("mutable");
    const mutable = await getWhirlpoolAddress(config, tokenA, tokenB, 2);

    setWhirlpoolProgram("immutable");
    const immutable = await getWhirlpoolAddress(config, tokenA, tokenB, 2);

    assert.notStrictEqual(mutable[0], immutable[0]);
  });

  it("setWhirlpoolsConfig updates mainnet properly", async () => {
    // Defaults are correct
    assert.strictEqual(
      WHIRLPOOLS_CONFIG_ADDRESS,
      DEFAULT_WHIRLPOOLS_CONFIG_ADDRESSES.solanaMainnet,
    );
    assert.strictEqual(
      WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
      DEFAULT_WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
    );

    // Sets immutable config and extension correctly
    setWhirlpoolProgram("immutable");
    assert.strictEqual(
      WHIRLPOOLS_CONFIG_ADDRESS,
      SOLANA_MAINNET_WHIRLPOOLS_IMMUTABLE_CONFIG_ADDRESS,
    );
    assert.strictEqual(
      WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
      SOLANA_MAINNET_WHIRLPOOLS_IMMUTABLE_CONFIG_EXTENSION_ADDRESS,
    );

    // Sets immutable config and extension correctly
    setWhirlpoolsConfig("solanaMainnet");
    assert.strictEqual(
      WHIRLPOOLS_CONFIG_ADDRESS,
      SOLANA_MAINNET_WHIRLPOOLS_IMMUTABLE_CONFIG_ADDRESS,
    );
    assert.strictEqual(
      WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
      SOLANA_MAINNET_WHIRLPOOLS_IMMUTABLE_CONFIG_EXTENSION_ADDRESS,
    );
  });
});
