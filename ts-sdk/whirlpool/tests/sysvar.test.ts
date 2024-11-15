import { describe, it, beforeAll } from "vitest";
import type { SysvarRent } from "@solana/sysvars";
import { lamports } from "@solana/web3.js";
import { calculateMinimumBalance } from "../src/sysvar";
import assert from "assert";
import { setupAta, setupMint } from "./utils/token";
import { fetchMint } from "@solana-program/token-2022";
import { rpc } from "./utils/mockRpc";
import { getTokenSizeForMint } from "../src/token";

describe("Sysvar", () => {
  let rent: SysvarRent;

  beforeAll(async () => {
    rent = {
      lamportsPerByteYear: lamports(3480n),
      exemptionThreshold: 2.0,
      burnPercent: 0,
    };
  });

  it("Should calculate the correct minimum balance for a token account", async () => {
    const mint = await setupMint();
    const ata = await setupAta(mint);
    const ataAccount = await rpc.getAccountInfo(ata).send();
    const ataAccountRent = ataAccount.value?.lamports;

    const mintAccount = await fetchMint(rpc, mint);
    const tokenSize = getTokenSizeForMint(mintAccount);
    const calcultatedMinimumBalance = calculateMinimumBalance(rent, tokenSize);

    assert.strictEqual(calcultatedMinimumBalance, ataAccountRent);
  });

  it("Should handle zero data size", () => {
    const dataSize = 0;
    const result = calculateMinimumBalance(rent, dataSize);

    assert.strictEqual(result, 890880n);
  });
});
