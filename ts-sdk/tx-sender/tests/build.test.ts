import { describe, it } from "vitest";
import { buildTransaction } from "../src/buildTransaction";
import { vi } from "vitest";
import * as compatibility from "../src/compatibility";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  IInstruction,
  ITransactionMessageWithFeePayerSigner,
  Rpc,
} from "@solana/web3.js";
import { getTransferSolInstruction } from "@solana-program/system";
import { address } from "@solana/web3.js";

import assert from "assert";
import { init } from "../src/config";
import { decodeTransaction, encodeTransaction } from "./utils";

const rpcUrl = "https://api.mainnet-beta.solana.com";

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
          addresses.map((addr) => ({
            address: addr,
            exists: true,
            data: {
              addresses: ["addr1234567890abcdef", "addr2345678901bcdef0"],
            },
          }))
        )
      ),
  };
});

vi.mock("@solana/web3.js", async () => {
  const actual = await vi.importActual("@solana/web3.js");
  return {
    ...actual,
    signTransactionMessageWithSigners: vi.fn().mockImplementation(
      (
        message: ITransactionMessageWithFeePayerSigner & {
          instructions: IInstruction[];
          version: 0;
        }
      ) => encodeTransaction(message.instructions, message.feePayer)
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
} as unknown as Rpc<any>;

vi.spyOn(compatibility, "rpcFromUrl").mockReturnValue(mockRpc);

describe("Build Transaction", async () => {
  const signer = await generateKeyPairSigner();
  const recipient = address("GdDMspJi2oQaKDtABKE24wAQgXhGBoxq8sC21st7GJ3E");
  const amount = 1_000_000n;
  init({ connectionContext: { rpcUrl, isTriton: false } });

  const transferInstruction = getTransferSolInstruction({
    source: signer,
    destination: recipient,
    amount,
  });

  it("Should build basic transaction with no priority fees", async () => {
    const message = await buildTransaction([transferInstruction], signer, {
      priorityFee: { type: "none" },
      jito: { type: "none" },
      chainId: "solana",
    });

    assert(message);
    console.log({ message });

    const decodedIxs = await decodeTransaction(
      getBase64EncodedWireTransaction(message)
    );

    const computeUnitProgramId = "ComputeBudget111111111111111111111111111111";
    const hasComputeUnitInstruction = decodedIxs.some(
      (ix) => ix.programAddress === computeUnitProgramId
    );
    assert.strictEqual(hasComputeUnitInstruction, false);
  });

  it("Should build transaction with exact priority fee", async () => {
    const message = await buildTransaction([transferInstruction], signer, {
      priorityFee: {
        type: "exact",
        amountLamports: 10_000n,
      },
      jito: { type: "none" },
      chainId: "solana",
    });

    assert(message);
  });

  it("Should build transaction with dynamic priority fee", async () => {
    const message = await buildTransaction([transferInstruction], signer, {
      priorityFee: {
        type: "dynamic",
        maxCapLamports: 100_000n,
      },
      jito: { type: "none" },
      chainId: "solana",
    });

    assert(message);
  });

  it("Should build transaction with exact Jito tip", async () => {
    const message = await buildTransaction([transferInstruction], signer, {
      priorityFee: { type: "none" },
      jito: {
        type: "exact",
        amountLamports: 10_000n,
      },
      chainId: "solana",
    });

    assert(message);
  });

  it("Should build transaction with dynamic Jito tip", async () => {
    const message = await buildTransaction([transferInstruction], signer, {
      priorityFee: { type: "none" },
      jito: { type: "dynamic" },
      chainId: "solana",
    });

    assert(message);
  });

  it("Should build transaction with lookup tables", async () => {
    const lookupTables = [
      address("BxZBuYQg7TzDyxBGe7pGCgwM1TRKcwZwcvDiGLVZhTxE"),
      address("HxZBuYQg7TzDyxBGe7pGCgwM1TRKcwZwcvDiGLVZhTxF"),
    ];

    const message = await buildTransaction(
      [transferInstruction],
      signer,
      {
        priorityFee: { type: "none" },
        jito: { type: "none" },
        chainId: "solana",
      },
      lookupTables
    );

    assert(message);
  });

  it("Should build transaction with additional signers", async () => {
    const additionalSigner = await createKeyPairSignerFromPrivateKeyBytes(
      new Uint8Array(32)
    );

    const message = await buildTransaction(
      [transferInstruction],
      signer,
      {
        priorityFee: { type: "none" },
        jito: { type: "none" },
        chainId: "solana",
      },
      [],
      [additionalSigner]
    );

    assert(message);
  });
});
