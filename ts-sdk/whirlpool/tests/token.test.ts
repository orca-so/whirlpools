import { describe, it, afterEach, vi, beforeAll, afterAll } from "vitest";
import {
  deleteAccount,
  rpc,
  signer,
} from "./utils/mockRpc";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  resetConfiguration,
  setSolWrappingStrategy,
} from "../src/config";
import { NATIVE_MINT, prepareTokenAccountsInstructions } from "../src/token";
import assert from "assert";
import {
  assertCloseAccountInstruction,
  assertCreateAccountInstruction,
  assertCreateAccountWithSeedInstruction,
  assertCreateAtaInstruction,
  assertInitializeAccountInstruction,
  assertSolTransferInstruction,
  assertSyncNativeInstruction,
} from "./utils/assertInstruction";
import { Address } from "@solana/web3.js";
import { setupAta, setupMint } from "./utils/token";
import { setupAtaTE, setupMintTE } from "./utils/tokenExtensions";

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
    mintTE = await setupMintTE();
    ataA = await setupAta(mintA);
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

  it("No native mint", async () => {
    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      mintA,
      mintB,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 2);
    assert.strictEqual(
      result.tokenAccountAddresses[mintA],
      ataA,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[mintB],
      ataB,
    );
    assert.strictEqual(result.createInstructions.length, 1);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: ataB,
      owner: signer.address,
      mint: mintB,
    });
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("No native mint with balances", async () => {
    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [mintA]: 100n,
      [mintB]: 100n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 2);
    assert.strictEqual(
      result.tokenAccountAddresses[mintA],
      ataA,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[mintB],
      ataB,
    );
    assert.strictEqual(result.createInstructions.length, 1);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: ataB,
      owner: signer.address,
      mint: mintB,
    });
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Token 2022 token", async () => {
    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      mintTE,
    ]);

    const tokenAddress = await findAssociatedTokenPda({
      owner: signer.address,
      mint: mintTE,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }).then((x) => x[0]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.strictEqual(
      result.tokenAccountAddresses[mintTE],
      tokenAddress,
    );
    assert.strictEqual(result.createInstructions.length, 1);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: tokenAddress,
      owner: signer.address,
      mint: mintTE,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Native mint and wrapping is none", async () => {
    setSolWrappingStrategy("none");

    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      mintA,
      mintB,
      NATIVE_MINT,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[mintA],
      ataA,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[mintB],
      ataB,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      ataNative,
    );
    assert.strictEqual(result.createInstructions.length, 2);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: ataB,
      owner: signer.address,
      mint: mintB,
    });
    assertCreateAtaInstruction(result.createInstructions[1], {
      ata: ataNative,
      owner: signer.address,
      mint: NATIVE_MINT,
    });
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Native mint and wrapping is none with balances", async () => {
    setSolWrappingStrategy("none");

    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [mintA]: 100n,
      [mintB]: 100n,
      [NATIVE_MINT]: 100n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[mintA],
      ataA,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[mintB],
      ataB,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      ataNative,
    );
    assert.strictEqual(result.createInstructions.length, 2);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: ataB,
      owner: signer.address,
      mint: mintB,
    });
    assertCreateAtaInstruction(result.createInstructions[1], {
      ata: ataNative,
      owner: signer.address,
      mint: NATIVE_MINT,
    });
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Native mint and wrapping is ata", async () => {
    setSolWrappingStrategy("ata");

    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      mintA,
      mintB,
      NATIVE_MINT,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[mintA],
      ataA,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[mintB],
      ataB,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      ataNative,
    );
    assert.strictEqual(result.createInstructions.length, 2);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: ataB,
      owner: signer.address,
      mint: mintB,
    });
    assertCreateAtaInstruction(result.createInstructions[1], {
      ata: ataNative,
      owner: signer.address,
      mint: NATIVE_MINT,
    });
    assert.strictEqual(result.cleanupInstructions.length, 1);
    assertCloseAccountInstruction(result.cleanupInstructions[0], {
      account: ataNative,
      owner: signer.address,
    });
  });

  it("Native mint and wrapping is ata but already exists", async () => {
    await setupAta(NATIVE_MINT);
    setSolWrappingStrategy("ata");

    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      mintA,
      mintB,
      NATIVE_MINT,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[mintA],
      ataA,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[mintB],
      ataB,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      ataNative,
    );
    assert.strictEqual(result.createInstructions.length, 1);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: ataB,
      owner: signer.address,
      mint: mintB,
    });
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Native mint and wrapping is ata with balances", async () => {
    setSolWrappingStrategy("ata");

    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [mintA]: 100n,
      [mintB]: 100n,
      [NATIVE_MINT]: 100n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[mintA],
      ataA,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[mintB],
      ataB,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      ataNative,
    );
    assert.strictEqual(result.createInstructions.length, 4);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: ataB,
      owner: signer.address,
      mint: mintB,
    });
    assertCreateAtaInstruction(result.createInstructions[1], {
      ata: ataNative,
      owner: signer.address,
      mint: NATIVE_MINT,
    });
    assertSolTransferInstruction(result.createInstructions[2], {
      from: signer.address,
      to: result.tokenAccountAddresses[NATIVE_MINT],
      amount: 100n,
    });
    assertSyncNativeInstruction(result.createInstructions[3], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
    });
    assert.strictEqual(result.cleanupInstructions.length, 1);
    assertCloseAccountInstruction(result.cleanupInstructions[0], {
      account: ataNative,
      owner: signer.address,
    });
  });

  it("Native mint and wrapping is ata but already exists with balances", async () => {
    await setupAta(NATIVE_MINT);
    setSolWrappingStrategy("ata");

    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [mintA]: 100n,
      [mintB]: 100n,
      [NATIVE_MINT]: 100n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[mintA],
      ataA,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[mintB],
      ataB,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      ataNative,
    );
    assert.strictEqual(result.createInstructions.length, 3);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: ataB,
      owner: signer.address,
      mint: mintB,
    });
    assertSolTransferInstruction(result.createInstructions[1], {
      from: signer.address,
      to: result.tokenAccountAddresses[NATIVE_MINT],
      amount: 100n,
    });
    assertSyncNativeInstruction(result.createInstructions[2], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
    });
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Native mint and wrapping is seed", async () => {
    setSolWrappingStrategy("seed");

    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      mintA,
      mintB,
      NATIVE_MINT,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[mintA],
      ataA,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[mintB],
      ataB,
    );
    assert.notStrictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      ataNative,
    );
    assert.strictEqual(result.createInstructions.length, 3);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: ataB,
      owner: signer.address,
      mint: mintB,
    });
    assertCreateAccountWithSeedInstruction(result.createInstructions[1], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
      payer: signer.address,
      owner: TOKEN_PROGRAM_ADDRESS,
      seed: Date.now().toString(),
    });
    assertInitializeAccountInstruction(result.createInstructions[2], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
      mint: NATIVE_MINT,
      owner: signer.address,
    });
    assert.strictEqual(result.cleanupInstructions.length, 1);
    assertCloseAccountInstruction(result.cleanupInstructions[0], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
      owner: signer.address,
    });
  });

  it("Native mint and wrapping is seed with balances", async () => {
    setSolWrappingStrategy("seed");

    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [mintA]: 100n,
      [mintB]: 100n,
      [NATIVE_MINT]: 100n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[mintA],
      ataA,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[mintB],
      ataB,
    );
    assert.notStrictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      ataNative,
    );
    assert.strictEqual(result.createInstructions.length, 5);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: ataB,
      owner: signer.address,
      mint: mintB,
    });
    assertCreateAccountWithSeedInstruction(result.createInstructions[1], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
      payer: signer.address,
      owner: TOKEN_PROGRAM_ADDRESS,
      seed: Date.now().toString(),
    });
    assertInitializeAccountInstruction(result.createInstructions[2], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
      mint: NATIVE_MINT,
      owner: signer.address,
    });
    assertSolTransferInstruction(result.createInstructions[3], {
      from: signer.address,
      to: result.tokenAccountAddresses[NATIVE_MINT],
      amount: 100n,
    });
    assertSyncNativeInstruction(result.createInstructions[4], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
    });
    assert.strictEqual(result.cleanupInstructions.length, 1);
    assertCloseAccountInstruction(result.cleanupInstructions[0], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
      owner: signer.address,
    });
  });

  it("Native mint and wrapping is keypair", async () => {
    setSolWrappingStrategy("keypair");

    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      mintA,
      mintB,
      NATIVE_MINT,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[mintA],
      ataA,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[mintB],
      ataB,
    );
    assert.notStrictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      ataNative,
    );
    assert.strictEqual(result.createInstructions.length, 3);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: ataB,
      owner: signer.address,
      mint: mintB,
    });
    assertCreateAccountInstruction(result.createInstructions[1], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
      payer: signer.address,
      owner: TOKEN_PROGRAM_ADDRESS,
    });
    assertInitializeAccountInstruction(result.createInstructions[2], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
      mint: NATIVE_MINT,
      owner: signer.address,
    });
    assert.strictEqual(result.cleanupInstructions.length, 1);
    assertCloseAccountInstruction(result.cleanupInstructions[0], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
      owner: signer.address,
    });
  });

  it("Native mint and wrapping is keypair with balances", async () => {
    setSolWrappingStrategy("keypair");

    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [mintA]: 100n,
      [mintB]: 100n,
      [NATIVE_MINT]: 100n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[mintA],
      ataA,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[mintB],
      ataB,
    );
    assert.notStrictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      ataNative,
    );
    assert.strictEqual(result.createInstructions.length, 5);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: ataB,
      owner: signer.address,
      mint: mintB,
    });
    assertCreateAccountInstruction(result.createInstructions[1], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
      payer: signer.address,
      owner: TOKEN_PROGRAM_ADDRESS,
    });
    assertInitializeAccountInstruction(result.createInstructions[2], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
      mint: NATIVE_MINT,
      owner: signer.address,
    });
    assertSolTransferInstruction(result.createInstructions[3], {
      from: signer.address,
      to: result.tokenAccountAddresses[NATIVE_MINT],
      amount: 100n,
    });
    assertSyncNativeInstruction(result.createInstructions[4], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
    });
    assert.strictEqual(result.cleanupInstructions.length, 1);
    assertCloseAccountInstruction(result.cleanupInstructions[0], {
      account: result.tokenAccountAddresses[NATIVE_MINT],
      owner: signer.address,
    });
  });
});
