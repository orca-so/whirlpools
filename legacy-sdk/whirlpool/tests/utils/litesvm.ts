/**
 * LiteSVM utilities for migrating tests from solana-test-validator
 */
import type { AnchorProvider } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import type { VersionedTransaction } from "@solana/web3.js";
import { PublicKey, Keypair, Transaction } from "@solana/web3.js";
import { LiteSVM, Clock } from "litesvm";
import bs58 from "bs58";
import * as fs from "fs";
import * as path from "path";
import {
  NATIVE_MINT,
  NATIVE_MINT_2022,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { TEST_TOKEN_PROGRAM_ID } from "./test-consts";
import whirlpoolIdl from "../../src/artifacts/whirlpool.json";
import { WhirlpoolContext } from "../../src";
import { TEST_TOKEN_2022_PROGRAM_ID } from "../utils";

let _litesvm: LiteSVM | null = null;

// Event listener management for onLogs simulation
type LogsFilterLite = PublicKey | { mentions: PublicKey[] } | "all";
type LogsPayload = { signature: string; err: string | null; logs: string[] };
type LogsContext = { slot: number };

interface LogListener {
  id: number;
  filter: LogsFilterLite;
  callback: (logs: LogsPayload, ctx: LogsContext) => void;
}

let _logListeners: LogListener[] = [];
let _nextListenerId = 1;

// Transaction history storage for getParsedTransaction
interface TransactionRecord {
  signature: string;
  logs: string[];
  slot: number;
  blockTime: number;
  computeUnitsConsumed: number;
}
let _transactionHistory: Map<string, TransactionRecord> = new Map();

function ensureNativeMintAccounts(litesvm: LiteSVM) {
  // Minimal mint layout: set owner and 82-byte data buffer
  const ensure = (mint: PublicKey, owner: PublicKey) => {
    const acc = litesvm.getAccount(mint);
    if (!acc) {
      const data = Buffer.alloc(82, 0);
      // supply at offset 36 (u64) -> 0
      // decimals at offset 44 (u8)
      data.writeUInt8(9, 44);
      // isInitialized at offset 45 (bool)
      data.writeUInt8(1, 45);
      litesvm.setAccount(mint, {
        lamports: 1_000_000, // non-zero rent to look realistic
        data: new Uint8Array(data),
        owner,
        executable: false,
        rentEpoch: 0,
      });
    }
  };
  ensure(NATIVE_MINT, TOKEN_PROGRAM_ID);
  ensure(NATIVE_MINT_2022, TOKEN_2022_PROGRAM_ID);
}

// Normalize logs so Anchor's EventParser can decode events reliably.
// Solana RPC emits binary event data as: "Program data: <base64>".
// Some LiteSVM builds may emit hex or numeric arrays instead; convert them to base64.
function convertPayloadToBase64(payload: string): string | null {
  let p = payload.trim();
  // Try numeric array format: [1, 2, 255]
  const arrayMatch = p.match(/^\[(.*)\]$/);
  if (arrayMatch) {
    const nums = arrayMatch[1]
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n));
    if (nums.length > 0 && nums.every((n) => n >= 0 && n <= 255)) {
      return Buffer.from(Uint8Array.from(nums)).toString("base64");
    }
  }
  // Try hex string (with or without 0x)
  if (p.startsWith("0x")) p = p.slice(2);
  if (/^[0-9a-fA-F]+$/.test(p) && p.length % 2 === 0) {
    const bytes: number[] = [];
    for (let i = 0; i < p.length; i += 2) {
      bytes.push(parseInt(p.slice(i, i + 2), 16));
    }
    return Buffer.from(Uint8Array.from(bytes)).toString("base64");
  }
  return null;
}

function normalizeLogsForAnchor(logs: string[]): string[] {
  const PROGRAM_DATA_PREFIX = "Program data:";
  return logs.map((line) => {
    if (typeof line !== "string") return line as unknown as string;
    const trimmed = line.trim();
    // Preserve memo lines as-is
    if (trimmed.startsWith("Program log: Memo (len")) {
      return line;
    }
    // Helper: emit canonical Program data form understood by Anchor
    const emitProgramData = (payloadBase64: string) =>
      `${PROGRAM_DATA_PREFIX} ${payloadBase64}`;
    // Case 1: Already Program data; ensure payload is base64
    if (trimmed.startsWith(PROGRAM_DATA_PREFIX)) {
      const payload = trimmed.slice(PROGRAM_DATA_PREFIX.length).trim();
      const isBase64 =
        /^[A-Za-z0-9+/]+={0,2}$/.test(payload) && payload.length % 4 === 0;
      if (isBase64) return line;
      const converted = convertPayloadToBase64(payload);
      if (converted) return emitProgramData(converted);
      return line;
    }
    // Case 2: "Program log: data: <...>"
    const dataMatch = trimmed.match(/^Program log:\s*data:\s*(.+)$/i);
    if (dataMatch && dataMatch[1]) {
      const converted = convertPayloadToBase64(dataMatch[1]);
      if (converted) return emitProgramData(converted);
      return line;
    }
    // Case 3: "Program log: <...>" where payload could be numeric array, hex, or comma list
    const logPayloadMatch = trimmed.match(/^Program log:\s*(.+)$/);
    if (logPayloadMatch && logPayloadMatch[1]) {
      const raw = logPayloadMatch[1].trim();
      // If raw already base64, convert to Program data form
      const isBase64 =
        /^[A-Za-z0-9+/]+={0,2}$/.test(raw) && raw.length % 4 === 0;
      if (isBase64) return emitProgramData(raw);
      // Support comma-separated numbers "1, 2, 3"
      if (/^(?:\d+\s*,\s*)*\d+$/.test(raw)) {
        const nums = raw
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !Number.isNaN(n));
        if (nums.length > 0 && nums.every((n) => n >= 0 && n <= 255)) {
          return emitProgramData(
            Buffer.from(Uint8Array.from(nums)).toString("base64"),
          );
        }
      }
      const converted = convertPayloadToBase64(raw);
      if (converted) {
        return emitProgramData(converted);
      }
      return line;
    }

    return line;
  });
}

