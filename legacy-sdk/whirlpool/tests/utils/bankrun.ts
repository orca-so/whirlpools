/**
 * Bankrun utilities for migrating tests from solana-test-validator
 */
import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Transaction,
  VersionedTransaction,
  AccountInfo,
} from "@solana/web3.js";
import { startAnchor } from "solana-bankrun";
import bs58 from "bs58";

type ProgramTestContext = Awaited<ReturnType<typeof startAnchor>>;
type AccountInfoBytes = AccountInfo<Uint8Array>;

let _context: ProgramTestContext | null = null;

function toBytes(publicKey: PublicKey): Uint8Array {
  return publicKey.toBytes();
}

/**
 * Initialize bankrun with the Whirlpool program using startAnchor
 */
export async function startBankrun(): Promise<ProgramTestContext> {
  if (_context) {
    return _context;
  }

  console.log("🚀 Starting bankrun...");

  // Use startAnchor which automatically loads programs from workspace
  _context = await startAnchor(
    "../../", // Path to Anchor.toml
    [], // Additional programs (empty for now)
    [] // Preloaded accounts (empty for now)
  );

  console.log("✅ Bankrun initialized");
  return _context;
}

/**
 * Get the bankrun context
 */
export function getBankrunContext(): ProgramTestContext {
  if (!_context) {
    throw new Error("Bankrun not started. Call startBankrun() first.");
  }
  return _context;
}

/**
 * Create a bankrun-powered Anchor provider
 */
export async function createBankrunProvider(): Promise<anchor.AnchorProvider> {
  const context = await startBankrun();

  // Create wallet
  const wallet = Keypair.generate();
  const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

  context.setAccount(wallet.publicKey, {
    lamports: 100e9,
    data: new Uint8Array(),
    owner: SYSTEM_PROGRAM,
    executable: false,
    rentEpoch: 0,
  });

  // Create connection wrapper
  const connection = createBankrunConnection(context);

  // Create provider
  return new anchor.AnchorProvider(
    connection as any,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
}

/**
 * Connection wrapper for bankrun
 */
function createBankrunConnection(context: ProgramTestContext) {
  return {
    getAccountInfo: async (pubkey: PublicKey) => {
      const account = await context.banksClient.getAccount(pubkey);
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
      return Promise.all(
        pubkeys.map((pk) => {
          return context.banksClient.getAccount(pk).then((account) => {
            if (!account) return null;
            return {
              data: Buffer.from(account.data),
              executable: account.executable,
              lamports: Number(account.lamports),
              owner: account.owner,
              rentEpoch: Number(account.rentEpoch),
            };
          });
        })
      );
    },
    sendRawTransaction: async (
      rawTransaction: Buffer | Uint8Array,
      options?: any
    ) => {
      // Deserialize and process the raw transaction
      const tx = Transaction.from(rawTransaction);
      const result = await context.banksClient.getLatestBlockhash();
      if (!tx.recentBlockhash) {
        tx.recentBlockhash = result?.[0];
      }

      const processResult = await context.banksClient.tryProcessTransaction(tx);
      if (!processResult.result) {
        // Extract and encode signature as base58 (Solana standard)
        let signature: string;
        if (
          tx.signatures &&
          tx.signatures.length > 0 &&
          tx.signatures[0].signature
        ) {
          signature = bs58.encode(tx.signatures[0].signature);
        } else {
          signature = "bankrun-raw-tx-sig";
        }
        return signature;
      } else {
        const logs = processResult.meta?.logMessages || [];
        const errorMsg = processResult.result
          ? JSON.stringify(processResult.result, null, 2)
          : "Unknown error";
        throw new Error(
          `Transaction failed:\nError: ${errorMsg}\nLogs:\n${logs.join("\n")}`
        );
      }
    },
    sendTransaction: async (
      tx: Transaction | VersionedTransaction,
      options?: any
    ) => {
      // Set recent blockhash if not already set
      const result = await context.banksClient.getLatestBlockhash();
      if (tx instanceof Transaction && !tx.recentBlockhash) {
        tx.recentBlockhash = result?.[0];
      }

      // Process the transaction through bankrun
      try {
        const processResult =
          await context.banksClient.tryProcessTransaction(tx);

        // Check if transaction succeeded
        // In bankrun, result is null/undefined if succeeded, contains error if failed
        if (!processResult.result) {
          // Transaction succeeded - extract and encode signature as base58 (Solana standard)
          let signature: string;
          if (tx instanceof Transaction) {
            if (tx.signatures?.[0]?.signature) {
              signature = bs58.encode(tx.signatures[0].signature);
            } else {
              signature = "bankrun-tx-sig";
            }
          } else {
            // VersionedTransaction
            if (tx.signatures?.[0]) {
              signature = bs58.encode(tx.signatures[0]);
            } else {
              signature = "bankrun-tx-sig";
            }
          }
          return signature;
        } else {
          // Transaction failed
          const logs = processResult.meta?.logMessages || [];
          const errorMsg = processResult.result
            ? JSON.stringify(processResult.result, null, 2)
            : "Unknown error";
          throw new Error(
            `Transaction failed:\nError: ${errorMsg}\nLogs:\n${logs.join("\n")}`
          );
        }
      } catch (error: any) {
        console.error("Transaction processing error:", error);
        throw new Error(
          `Failed to process transaction: ${error.message || error}`
        );
      }
    },
    confirmTransaction: async () => ({
      context: { slot: 1 },
      value: { err: null },
    }),
    getLatestBlockhash: async () => {
      const result = await context.banksClient.getLatestBlockhash();
      // Bankrun returns blockhash directly as a string, not as an object
      // The result format from bankrun is { blockhash: string, lastValidBlockHeight: bigint }
      if (!result) {
        throw new Error("No blockhash found");
      }
      return {
        blockhash: result[0],
        lastValidBlockHeight: result[1],
      };
    },
    getBalance: async (pubkey: PublicKey) => {
      const account = await context.banksClient.getAccount(pubkey);
      return account ? Number(account.lamports) : 0;
    },
    getMinimumBalanceForRentExemption: async (dataLength: number) => {
      const rent = await context.banksClient.getRent();
      return Number(rent.minimumBalance(BigInt(dataLength)));
    },
    requestAirdrop: async (pubkey: PublicKey, lamports: number) => {
      const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
      let account = await context.banksClient.getAccount(pubkey);
      if (account) {
        context.setAccount(pubkey, {
          lamports: Number(account.lamports) + lamports,
          data: account.data,
          owner: account.owner,
          executable: account.executable,
          rentEpoch: Number(account.rentEpoch),
        });
      } else {
        context.setAccount(pubkey, {
          lamports: lamports,
          data: new Uint8Array(),
          owner: SYSTEM_PROGRAM,
          executable: false,
          rentEpoch: 0,
        });
      }
      return "airdrop-sig";
    },
    getTokenSupply: async (mint: PublicKey) => {
      const mintAccount = await context.banksClient.getAccount(mint);
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
  };
}

/**
 * Create funded keypair for testing
 */
export async function createFundedKeypair(
  lamports: number = 100e9
): Promise<Keypair> {
  const context = getBankrunContext();
  const keypair = Keypair.generate();
  const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

  context.setAccount(keypair.publicKey, {
    lamports: lamports,
    data: new Uint8Array(),
    owner: SYSTEM_PROGRAM,
    executable: false,
    rentEpoch: 0,
  });

  return keypair;
}
