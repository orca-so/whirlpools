import { describe, it, afterAll } from "vitest";
import {
  DEFAULT_ADDRESS,
  FUNDER,
  SLIPPAGE_TOLERANCE_BPS,
  resetConfiguration,
  setDefaultFunder,
  setDefaultSlippageToleranceBps,
  setNativeMintWrappingStrategy,
  setWhirlpoolsConfig,
  NATIVE_MINT_WRAPPING_STRATEGY,
  WHIRLPOOLS_CONFIG_ADDRESS,
  WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
  DEFAULT_SLIPPAGE_TOLERANCE_BPS,
  DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY,
  DEFAULT_WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
  DEFAULT_WHIRLPOOLS_CONFIG_ADDRESSES,
} from "../src/config";
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
  });
});
