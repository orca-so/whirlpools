import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import {
  BuildOptions,
  LookupTableFetcher,
  TransactionBuilderOptions,
  Wallet,
  WrappedSolAccountCreateMethod,
} from "@orca-so/common-sdk";
import { Commitment, Connection, PublicKey, SendOptions } from "@solana/web3.js";
import { Whirlpool } from "./artifacts/whirlpool";
import WhirlpoolIDL from "./artifacts/whirlpool.json";
import { WhirlpoolAccountFetcherInterface, buildDefaultAccountFetcher } from "./network/public/";
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

/**
 * Default settings used when resolving token accounts.
 * @category Core
 */
export type AccountResolverOptions = {
  createWrappedSolAccountMethod: WrappedSolAccountCreateMethod;
  allowPDAOwnerAddress: boolean;
};

const DEFAULT_ACCOUNT_RESOLVER_OPTS: AccountResolverOptions = {
  createWrappedSolAccountMethod: "keypair",
  allowPDAOwnerAddress: false,
};

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
    programId: PublicKey,
    fetcher: WhirlpoolAccountFetcherInterface = buildDefaultAccountFetcher(connection),
    lookupTableFetcher?: LookupTableFetcher,
    opts: WhirlpoolContextOpts = {}
  ): WhirlpoolContext {
    const anchorProvider = new AnchorProvider(connection, wallet, {
      commitment: opts.userDefaultConfirmCommitment || "confirmed",
      preflightCommitment: opts.userDefaultConfirmCommitment || "confirmed",
    });
    const program = new Program(WhirlpoolIDL as Idl, programId, anchorProvider);
    return new WhirlpoolContext(
      anchorProvider,
      anchorProvider.wallet,
      program,
      fetcher,
      lookupTableFetcher,
      opts
    );
  }

  public static fromWorkspace(
    provider: AnchorProvider,
    program: Program,
    fetcher: WhirlpoolAccountFetcherInterface = buildDefaultAccountFetcher(provider.connection),
    lookupTableFetcher?: LookupTableFetcher,
    opts: WhirlpoolContextOpts = {}
  ) {
    return new WhirlpoolContext(
      provider,
      provider.wallet,
      program,
      fetcher,
      lookupTableFetcher,
      opts
    );
  }

  public static withProvider(
    provider: AnchorProvider,
    programId: PublicKey,
    fetcher: WhirlpoolAccountFetcherInterface = buildDefaultAccountFetcher(provider.connection),
    lookupTableFetcher?: LookupTableFetcher,
    opts: WhirlpoolContextOpts = {}
  ): WhirlpoolContext {
    const program = new Program(WhirlpoolIDL as Idl, programId, provider);
    return new WhirlpoolContext(
      provider,
      provider.wallet,
      program,
      fetcher,
      lookupTableFetcher,
      opts
    );
  }

  public constructor(
    provider: AnchorProvider,
    wallet: Wallet,
    program: Program,
    fetcher: WhirlpoolAccountFetcherInterface,
    lookupTableFetcher?: LookupTableFetcher,
    opts: WhirlpoolContextOpts = {}
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
    this.accountResolverOpts = opts.accountResolverOptions ?? DEFAULT_ACCOUNT_RESOLVER_OPTS;
  }

  // TODO: Add another factory method to build from on-chain IDL
}
