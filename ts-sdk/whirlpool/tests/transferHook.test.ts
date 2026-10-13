import { fetchMint } from "@solana-program/token-2022";
import assert from "assert";
import { describe, it } from "vitest";
import {
  getExtraAccountMetaAddress,
  getExtraAccountMetasForTransferHook,
} from "../src/transferHook";
import { getTestContext, rpc, setRawAccount } from "./utils/mockRpc";
import {
  setupMintTETransferHook,
  TEST_TRANSFER_HOOK_PROGRAM_ADDRESS,
} from "./utils/tokenExtensions";

await getTestContext();

describe("getExtraAccountMetasForTransferHook", () => {
  it("returns undefined when ExtraAccountMetaList is missing", async () => {
    const mint = await setupMintTETransferHook();
    const mintAccount = await fetchMint(rpc, mint);
    const extra = await getExtraAccountMetasForTransferHook(
      rpc,
      mintAccount,
      mint,
      mint,
      mint,
    );
    assert.strictEqual(extra, undefined);
  });

  it("returns the hook program and ExtraAccountMetaList when the list exists", async () => {
    const mint = await setupMintTETransferHook();
    const extraAccountMetaAddress = await getExtraAccountMetaAddress(
      mint,
      TEST_TRANSFER_HOOK_PROGRAM_ADDRESS,
    );
    await setRawAccount(extraAccountMetaAddress, {
      lamports: 1_000_000,
      data: new Uint8Array(16),
      owner: TEST_TRANSFER_HOOK_PROGRAM_ADDRESS,
    });

    const mintAccount = await fetchMint(rpc, mint);
    const extra = await getExtraAccountMetasForTransferHook(
      rpc,
      mintAccount,
      mint,
      mint,
      mint,
    );
    assert.ok(extra);
    assert.strictEqual(extra.length, 2);
    assert.strictEqual(extra[0]?.address, TEST_TRANSFER_HOOK_PROGRAM_ADDRESS);
    assert.strictEqual(extra[1]?.address, extraAccountMetaAddress);
  });
});
