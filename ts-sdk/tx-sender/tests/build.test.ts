import { describe, expect, it } from "vitest";
import { buildTransaction } from "../src/buildTransaction";
import { vi } from "vitest";
import * as compatibility from "../src/compatibility";
import * as jito from "../src/jito";
import type {
  IInstruction,
  ITransactionMessageWithFeePayerSigner,
  Rpc,
  SolanaRpcApi,
  Address,
} from "@solana/kit";
import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { address } from "@solana/kit";
import assert from "assert";
import {
  setRpc,
  setPriorityFeeSetting,
  setJitoTipSetting,
  setComputeUnitMarginMultiplier,
} from "../src/config";
import { decodeTransaction, encodeTransaction } from "./utils";
import { fetchAllMaybeAddressLookupTable } from "@solana-program/address-lookup-table";

const rpcUrl = "https://api.mainnet-beta.solana.com";
const computeUnitProgramId = "ComputeBudget111111111111111111111111111111";
const systemProgramId = "11111111111111111111111111111111";

const getLatestBlockhashMockRpcResponse = {
  value: {
    blockhash: "123456789abcdef",
    lastValidBlockHeight: 123456789,
  },
};

vi.mock("@solana-program/address-lookup-table", async () => {
  const actual = await vi.importActual("@solana-program/address-lookup-table");
  return {
    ...actual,
    fetchAllMaybeAddressLookupTable: vi
      .fn()
      .mockImplementation((rpc, addresses) =>
        Promise.resolve(
          addresses.map((addr: Address) => ({
            address: addr,
            exists: true,
            data: {
              addresses: ["addr1234567890abcdef", "addr2345678901bcdef0"],
            },
          })),
        ),
      ),
  };
});

vi.mock("@solana/kit", async () => {
  const actual = await vi.importActual("@solana/kit");
  return {
    ...actual,
    signTransactionMessageWithSigners: vi.fn().mockImplementation(
      (
        message: ITransactionMessageWithFeePayerSigner & {
          instructions: IInstruction[];
          version: 0;
        },
      ) => encodeTransaction(message.instructions, message.feePayer),
    ),
    getComputeUnitEstimateForTransactionMessageFactory: vi
      .fn()
      .mockReturnValue(vi.fn().mockResolvedValue(50_000)),
  };
});

const mockRpc = {
  getLatestBlockhash: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue(getLatestBlockhashMockRpcResponse),
  }),
  getRecentPrioritizationFees: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue([
      {
        prioritizationFee: BigInt(1000),
        slot: 123456789n,
      },
    ]),
  }),
  getGenesisHash: vi.fn().mockReturnValue({
    send: vi
      .fn()
      .mockResolvedValue("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"),
  }),
} as const satisfies Partial<Rpc<SolanaRpcApi>>;

vi.spyOn(compatibility, "rpcFromUrl").mockReturnValue(
  mockRpc as unknown as Rpc<SolanaRpcApi>,
);

vi.spyOn(jito, "recentJitoTip").mockResolvedValue(BigInt(1000));

