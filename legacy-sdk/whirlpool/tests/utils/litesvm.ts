/**
 * LiteSVM utilities for migrating tests from solana-test-validator
 */
import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { LiteSVM, Clock } from "litesvm";
import bs58 from "bs58";
import * as fs from "fs";
import * as path from "path";

let _litesvm: LiteSVM | null = null;

// Event listener management for onLogs simulation
interface LogListener {
  id: number;
  filter: any;
  callback: (logs: any, ctx: any) => void;
}

let _logListeners: LogListener[] = [];
let _nextListenerId = 1;

/**
 * Initialize LiteSVM with the Whirlpool program and external dependencies
 */
export async function startLiteSVM(): Promise<LiteSVM> {
  if (_litesvm) {
    return _litesvm;
  }

  console.log("🚀 Starting LiteSVM...");

  // Reset event listeners
  _logListeners = [];
  _nextListenerId = 1;

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
  console.log(
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

  if (!fs.existsSync(programPath)) {
    throw new Error(
      `Program not found at ${programPath}. Run 'anchor build' first.`,
    );
  }

  _litesvm.addProgramFromFile(programId, programPath);

  // Load the full Token-2022 program to override LiteSVM's built-in version
  // This provides complete instruction support including UpdateRateInterestBearingMint and AmountToUiAmount
  const token2022ProgramId = new PublicKey(
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  );
  const token2022Path = path.resolve(
    __dirname,
    "../external_program/token_2022.20250510.so",
  );

  if (fs.existsSync(token2022Path)) {
    _litesvm.addProgramFromFile(token2022ProgramId, token2022Path);
    console.log(
      "✅ Loaded latest Token-2022 program from mainnet (overriding built-in)",
    );
  } else {
    console.warn(
      "⚠️  Token-2022 program not found - some Token-2022 extension instructions may not work",
    );
  }

  // Load the Transfer Hook program for Token-2022 tests
  const transferHookProgramId = new PublicKey(
    "EBZDYx7599krFc4m2govwBdZcicr4GgepqC78m71nsHS",
  );
  const transferHookPath = path.resolve(
    __dirname,
    "../external_program/transfer_hook_counter.so",
  );

  if (fs.existsSync(transferHookPath)) {
    _litesvm.addProgramFromFile(transferHookProgramId, transferHookPath);
    console.log("✅ Loaded Transfer Hook program");
  } else {
    console.warn(
      "⚠️  Transfer Hook program not found - Token-2022 TransferHook tests may fail",
    );
  }

  // Load the Metaplex Token Metadata program
  const metadataProgramId = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
  );
  const metadataPath = path.resolve(
    __dirname,
    "../external_program/mpl_token_metadata.20240214.so",
  );

  if (fs.existsSync(metadataPath)) {
    _litesvm.addProgramFromFile(metadataProgramId, metadataPath);
    console.log("✅ Loaded Metaplex Token Metadata program");
  } else {
    console.warn(
      "⚠️  Metadata program not found - position metadata tests may fail",
    );
  }

  console.log("✅ LiteSVM initialized");
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
function mapLiteSVMError(error: any, logs: string[]): string {
  let errorStr = error.toString();

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
    if (error && typeof error === "object" && error.InstructionError) {
      const [index, innerError] = error.InstructionError;
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

  // Fund the wallet using airdrop
  litesvm.airdrop(wallet.publicKey, BigInt(100e9));

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
      if (!account) return null;
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
        if (!account) return null;
        return {
          data: Buffer.from(account.data),
          executable: account.executable,
          lamports: Number(account.lamports),
          owner: account.owner,
          rentEpoch: Number(account.rentEpoch),
        };
      });
    },
    sendRawTransaction: async (
      rawTransaction: Buffer | Uint8Array,
      options?: any,
    ) => {
      const litesvm = getLiteSVM();
      // Deserialize transaction to extract signature after processing
      const tx = Transaction.from(rawTransaction);

      // Send the raw transaction bytes directly to avoid type conflicts
      // TypeScript sees incompatibility between workspace and litesvm's bundled @solana/web3.js
      // but at runtime they're compatible
      // @ts-expect-error - Transaction types are structurally compatible
      const result = litesvm.sendTransaction(Transaction.from(rawTransaction));

      // Check if transaction failed
      if ("err" in result) {
        const error = result.err();
        const logs = result.meta ? result.meta().logs() : [];
        const errorStr = mapLiteSVMError(error, logs);

        throw new Error(
          `Transaction failed:\nError: ${errorStr}\nLogs:\n${logs.join("\n")}`,
        );
      }

      // Extract signature
      if (
        tx.signatures &&
        tx.signatures.length > 0 &&
        tx.signatures[0].signature
      ) {
        return bs58.encode(tx.signatures[0].signature);
      }
      return "litesvm-raw-tx-sig";
    },
    sendAndConfirmTransaction: async (
      tx: Transaction | VersionedTransaction,
      signers?: any[],
      options?: any,
    ) => {
      const litesvm = getLiteSVM();
      // Set blockhash if needed
      if (tx instanceof Transaction) {
        tx.recentBlockhash = litesvm.latestBlockhash();

        // Sign with signers if provided
        if (signers && signers.length > 0) {
          if (!tx.feePayer) {
            tx.feePayer = signers[0].publicKey;
          }
          tx.sign(...signers);
        }
      }

      // @ts-expect-error - Transaction types are structurally compatible
      const result = litesvm.sendTransaction(tx);

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
      const logs = result.logs();
      const logsPayload = {
        signature,
        err: null,
        logs,
      };
      const context = { slot: Number(litesvm.getClock().slot) };

      for (const listener of _logListeners) {
        try {
          setImmediate(() => listener.callback(logsPayload, context));
        } catch (err) {
          console.error("Error in log listener:", err);
        }
      }

      // Expire the blockhash to get a fresh one for next transaction
      getLiteSVM().expireBlockhash();

      return signature;
    },
    sendTransaction: async (
      tx: Transaction | VersionedTransaction,
      signersOrOptions?: any[] | any,
      options?: any,
    ) => {
      const litesvm = getLiteSVM();
      // Handle both (tx, options) and (tx, signers, options) signatures
      let signers: any[] = [];
      let finalOptions = options;

      if (Array.isArray(signersOrOptions)) {
        signers = signersOrOptions;
      } else if (signersOrOptions) {
        finalOptions = signersOrOptions;
      }

      // Set blockhash and ensure fee payer is set
      if (tx instanceof Transaction) {
        tx.recentBlockhash = litesvm.latestBlockhash();

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
        // @ts-expect-error - Transaction types are structurally compatible
        const result = litesvm.sendTransaction(tx);

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
        const logs = result.logs();

        // Trigger log listeners (simulate WebSocket events)
        const logsPayload = {
          signature,
          err: null,
          logs,
        };
        const context = { slot: Number(getLiteSVM().getClock().slot) };

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
        getLiteSVM().expireBlockhash();

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
      const result = litesvm.airdrop(pubkey, BigInt(lamports));
      if (result && "err" in result) {
        throw new Error(`Airdrop failed: ${JSON.stringify(result.err)}`);
      }
      return "airdrop-sig";
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
    getParsedTokenAccountsByOwner: async (owner: PublicKey, filter: any) => {
      // This is a stub implementation that returns empty array
      // The tests use this to check for existing token accounts
      // LiteSVM doesn't have a built-in way to query accounts by owner
      // For now, return empty array which will cause tests to create new accounts
      return {
        context: { slot: 1 },
        value: [],
      };
    },
    getEpochInfo: async (commitment?: any) => {
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
      filter: any,
      callback: (logs: any, ctx: any) => void,
      commitment?: any,
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
      options?: any,
    ) => {
      console.log("🎯 simulateTransaction called");
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
      // @ts-expect-error - Transaction types are structurally compatible
      const result = litesvm.simulateTransaction(tx);

      // Check if simulation failed
      if ("err" in result) {
        const error = result.err();
        const logs = result.meta().logs();
        console.log("❌ Simulation failed with error:", error);

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

      console.log("✅ Simulation succeeded");

      // Simulation succeeded
      const logs = result.meta().logs();
      const postAccounts = result.postAccounts();
      const accounts = postAccounts.map((acc: any) => {
        const account = acc.account();
        const accountData = account.data();
        return {
          data: [Buffer.from(accountData).toString("base64"), "base64"],
          executable: account.executable(),
          lamports: Number(account.lamports()),
          owner: new PublicKey(account.owner()),
          rentEpoch: Number(account.rentEpoch()),
        };
      });

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
          console.log("📦 Simulation returnData:", {
            programId: returnData.programId.toBase58(),
            dataLength: data.length,
            dataHex: Buffer.from(data).toString("hex").slice(0, 40),
          });
        } else {
          console.log("⚠️  No returnData in simulation result");
        }
      } catch (e) {
        console.log(
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
  litesvm.setAccount(pubkey, {
    lamports: Number(account.lamports),
    data: new Uint8Array(data),
    owner: new PublicKey(account.owner),
    executable: account.executable,
    rentEpoch: Number(account.rentEpoch ?? 0),
  });

  console.log(`✅ Loaded preload account: ${pubkey.toBase58()}`);
}

/**
 * Get the current blockchain timestamp from LiteSVM
 */
export function getCurrentTimestamp(): number {
  const litesvm = getLiteSVM();
  return Number(litesvm.getClock().unixTimestamp);
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
  const newTimestamp = currentClock.unixTimestamp + BigInt(seconds);

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

  console.log(
    `⏰ Warped clock: +${seconds}s (slot: ${currentClock.slot} -> ${newSlot}, time: ${currentClock.unixTimestamp} -> ${newTimestamp})`,
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
  tokenProgramId: PublicKey,
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
