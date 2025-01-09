import {
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import {
  getMultipleParsedAccounts,
  getParsedAccount,
  ParsableMintInfo,
} from "../../../src/web3";
import {
  createAssociatedTokenAccount,
  createNewMint,
  createTestContext,
  requestAirdrop,
} from "../../test-context";
import { expectMintEquals } from "../../utils/expectations";

jest.setTimeout(100 * 1000 /* ms */);

describe("account-requests", () => {
  const ctx = createTestContext();
  // Silence the errors when we evaluate invalid token accounts.
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  beforeAll(async () => {
    await requestAirdrop(ctx);
  });

  const tokenPrograms = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
  tokenPrograms.forEach((tokenProgram) =>
    describe(`TokenProgram: ${tokenProgram.toBase58()}`, () => {
      it("getParsedAccount, ok", async () => {
        const mint = await createNewMint(ctx, tokenProgram);
        const expected = {
          ...(await getMint(ctx.connection, mint, undefined, tokenProgram)),
          tokenProgram,
        };

        const mintInfo = await getParsedAccount(
          ctx.connection,
          mint,
          ParsableMintInfo,
        );
        expectMintEquals(mintInfo!, expected);
      });

      it("getMultipleParsedAccounts, some null", async () => {
        const mint = await createNewMint(ctx, tokenProgram);
        const missing = Keypair.generate().publicKey;
        const mintInfos = await getMultipleParsedAccounts(
          ctx.connection,
          [mint, missing],
          ParsableMintInfo,
        );

        const expected = {
          ...(await getMint(ctx.connection, mint, undefined, tokenProgram)),
          tokenProgram,
        };

        expectMintEquals(mintInfos[0]!, expected);
        expect(mintInfos[1]).toBeNull();
      });

      it("getMultipleParsedAccounts, invalid type returns null", async () => {
        const mint = await createNewMint(ctx, tokenProgram);
        const { ata } = await createAssociatedTokenAccount(
          ctx,
          tokenProgram,
          mint,
        );
        const mintInfos = await getMultipleParsedAccounts(
          ctx.connection,
          [mint, ata],
          ParsableMintInfo,
        );
        const expected = {
          ...(await getMint(ctx.connection, mint, undefined, tokenProgram)),
          tokenProgram,
        };
        expectMintEquals(mintInfos[0]!, expected);
        expect(mintInfos[1]).toBeNull();
      });

      it("getMultipleParsedAccounts, separate chunks", async () => {
        const mints = await Promise.all(
          Array.from(
            { length: 10 },
            async () => await createNewMint(ctx, tokenProgram),
          ),
        );
        const mintInfos = await getMultipleParsedAccounts(
          ctx.connection,
          mints,
          ParsableMintInfo,
          2,
        );

        // Verify all mints are fetched and are in order
        expect(mintInfos.length === mints.length);
        mints.forEach((mint, i) => {
          expect(mintInfos[i]!.address.equals(mint));
        });
      });
    }),
  );
});