describe("Build Transaction", async () => {
  const signer = await generateKeyPairSigner();
  const recipient = address("GdDMspJi2oQaKDtABKE24wAQgXhGBoxq8sC21st7GJ3E");
  const amount = 1_000_000n;

  setPriorityFeeSetting({ type: "none" });
  setJitoTipSetting({ type: "none" });
  setComputeUnitMarginMultiplier(1.05);

  const transferInstruction = getTransferSolInstruction({
    source: signer,
    destination: recipient,
    amount,
  });
  it("Should fail when RPC URL is not set", async () => {
    await assert.rejects(
      async () => {
        await buildTransaction([transferInstruction], signer);
      },
      {
        message: "Connection not initialized. Call setRpc() first",
      },
    );
  });

  it("Should build basic transaction with no priority fees", async () => {
    const _rpc = await setRpc(rpcUrl, false); // testing that returning the rpc works
    const message = await buildTransaction([transferInstruction], signer);

    const decodedIxs = await decodeTransaction(
      getBase64EncodedWireTransaction(message),
    );

    const computeUnitProgramixCount = decodedIxs.filter(
      (ix) => ix.programAddress === computeUnitProgramId,
    ).length;
    const systemProgramixCount = decodedIxs.filter(
      (ix) => ix.programAddress === systemProgramId,
    ).length;

    assert.strictEqual(systemProgramixCount, 1);
    assert.strictEqual(computeUnitProgramixCount, 1);
  });

  it("Should build transaction with exact priority fee", async () => {
    setJitoTipSetting({ type: "none" });
    setPriorityFeeSetting({
      type: "exact",
      amountLamports: 10_000n,
    });
    const message = await buildTransaction([transferInstruction], signer);

    const decodedIxs = await decodeTransaction(
      getBase64EncodedWireTransaction(message),
    );

    const computeUnitProgramixCount = decodedIxs.filter(
      (ix) => ix.programAddress === computeUnitProgramId,
    ).length;
    const systemProgramixCount = decodedIxs.filter(
      (ix) => ix.programAddress === systemProgramId,
    ).length;

    assert.strictEqual(systemProgramixCount, 1);
    assert.strictEqual(computeUnitProgramixCount, 2);
  });

  it("Should build transaction with dynamic priority fee", async () => {
    setJitoTipSetting({ type: "none" });
    setPriorityFeeSetting({
      type: "dynamic",
      maxCapLamports: 100_000n,
    });

    const message = await buildTransaction([transferInstruction], signer);

    assert.strictEqual(
      mockRpc.getRecentPrioritizationFees().send.mock.calls.length,
      1,
    );
    const decodedIxs = await decodeTransaction(
      getBase64EncodedWireTransaction(message),
    );

    const computeUnitProgramixCount = decodedIxs.filter(
      (ix) => ix.programAddress === computeUnitProgramId,
    ).length;
    const systemProgramixCount = decodedIxs.filter(
      (ix) => ix.programAddress === systemProgramId,
    ).length;

    assert.strictEqual(systemProgramixCount, 1);
    assert.strictEqual(computeUnitProgramixCount, 2);
  });

  it("Should build transaction with exact Jito tip", async () => {
    setPriorityFeeSetting({ type: "none" });
    setJitoTipSetting({
      type: "exact",
      amountLamports: 10_000n,
    });
    const message = await buildTransaction([transferInstruction], signer);

    const decodedIxs = await decodeTransaction(
      getBase64EncodedWireTransaction(message),
    );

    const computeUnitProgramixCount = decodedIxs.filter(
      (ix) => ix.programAddress === computeUnitProgramId,
    ).length;
    const systemProgramixCount = decodedIxs.filter(
      (ix) => ix.programAddress === systemProgramId,
    ).length;

    assert.strictEqual(computeUnitProgramixCount, 1);
    assert.strictEqual(systemProgramixCount, 2);
  });

  it("Should build transaction with dynamic Jito tip", async () => {
    setPriorityFeeSetting({ type: "none" });
    setJitoTipSetting({ type: "dynamic" });
    const message = await buildTransaction([transferInstruction], signer);
    const decodedIxs = await decodeTransaction(
      getBase64EncodedWireTransaction(message),
    );

    const computeUnitProgramixCount = decodedIxs.filter(
      (ix) => ix.programAddress === computeUnitProgramId,
    ).length;
    const systemProgramixCount = decodedIxs.filter(
      (ix) => ix.programAddress === systemProgramId,
    ).length;

    assert.strictEqual(computeUnitProgramixCount, 1);
    assert.strictEqual(systemProgramixCount, 2);
  });

  it("Should build transaction with lookup tables", async () => {
    setPriorityFeeSetting({ type: "dynamic" });
    setJitoTipSetting({ type: "none" });
    const lookupTables = [
      address("BxZBuYQg7TzDyxBGe7pGCgwM1TRKcwZwcvDiGLVZhTxE"),
      address("HxZBuYQg7TzDyxBGe7pGCgwM1TRKcwZwcvDiGLVZhTxF"),
    ];

    const message = await buildTransaction(
      [transferInstruction],
      signer,
      lookupTables,
    );
    const decodedIxs = await decodeTransaction(
      getBase64EncodedWireTransaction(message),
    );

    const computeUnitProgramixCount = decodedIxs.filter(
      (ix) => ix.programAddress === computeUnitProgramId,
    ).length;
    const systemProgramixCount = decodedIxs.filter(
      (ix) => ix.programAddress === systemProgramId,
    ).length;

    assert.strictEqual(computeUnitProgramixCount, 2);
    assert.strictEqual(systemProgramixCount, 1);

    expect(vi.mocked(fetchAllMaybeAddressLookupTable)).toHaveBeenCalledWith(
      mockRpc,
      lookupTables,
    );
  });
});