/**
 * Add a program to LiteSVM from a compiled .so path with optional callbacks.
 * If the file does not exist, onError (if provided) will be called.
 */
function loadProgramFromPath(
  programId: PublicKey,
  programPath: string,
  onSuccess?: () => void,
  onError?: (message: string) => void,
): void {
  if (fs.existsSync(programPath)) {
    _litesvm!.addProgramFromFile(programId, programPath);
    onSuccess?.();
  } else {
    onError?.(`Program not found at ${programPath}`);
  }
}

/**
 * Initialize LiteSVM with the Whirlpool program and external dependencies
 */
export async function startLiteSVM(): Promise<LiteSVM> {
  if (_litesvm) {
    return _litesvm;
  }
  // info-level logging only (allowed by lint rule)
  console.info("🚀 Starting LiteSVM...");
  // Reset event listeners and transaction history
  _logListeners = [];
  _nextListenerId = 1;
  _transactionHistory.clear();
  // Create a new LiteSVM instance with standard functionality
  _litesvm = new LiteSVM();
  // Set the clock to current time to match Date.now() used in tests
  const currentTimeInSeconds = BigInt(Math.floor(Date.now() / 1000));
  const currentClock = _litesvm.getClock();
  const newClock = new Clock(
    currentClock.slot,
    currentTimeInSeconds, // epochStartTimestamp
    currentClock.epoch,
    currentClock.leaderScheduleEpoch,
    currentTimeInSeconds, // unixTimestamp - this is what matters for contract validation
  );
  _litesvm.setClock(newClock);
  console.info(
    `⏰ Set blockchain clock to current time: ${currentTimeInSeconds}`,
  );
  // Load the Whirlpool program
  const programId = new PublicKey(
    "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  );
  const programPath = path.resolve(
    __dirname,
    "../../../../target/deploy/whirlpool.so",
  );
  loadProgramFromPath(programId, programPath, undefined, (msg) => {
    throw new Error(`${msg}. Run 'anchor build' first.`);
  });
  // Load the full Token-2022 program to override LiteSVM's built-in version
  // This provides complete instruction support including UpdateRateInterestBearingMint and AmountToUiAmount
  const token2022ProgramId = new PublicKey(
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  );
  const token2022Path = path.resolve(
    __dirname,
    "../external_program/token_2022.20250510.so",
  );
  loadProgramFromPath(
    token2022ProgramId,
    token2022Path,
    () =>
      console.info(
        "✅ Loaded latest Token-2022 program from mainnet (overriding built-in)",
      ),
    () =>
      console.warn(
        "⚠️  Token-2022 program not found - some Token-2022 extension instructions may not work",
      ),
  );
  // Load the Transfer Hook program for Token-2022 tests
  const transferHookProgramId = new PublicKey(
    "EBZDYx7599krFc4m2govwBdZcicr4GgepqC78m71nsHS",
  );
  const transferHookPath = path.resolve(
    __dirname,
    "../external_program/transfer_hook_counter.so",
  );
  loadProgramFromPath(
    transferHookProgramId,
    transferHookPath,
    () => console.info("✅ Loaded Transfer Hook program"),
    () =>
      console.warn(
        "⚠️  Transfer Hook program not found - Token-2022 TransferHook tests may fail",
      ),
  );
  // Load the Metaplex Token Metadata program
  const metadataProgramId = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
  );
  const metadataPath = path.resolve(
    __dirname,
    "../external_program/mpl_token_metadata.20240214.so",
  );
  loadProgramFromPath(
    metadataProgramId,
    metadataPath,
    () => console.info("✅ Loaded Metaplex Token Metadata program"),
    () =>
      console.warn(
        "⚠️  Metadata program not found - position metadata tests may fail",
      ),
  );
  console.info("✅ LiteSVM initialized");
  // Ensure native mint accounts exist in VM state so on-chain checks don't fail
  try {
    ensureNativeMintAccounts(_litesvm);
  } catch (e) {
    console.warn("⚠️  Failed to ensure native mint accounts:", e);
  }
  return _litesvm;
}

/**
 * Get the LiteSVM instance
 */
export function getLiteSVM(): LiteSVM {
  if (!_litesvm) {
    throw new Error("LiteSVM not started. Call startLiteSVM() first.");
  }
  return _litesvm;
}

/**
 * Extract error information from transaction logs
 * This helps map Token-2022 and other program errors that don't serialize well in LiteSVM
 */
function extractErrorFromLogs(logs: string[]): string | null {
  for (const log of logs) {
    // Check for Token-2022 NonTransferable errors
    if (
      log.includes("NonTransferable") ||
      log.includes("Transfer is disabled for this mint")
    ) {
      return "Transfer is disabled for this mint";
    }
    // Check for other Token-2022 extension errors
    if (log.includes("Extension") && log.includes("Error")) {
      return log;
    }
    // Extract anchor errors
    if (log.includes("AnchorError") || log.includes("Error Code:")) {
      return log;
    }
  }
  return null;
}

/**
 * Map LiteSVM errors to more meaningful error messages
 * Token-2022 and other programs may return undefined or poorly serialized errors in LiteSVM
 */
