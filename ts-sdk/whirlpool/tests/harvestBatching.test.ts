import { getAddMemoInstruction } from "@solana-program/memo";
import {
  getTransferSolInstruction,
  SYSTEM_PROGRAM_ADDRESS,
} from "@solana-program/system";
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import type { Address } from "@solana/kit";
import type * as TxSender from "@orca-so/tx-sender";
import {
  buildAndSendTransaction,
  buildTransaction,
  getRpcConfig,
  rpcFromUrl,
} from "@orca-so/tx-sender";
import assert from "assert";
import { afterAll, beforeAll, describe, it, vi } from "vitest";
import { wouldExceedTransactionSize } from "../src/actionHelpers";
import * as config from "../src/config";
import {
  harvestAllPositionFees,
  harvestPositionInstructions,
} from "../src/harvest";
import { swapInstructions } from "../src/swap";
import { NATIVE_MINT, orderMints } from "../src/token";
import {
  getTestContext,
  rpc,
  sendTransaction,
  signer,
  TEST_WHIRLPOOL_DEPLOYMENT,
} from "./utils/mockRpc";
import { setupPosition, setupWhirlpool } from "./utils/program";
import { setupAta, setupMint } from "./utils/token";

vi.mock("@orca-so/tx-sender", async (importOriginal) => ({
  ...(await importOriginal<typeof TxSender>()),
  buildAndSendTransaction: vi.fn(),
  buildTransaction: vi.fn(),
  getRpcConfig: vi.fn(),
  rpcFromUrl: vi.fn(),
}));

describe("SOL harvest batching", () => {
  let pool: Address;
  let mintA: Address;
  const positions: Address[] = [];

  beforeAll(async () => {
    await getTestContext();
    vi.spyOn(config, "getPayer").mockReturnValue(signer);
    vi.mocked(getRpcConfig).mockReturnValue({
      rpcUrl: "http://localhost:8899",
      supportsPriorityFeePercentile: false,
      chainId: "unknown",
      pollIntervalMs: 1000,
      resendOnPoll: false,
    });
    vi.mocked(rpcFromUrl).mockReturnValue(rpc);

    // Keep Kit's real transaction compiler and signer handling. Only route
    // transaction construction and sending through the in-process test RPC.
    vi.mocked(buildTransaction).mockImplementation(
      async (instructions, payer) => {
        const blockhash = await rpc.getLatestBlockhash().send();
        return pipe(
          createTransactionMessage({ version: 0 }),
          (message) => setTransactionMessageFeePayerSigner(payer, message),
          (message) =>
            setTransactionMessageLifetimeUsingBlockhash(
              blockhash.value,
              message,
            ),
          (message) =>
            appendTransactionMessageInstructions(instructions, message),
          (message) => partiallySignTransactionMessageWithSigners(message),
        );
      },
    );
    vi.mocked(buildAndSendTransaction).mockImplementation((instructions) =>
      sendTransaction(instructions),
    );

    const mint = await setupMint();
    await setupAta(mint, { amount: 2_000_000n });
    await setupAta(NATIVE_MINT, { amount: 2_000_000n });
    const orderedMints = orderMints(mint, NATIVE_MINT);
    mintA = orderedMints[0];
    pool = await setupWhirlpool(...orderedMints, 64, {
      whirlpoolDeployment: TEST_WHIRLPOOL_DEPLOYMENT,
    });
    for (let i = 0; i < 2; i++) {
      positions.push(
        await setupPosition(pool, {
          liquidity: 1_000_000n,
          tickLower: -1000,
          tickUpper: 1000,
          whirlpoolDeployment: TEST_WHIRLPOOL_DEPLOYMENT,
        }),
      );
    }
  });

  afterAll(() => {
    config.setNativeMintWrappingStrategy("keypair");
    vi.restoreAllMocks();
  });

  it("Checks a System Program instruction using the actual payer signer", async () => {
    const destination = await generateKeyPairSigner();
    const memo = getAddMemoInstruction({ memo: "harvest batching" });
    const transfer = getTransferSolInstruction({
      source: signer,
      destination: destination.address,
      amount: 1n,
    });

    assert.strictEqual(
      await wouldExceedTransactionSize([memo], [transfer], signer),
      false,
    );
    assert.strictEqual(vi.mocked(buildTransaction).mock.lastCall?.[1], signer);
  });

  it("Still rejects an oversized batch", async () => {
    const memo = getAddMemoInstruction({ memo: "x".repeat(1400) });
    assert.strictEqual(
      await wouldExceedTransactionSize([], [memo], signer),
      true,
    );
  });

  it.each(["keypair", "seed"] as const)(
    "Harvests two SOL positions with %s wrapping",
    async (strategy) => {
      config.setNativeMintWrappingStrategy(strategy);
      const swap = await swapInstructions(
        rpc,
        { inputAmount: 10_000n, mint: mintA },
        pool,
        { signer, whirlpoolDeployment: TEST_WHIRLPOOL_DEPLOYMENT },
      );
      await sendTransaction(swap.instructions);

      for (const position of positions) {
        const harvest = await harvestPositionInstructions(rpc, position, {
          authority: signer,
          whirlpoolDeployment: TEST_WHIRLPOOL_DEPLOYMENT,
        });
        assert(harvest.feesQuote.feeOwedA > 0n);
        assert(
          harvest.instructions.some(
            (instruction) =>
              instruction.programAddress === SYSTEM_PROGRAM_ADDRESS,
          ),
        );
      }

      vi.mocked(buildTransaction).mockClear();
      vi.mocked(buildAndSendTransaction).mockClear();
      const signatures = await harvestAllPositionFees(
        TEST_WHIRLPOOL_DEPLOYMENT,
      );
      assert.strictEqual(signatures.length, 1);
      assert.strictEqual(
        vi.mocked(buildAndSendTransaction).mock.calls.length,
        1,
      );
      assert(vi.mocked(buildTransaction).mock.calls.length > 0);
      for (const [, payer] of vi.mocked(buildTransaction).mock.calls) {
        assert.strictEqual(payer, signer);
      }

      for (const position of positions) {
        const { feesQuote } = await harvestPositionInstructions(rpc, position, {
          authority: signer,
          whirlpoolDeployment: TEST_WHIRLPOOL_DEPLOYMENT,
        });
        assert.strictEqual(feesQuote.feeOwedA, 0n);
        assert.strictEqual(feesQuote.feeOwedB, 0n);
      }
    },
  );
});
