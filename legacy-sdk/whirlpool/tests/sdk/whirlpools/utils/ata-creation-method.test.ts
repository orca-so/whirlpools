import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";
import * as assert from "assert";
import type { AtaCreationMethod, WhirlpoolContext } from "../../../../src";
import { WhirlpoolContext } from "../../../../src";
import { resolveAtaForMints } from "../../../../src/utils/whirlpool-ata-utils";
import { createAssociatedTokenAccount, createMint } from "../../../utils";
import { initializeLiteSVMEnvironment } from "../../../utils/litesvm";

/**
 * `AccountResolverOptions.createAtaMethod` selects which Associated Token Account program
 * instruction the SDK emits for ATAs that don't exist yet. `create` fails with
 * `IllegalOwner` if something else creates the ATA between the SDK's pre-flight fetch and
 * execution — a preceding transaction in the same Jito bundle, for instance — while
 * `createIdempotent` tolerates it.
 *
 * The default is `create`, which these tests pin: changing it would silently alter the
 * instructions every existing caller produces.
 */
describe("ata creation method", () => {
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
    createAtaMethod: AtaCreationMethod,
  ): WhirlpoolContext {
    return WhirlpoolContext.fromWorkspace(
      provider,
      program,
      undefined,
      undefined,
      {
        accountResolverOptions: {
          createWrappedSolAccountMethod: "keypair",
          allowPDAOwnerAddress: false,
          createAtaMethod,
        },
      },
    );
  }

  /** A mint the wallet holds no ATA for, so resolution has to emit a create instruction. */
  async function mintWithoutAta(): Promise<PublicKey> {
    return createMint(provider);
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
    const ix = await resolveCreateIx(defaultCtx, await mintWithoutAta());
    assert.deepEqual([...ix.data], CREATE_DISCRIMINATOR);
  });

  it("emits Create when explicitly configured", async () => {
    const ctx = ctxWithAtaCreationMethod("create");
    const ix = await resolveCreateIx(ctx, await mintWithoutAta());
    assert.deepEqual([...ix.data], CREATE_DISCRIMINATOR);
  });

  it("emits CreateIdempotent when configured", async () => {
    const ctx = ctxWithAtaCreationMethod("createIdempotent");
    const ix = await resolveCreateIx(ctx, await mintWithoutAta());
    assert.deepEqual([...ix.data], CREATE_IDEMPOTENT_DISCRIMINATOR);
  });

  it("keeps Create for an AccountResolverOptions built without the option", async () => {
    // Callers that predate `createAtaMethod` pass an object without it. The context merges
    // it over the defaults, so the field is absent from their literal but still resolves
    // to `create`.
    const ctx = WhirlpoolContext.fromWorkspace(
      provider,
      program,
      undefined,
      undefined,
      {
        accountResolverOptions: {
          createWrappedSolAccountMethod: "keypair",
          allowPDAOwnerAddress: false,
        },
      },
    );
    assert.equal(ctx.accountResolverOpts.createAtaMethod, "create");
    const ix = await resolveCreateIx(ctx, await mintWithoutAta());
    assert.deepEqual([...ix.data], CREATE_DISCRIMINATOR);
  });

  describe("when the ATA is created between resolution and execution", () => {
    /**
     * Resolve a create instruction and send it, optionally creating the ATA out of band
     * first — the race a preceding transaction in the same bundle makes the SDK lose.
     */
    async function resolveThenSend(
      createAtaMethod: AtaCreationMethod,
      frontRun: boolean,
    ) {
      const ctx = ctxWithAtaCreationMethod(createAtaMethod);
      const mint = await mintWithoutAta();
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

    // Control: the same Create instruction lands when nothing front-runs it. Without this,
    // the rejection below could pass for a malformed instruction rather than the race.
    it("Create succeeds when nothing front-runs it", async () => {
      await resolveThenSend("create", false);
    });

    it("Create fails once the ATA exists", async () => {
      // The failure is the point; the error is not portable. Mainnet's ATA program reports
      // IllegalOwner ("Provided owner is not allowed") because it short-circuits before the
      // system CPI, while the build bundled with LiteSVM reports NotEnoughAccountKeys for
      // the same cause. Asserting either would pin the test to one program version.
      await assert.rejects(() => resolveThenSend("create", true));
    });

    it("CreateIdempotent succeeds once the ATA exists", async () => {
      await resolveThenSend("createIdempotent", true);
    });
  });
});
