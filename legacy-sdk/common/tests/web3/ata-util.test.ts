import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AccountLayout,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  getAccount,
  getAssociatedTokenAddressSync,
  setAuthority,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { BN } from "bn.js";
import { ZERO } from "../../src/math";
import {
  resolveOrCreateATA,
  resolveOrCreateATAs,
} from "../../src/web3/ata-util";
import { TransactionBuilder } from "../../src/web3/transactions";
import {
  createNewMint,
  createTestContext,
  requestAirdrop,
} from "../test-context";

describe("ata-util", () => {
  const ctx = createTestContext();
  const { connection, wallet } = ctx;

  beforeAll(async () => {
    await requestAirdrop(ctx);
  });

  const tokenPrograms = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
  tokenPrograms.forEach((tokenProgram) =>
    describe(`TokenProgram: ${tokenProgram.toBase58()}`, () => {
      it("resolveOrCreateATA, wrapped sol", async () => {
        const { connection, wallet } = ctx;

        // verify address & instruction
        const notExpected = getAssociatedTokenAddressSync(
          wallet.publicKey,
          NATIVE_MINT,
        );
        const resolved = await resolveOrCreateATA(
          connection,
          wallet.publicKey,
          NATIVE_MINT,
          () =>
            connection.getMinimumBalanceForRentExemption(AccountLayout.span),
          new BN(LAMPORTS_PER_SOL),
          wallet.publicKey,
          false,
        );
        expect(resolved.address.equals(notExpected)).toBeFalsy(); // non-ATA address
        expect(resolved.instructions.length).toEqual(2);
        expect(
          resolved.instructions[0].programId.equals(SystemProgram.programId),
        ).toBeTruthy();
        expect(
          resolved.instructions[1].programId.equals(TOKEN_PROGRAM_ID),
        ).toBeTruthy();
        expect(resolved.cleanupInstructions.length).toEqual(1);
        expect(
          resolved.cleanupInstructions[0].programId.equals(TOKEN_PROGRAM_ID),
        ).toBeTruthy();
      });

      it("resolveOrCreateATA, not exist, modeIdempotent = false", async () => {
        const mint = await createNewMint(ctx, tokenProgram);

        // verify address & instruction
        const expected = getAssociatedTokenAddressSync(
          mint,
          wallet.publicKey,
          undefined,
          tokenProgram,
        );
        const resolved = await resolveOrCreateATA(
          connection,
          wallet.publicKey,
          mint,
          () =>
            connection.getMinimumBalanceForRentExemption(AccountLayout.span),
          ZERO,
          wallet.publicKey,
          false,
        );
        expect(resolved.address.equals(expected)).toBeTruthy();
        expect(resolved.instructions.length).toEqual(1);
        expect(resolved.instructions[0].data.length).toEqual(0); // no instruction data

        // verify transaction
        const preAccountData = await connection.getAccountInfo(
          resolved.address,
        );
        expect(preAccountData).toBeNull();

        const builder = new TransactionBuilder(connection, wallet);
        builder.addInstruction(resolved);
        await builder.buildAndExecute();

        const postAccountData = await connection.getAccountInfo(
          resolved.address,
        );
        expect(postAccountData?.owner.equals(tokenProgram)).toBeTruthy();
      });

      it("resolveOrCreateATA, exist, modeIdempotent = false", async () => {
        const mint = await createNewMint(ctx, tokenProgram);

        const expected = await createAssociatedTokenAccount(
          ctx.connection,
          wallet.payer,
          mint,
          wallet.publicKey,
          undefined,
          tokenProgram,
        );
        const preAccountData = await connection.getAccountInfo(expected);
        expect(preAccountData).not.toBeNull();

        // verify address & instruction
        const resolved = await resolveOrCreateATA(
          connection,
          wallet.publicKey,
          mint,
          () =>
            connection.getMinimumBalanceForRentExemption(AccountLayout.span),
          ZERO,
          wallet.publicKey,
          false,
        );
        expect(resolved.address.equals(expected)).toBeTruthy();
        expect(resolved.instructions.length).toEqual(0);
      });

      it("resolveOrCreateATA, created before execution, modeIdempotent = false", async () => {
        const mint = await createNewMint(ctx, tokenProgram);

        const expected = getAssociatedTokenAddressSync(
          mint,
          wallet.publicKey,
          undefined,
          tokenProgram,
        );
        const resolved = await resolveOrCreateATA(
          connection,
          wallet.publicKey,
          mint,
          () =>
            connection.getMinimumBalanceForRentExemption(AccountLayout.span),
          ZERO,
          wallet.publicKey,
          false,
        );
        expect(resolved.address.equals(expected)).toBeTruthy();
        expect(resolved.instructions.length).toEqual(1);
        expect(resolved.instructions[0].data.length).toEqual(0); // no instruction data

        // created before execution
        await createAssociatedTokenAccount(
          connection,
          wallet.payer,
          mint,
          wallet.publicKey,
          undefined,
          tokenProgram,
        );
        const accountData = await connection.getAccountInfo(expected);
        expect(accountData).not.toBeNull();

        // Tx should be fail
        const builder = new TransactionBuilder(connection, wallet);
        builder.addInstruction(resolved);
        await expect(builder.buildAndExecute()).rejects.toThrow();
      });

      it("resolveOrCreateATA, created before execution, modeIdempotent = true", async () => {
        const mint = await createNewMint(ctx, tokenProgram);

        const expected = getAssociatedTokenAddressSync(
          mint,
          wallet.publicKey,
          undefined,
          tokenProgram,
        );
        const resolved = await resolveOrCreateATA(
          connection,
          wallet.publicKey,
          mint,
          () =>
            connection.getMinimumBalanceForRentExemption(AccountLayout.span),
          ZERO,
          wallet.publicKey,
          true,
        );
        expect(resolved.address.equals(expected)).toBeTruthy();
        expect(resolved.instructions.length).toEqual(1);
        expect(resolved.instructions[0].data[0]).toEqual(1); // 1 byte data

        // created before execution
        await createAssociatedTokenAccount(
          connection,
          wallet.payer,
          mint,
          wallet.publicKey,
          undefined,
          tokenProgram,
        );
        const accountData = await connection.getAccountInfo(expected);
        expect(accountData).not.toBeNull();

        // Tx should be success even if ATA has been created
        const builder = new TransactionBuilder(connection, wallet);
        builder.addInstruction(resolved);
        await expect(builder.buildAndExecute()).resolves.toBeTruthy();
      });

      it("resolveOrCreateATAs, created before execution, modeIdempotent = false", async () => {
        const mints = await Promise.all([
          createNewMint(ctx, tokenProgram),
          createNewMint(ctx, tokenProgram),
          createNewMint(ctx, tokenProgram),
        ]);

        // create first ATA
        await createAssociatedTokenAccount(
          connection,
          wallet.payer,
          mints[0],
          wallet.publicKey,
          undefined,
          tokenProgram,
        );

        const expected = mints.map((mint) =>
          getAssociatedTokenAddressSync(
            mint,
            wallet.publicKey,
            undefined,
            tokenProgram,
          ),
        );
        const resolved = await resolveOrCreateATAs(
          connection,
          wallet.publicKey,
          mints.map((mint) => ({ tokenMint: mint, wrappedSolAmountIn: ZERO })),
          () =>
            connection.getMinimumBalanceForRentExemption(AccountLayout.span),
          wallet.publicKey,
          false,
        );
        expect(resolved[0].address.equals(expected[0])).toBeTruthy();
        expect(resolved[1].address.equals(expected[1])).toBeTruthy();
        expect(resolved[2].address.equals(expected[2])).toBeTruthy();
        expect(resolved[0].instructions.length).toEqual(0); // already exists
        expect(resolved[1].instructions.length).toEqual(1);
        expect(resolved[2].instructions.length).toEqual(1);
        expect(resolved[1].instructions[0].data.length).toEqual(0); // no instruction data
        expect(resolved[2].instructions[0].data.length).toEqual(0); // no instruction data

        // create second ATA before execution
        await createAssociatedTokenAccount(
          connection,
          wallet.payer,
          mints[1],
          wallet.publicKey,
          undefined,
          tokenProgram,
        );

        const preAccountData =
          await connection.getMultipleAccountsInfo(expected);
        expect(preAccountData[0]).not.toBeNull();
        expect(preAccountData[1]).not.toBeNull();
        expect(preAccountData[2]).toBeNull();

        // Tx should be fail
        const builder = new TransactionBuilder(connection, wallet);
        builder.addInstructions(resolved);
        await expect(builder.buildAndExecute()).rejects.toThrow();
      });

      it("resolveOrCreateATAs, created before execution, modeIdempotent = true", async () => {
        const mints = await Promise.all([
          createNewMint(ctx, tokenProgram),
          createNewMint(ctx, tokenProgram),
          createNewMint(ctx, tokenProgram),
        ]);

        // create first ATA
        await createAssociatedTokenAccount(
          connection,
          wallet.payer,
          mints[0],
          wallet.publicKey,
          undefined,
          tokenProgram,
        );

        const expected = mints.map((mint) =>
          getAssociatedTokenAddressSync(
            mint,
            wallet.publicKey,
            undefined,
            tokenProgram,
          ),
        );

        const resolved = await resolveOrCreateATAs(
          connection,
          wallet.publicKey,
          mints.map((mint) => ({ tokenMint: mint, wrappedSolAmountIn: ZERO })),
          () =>
            connection.getMinimumBalanceForRentExemption(AccountLayout.span),
          wallet.publicKey,
          true,
        );
        expect(resolved[0].address.equals(expected[0])).toBeTruthy();
        expect(resolved[1].address.equals(expected[1])).toBeTruthy();
        expect(resolved[2].address.equals(expected[2])).toBeTruthy();
        expect(resolved[0].instructions.length).toEqual(0); // already exists
        expect(resolved[1].instructions.length).toEqual(1);
        expect(resolved[2].instructions.length).toEqual(1);
        expect(resolved[1].instructions[0].data[0]).toEqual(1); // 1 byte data
        expect(resolved[2].instructions[0].data[0]).toEqual(1); // 1 byte data

        // create second ATA before execution
        await createAssociatedTokenAccount(
          connection,
          wallet.payer,
          mints[1],
          wallet.publicKey,
          undefined,
          tokenProgram,
        );

        const preAccountData =
          await connection.getMultipleAccountsInfo(expected);
        expect(preAccountData[0]).not.toBeNull();
        expect(preAccountData[1]).not.toBeNull();
        expect(preAccountData[2]).toBeNull();

        // Tx should be success even if second ATA has been created
        const builder = new TransactionBuilder(connection, wallet);
        builder.addInstructions(resolved);
        await expect(builder.buildAndExecute()).resolves.toBeTruthy();

        const postAccountData =
          await connection.getMultipleAccountsInfo(expected);
        expect(postAccountData[0]).not.toBeNull();
        expect(postAccountData[1]).not.toBeNull();
        expect(postAccountData[2]).not.toBeNull();
      });

      it("resolveOrCreateATA, owner changed ATA detected", async () => {
        // in Token-2022, owner of ATA cannot be changed
        if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) return;

        const anotherWallet = Keypair.generate();
        const mint = await createNewMint(ctx, tokenProgram);

        const ata = await createAssociatedTokenAccount(
          connection,
          wallet.payer,
          mint,
          wallet.publicKey,
          undefined,
          tokenProgram,
        );

        // should be ok
        const preOwnerChanged = await resolveOrCreateATA(
          connection,
          wallet.publicKey,
          mint,
          () =>
            connection.getMinimumBalanceForRentExemption(AccountLayout.span),
        );
        expect(preOwnerChanged.address.equals(ata)).toBeTruthy();

        // owner change
        await setAuthority(
          connection,
          ctx.wallet.payer,
          ata,
          wallet.publicKey,
          2,
          anotherWallet.publicKey,
          [],
        );

        // verify that owner have been changed
        const changed = await getAccount(connection, ata);
        expect(changed.owner.equals(anotherWallet.publicKey)).toBeTruthy();

        // should be failed
        const postOwnerChangedPromise = resolveOrCreateATA(
          connection,
          wallet.publicKey,
          mint,
          () =>
            connection.getMinimumBalanceForRentExemption(AccountLayout.span),
        );
        await expect(postOwnerChangedPromise).rejects.toThrow(
          /ATA with change of ownership detected/,
        );
      });

      it("resolveOrCreateATA, allowPDAOwnerAddress = false", async () => {
        const mint = await createNewMint(ctx, tokenProgram);

        const pda = getAssociatedTokenAddressSync(
          mint,
          wallet.publicKey,
          undefined,
          tokenProgram,
        ); // ATA is one of PDAs
        const allowPDAOwnerAddress = false;

        try {
          await resolveOrCreateATA(
            connection,
            pda,
            mint,
            () =>
              connection.getMinimumBalanceForRentExemption(AccountLayout.span),
            ZERO,
            wallet.publicKey,
            false,
            allowPDAOwnerAddress,
          );

          fail("should be failed");
        } catch (e) {
          expect(e.name).toMatch("TokenOwnerOffCurveError");
        }
      });

      it("resolveOrCreateATA, allowPDAOwnerAddress = true", async () => {
        const mint = await createNewMint(ctx, tokenProgram);

        const pda = getAssociatedTokenAddressSync(
          mint,
          wallet.publicKey,
          undefined,
          tokenProgram,
        ); // ATA is one of PDAs
        const allowPDAOwnerAddress = true;

        try {
          await resolveOrCreateATA(
            connection,
            pda,
            mint,
            () =>
              connection.getMinimumBalanceForRentExemption(AccountLayout.span),
            ZERO,
            wallet.publicKey,
            false,
            allowPDAOwnerAddress,
          );
        } catch {
          fail("should be failed");
        }
      });

      it("resolveOrCreateATA, wrappedSolAccountCreateMethod = ata", async () => {
        const { connection, wallet } = ctx;

        const wrappedSolAccountCreateMethod = "ata";

        const resolved = await resolveOrCreateATA(
          connection,
          wallet.publicKey,
          NATIVE_MINT,
          () =>
            connection.getMinimumBalanceForRentExemption(AccountLayout.span),
          new BN(LAMPORTS_PER_SOL),
          wallet.publicKey,
          false,
          false,
          wrappedSolAccountCreateMethod,
        );

        expect(resolved.instructions.length).toEqual(3);
        expect(
          resolved.instructions[0].programId.equals(
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        ).toBeTruthy();
        expect(
          resolved.instructions[1].programId.equals(SystemProgram.programId),
        ).toBeTruthy();
        expect(
          resolved.instructions[2].programId.equals(TOKEN_PROGRAM_ID),
        ).toBeTruthy();
        expect(resolved.cleanupInstructions.length).toEqual(1);
        expect(
          resolved.cleanupInstructions[0].programId.equals(TOKEN_PROGRAM_ID),
        ).toBeTruthy();
        expect(resolved.signers.length).toEqual(0);

        const builder = new TransactionBuilder(connection, wallet);
        builder.addInstruction(resolved);
        await expect(builder.buildAndExecute()).resolves.toBeTruthy();
      });

      it("resolveOrCreateATA, wrappedSolAccountCreateMethod = ata, amount = 0", async () => {
        const { connection, wallet } = ctx;

        const wrappedSolAccountCreateMethod = "ata";

        const resolved = await resolveOrCreateATA(
          connection,
          wallet.publicKey,
          NATIVE_MINT,
          () =>
            connection.getMinimumBalanceForRentExemption(AccountLayout.span),
          ZERO,
          wallet.publicKey,
          false,
          false,
          wrappedSolAccountCreateMethod,
        );

        expect(resolved.instructions.length).toEqual(1);
        expect(
          resolved.instructions[0].programId.equals(
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        ).toBeTruthy();
        expect(resolved.cleanupInstructions.length).toEqual(1);
        expect(
          resolved.cleanupInstructions[0].programId.equals(TOKEN_PROGRAM_ID),
        ).toBeTruthy();
        expect(resolved.signers.length).toEqual(0);

        const builder = new TransactionBuilder(connection, wallet);
        builder.addInstruction(resolved);
        await expect(builder.buildAndExecute()).resolves.toBeTruthy();
      });

      it("resolveOrCreateATA, wrappedSolAccountCreateMethod = keypair", async () => {
        const { connection, wallet } = ctx;

        const wrappedSolAccountCreateMethod = "keypair";

        const resolved = await resolveOrCreateATA(
          connection,
          wallet.publicKey,
          NATIVE_MINT,
          () =>
            connection.getMinimumBalanceForRentExemption(AccountLayout.span),
          new BN(LAMPORTS_PER_SOL),
          wallet.publicKey,
          false,
          false,
          wrappedSolAccountCreateMethod,
        );

        expect(resolved.instructions.length).toEqual(2);
        expect(
          resolved.instructions[0].programId.equals(SystemProgram.programId),
        ).toBeTruthy();
        expect(
          resolved.instructions[1].programId.equals(TOKEN_PROGRAM_ID),
        ).toBeTruthy();
        expect(resolved.cleanupInstructions.length).toEqual(1);
        expect(
          resolved.cleanupInstructions[0].programId.equals(TOKEN_PROGRAM_ID),
        ).toBeTruthy();
        expect(resolved.signers.length).toEqual(1);

        const builder = new TransactionBuilder(connection, wallet);
        builder.addInstruction(resolved);
        await expect(builder.buildAndExecute()).resolves.toBeTruthy();
      });

      it("resolveOrCreateATA, wrappedSolAccountCreateMethod = withSeed", async () => {
        const { connection, wallet } = ctx;

        const wrappedSolAccountCreateMethod = "withSeed";

        const resolved = await resolveOrCreateATA(
          connection,
          wallet.publicKey,
          NATIVE_MINT,
          () =>
            connection.getMinimumBalanceForRentExemption(AccountLayout.span),
          new BN(LAMPORTS_PER_SOL),
          wallet.publicKey,
          false,
          false,
          wrappedSolAccountCreateMethod,
        );

        expect(resolved.instructions.length).toEqual(2);
        expect(
          resolved.instructions[0].programId.equals(SystemProgram.programId),
        ).toBeTruthy();
        expect(
          resolved.instructions[1].programId.equals(TOKEN_PROGRAM_ID),
        ).toBeTruthy();
        expect(resolved.cleanupInstructions.length).toEqual(1);
        expect(
          resolved.cleanupInstructions[0].programId.equals(TOKEN_PROGRAM_ID),
        ).toBeTruthy();
        expect(resolved.signers.length).toEqual(0);

        const builder = new TransactionBuilder(connection, wallet);
        builder.addInstruction(resolved);
        await expect(builder.buildAndExecute()).resolves.toBeTruthy();
      });
    }),
  );
});
