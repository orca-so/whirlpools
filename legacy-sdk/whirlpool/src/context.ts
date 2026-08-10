import type { Idl } from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type {
  BuildOptions,
  LookupTableFetcher,
  TransactionBuilderOptions,
  Wallet,
  WrappedSolAccountCreateMethod,
} from "@orca-so/common-sdk";
import type {
  Commitment,
  Connection,
  PublicKey,
  SendOptions,
} from "@solana/web3.js";
import type { Whirlpool } from "./artifacts/whirlpool";
import WhirlpoolIDL from "./artifacts/whirlpool.json";
import type { WhirlpoolAccountFetcherInterface } from "./network/public";
import { buildDefaultAccountFetcher } from "./network/public";
import { contextOptionsToBuilderOptions } from "./utils/txn-utils";

/**
 * Default settings used when interacting with transactions.
 * @category Core
 */
export type WhirlpoolContextOpts = {
  userDefaultBuildOptions?: Partial<BuildOptions>;
  userDefaultSendOptions?: Partial<SendOptions>;
  userDefaultConfirmCommitment?: Commitment;
  accountResolverOptions?: AccountResolverOptions;
};

export type AtaCreationMethod = "create" | "createIdempotent";

/**
 * Default settings used when resolving token accounts.
 * @category Core
 */
export type AccountResolverOptions = {
  createWrappedSolAccountMethod: WrappedSolAccountCreateMethod;
  allowPDAOwnerAddress: boolean;
  /**
   * The method to use when creating ATAs that don't exist.
   *
   * The historical default was the non-idempotent `create` method, so changing that
   * introduces a breaking change for consumers.
   */
  createAtaMethod?: AtaCreationMethod;
};

const DEFAULT_ACCOUNT_RESOLVER_OPTS: AccountResolverOptions = {
  createWrappedSolAccountMethod: "keypair",
  allowPDAOwnerAddress: false,
  createAtaMethod: "create",
};

/**
 * Whether `opts` asks for `CreateIdempotent` when creating ATAs.
 *
 * Only an explicit `createIdempotent` value gets idempotent behavior,
 * anything else (including undefined) defaults to `create`
 */
export function shouldCreateAtaIdempotent(
  opts: AccountResolverOptions,
): boolean {
  return opts.createAtaMethod === "createIdempotent";
}

/**
 * Context for storing environment classes and objects for usage throughout the SDK
 * @category Core
 */
export class WhirlpoolContext {
  readonly connection: Connection;
  readonly wallet: Wallet;
  readonly program: Program<Whirlpool>;
  readonly provider: AnchorProvider;
  readonly fetcher: WhirlpoolAccountFetcherInterface;
  readonly lookupTableFetcher: LookupTableFetcher | undefined;
  readonly opts: WhirlpoolContextOpts;
  readonly txBuilderOpts: TransactionBuilderOptions | undefined;
  readonly accountResolverOpts: AccountResolverOptions;

  public static from(
    connection: Connection,
    wallet: Wallet,
    fetcher: WhirlpoolAccountFetcherInterface = buildDefaultAccountFetcher(
      connection,
    ),
    lookupTableFetcher?: LookupTableFetcher,
    opts: WhirlpoolContextOpts = {},
    programId?: PublicKey,
  ): WhirlpoolContext {
    const anchorProvider = new AnchorProvider(connection, wallet, {
      commitment: opts.userDefaultConfirmCommitment || "confirmed",
      preflightCommitment: opts.userDefaultConfirmCommitment || "confirmed",
    });
    const program = new Program(getWhirlpoolIdl(programId), anchorProvider);
    return new WhirlpoolContext(
      anchorProvider,
      anchorProvider.wallet,
      program,
      fetcher,
      lookupTableFetcher,
      opts,
    );
  }

  public static fromWorkspace(
    provider: AnchorProvider,
    program: Program,
    fetcher: WhirlpoolAccountFetcherInterface = buildDefaultAccountFetcher(
      provider.connection,
    ),
    lookupTableFetcher?: LookupTableFetcher,
    opts: WhirlpoolContextOpts = {},
  ) {
    return new WhirlpoolContext(
      provider,
      provider.wallet,
      program,
      fetcher,
      lookupTableFetcher,
      opts,
    );
  }

  public static withProvider(
    provider: AnchorProvider,
    fetcher: WhirlpoolAccountFetcherInterface = buildDefaultAccountFetcher(
      provider.connection,
    ),
    lookupTableFetcher?: LookupTableFetcher,
    opts: WhirlpoolContextOpts = {},
    programId?: PublicKey,
  ): WhirlpoolContext {
    const program = new Program(getWhirlpoolIdl(programId), provider);
    return new WhirlpoolContext(
      provider,
      provider.wallet,
      program,
      fetcher,
      lookupTableFetcher,
      opts,
    );
  }

  public constructor(
    provider: AnchorProvider,
    wallet: Wallet,
    program: Program,
    fetcher: WhirlpoolAccountFetcherInterface,
    lookupTableFetcher?: LookupTableFetcher,
    opts: WhirlpoolContextOpts = {},
  ) {
    this.connection = provider.connection;
    this.wallet = wallet;
    // It's a hack but it works on Anchor workspace *shrug*
    this.program = program as unknown as Program<Whirlpool>;
    this.provider = provider;
    this.fetcher = fetcher;
    this.lookupTableFetcher = lookupTableFetcher;
    this.opts = opts;
    this.txBuilderOpts = contextOptionsToBuilderOptions(this.opts);
    this.accountResolverOpts = {
      ...DEFAULT_ACCOUNT_RESOLVER_OPTS,
      ...opts.accountResolverOptions,
    };
  }

  // TODO: Add another factory method to build from on-chain IDL
}

/**
 * Returns the bundled Whirlpool IDL, optionally rebound to a different program by
 * overriding its embedded `address`. Anchor derives the program id a `Program` targets
 * from `idl.address`, so cloning the IDL with a new address is what lets the SDK build
 * instructions and PDAs against the immutable Whirlpool program (or any fork) without a
 * separate IDL artifact.
 */
function getWhirlpoolIdl(programId?: PublicKey): Idl {
  if (programId === undefined) {
    return WhirlpoolIDL as Idl;
  }
  return { ...(WhirlpoolIDL as Idl), address: programId.toBase58() };
}
