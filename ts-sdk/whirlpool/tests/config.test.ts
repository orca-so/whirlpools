import { describe, it } from "mocha";
import {
  DEFAULT_ADDRESS,
  DEFAULT_FUNDER,
  DEFAULT_SLIPPAGE_TOLERANCE_BPS,
  resetConfiguration,
  setDefaultFunder,
  setDefaultSlippageToleranceBps,
  setSolWrappingStrategy,
  setWhirlpoolsConfig,
  SOL_WRAPPING_STRATEGY,
  WHIRLPOOLS_CONFIG_ADDRESS,
  WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS,
} from "../src/config";
import assert from "assert";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/web3.js";

describe("Configuration", () => {
  afterEach(async () => {
    await resetConfiguration();
  });

  it("Should be able to set whirlpool config", async () => {
    await setWhirlpoolsConfig(DEFAULT_ADDRESS);
    assert.strictEqual(WHIRLPOOLS_CONFIG_ADDRESS, DEFAULT_ADDRESS);
    assert.strictEqual(WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS, "");
  });

  it("Should be able to set default funder to an address", () => {
    setDefaultFunder(DEFAULT_ADDRESS);
    assert.strictEqual(DEFAULT_FUNDER.address, DEFAULT_ADDRESS);
  });

  it("Should be able to set default funder to a signer", async () => {
    const bytes = new Uint8Array(64);
    const signer = await createKeyPairSignerFromPrivateKeyBytes(bytes);
    setDefaultFunder(signer);
    assert.strictEqual(DEFAULT_FUNDER.address, DEFAULT_ADDRESS);
  });

  it("Should be able to set the default slippage tolerance", () => {
    setDefaultSlippageToleranceBps(200);
    assert.strictEqual(DEFAULT_SLIPPAGE_TOLERANCE_BPS, 200);
  });

  it("Should be able to set the sol wrapping strategy", () => {
    setSolWrappingStrategy("ata");
    assert.strictEqual(SOL_WRAPPING_STRATEGY, "ata");
  });

});
