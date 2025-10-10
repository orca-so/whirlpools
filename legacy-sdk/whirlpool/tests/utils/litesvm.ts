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
import { LiteSVM } from "litesvm";
import bs58 from "bs58";
import * as fs from "fs";
import * as path from "path";

let _litesvm: LiteSVM | null = null;

/**
 * Initialize LiteSVM with the Whirlpool program
 */
export async function startLiteSVM(): Promise<LiteSVM> {
  if (_litesvm) {
    return _litesvm;
  }

  console.log("🚀 Starting LiteSVM...");

  // Create a new LiteSVM instance with standard functionality
  _litesvm = new LiteSVM();

  // Load the Whirlpool program
  const programId = new PublicKey(
    "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
  );
  const programPath = path.resolve(
    __dirname,
    "../../../../target/deploy/whirlpool.so"
  );

  if (!fs.existsSync(programPath)) {
    throw new Error(
      `Program not found at ${programPath}. Run 'anchor build' first.`
    );
  }

  _litesvm.addProgramFromFile(programId, programPath);

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
    { commitment: "confirmed" }
  );
}

/**
 * Connection wrapper for LiteSVM
 */
function createLiteSVMConnection(litesvm: LiteSVM) {
  return {
    getAccountInfo: async (pubkey: PublicKey) => {
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
      options?: any
    ) => {
      // Deserialize transaction to extract signature after processing
      const tx = Transaction.from(rawTransaction);

      // Send the raw transaction bytes directly to avoid type conflicts
      // TypeScript sees incompatibility between workspace and litesvm's bundled @solana/web3.js
      // but at runtime they're compatible
      // @ts-expect-error - Transaction types are structurally compatible
      const result = litesvm.sendTransaction(Transaction.from(rawTransaction));

      // Check if transaction failed
      if ("err" in result) {
        const logs =
          "logMessages" in result && Array.isArray(result.logMessages)
            ? result.logMessages
            : [];
        throw new Error(
          `Transaction failed:\nError: ${JSON.stringify(result.err)}\nLogs:\n${logs.join("\n")}`
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
    sendTransaction: async (
      tx: Transaction | VersionedTransaction,
      options?: any
    ) => {
      // Set blockhash
      if (tx instanceof Transaction) {
        tx.recentBlockhash = litesvm.latestBlockhash();
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
          // LiteSVM uses methods for error properties
          const error = result.err();
          const logs = result.meta().logs();

          // Convert error to string representation
          const errorStr = error.toString();

          throw new Error(
            `Transaction failed:\nError: ${errorStr}\nLogs:\n${logs.join("\n")}`
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

        // Expire the blockhash to get a fresh one for next transaction
        litesvm.expireBlockhash();

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
      const blockhash = litesvm.latestBlockhash();
      return {
        blockhash: blockhash,
        lastValidBlockHeight: 1000000,
      };
    },
    getBalance: async (pubkey: PublicKey) => {
      const balance = litesvm.getBalance(pubkey);
      return balance ? Number(balance) : 0;
    },
    getMinimumBalanceForRentExemption: async (dataLength: number) => {
      return Number(litesvm.minimumBalanceForRentExemption(BigInt(dataLength)));
    },
    requestAirdrop: async (pubkey: PublicKey, lamports: number) => {
      const result = litesvm.airdrop(pubkey, BigInt(lamports));
      if (result && "err" in result) {
        throw new Error(`Airdrop failed: ${JSON.stringify(result.err)}`);
      }
      return "airdrop-sig";
    },
    getTokenSupply: async (mint: PublicKey) => {
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
  };
}

/**
 * Create funded keypair for testing
 */
export async function createFundedKeypair(
  lamports: number = 100e9
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