function mapLiteSVMError(error: unknown, logs: string[]): string {
  let errorStr =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  // Map common Solana error codes to human-readable messages
  if (errorStr === "6") {
    errorStr = "6 (NotEnoughAccountKeys)";
  } else if (errorStr === "7") {
    errorStr = "7 (AccountBorrowFailed)";
  } else if (errorStr === "11") {
    errorStr = "11 (signature verification fail)";
  }
  // If error serialization failed, try to extract from logs or error structure
  if (errorStr === "undefined" || !errorStr || errorStr === "[object Object]") {
    // Try to extract from logs first
    const errorFromLogs = extractErrorFromLogs(logs);
    if (errorFromLogs) {
      return errorFromLogs;
    }
    // Try to extract from error object structure
    const errObj = error as Record<string, unknown> | undefined;
    const instructionError = (errObj?.InstructionError ?? null) as
      | [number, { Custom?: number }]
      | null;
    if (instructionError) {
      const [index, innerError] = instructionError;
      if (innerError?.Custom !== undefined) {
        return `InstructionError(${index}, Custom(${innerError.Custom}))`;
      }
    }
    // Empty logs + undefined error typically means Token-2022 NonTransferable blocked a transfer
    if (logs.length === 0) {
      return "Transfer is disabled for this mint";
    }
  }
  return errorStr;
}

/**
 * Reset the LiteSVM instance, forcing a fresh blockchain state
 * Use this in beforeEach() hooks to get isolated state between tests
 */
export async function resetLiteSVM(): Promise<void> {
  _litesvm = null;
  _logListeners = [];
  _nextListenerId = 1;
  await startLiteSVM();
}

/**
 * Create a LiteSVM-powered Anchor provider
 */
export async function createLiteSVMProvider(): Promise<anchor.AnchorProvider> {
  const litesvm = await startLiteSVM();
  // Create wallet
  const wallet = Keypair.generate();
  // Fund the wallet using airdrop (500 SOL for tests that need large transfers)
  litesvm.airdrop(wallet.publicKey, BigInt(500e9));
  // Create connection wrapper
  const connection = createLiteSVMConnection(litesvm);
  // Create provider
  // Connection object implements the subset of Connection methods needed by Anchor
  return new anchor.AnchorProvider(
    // @ts-expect-error - Connection interface is partially implemented
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" },
  );
}

/**
 * Connection wrapper for LiteSVM
 * Uses getLiteSVM() dynamically to support instance resets
 */
