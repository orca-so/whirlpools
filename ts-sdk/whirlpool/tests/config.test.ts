import { describe, it, afterAll } from "vitest";
import {
  DEFAULT_ADDRESS,
  FUNDER,
  SLIPPAGE_TOLERANCE_BPS,
  resetConfiguration,
  setDefaultFunder,
  setDefaultSlippageToleranceBps,
  setNativeMintWrappingStrategy,
  NATIVE_MINT_WRAPPING_STRATEGY,
  DEFAULT_SLIPPAGE_TOLERANCE_BPS,
  DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY,
  ENFORCE_TOKEN_BALANCE_CHECK,
  DEFAULT_ENFORCE_TOKEN_BALANCE_CHECK,
  setEnforceTokenBalanceCheck,
  WhirlpoolDeployment,
} from "../src/config";
import assert from "assert";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";

// Tests in order, which is important here

describe("Configuration", () => {
  afterAll(() => {
    resetConfiguration();
  });

  it("Should expose named WhirlpoolDeployment constants", () => {
    assert.strictEqual(
      WhirlpoolDeployment.mainnet.configAddress,
      "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
    );
    assert.strictEqual(
      WhirlpoolDeployment.devnet.configAddress,
      "FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR",
    );
    assert.strictEqual(
      WhirlpoolDeployment.mainnet.programId,
      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    );
    assert.strictEqual(
      WhirlpoolDeployment.mainnetImmutable.programId,
      "iwhrLHdsgrvmnwU8GF2FSmyabSMjfHwFGJAX2ufJ3ZN",
    );
  });

  it("Should construct a custom WhirlpoolDeployment", () => {
    const custom = WhirlpoolDeployment.custom(
      WhirlpoolDeployment.mainnet.programId,
      "GdDMspJi2oQaKDtABKE24wAQgXhGBoxq8sC21st7GJ3E" as never,
    );
    assert.strictEqual(custom.programId, WhirlpoolDeployment.mainnet.programId);
    assert.strictEqual(
      custom.configAddress,
      "GdDMspJi2oQaKDtABKE24wAQgXhGBoxq8sC21st7GJ3E",
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
