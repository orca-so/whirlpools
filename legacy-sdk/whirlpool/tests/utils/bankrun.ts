/**
 * Bankrun utilities for migrating tests from solana-test-validator
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import type { ProgramTestContext } from "solana-bankrun";
import { startAnchor, Account } from "solana-bankrun/dist/internal";
import * as path from "path";

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

  context.setAccount(
    wallet.publicKey.toBuffer(),
    new Account(
      BigInt(100e9),
      new Uint8Array(),
      SYSTEM_PROGRAM.toBuffer(),
      false,
      0n
    )
  );

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
      const account = await context.banksClient.getAccount(pubkey.toBuffer());
      if (!account) return null;
      return {
        data: Buffer.from(account.data),
        executable: account.executable,
        lamports: Number(account.lamports),
        owner: new PublicKey(account.owner),
        rentEpoch: Number(account.rentEpoch),
      };
    },
    getMultipleAccountsInfo: async (pubkeys: PublicKey[]) => {
      return Promise.all(
        pubkeys.map((pk) => {
          return context.banksClient
            .getAccount(pk.toBuffer())
            .then((account) => {
              if (!account) return null;
              return {
                data: Buffer.from(account.data),
                executable: account.executable,
                lamports: Number(account.lamports),
                owner: new PublicKey(account.owner),
                rentEpoch: Number(account.rentEpoch),
              };
            });
        })
      );
    },
    sendTransaction: async (tx: any) => {
      const [blockhash] = await context.banksClient.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      await context.banksClient.processTransaction(tx);
      return tx.signatures?.[0]?.signature?.toString("base64") || "bankrun-sig";
    },
    confirmTransaction: async () => ({
      context: { slot: 1 },
      value: { err: null },
    }),
    getLatestBlockhash: async () => {
      const result = await context.banksClient.getLatestBlockhash();
      return {
        blockhash: result.blockhash,
        lastValidBlockHeight: Number(result.lastValidBlockHeight),
      };
    },
    getBalance: async (pubkey: PublicKey) => {
      const account = await context.banksClient.getAccount(pubkey.toBuffer());
      return account ? Number(account.lamports) : 0;
    },
    getMinimumBalanceForRentExemption: async (dataLength: number) => {
      const rent = await context.banksClient.getRent();
      return Number(rent.minimumBalance(BigInt(dataLength)));
    },
    requestAirdrop: async (pubkey: PublicKey, lamports: number) => {
      const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
      let account = await context.banksClient.getAccount(pubkey.toBuffer());
      if (account) {
        context.setAccount(
          pubkey.toBuffer(),
          new Account(
            account.lamports + BigInt(lamports),
            account.data,
            account.owner,
            account.executable,
            account.rentEpoch
          )
        );
      } else {
        context.setAccount(
          pubkey.toBuffer(),
          new Account(
            BigInt(lamports),
            new Uint8Array(),
            SYSTEM_PROGRAM.toBuffer(),
            false,
            0n
          )
        );
      }
      return "airdrop-sig";
    },
    getTokenSupply: async (mint: PublicKey) => {
      const mintAccount = await context.banksClient.getAccount(mint.toBuffer());
      if (!mintAccount || mintAccount.data.length < 36) {
        throw new Error("Invalid mint account");
      }
      // Read supply from token mint account (bytes 36-44)
      const supply = mintAccount.data.readBigUInt64LE(36);
      // Read decimals from token mint account (byte 44)
      const decimals = mintAccount.data.readUInt8(44);
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

  context.setAccount(
    keypair.publicKey.toBuffer(),
    new Account(
      BigInt(lamports),
      new Uint8Array(),
      SYSTEM_PROGRAM.toBuffer(),
      false,
      0n
    )
  );

  return keypair;
}
