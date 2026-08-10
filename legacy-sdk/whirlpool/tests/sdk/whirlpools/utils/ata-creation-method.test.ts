import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import { Transaction } from "@solana/web3.js";
import * as assert from "assert";
import type { AtaCreationMethod, WhirlpoolContextOpts } from "../../../../src";
import { WhirlpoolContext } from "../../../../src";
import { resolveAtaForMints } from "../../../../src/utils/whirlpool-ata-utils";
import { createAssociatedTokenAccount, createMint } from "../../../utils";
import { initializeLiteSVMEnvironment } from "../../../utils/litesvm";

describe("ata creation method", () => {
  // source: https://github.com/solana-program/associated-token-account/blob/5ef2d950ccdebb35a73c77e8008910cf15a87a5f/interface/src/instruction.rs#L19-L61
  const CREATE_DISCRIMINATOR: number[] = [];
  const CREATE_IDEMPOTENT_DISCRIMINATOR = [1];

  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let defaultCtx: WhirlpoolContext;
  let accountExemption: number;

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    program = env.program;
    defaultCtx = env.ctx;
    accountExemption = await env.fetcher.getAccountRentExempt();
    anchor.setProvider(provider);
  });

  function ctxWithAtaCreationMethod(
    createAtaMethod?: AtaCreationMethod,
  ): WhirlpoolContext {
    let opts: WhirlpoolContextOpts = {
      accountResolverOptions: {
        createWrappedSolAccountMethod: "keypair",
        allowPDAOwnerAddress: false,
      },
    };

    if (createAtaMethod) {
      opts.accountResolverOptions!.createAtaMethod = createAtaMethod;
    }

    return WhirlpoolContext.fromWorkspace(
      provider,
      program,
      undefined,
      undefined,
      opts,
    );
  }

  async function resolveCreateIx(ctx: WhirlpoolContext, mint: PublicKey) {
    const { resolveAtaIxs } = await resolveAtaForMints(ctx, {
      mints: [mint],
      accountExemption,
    });
    assert.equal(
      resolveAtaIxs.length,
      1,
      "expected one instruction set for an ATA that does not exist yet",
    );
    const instructions = resolveAtaIxs[0].instructions;
    assert.equal(instructions.length, 1);
    const ix = instructions[0];
    assert.ok(
      ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID),
      "expected an Associated Token Account program instruction",
    );
    return ix;
  }

  it("emits Create by default", async () => {
    const ix = await resolveCreateIx(defaultCtx, await createMint(provider));
    assert.deepEqual([...ix.data], CREATE_DISCRIMINATOR);
  });

  it("emits Create when explicitly configured", async () => {
    const ctx = ctxWithAtaCreationMethod("create");
    const ix = await resolveCreateIx(ctx, await createMint(provider));
    assert.deepEqual([...ix.data], CREATE_DISCRIMINATOR);
  });

  it("emits CreateIdempotent when configured", async () => {
    const ctx = ctxWithAtaCreationMethod("createIdempotent");
    const ix = await resolveCreateIx(ctx, await createMint(provider));
    assert.deepEqual([...ix.data], CREATE_IDEMPOTENT_DISCRIMINATOR);
  });

  it("keeps Create for an AccountResolverOptions built without the option", async () => {
    const ctx = ctxWithAtaCreationMethod();
    assert.equal(ctx.accountResolverOpts.createAtaMethod, "create");
    const ix = await resolveCreateIx(ctx, await createMint(provider));
    assert.deepEqual([...ix.data], CREATE_DISCRIMINATOR);
  });

  describe("when the ATA is created between resolution and execution", () => {
    async function resolveThenSend(
      createAtaMethod: AtaCreationMethod,
      frontRun: boolean,
    ) {
      const ctx = ctxWithAtaCreationMethod(createAtaMethod);
      const mint = await createMint(provider);
      const ix = await resolveCreateIx(ctx, mint);

      if (frontRun) {
        const owner = provider.wallet.publicKey;
        const ata = await createAssociatedTokenAccount(
          provider,
          mint,
          owner,
          owner,
        );
        assert.ok(ata.equals(getAssociatedTokenAddressSync(mint, owner)));
      }

      return provider.sendAndConfirm(new Transaction().add(ix), [], {
        commitment: "confirmed",
      });
    }

    // the Create instruction lands when nothing front-runs it
    it("Create succeeds when nothing front-runs it", async () => {
      await resolveThenSend("create", false);
    });

    it("Create fails once the ATA exists", async () => {
      // the Create instruction fails when another transaction creates the ATA
      await assert.rejects(() => resolveThenSend("create", true));
    });

    it("CreateIdempotent succeeds once the ATA exists", async () => {
      // the CreateIdempotent instruction lands even when another transaction creates the ATA
      await resolveThenSend("createIdempotent", true);
    });
  });
});
