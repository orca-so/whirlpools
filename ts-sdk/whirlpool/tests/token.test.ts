import { describe, it } from "mocha";
import {
  mockAccounts,
  rpc,
  TOKEN_2022_MINT,
  TOKEN_MINT_1,
  TOKEN_MINT_2,
} from "./mockRpc";
import {
  AccountState,
  findAssociatedTokenPda,
  getTokenEncoder,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  DEFAULT_ADDRESS,
  resetConfiguration,
  setSolWrappingStrategy,
} from "../src/config";
import type { Address, TransactionSigner } from "@solana/web3.js";
import { createNoopSigner, generateKeyPairSigner } from "@solana/web3.js";
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
} from "./assertInstruction";
import type { SinonFakeTimers } from "sinon";
import { useFakeTimers } from "sinon";

describe("Token Account Creation", () => {
  let clock = {} as SinonFakeTimers;
  let signer: TransactionSigner = createNoopSigner(DEFAULT_ADDRESS);
  let existingTokenAccount: Address = DEFAULT_ADDRESS;
  let nonExistingTokenAccount: Address = DEFAULT_ADDRESS;
  let nativeMintTokenAccount: Address = DEFAULT_ADDRESS;

  const createNativeMintTokenAccount = async () => {
    mockAccounts[nativeMintTokenAccount] = mockAccounts[existingTokenAccount] =
      {
        bytes: getTokenEncoder().encode({
          mint: TOKEN_MINT_1,
          owner: signer.address,
          amount: 500,
          delegate: null,
          state: AccountState.Initialized,
          isNative: null,
          delegatedAmount: 0,
          closeAuthority: null,
        }),
        owner: TOKEN_PROGRAM_ADDRESS,
      };
  };

  before(async () => {
    clock = useFakeTimers();
    signer = await generateKeyPairSigner();
    [existingTokenAccount, nonExistingTokenAccount, nativeMintTokenAccount] =
      await Promise.all(
        [TOKEN_MINT_1, TOKEN_MINT_2, NATIVE_MINT].map((mint) =>
          findAssociatedTokenPda({
            owner: signer.address,
            mint,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
          }).then((x) => x[0]),
        ),
      );
    mockAccounts[existingTokenAccount] = {
      bytes: getTokenEncoder().encode({
        mint: TOKEN_MINT_1,
        owner: signer.address,
        amount: 500,
        delegate: null,
        state: AccountState.Initialized,
        isNative: null,
        delegatedAmount: 0,
        closeAuthority: null,
      }),
      owner: TOKEN_PROGRAM_ADDRESS,
    };
  });

  after(async () => {
    clock.restore();
    delete mockAccounts[existingTokenAccount];
  });

  afterEach(async () => {
    await resetConfiguration();
  });

  it("No native mint", async () => {
    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      TOKEN_MINT_1,
      TOKEN_MINT_2,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 2);
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_1],
      existingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_2],
      nonExistingTokenAccount,
    );
    assert.strictEqual(result.createInstructions.length, 1);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: nonExistingTokenAccount,
      owner: signer.address,
      mint: TOKEN_MINT_2,
    });
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("No native mint with balances", async () => {
    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [TOKEN_MINT_1]: 100n,
      [TOKEN_MINT_2]: 100n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 2);
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_1],
      existingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_2],
      nonExistingTokenAccount,
    );
    assert.strictEqual(result.createInstructions.length, 1);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: nonExistingTokenAccount,
      owner: signer.address,
      mint: TOKEN_MINT_2,
    });
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Token 2022 token", async () => {
    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      TOKEN_2022_MINT,
    ]);

    const tokenAddress = await findAssociatedTokenPda({
      owner: signer.address,
      mint: TOKEN_2022_MINT,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }).then((x) => x[0]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 1);
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_2022_MINT],
      tokenAddress,
    );
    assert.strictEqual(result.createInstructions.length, 1);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: tokenAddress,
      owner: signer.address,
      mint: TOKEN_MINT_2,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Native mint and wrapping is none", async () => {
    setSolWrappingStrategy("none");

    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      TOKEN_MINT_1,
      TOKEN_MINT_2,
      NATIVE_MINT,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_1],
      existingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_2],
      nonExistingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      nativeMintTokenAccount,
    );
    assert.strictEqual(result.createInstructions.length, 2);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: nonExistingTokenAccount,
      owner: signer.address,
      mint: TOKEN_MINT_2,
    });
    assertCreateAtaInstruction(result.createInstructions[1], {
      ata: nativeMintTokenAccount,
      owner: signer.address,
      mint: NATIVE_MINT,
    });
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Native mint and wrapping is none with balances", async () => {
    setSolWrappingStrategy("none");

    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [TOKEN_MINT_1]: 100n,
      [TOKEN_MINT_2]: 100n,
      [NATIVE_MINT]: 100n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_1],
      existingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_2],
      nonExistingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      nativeMintTokenAccount,
    );
    assert.strictEqual(result.createInstructions.length, 2);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: nonExistingTokenAccount,
      owner: signer.address,
      mint: TOKEN_MINT_2,
    });
    assertCreateAtaInstruction(result.createInstructions[1], {
      ata: nativeMintTokenAccount,
      owner: signer.address,
      mint: NATIVE_MINT,
    });
    assert.strictEqual(result.cleanupInstructions.length, 0);
  });

  it("Native mint and wrapping is ata", async () => {
    setSolWrappingStrategy("ata");

    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      TOKEN_MINT_1,
      TOKEN_MINT_2,
      NATIVE_MINT,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_1],
      existingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_2],
      nonExistingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      nativeMintTokenAccount,
    );
    assert.strictEqual(result.createInstructions.length, 2);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: nonExistingTokenAccount,
      owner: signer.address,
      mint: TOKEN_MINT_2,
    });
    assertCreateAtaInstruction(result.createInstructions[1], {
      ata: nativeMintTokenAccount,
      owner: signer.address,
      mint: NATIVE_MINT,
    });
    assert.strictEqual(result.cleanupInstructions.length, 1);
    assertCloseAccountInstruction(result.cleanupInstructions[0], {
      account: nativeMintTokenAccount,
      owner: signer.address,
    });
  });

  it("Native mint and wrapping is ata but already exists", async () => {
    setSolWrappingStrategy("ata");
    await createNativeMintTokenAccount();

    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      TOKEN_MINT_1,
      TOKEN_MINT_2,
      NATIVE_MINT,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_1],
      existingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_2],
      nonExistingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      nativeMintTokenAccount,
    );
    assert.strictEqual(result.createInstructions.length, 1);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: nonExistingTokenAccount,
      owner: signer.address,
      mint: TOKEN_MINT_2,
    });
    assert.strictEqual(result.cleanupInstructions.length, 0);

    delete mockAccounts[nativeMintTokenAccount];
  });

  it("Native mint and wrapping is ata with balances", async () => {
    setSolWrappingStrategy("ata");

    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [TOKEN_MINT_1]: 100n,
      [TOKEN_MINT_2]: 100n,
      [NATIVE_MINT]: 100n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_1],
      existingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_2],
      nonExistingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      nativeMintTokenAccount,
    );
    assert.strictEqual(result.createInstructions.length, 4);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: nonExistingTokenAccount,
      owner: signer.address,
      mint: TOKEN_MINT_2,
    });
    assertCreateAtaInstruction(result.createInstructions[1], {
      ata: nativeMintTokenAccount,
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
      account: nativeMintTokenAccount,
      owner: signer.address,
    });
  });

  it("Native mint and wrapping is ata but already exists with balances", async () => {
    setSolWrappingStrategy("ata");
    await createNativeMintTokenAccount();

    const result = await prepareTokenAccountsInstructions(rpc, signer, {
      [TOKEN_MINT_1]: 100n,
      [TOKEN_MINT_2]: 100n,
      [NATIVE_MINT]: 100n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_1],
      existingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_2],
      nonExistingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      nativeMintTokenAccount,
    );
    assert.strictEqual(result.createInstructions.length, 3);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: nonExistingTokenAccount,
      owner: signer.address,
      mint: TOKEN_MINT_2,
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

    delete mockAccounts[nativeMintTokenAccount];
  });

  it("Native mint and wrapping is seed", async () => {
    setSolWrappingStrategy("seed");

    const result = await prepareTokenAccountsInstructions(rpc, signer, [
      TOKEN_MINT_1,
      TOKEN_MINT_2,
      NATIVE_MINT,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_1],
      existingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_2],
      nonExistingTokenAccount,
    );
    assert.notStrictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      nativeMintTokenAccount,
    );
    assert.strictEqual(result.createInstructions.length, 3);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: nonExistingTokenAccount,
      owner: signer.address,
      mint: TOKEN_MINT_2,
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
      [TOKEN_MINT_1]: 100n,
      [TOKEN_MINT_2]: 100n,
      [NATIVE_MINT]: 100n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_1],
      existingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_2],
      nonExistingTokenAccount,
    );
    assert.notStrictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      nativeMintTokenAccount,
    );
    assert.strictEqual(result.createInstructions.length, 5);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: nonExistingTokenAccount,
      owner: signer.address,
      mint: TOKEN_MINT_2,
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
      TOKEN_MINT_1,
      TOKEN_MINT_2,
      NATIVE_MINT,
    ]);

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_1],
      existingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_2],
      nonExistingTokenAccount,
    );
    assert.notStrictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      nativeMintTokenAccount,
    );
    assert.strictEqual(result.createInstructions.length, 3);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: nonExistingTokenAccount,
      owner: signer.address,
      mint: TOKEN_MINT_2,
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
      [TOKEN_MINT_1]: 100n,
      [TOKEN_MINT_2]: 100n,
      [NATIVE_MINT]: 100n,
    });

    assert.strictEqual(Object.keys(result.tokenAccountAddresses).length, 3);
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_1],
      existingTokenAccount,
    );
    assert.strictEqual(
      result.tokenAccountAddresses[TOKEN_MINT_2],
      nonExistingTokenAccount,
    );
    assert.notStrictEqual(
      result.tokenAccountAddresses[NATIVE_MINT],
      nativeMintTokenAccount,
    );
    assert.strictEqual(result.createInstructions.length, 5);
    assertCreateAtaInstruction(result.createInstructions[0], {
      ata: nonExistingTokenAccount,
      owner: signer.address,
      mint: TOKEN_MINT_2,
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
