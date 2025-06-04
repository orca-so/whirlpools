import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ParsableMintInfo, ParsableTokenAccountInfo } from "../../../src/web3";
import {
  createAssociatedTokenAccount,
  createNewMint,
  createTestContext,
  requestAirdrop,
} from "../../test-context";

describe("parsing", () => {
  const ctx = createTestContext();

  beforeAll(async () => {
    await requestAirdrop(ctx);
  });

  const tokenPrograms = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
  tokenPrograms.forEach((tokenProgram) =>
    describe(`TokenProgram: ${tokenProgram.toBase58()}`, () => {
      it("ParsableMintInfo", async () => {
        const mint = await createNewMint(ctx, tokenProgram);
        const account = await ctx.connection.getAccountInfo(mint);
        const parsed = ParsableMintInfo.parse(mint, account);

        expect(parsed).toBeDefined();
        if (!parsed) {
          throw new Error("parsed is undefined");
        }
        const parsedData = parsed;
        expect(parsedData.isInitialized).toEqual(true);
        expect(parsedData.decimals).toEqual(6);
        expect(parsedData.tokenProgram.equals(TOKEN_PROGRAM_ID));
      });

      it("ParsableTokenAccountInfo", async () => {
        const { ata, mint } = await createAssociatedTokenAccount(
          ctx,
          tokenProgram,
        );
        const account = await ctx.connection.getAccountInfo(ata);
        const parsed = ParsableTokenAccountInfo.parse(ata, account);

        expect(parsed).toBeDefined();
        if (!parsed) {
          throw new Error("parsed is undefined");
        }
        const parsedData = parsed;
        expect(parsedData.mint.equals(mint)).toBeTruthy();
        expect(parsedData.tokenProgram.equals(TOKEN_PROGRAM_ID));
        expect(parsedData.isInitialized).toEqual(true);
        expect(parsedData.amount === 0n).toBeTruthy();
      });
    }),
  );
});
