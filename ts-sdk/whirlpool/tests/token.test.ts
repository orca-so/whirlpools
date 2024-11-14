import { describe, it, afterEach, vi, beforeAll, afterAll } from "vitest";
import { deleteAccount, rpc, sendTransaction, signer } from "./utils/mockRpc";
import {
  fetchMaybeToken,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  fetchMint,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import {
  resetConfiguration,
  setNativeMintWrappingStrategy,
} from "../src/config";
import {
  getAccountExtensions,
  getCurrentTransferFee,
  getTokenSizeForMint,
  NATIVE_MINT,
  orderMints,
  prepareTokenAccountsInstructions,
} from "../src/token";
import assert from "assert";
import type { Address } from "@solana/web3.js";
import { address } from "@solana/web3.js";
import { setupAta, setupMint } from "./utils/token";
import { setupMintTE, setupMintTEFee } from "./utils/tokenExtensions";

describe("Token Account Creation", () => {
  let mintA: Address;
  let mintB: Address;
  let mintTE: Address;
  let ataA: Address;
  let ataB: Address;
  let ataTE: Address;
  let ataNative: Address;

  beforeAll(async () => {
    vi.useFakeTimers();
    mintA = await setupMint();
    mintB = await setupMint();
    mintTE = await setupMintTEFee();
    ataA = await setupAta(mintA, { amount: 100n });
    ataB = await findAssociatedTokenPda({
      mint: mintB,
      owner: signer.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }).then((x) => x[0]);
    ataTE = await findAssociatedTokenPda({
      mint: mintTE,
      owner: signer.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }).then((x) => x[0]);
    ataNative = await findAssociatedTokenPda({
      mint: NATIVE_MINT,
      owner: signer.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }).then((x) => x[0]);
  });

  afterEach(async () => {
    await deleteAccount(ataNative);
    resetConfiguration();
  });

  afterAll(async () => {
    vi.useRealTimers();
  });

  it("No tokens", async () => {
    const result = await prepareTokenAccountsInstructions(rpc, signer, []);
    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 0);
    assert.strictEqual(result.createInstructions.length, 0);
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("No native mint", async () => {
    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      mintA,
      mintB,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 2);
    assert.strictEqual(result.tokenAccountAddresses[mintA], ataA);
    assert.strictEqual(result.tokenAccountAddresses[mintB], ataB);

    await sendTransaction(result.createInstructions);

    const ataBAfterCreate = await fetchMaybeToken(rpc, ataB);
    assert(ataBAfterCreate.exists);
    assert.strictEqual(ataBAfterCreate.data.amount, 0n);
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("No native mint with balances", async () => {
    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [mintA]: 0n,
      [mintB]: 0n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 2);
    assert.strictEqual(result.tokenAccountAddresses[mintA], ataA);
    assert.strictEqual(result.tokenAccountAddresses[mintB], ataB);

    await sendTransaction(result.createInstructions);

    const ataBAfterCreate = await fetchMaybeToken(rpc, ataB);
    assert(ataBAfterCreate.exists);
    assert.strictEqual(ataBAfterCreate.data.amount, 0n);
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Required balance is already met", async () => {
    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [mintA]: 100n,
    });
    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.strictEqual(result.tokenAccountAddresses[mintA], ataA);

    assert.strictEqual(result.createInstructions.length, 0);
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Required balance but current balance is insufficient", async () => {
    const result = prepareTokenAccountsInstructions(rpc, signer, {
      [mintA]: 250n,
    });
    await assert.rejects(result);
  });

  it("Required balance but no token account exists", async () => {
    const result = prepareTokenAccountsInstructions(rpc, signer, {
      [mintB]: 250n,
    });
    await assert.rejects(result);
  });

  it("Token 2022 token that requires larger token accounts", async () => {
    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      mintTE,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.strictEqual(result.tokenAccountAddresses[mintTE], ataTE);

    await sendTransaction(result.createInstructions);
    const ataTEAfterCreate = await fetchMaybeToken(rpc, ataTE);
    assert(ataTEAfterCreate.exists);
    assert.strictEqual(ataTEAfterCreate.data.amount, 0n);

    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Native mint and wrapping is none", async () => {
    setNativeMintWrappingStrategy("none");

    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      NATIVE_MINT,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.strictEqual(result.tokenAccountAddresses[NATIVE_MINT], ataNative);

    await sendTransaction(result.createInstructions);
    const ataNativeAfterCreate = await fetchMaybeToken(rpc, ataNative);
    assert(ataNativeAfterCreate.exists);
    assert.strictEqual(ataNativeAfterCreate.data.amount, 0n);

    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Native mint and wrapping is none with balances", async () => {
    setNativeMintWrappingStrategy("none");

    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [NATIVE_MINT]: 0n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.strictEqual(result.tokenAccountAddresses[NATIVE_MINT], ataNative);

    await sendTransaction(result.createInstructions);

    const ataNativeAfterCreate = await fetchMaybeToken(rpc, ataNative);
    assert(ataNativeAfterCreate.exists);
    assert.strictEqual(ataNativeAfterCreate.data.amount, 0n);
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Native mint and wrapping is none with balances but no token account exists", async () => {
    setNativeMintWrappingStrategy("none");

    const result = prepareTokenAccountsInstructions(rpc, signer, {
      [NATIVE_MINT]: 250n,
    });
    await assert.rejects(result);
  });

  it("Native mint and wrapping is none with balances but already exists", async () => {
    await setupAta(NATIVE_MINT, { amount: 250n });
    setNativeMintWrappingStrategy("none");

    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [NATIVE_MINT]: 250n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.strictEqual(result.tokenAccountAddresses[NATIVE_MINT], ataNative);

    await sendTransaction(result.createInstructions);

    const ataNativeAfterCreate = await fetchMaybeToken(rpc, ataNative);
    assert(ataNativeAfterCreate.exists);
    assert.strictEqual(ataNativeAfterCreate.data.amount, 250n);
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Native mint and wrapping is none with balances but current balance is insufficient", async () => {
    await setupAta(NATIVE_MINT);
    setNativeMintWrappingStrategy("none");

    const result = prepareTokenAccountsInstructions(rpc, signer, {
      [NATIVE_MINT]: 250n,
    });
    await assert.rejects(result);
  });

  it("Native mint and wrapping is ata", async () => {
    setNativeMintWrappingStrategy("ata");

    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      NATIVE_MINT,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.strictEqual(result.tokenAccountAddresses[NATIVE_MINT], ataNative);

    await sendTransaction(result.createInstructions);

    const ataNativeAfterCreate = await fetchMaybeToken(rpc, ataNative);
    assert(ataNativeAfterCreate.exists);
    assert.strictEqual(ataNativeAfterCreate.data.amount, 0n);

    await sendTransaction(result.cleanupInstructions);

    const ataNativeAfterCleanup = await fetchMaybeToken(rpc, ataNative);
    assert(!ataNativeAfterCleanup.exists);
  });

  it("Native mint and wrapping is ata but already exists", async () => {
    await setupAta(NATIVE_MINT);
    setNativeMintWrappingStrategy("ata");

    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      NATIVE_MINT,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.strictEqual(result.tokenAccountAddresses[NATIVE_MINT], ataNative);

    await sendTransaction(result.createInstructions);

    const ataNativeAfterCreate = await fetchMaybeToken(rpc, ataNative);
    assert(ataNativeAfterCreate.exists);
    assert.strictEqual(ataNativeAfterCreate.data.amount, 0n);

    await sendTransaction(result.cleanupInstructions);

    const ataNativeAfterCleanup = await fetchMaybeToken(rpc, ataNative);
    assert(ataNativeAfterCleanup.exists);
  });

  it("Native mint and wrapping is ata with balances", async () => {
    setNativeMintWrappingStrategy("ata");

    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [NATIVE_MINT]: 250n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.strictEqual(result.tokenAccountAddresses[NATIVE_MINT], ataNative);

    await sendTransaction(result.createInstructions);

    const ataNativeAfterCreate = await fetchMaybeToken(rpc, ataNative);
    assert(ataNativeAfterCreate.exists);
    assert.strictEqual(ataNativeAfterCreate.data.amount, 250n);

    await sendTransaction(result.cleanupInstructions);
    const ataNativeAfterCleanup = await fetchMaybeToken(rpc, ataNative);
    assert(!ataNativeAfterCleanup.exists);
  });

  it("Native mint and wrapping is ata but already exists with balances", async () => {
    await setupAta(NATIVE_MINT, { amount: 100n });
    setNativeMintWrappingStrategy("ata");

    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [NATIVE_MINT]: 250n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.strictEqual(result.tokenAccountAddresses[NATIVE_MINT], ataNative);

    await sendTransaction(result.createInstructions);

    const ataNativeAfterCreate = await fetchMaybeToken(rpc, ataNative);
    assert(ataNativeAfterCreate.exists);
    assert.strictEqual(ataNativeAfterCreate.data.amount, 250n);

    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Native mint and wrapping is ata but already exists with balances and existing balance", async () => {
    await setupAta(NATIVE_MINT, { amount: 500n });
    setNativeMintWrappingStrategy("ata");

    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [NATIVE_MINT]: 250n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.strictEqual(result.tokenAccountAddresses[NATIVE_MINT], ataNative);

    await sendTransaction(result.createInstructions);

    const ataNativeAfterCreate = await fetchMaybeToken(rpc, ataNative);
    assert(ataNativeAfterCreate.exists);
    assert.strictEqual(ataNativeAfterCreate.data.amount, 500n);

    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Native mint and wrapping is seed", async () => {
    setNativeMintWrappingStrategy("seed");

    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      NATIVE_MINT,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.notStrictEqual(result.tokenAccountAddresses[NATIVE_MINT], ataNative);

    await sendTransaction(result.createInstructions);

    const nativeAccountAfterCreate = await fetchMaybeToken(
      rpc,
      result.tokenAccountAddresses[NATIVE_MINT],
    );
    assert(nativeAccountAfterCreate.exists);
    assert.strictEqual(nativeAccountAfterCreate.data.amount, 0n);

    await sendTransaction(result.cleanupInstructions);

    const nativeAccountAfterCleanup = await fetchMaybeToken(
      rpc,
      result.tokenAccountAddresses[NATIVE_MINT],
    );
    assert(!nativeAccountAfterCleanup.exists);
  });

  it("Native mint and wrapping is seed with balances", async () => {
    setNativeMintWrappingStrategy("seed");

    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [NATIVE_MINT]: 250n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.notStrictEqual(result.tokenAccountAddresses[NATIVE_MINT], ataNative);

    await sendTransaction(result.createInstructions);

    const nativeAccountAfterCreate = await fetchMaybeToken(
      rpc,
      result.tokenAccountAddresses[NATIVE_MINT],
    );
    assert(nativeAccountAfterCreate.exists);
    assert.strictEqual(nativeAccountAfterCreate.data.amount, 250n);

    await sendTransaction(result.cleanupInstructions);

    const nativeAccountAfterCleanup = await fetchMaybeToken(
      rpc,
      result.tokenAccountAddresses[NATIVE_MINT],
    );
    assert(!nativeAccountAfterCleanup.exists);
  });

  it("Native mint and wrapping is keypair", async () => {
    setNativeMintWrappingStrategy("keypair");

    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      NATIVE_MINT,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.notStrictEqual(result.tokenAccountAddresses[NATIVE_MINT], ataNative);

    await sendTransaction(result.createInstructions);

    const nativeAccountAfterCreate = await fetchMaybeToken(
      rpc,
      result.tokenAccountAddresses[NATIVE_MINT],
    );
    assert(nativeAccountAfterCreate.exists);
    assert.strictEqual(nativeAccountAfterCreate.data.amount, 0n);

    await sendTransaction(result.cleanupInstructions);

    const nativeAccountAfterCleanup = await fetchMaybeToken(
      rpc,
      result.tokenAccountAddresses[NATIVE_MINT],
    );
    assert(!nativeAccountAfterCleanup.exists);
  });

  it("Native mint and wrapping is keypair with balances", async () => {
    setNativeMintWrappingStrategy("keypair");

    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [NATIVE_MINT]: 250n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.notStrictEqual(result.tokenAccountAddresses[NATIVE_MINT], ataNative);

    await sendTransaction(result.createInstructions);

    const nativeAccountAfterCreate = await fetchMaybeToken(
      rpc,
      result.tokenAccountAddresses[NATIVE_MINT],
    );
    assert(nativeAccountAfterCreate.exists);
    assert.strictEqual(nativeAccountAfterCreate.data.amount, 250n);

    await sendTransaction(result.cleanupInstructions);

    const nativeAccountAfterCleanup = await fetchMaybeToken(
      rpc,
      result.tokenAccountAddresses[NATIVE_MINT],
    );
    assert(!nativeAccountAfterCleanup.exists);
  });

  it("Should order mints by canonical byte order", () => {
    const mint1 = address("Jd4M8bfJG3sAkd82RsGWyEXoaBXQP7njFzBwEaCTuDa");
    const mint2 = address("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k");
    const [mintA, mintB] = orderMints(mint1, mint2);
    assert.strictEqual(mintA, mint1);
    assert.strictEqual(mintB, mint2);

    const [mintC, mintD] = orderMints(mint2, mint1);
    assert.strictEqual(mintC, mint1);
    assert.strictEqual(mintD, mint2);
  });

  it("Should derive the correct transfer fee", async () => {
    const withFee = await fetchMint(rpc, mintTE);
    const older = getCurrentTransferFee(withFee, 0n);
    assert.strictEqual(older?.feeBps, 100);
    assert.strictEqual(older?.maxFee, 1000000000n);

    const newer = getCurrentTransferFee(withFee, 2n);
    assert.strictEqual(newer?.feeBps, 150);
    assert.strictEqual(newer?.maxFee, 1000000000n);

    const noFee = await fetchMint(rpc, mintA);
    const noFeeResult = getCurrentTransferFee(noFee, 0n);
    assert.strictEqual(noFeeResult, undefined);
  });

  it("Should get the correct account extensions", async () => {
    const mint = await fetchMint(rpc, mintTE);
    const extensions = getAccountExtensions(mint.data);
    assert.strictEqual(extensions.length, 1);
    assert.strictEqual(extensions[0].__kind, "TransferFeeAmount");
  });

  it("Should get the correct token size for TOKEN_PROGRAM mint", async () => {
    const mintAccount = await fetchMint(rpc, mintA)
    const tokenSize = getTokenSizeForMint(mintAccount)
    assert.strictEqual(tokenSize, 165);
  });

  it("Should get the correct token size for TOKEN_2022_PROGRAM mint", async () => {
    const mint = await setupMintTE();
    const mintAccount = await fetchMint(rpc, mint)
    const tokenSize = getTokenSizeForMint(mintAccount)
    assert.strictEqual(tokenSize, 165);
  });

  it("Should get the correct token size for TOKEN_2022_PROGRAM mint with", async () => {
    const mintAccount = await fetchMint(rpc, mintTE)
    const tokenSize = getTokenSizeForMint(mintAccount)
    assert.strictEqual(tokenSize, 178);
  });
});
