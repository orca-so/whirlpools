import { describe, it } from "vitest";
import type { SysvarRent } from "@solana/sysvars";
import { lamports } from "@solana/kit";
import { calculateMinimumBalanceForRentExemption } from "../src/sysvar";
import assert from "assert";

describe("Sysvar", () => {
  const rent: SysvarRent = {
    lamportsPerByteYear: lamports(10n),
    exemptionThreshold: 1.0,
    burnPercent: 0,
  };

  it("Should calculate the correct minimum balance for a token account", () => {
    const tokenSize = 165;
    const calcultatedMinimumBalance = calculateMinimumBalanceForRentExemption(
      rent,
      tokenSize,
    );

    const expectedMinimumBalance = lamports(2930n);
    assert.strictEqual(calcultatedMinimumBalance, expectedMinimumBalance);
  });

  it("Should handle zero data size", () => {
    const dataSize = 0;
    const result = calculateMinimumBalanceForRentExemption(rent, dataSize);

    const expectedMinimumBalance = lamports(1280n);
    assert.strictEqual(result, expectedMinimumBalance);
  });
});
