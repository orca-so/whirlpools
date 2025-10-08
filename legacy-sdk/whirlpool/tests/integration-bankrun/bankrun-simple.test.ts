/**
 * Simple Bankrun Test - No complex dependencies
 *
 * This test demonstrates that bankrun is working correctly
 * without relying on complex test utilities or SDK imports
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import * as assert from "assert";
import { startBankrun, createBankrunProvider } from "../utils/bankrun";

describe("Bankrun Simple Test", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;

  beforeAll(async () => {
    // Initialize bankrun
    await startBankrun();

    // Create provider
    provider = await createBankrunProvider();

    // Load Whirlpool program
    const programId = new PublicKey(
      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
    );
    const idl = require("../../src/artifacts/whirlpool.json");
    program = new anchor.Program(idl, programId, provider);

    console.log("✅ Bankrun initialized successfully");
  });

  it("should have a funded wallet", async () => {
    const balance = await provider.connection.getBalance(
      provider.wallet.publicKey
    );
    assert.ok(balance > 0, "Wallet should have SOL");
    console.log(`  Wallet balance: ${balance / 1e9} SOL`);
  });

  it("should be able to create and fund new accounts", async () => {
    const newKeypair = Keypair.generate();

    // Request airdrop
    await provider.connection.requestAirdrop(newKeypair.publicKey, 1e9);

    const balance = await provider.connection.getBalance(newKeypair.publicKey);
    assert.strictEqual(balance, 1e9, "Account should have exactly 1 SOL");
  });

  it("should be able to get account info", async () => {
    const keypair = Keypair.generate();
    await provider.connection.requestAirdrop(keypair.publicKey, 2e9);

    const accountInfo = await provider.connection.getAccountInfo(
      keypair.publicKey
    );
    assert.ok(accountInfo !== null, "Account info should exist");
    assert.strictEqual(accountInfo.lamports, 2e9);
    assert.ok(accountInfo.owner.equals(SystemProgram.programId));
  });

  it("should have the Whirlpool program deployed", async () => {
    const programInfo = await provider.connection.getAccountInfo(
      program.programId
    );
    assert.ok(programInfo !== null, "Whirlpool program should be deployed");
    assert.ok(programInfo.executable, "Program should be executable");
    console.log(`  Program data size: ${programInfo.data.length} bytes`);
  });

  it("should be able to get rent exemption amounts", async () => {
    const minBalance =
      await provider.connection.getMinimumBalanceForRentExemption(165);
    assert.ok(minBalance > 0, "Min balance should be positive");
    console.log(`  Min rent exemption for 165 bytes: ${minBalance} lamports`);
  });

  it("should be able to get latest blockhash", async () => {
    const { blockhash, lastValidBlockHeight } =
      await provider.connection.getLatestBlockhash();
    assert.ok(blockhash, "Should have blockhash");
    assert.ok(lastValidBlockHeight > 0, "Should have valid block height");
  });
});