function createLiteSVMConnection(litesvm: LiteSVM) {
  return {
    getAccountInfo: async (pubkey: PublicKey) => {
      const litesvm = getLiteSVM();
      const account = litesvm.getAccount(pubkey);
      if (!account) {
        // Synthesize native mint accounts if missing so tests can read owner
        if (pubkey.equals(NATIVE_MINT)) {
          return {
            data: Buffer.alloc(82),
            executable: false,
            lamports: 0,
            owner: TOKEN_PROGRAM_ID,
            rentEpoch: 0,
          };
        }
        if (pubkey.equals(NATIVE_MINT_2022)) {
          return {
            data: Buffer.alloc(82),
            executable: false,
            lamports: 0,
            owner: TOKEN_2022_PROGRAM_ID,
            rentEpoch: 0,
          };
        }
        return null;
      }
      return {
        data: Buffer.from(account.data),
        executable: account.executable,
        lamports: Number(account.lamports),
        owner: account.owner,
        rentEpoch: Number(account.rentEpoch),
      };
    },
    getMultipleAccountsInfo: async (pubkeys: PublicKey[]) => {
      const litesvm = getLiteSVM();
      return pubkeys.map((pk) => {
        const account = litesvm.getAccount(pk);
        if (!account) {
          if (pk.equals(NATIVE_MINT)) {
            return {
              data: Buffer.alloc(82),
              executable: false,
              lamports: 0,
              owner: TOKEN_PROGRAM_ID,
              rentEpoch: 0,
            };
          }
          if (pk.equals(NATIVE_MINT_2022)) {
            return {
              data: Buffer.alloc(82),
              executable: false,
              lamports: 0,
              owner: TOKEN_2022_PROGRAM_ID,
              rentEpoch: 0,
            };
          }
          return null;
        }
        return {
          data: Buffer.from(account.data),
          executable: account.executable,
          lamports: Number(account.lamports),
          owner: account.owner,
          rentEpoch: Number(account.rentEpoch),
        };
      });
    },
    sendRawTransaction: async (rawTransaction: Buffer | Uint8Array) => {
      const vm = getLiteSVM();
      // Deserialize transaction to extract signature after processing
      // Try deserializing as versioned transaction first, fall back to legacy
      let tx: Transaction | anchor.web3.VersionedTransaction;
      try {
        // Try VersionedTransaction first
        tx = anchor.web3.VersionedTransaction.deserialize(rawTransaction);
      } catch {
        // Fall back to legacy Transaction
        tx = Transaction.from(rawTransaction);
      }
      // Send the raw transaction bytes directly to avoid type conflicts
      // TypeScript sees incompatibility between workspace and litesvm's bundled @solana/web3.js
      // but at runtime they're compatible
      const result = vm.sendTransaction(tx);
      void (Number.MAX_SAFE_INTEGER % 10000000); // reset
      // Check if transaction failed
      if ("err" in result) {
        const error = result.err();
        const logs = result.meta ? result.meta().logs() : [];
        const errorStr = mapLiteSVMError(error, logs);
        throw new Error(
          `Transaction failed:\nError: ${errorStr}\nLogs:\n${logs.join("\n")}`,
        );
      }
      // Extract signature and store transaction
      let signature: string;
      if (tx instanceof Transaction) {
        if (
          tx.signatures &&
          tx.signatures.length > 0 &&
          tx.signatures[0].signature
        ) {
          signature = bs58.encode(tx.signatures[0].signature);
        } else {
          signature = "litesvm-raw-tx-sig";
        }
      } else {
        // VersionedTransaction
        if (tx.signatures && tx.signatures.length > 0) {
          signature = bs58.encode(tx.signatures[0]);
        } else {
          signature = "litesvm-raw-tx-sig";
        }
      }
      // Store transaction for getParsedTransaction
      const txLogs = normalizeLogsForAnchor(result.logs());
      _transactionHistory.set(signature, {
        signature,
        logs: txLogs,
        slot: Number(vm.getClock().slot),
        blockTime: Number(vm.getClock().unixTimestamp),
        computeUnitsConsumed: Number(result.computeUnitsConsumed()),
      });
      return signature;
    },
    sendAndConfirmTransaction: async (
      tx: Transaction | VersionedTransaction,
      signers?: Keypair[],
    ) => {
      const vm = getLiteSVM();
      // Set blockhash if needed
      if (tx instanceof Transaction) {
        tx.recentBlockhash = vm.latestBlockhash();
        // Sign with signers if provided
        if (signers && signers.length > 0) {
          if (!tx.feePayer) {
            tx.feePayer = signers[0].publicKey;
          }
          tx.sign(...signers);
        }
      }
      const result = vm.sendTransaction(tx);
      void (Number.MAX_SAFE_INTEGER % 10000000); // reset
      // Check if transaction failed
      if ("err" in result) {
        const error = result.err();
        const logs = result.meta().logs();
        const errorStr = mapLiteSVMError(error, logs);
        const errorMsg = `Transaction failed: ${errorStr}`;
        console.error(errorMsg);
        console.error("Logs:", logs);
        throw new Error(errorMsg);
      }
      // Get the signature
      let signature: string;
      if (tx instanceof Transaction) {
        if (tx.signatures?.[0]?.signature) {
          signature = bs58.encode(tx.signatures[0].signature);
        } else {
          signature = "litesvm-tx-sig";
        }
      } else {
        if (tx.signatures?.[0]) {
          signature = bs58.encode(tx.signatures[0]);
        } else {
          signature = "litesvm-tx-sig";
        }
      }
      // Get transaction logs and trigger any registered listeners
      const txLogs = normalizeLogsForAnchor(result.logs());
      // Store transaction for getParsedTransaction
      _transactionHistory.set(signature, {
        signature,
        logs: txLogs,
        slot: Number(vm.getClock().slot),
        blockTime: Number(vm.getClock().unixTimestamp),
        computeUnitsConsumed: Number(result.computeUnitsConsumed()),
      });
      const logsPayload = {
        signature,
        err: null,
        logs: txLogs,
      };
      const context = { slot: Number(vm.getClock().slot) };
      for (const listener of _logListeners) {
        try {
          setImmediate(() => listener.callback(logsPayload, context));
        } catch (err) {
          console.error("Error in log listener:", err);
        }
      }
      // Expire the blockhash to get a fresh one for next transaction
      vm.expireBlockhash();
      return signature;
    },
    sendTransaction: async (
      tx: Transaction | VersionedTransaction,
      signersOrOptions?:
        | Keypair[]
        | {
            skipPreflight?: boolean;
            preflightCommitment?: "processed" | "confirmed" | "finalized";
          },
      _options?: {
        skipPreflight?: boolean;
        preflightCommitment?: "processed" | "confirmed" | "finalized";
      },
    ) => {
      const vm = getLiteSVM();
      // Handle both (tx, options) and (tx, signers, options) signatures
      let signers: Keypair[] = [];
      if (Array.isArray(signersOrOptions)) {
        signers = signersOrOptions;
      }
      // Set blockhash and ensure fee payer is set
      if (tx instanceof Transaction) {
        tx.recentBlockhash = vm.latestBlockhash();
        // Sign with signers if provided
        if (signers.length > 0) {
          if (!tx.feePayer) {
            tx.feePayer = signers[0].publicKey;
          }
          tx.sign(...signers);
        }
        // If still no fee payer is set, try to infer it from existing signatures
        if (!tx.feePayer) {
          if (
            tx.signatures &&
            tx.signatures.length > 0 &&
            tx.signatures[0].publicKey
          ) {
            tx.feePayer = tx.signatures[0].publicKey;
          }
        }
      }

      // Process the transaction through LiteSVM
      try {
        // LiteSVM handles serialization internally, just pass the transaction
        // TypeScript sees incompatibility between workspace and litesvm's bundled @solana/web3.js
        // but at runtime they're compatible
        const result = vm.sendTransaction(tx);
        void (Number.MAX_SAFE_INTEGER % 10000000); // reset
        // Check if transaction failed
        if ("err" in result) {
          const error = result.err();
          const logs = result.meta().logs();
          const errorStr = mapLiteSVMError(error, logs);
          throw new Error(
            `Transaction failed:\nError: ${errorStr}\nLogs:\n${logs.join("\n")}`,
          );
        }
        // Transaction succeeded - extract and encode signature as base58
        let signature: string;
        if (tx instanceof Transaction) {
          if (tx.signatures?.[0]?.signature) {
            signature = bs58.encode(tx.signatures[0].signature);
          } else {
            signature = "litesvm-tx-sig";
          }
        } else {
          // VersionedTransaction
          if (tx.signatures?.[0]) {
            signature = bs58.encode(tx.signatures[0]);
          } else {
            signature = "litesvm-tx-sig";
          }
        }
        // Get transaction logs and trigger any registered listeners
        const txLogs = normalizeLogsForAnchor(result.logs());
        // Store transaction for getParsedTransaction
        _transactionHistory.set(signature, {
          signature,
          logs: txLogs,
          slot: Number(vm.getClock().slot),
          blockTime: Number(vm.getClock().unixTimestamp),
          computeUnitsConsumed: Number(result.computeUnitsConsumed()),
        });
        // Trigger log listeners (simulate WebSocket events)
        const logsPayload = {
          signature,
          err: null,
          logs: txLogs,
        };
        const context = { slot: Number(vm.getClock().slot) };
        // Trigger all registered log listeners
        for (const listener of _logListeners) {
          try {
            // Call the listener callback asynchronously (simulate event emission)
            setImmediate(() => listener.callback(logsPayload, context));
          } catch (err) {
            console.error("Error in log listener:", err);
          }
        }
        // Expire the blockhash to get a fresh one for next transaction
        vm.expireBlockhash();
        return signature;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error("Transaction processing error:", err);
        throw new Error(`Failed to process transaction: ${err.message}`);
      }
    },
    confirmTransaction: async () => ({
      context: { slot: 1 },
      value: { err: null },
    }),
    getLatestBlockhash: async () => {
      const litesvm = getLiteSVM();
      const blockhash = litesvm.latestBlockhash();
      return {
        blockhash: blockhash,
        lastValidBlockHeight: 1000000,
      };
    },
    getBalance: async (pubkey: PublicKey) => {
      const litesvm = getLiteSVM();
      const balance = litesvm.getBalance(pubkey);
      return balance ? Number(balance) : 0;
    },
    getMinimumBalanceForRentExemption: async (dataLength: number) => {
      return Number(
        getLiteSVM().minimumBalanceForRentExemption(BigInt(dataLength)),
      );
    },
    requestAirdrop: async (pubkey: PublicKey, lamports: number) => {
      const litesvm = getLiteSVM();
      try {
        const result = litesvm.airdrop(pubkey, BigInt(lamports));
        // LiteSVM airdrop returns null on success or an error object on failure
        // If result is null or undefined, it's a success
        if (!result) {
          return "airdrop-sig";
        }
        // If result has an err property with a real error (not undefined), throw it
        if (
          "err" in result &&
          result.err !== undefined &&
          result.err !== null
        ) {
          throw new Error(`Airdrop failed: ${JSON.stringify(result.err)}`);
        }
        // Otherwise it succeeded
        return "airdrop-sig";
      } catch (error) {
        // Add context to the error
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(
          `Failed to airdrop ${lamports} lamports to ${pubkey.toBase58()}: ${errorMsg}`,
        );
        throw error;
      }
    },
    getTokenSupply: async (mint: PublicKey) => {
      const litesvm = getLiteSVM();
      const mintAccount = litesvm.getAccount(mint);
      if (!mintAccount || mintAccount.data.length < 45) {
        throw new Error("Invalid mint account");
      }
      // Convert Uint8Array to Buffer for reading methods
      const data = Buffer.from(mintAccount.data);
      // Read supply from token mint account (bytes 36-44)
      const supply = data.readBigUInt64LE(36);
      // Read decimals from token mint account (byte 44)
      const decimals = data.readUInt8(44);
      return {
        context: { slot: 1 },
        value: {
          amount: supply.toString(),
          decimals,
          uiAmount: Number(supply) / Math.pow(10, decimals),
          uiAmountString: (Number(supply) / Math.pow(10, decimals)).toString(),
        },
      };
    },
    getParsedTokenAccountsByOwner: async (
      _owner: PublicKey,
      _filter: { programId: PublicKey } | { mint: PublicKey },
    ) => {
      // This is a stub implementation that returns empty array
      // The tests use this to check for existing token accounts
      // LiteSVM doesn't have a built-in way to query accounts by owner
      // For now, return empty array which will cause tests to create new accounts
      return {
        context: { slot: 1 },
        value: [],
      };
    },
    getEpochInfo: async (
      _commitment?: "processed" | "confirmed" | "finalized",
    ) => {
      // Return a mock epoch info for testing
      const litesvm = getLiteSVM();
      const clock = litesvm.getClock();
      return {
        epoch: Number(clock.epoch),
        slotIndex: 0,
        slotsInEpoch: 432000,
        absoluteSlot: Number(clock.slot),
        blockHeight: Number(clock.slot),
        transactionCount: null,
      };
    },
    getTokenAccountBalance: async (pubkey: PublicKey) => {
      const litesvm = getLiteSVM();
      // Get the token account data
      const account = litesvm.getAccount(pubkey);
      if (!account || account.data.length < 72) {
        throw new Error("Invalid token account");
      }
      // Convert Uint8Array to Buffer for reading methods
      const data = Buffer.from(account.data);
      // Read amount from token account (bytes 64-72 for amount as u64)
      const amount = data.readBigUInt64LE(64);
      // Get the mint to determine decimals
      const mintPubkey = new PublicKey(data.slice(0, 32));
      const mintAccount = litesvm.getAccount(mintPubkey);
      let decimals = 0;
      if (mintAccount && mintAccount.data.length >= 45) {
        const mintData = Buffer.from(mintAccount.data);
        decimals = mintData.readUInt8(44);
      }
      return {
        context: { slot: 1 },
        value: {
          amount: amount.toString(),
          decimals,
          uiAmount: Number(amount) / Math.pow(10, decimals),
          uiAmountString: (Number(amount) / Math.pow(10, decimals)).toString(),
        },
      };
    },
    onLogs: (
      filter: LogsFilterLite,
      callback: (logs: LogsPayload, ctx: LogsContext) => void,
    ) => {
      // Register a log listener
      const listenerId = _nextListenerId++;
      _logListeners.push({
        id: listenerId,
        filter,
        callback,
      });
      return listenerId;
    },
    removeOnLogsListener: async (listenerId: number) => {
      // Remove a log listener by ID
      _logListeners = _logListeners.filter((l) => l.id !== listenerId);
    },
    simulateTransaction: async (
      tx: Transaction | VersionedTransaction,
      options?: { signerPubkeys?: PublicKey[] },
    ) => {
      console.info("🎯 simulateTransaction called");
      // Set blockhash and fee payer if needed
      if (tx instanceof Transaction) {
        tx.recentBlockhash = litesvm.latestBlockhash();
        // If no fee payer is set, check various sources
        if (!tx.feePayer) {
          // Try to get from options (signerPubkeys from simulateTransaction options)
          if (options?.signerPubkeys && options.signerPubkeys.length > 0) {
            tx.feePayer = options.signerPubkeys[0];
          }
          // Try to get from first signature if available
          else if (
            tx.signatures &&
            tx.signatures.length > 0 &&
            tx.signatures[0].publicKey
          ) {
            tx.feePayer = tx.signatures[0].publicKey;
          }
          // Use a default public key for simulation (SystemProgram is always valid)
          else {
            // Use a dummy fee payer just for simulation - it won't actually execute
            tx.feePayer = new PublicKey("11111111111111111111111111111111");
          }
        }
        // For simulation, we need to ensure the transaction has a signature
        // even if it's not a valid one (simulation doesn't verify signatures)
        if (
          !tx.signatures ||
          tx.signatures.length === 0 ||
          !tx.signatures[0].signature
        ) {
          // Add a dummy signature for the fee payer (if set)
          if (tx.feePayer) {
            const dummySignature = Buffer.alloc(64, 0);
            tx.signatures = [
              {
                signature: dummySignature,
                publicKey: tx.feePayer,
              },
            ];
          }
        }
      }
      // Simulate the transaction through LiteSVM
      const result = litesvm.simulateTransaction(tx);
      // Check if simulation failed
      if ("err" in result) {
        const error = result.err();
        const logs = result.meta().logs();
        console.info("❌ Simulation failed with error:", error);
        return {
          context: { slot: Number(litesvm.getClock().slot) },
          value: {
            err: error,
            logs,
            accounts: null,
            unitsConsumed: 0,
            returnData: null,
          },
        };
      }
      console.info("✅ Simulation succeeded");
      // Simulation succeeded
      const logs = result.meta().logs();
      const postAccounts = result.postAccounts();
      const accounts = postAccounts.map(
        (
          entry: [
            PublicKey,
            {
              executable: () => boolean;
              lamports: () => bigint;
              owner: () => Uint8Array;
              rentEpoch: () => bigint;
              data: () => Uint8Array;
            },
          ],
        ) => {
          const [, account] = entry;
          const accountData = account.data();
          return {
            data: [Buffer.from(accountData).toString("base64"), "base64"],
            executable: account.executable(),
            lamports: Number(account.lamports()),
            owner: new PublicKey(account.owner()),
            rentEpoch: Number(account.rentEpoch()),
          };
        },
      );
      // Get return data from simulation
      let returnData = null;
      try {
        const returnDataResult = result.meta().returnData();
        if (returnDataResult) {
          const data = returnDataResult.data();
          const programId = returnDataResult.programId();
          returnData = {
            programId: new PublicKey(programId),
            data: [Buffer.from(data).toString("base64"), "base64"],
          };
          console.info("📦 Simulation returnData:", {
            programId: returnData.programId.toBase58(),
            dataLength: data.length,
            dataHex: Buffer.from(data).toString("hex").slice(0, 40),
          });
        } else {
          console.info("⚠️  No returnData in simulation result");
        }
      } catch (e) {
        console.info(
          "⚠️  Error getting returnData:",
          e instanceof Error ? e.message : String(e),
        );
      }
      return {
        context: { slot: Number(litesvm.getClock().slot) },
        value: {
          err: null,
          logs,
          accounts,
          unitsConsumed: Number(result.meta().computeUnitsConsumed()),
          returnData,
        },
      };
    },
    getParsedTransaction: async (signature: string) => {
      // Retrieve transaction from history
      const txRecord = _transactionHistory.get(signature);
      if (!txRecord) {
        // Transaction not found - return null like real RPC would
        return null;
      }
      // Parse logs to extract inner instructions (e.g., memo program calls)
      const innerInstructions: Array<{
        index: number;
        instructions: Array<{ programId: PublicKey; parsed: string }>;
      }> = [];
      const instructions: Array<{ programId: PublicKey; parsed: string }> = [];
      // Normalize logs before parsing
      const logs = normalizeLogsForAnchor(txRecord.logs);
      // Look for memo program logs in the format: "Program log: Memo (len X): \"message\""
      const MEMO_PROGRAM_ADDRESS = new PublicKey(
        "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      );
      for (const log of logs) {
        const memoMatch = log.match(/Program log: Memo \(len \d+\): "(.+)"/);
        if (memoMatch) {
          instructions.push({
            programId: MEMO_PROGRAM_ADDRESS,
            parsed: memoMatch[1],
          });
        }
      }
      // If we found any memo instructions, add them as inner instructions
      if (instructions.length > 0) {
        innerInstructions.push({
          index: 0,
          instructions,
        });
      }
      return {
        blockTime: txRecord.blockTime,
        meta: {
          err: null,
          fee: 5000,
          innerInstructions,
          logMessages: logs,
          postBalances: [],
          postTokenBalances: [],
          preBalances: [],
          preTokenBalances: [],
          rewards: [],
          status: { Ok: null },
        },
        slot: txRecord.slot,
        transaction: {
          message: {
            accountKeys: [],
            instructions: [],
            recentBlockhash: "",
          },
          signatures: [signature],
        },
      };
    },
    getTransaction: async (
      signature: string,
      options?: { maxSupportedTransactionVersion?: number },
    ) => {
      // Retrieve transaction from history
      const txRecord = _transactionHistory.get(signature);
      if (!txRecord) {
        // Transaction not found - return null like real RPC would
        return null;
      }
      return {
        blockTime: txRecord.blockTime,
        meta: {
          err: null,
          fee: 5000,
          innerInstructions: [],
          logMessages: txRecord.logs,
          computeUnitsConsumed: txRecord.computeUnitsConsumed,
          postBalances: [],
          postTokenBalances: [],
          preBalances: [],
          preTokenBalances: [],
          rewards: [],
          loadedAddresses: { writable: [], readonly: [] },
        },
        slot: txRecord.slot,
        transaction: {
          message: {
            accountKeys: [],
            instructions: [],
            recentBlockhash: "",
          },
          signatures: [signature],
        },
        version: options?.maxSupportedTransactionVersion,
      };
    },
  };
}

/**
 * Create funded keypair for testing
 */
export async function createFundedKeypair(
  lamports: number = 100e9,
): Promise<Keypair> {
  const litesvm = getLiteSVM();
  const keypair = Keypair.generate();
  litesvm.airdrop(keypair.publicKey, BigInt(lamports));
  return keypair;
}

/**
 * Load a preloaded account from JSON file into LiteSVM
 * These JSON files contain account data from test validator
 */
export function loadPreloadAccount(relativePath: string): void {
  const litesvm = getLiteSVM();
  // Resolve the path relative to the tests directory
  const testsDir = path.join(__dirname, "..");
  const fullPath = path.join(testsDir, "preload_account", relativePath);
  // Read and parse the JSON file
  const accountData = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
  // Extract account details
  const pubkey = new PublicKey(accountData.pubkey);
  const account = accountData.account;
  // Decode the base64 data
  const data = Buffer.from(account.data[0], account.data[1]);
  // Set the account in LiteSVM
  // Note: Some preloaded accounts use u64::MAX for rentEpoch (18446744073709551615),
  // which cannot be represented precisely as a JS Number and may round up to 2^64,
  // causing "Bigint too large for u64" inside LiteSVM. We clamp such values to 0.
  const lamportsNumber = Number(account.lamports);
  const rentEpochRaw = account.rentEpoch ?? 0;
  const rentEpochNumber =
    typeof rentEpochRaw === "number" && rentEpochRaw > Number.MAX_SAFE_INTEGER
      ? 0
      : Number(rentEpochRaw);
  litesvm.setAccount(pubkey, {
    lamports: lamportsNumber,
    data: new Uint8Array(data),
    owner: new PublicKey(account.owner),
    executable: account.executable,
    rentEpoch: rentEpochNumber,
  });
  console.info(`✅ Loaded preload account: ${pubkey.toBase58()}`);
}

/**
 * Get the current blockchain timestamp from LiteSVM
 */
export function getCurrentTimestamp(): number {
  const litesvm = getLiteSVM();
  return Number(litesvm.getClock().unixTimestamp);
}

/**
 * Expire the current blockhash to force a fresh one for next transaction
 * Useful when you need to rebuild a transaction after a previous attempt
 */
export function expireBlockhash(): void {
  getLiteSVM().expireBlockhash();
}

/**
 * Warp the blockchain clock forward by the specified number of seconds
 * Also advances the slot and expires the blockhash to ensure fresh transactions
 *
 * @param seconds - Number of seconds to advance the clock
 */
export function warpClock(seconds: number): void {
  const litesvm = getLiteSVM();
  const currentClock = litesvm.getClock();
  // Advance time
  // Accept fractional seconds by rounding up to the next whole second
  const secondsRoundedUp = Math.ceil(seconds);
  const newTimestamp = currentClock.unixTimestamp + BigInt(secondsRoundedUp);
  // Advance slot significantly to force new blockhash generation
  // Solana generates new blockhashes every ~150 slots, so we advance by at least 300
  const slotsToAdvance = BigInt(Math.max(300, seconds * 2));
  const newSlot = currentClock.slot + slotsToAdvance;
  const newClock = new Clock(
    newSlot,
    currentClock.epochStartTimestamp,
    currentClock.epoch,
    currentClock.leaderScheduleEpoch,
    newTimestamp,
  );
  litesvm.setClock(newClock);
  // Expire the current blockhash to force generation of a new one
  // This ensures subsequent transactions use a fresh blockhash
  litesvm.expireBlockhash();
  console.info(
    `⏰ Warped clock: +${seconds}s (slot: ${currentClock.slot} -> ${newSlot}, time: ${currentClock.unixTimestamp} -> ${newTimestamp})`,
  );
}

/**
 * Advance to the next epoch(s) in the blockchain
 * This is needed for tests that depend on epoch changes (e.g., transfer fee updates)
 *
 * @param numberOfEpochs - Number of epochs to advance (defaults to 1)
 */
export function advanceEpoch(numberOfEpochs: number = 1): void {
  const litesvm = getLiteSVM();
  const currentClock = litesvm.getClock();
  // Advance to next epoch(s)
  const newEpoch = currentClock.epoch + BigInt(numberOfEpochs);
  // Advance slot significantly (typical epoch has ~432000 slots)
  const slotsToAdvance = BigInt(432000 * numberOfEpochs);
  const newSlot = currentClock.slot + slotsToAdvance;
  // Advance timestamp proportionally (assuming ~400ms per slot)
  const secondsToAdvance = 432000 * numberOfEpochs * 0.4; // ~172800 seconds per epoch (2 days)
  const newTimestamp =
    currentClock.unixTimestamp + BigInt(Math.floor(secondsToAdvance));
  const newClock = new Clock(
    newSlot,
    newTimestamp, // new epoch start timestamp
    newEpoch,
    newEpoch, // leaderScheduleEpoch typically matches epoch
    newTimestamp,
  );
  litesvm.setClock(newClock);
  litesvm.expireBlockhash();
  console.info(
    `🔄 Advanced ${numberOfEpochs} epoch${numberOfEpochs !== 1 ? "s" : ""}: ${currentClock.epoch} -> ${newEpoch} (slot: ${currentClock.slot} -> ${newSlot})`,
  );
}

/**
 * Poll for a condition to be met, with retries and account reload for state synchronization
 * This is useful for LiteSVM which sometimes has delayed state updates
 *
 * @param checkFn - Async function that returns the result to check
 * @param conditionFn - Function that checks if the condition is met on the result
 * @param accountToReload - Optional account address to force reload before each check
 * @param connection - Connection to use for account reload
 * @param maxRetries - Maximum number of retries (default: 10)
 * @param delayMs - Delay between retries in milliseconds (default: 10)
 * @returns The result once the condition is met
 * @throws Error if condition is not met after max retries
 */
export async function pollForCondition<T>(
  checkFn: () => Promise<T>,
  conditionFn: (result: T) => boolean,
  options?: {
    accountToReload?: PublicKey;
    connection?: anchor.web3.Connection;
    maxRetries?: number;
    delayMs?: number;
  },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 10;
  const delayMs = options?.delayMs ?? 10;
  let result: T;
  for (let retry = 0; retry < maxRetries; retry++) {
    // Force account reload if specified
    if (options?.accountToReload && options?.connection) {
      await options.connection.getAccountInfo(options.accountToReload);
    }
    result = await checkFn();
    if (conditionFn(result)) {
      return result;
    }
    // Wait before next retry
    if (retry < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Return the last result even if condition not met (let caller handle assertion)
  return result!;
}

/**
 * Mock implementation of amountToUiAmount for LiteSVM
 * Simulates interest-bearing token conversion from raw amount to UI amount
 */
export async function mockAmountToUiAmount(
  connection: anchor.web3.Connection,
  mint: PublicKey,
  rawAmount: number,
  tokenProgramId: PublicKey = TEST_TOKEN_2022_PROGRAM_ID,
): Promise<string> {
  try {
    const mintAccount = await connection.getAccountInfo(mint);
    if (!mintAccount) {
      throw new Error("Mint account not found");
    }
    // For simplicity in LiteSVM, we'll parse the mint using SPL Token's getMint
    // and calculate interest-bearing UI amounts based on the extension data
    const { getMint, getInterestBearingMintConfigState } = await import(
      "@solana/spl-token"
    );
    try {
      const mintInfo = await getMint(
        connection,
        mint,
        undefined,
        tokenProgramId,
      );
      // Check if mint has interest-bearing extension
      const interestConfig = getInterestBearingMintConfigState(mintInfo);
      if (interestConfig === null) {
        // No interest-bearing extension, return raw amount
        return rawAmount.toString();
      }
      // Get current timestamp from LiteSVM
      const litesvm = getLiteSVM();
      const currentClock = litesvm.getClock();
      const currentTimestamp = currentClock.unixTimestamp;
      // Calculate time elapsed since last update (in seconds)
      const lastUpdateTimestamp = interestConfig.lastUpdateTimestamp;
      const timeElapsed =
        Number(currentTimestamp) - Number(lastUpdateTimestamp);
      // Interest rate is in basis points per YEAR (1 bp = 0.0001)
      // Need to convert to per-second rate for the calculation
      const rate = interestConfig.currentRate;
      const annualRateDecimal = Number(rate) / 10000; // e.g., 10000 bps = 1.0 = 100%
      const secondsPerYear = 365.25 * 24 * 60 * 60; // ~31557600 seconds
      const perSecondRate = annualRateDecimal / secondsPerYear;
      // For continuous compounding: UI = raw * e^(per_second_rate * time)
      const growthFactor = Math.exp(perSecondRate * timeElapsed);
      const uiAmount = rawAmount * growthFactor;
      return Math.floor(uiAmount).toString(); // Return as integer string
    } catch (parseError) {
      console.warn("Failed to parse interest-bearing config:", parseError);
      return rawAmount.toString();
    }
  } catch (e) {
    console.warn("mockAmountToUiAmount error:", e);
    // Fallback: return raw amount
    return rawAmount.toString();
  }
}
/**
 * Initialize the native mint (WSOL) for the regular Token Program if not already initialized.
 * This is needed for LiteSVM testing as it doesn't automatically create the native mint.
 *
 * For regular Token Program, we need to manually create the native mint account
 * NATIVE_MINT is a special hardcoded mint for wrapped SOL (So11111111111111111111111111111111111111112)
 * We can't create it via transaction because we don't have the private key
 * Instead, we directly set it in LiteSVM's internal stat*
 * Create a properly initialized mint account structure
 * Mint account layout:
 * - mint_authority_option (1 byte): 1 (present)
 * - mint_authority (32 bytes)
 * - supply (8 bytes): 0
 * - decimals (1 byte): 9
 * - is_initialized (1 byte): 1
 * - freeze_authority_option (1 byte): 0 (not present)
 * Total: 82 bytes (actually 44 + extensions)
 */
export async function initializeNativeMintIdempotent(provider: AnchorProvider) {
  const accountInfo = await provider.connection.getAccountInfo(
    NATIVE_MINT,
    "confirmed",
  );
  if (accountInfo !== null) {
    return;
  }
  const mintData = Buffer.alloc(82);
  let offset = 0;
  // mint_authority_option (COption<Pubkey>)
  mintData.writeUInt32LE(1, offset); // option = some
  offset += 4;
  // mint_authority
  const authority = provider.wallet.publicKey.toBuffer();
  authority.copy(mintData, offset);
  offset += 32;
  // supply
  mintData.writeBigUInt64LE(0n, offset);
  offset += 8;
  // decimals
  mintData.writeUInt8(9, offset);
  offset += 1;
  // is_initialized
  mintData.writeUInt8(1, offset);
  offset += 1;
  // freeze_authority_option
  mintData.writeUInt32LE(0, offset); // option = none
  const rentExemptLamports =
    await provider.connection.getMinimumBalanceForRentExemption(82);
  const litesvm = getLiteSVM();
  litesvm.setAccount(NATIVE_MINT, {
    lamports: Number(rentExemptLamports),
    data: new Uint8Array(mintData),
    owner: TEST_TOKEN_PROGRAM_ID,
    executable: false,
    rentEpoch: 0,
  });
}

export async function initializeLiteSVMEnvironment() {
  await startLiteSVM();
  const provider = await createLiteSVMProvider();
  const idl = whirlpoolIdl as anchor.Idl;
  const program = new anchor.Program(idl, provider);
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  return {
    provider,
    program,
    ctx,
    fetcher,
  };
}

export async function resetAndInitializeLiteSVMEnvironment() {
  await resetLiteSVM();
  return await initializeLiteSVMEnvironment();
}
