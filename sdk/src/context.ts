import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import {
  BuildOptions,
  LookupTableFetcher,
  TransactionBuilderOptions,
  Wallet,
} from "@orca-so/common-sdk";
import { Commitment, Connection, PublicKey, SendOptions } from "@solana/web3.js";
import { Whirlpool } from "./artifacts/whirlpool";
import WhirlpoolIDL from "./artifacts/whirlpool.json";
import { AccountFetcher } from "./network/public";
import { contextOptionsToBuilderOptions } from "./utils/txn-utils";

/**
 * Default settings used when interacting with transactions.
 * @category Core
 */
export type WhirlpoolContextOpts = {
  userDefaultBuildOptions?: Partial<BuildOptions>;
  userDefaultSendOptions?: Partial<SendOptions>;
  userDefaultConfirmCommitment?: Commitment;
};

/**
 * @category Core
 */
export class WhirlpoolContext {
  readonly connection: Connection;
  readonly wallet: Wallet;
  readonly program: Program<Whirlpool>;
  readonly provider: AnchorProvider;
  readonly fetcher: AccountFetcher;
  readonly lookupTableFetcher: LookupTableFetcher | undefined;
  readonly opts: WhirlpoolContextOpts;
  readonly txBuilderOpts: TransactionBuilderOptions | undefined;

  public static from(
    connection: Connection,
    wallet: Wallet,
    programId: PublicKey,
    fetcher = new AccountFetcher(connection),
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
    fetcher = new AccountFetcher(provider.connection),
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
    fetcher = new AccountFetcher(provider.connection),
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
    fetcher: AccountFetcher,
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
  }

  // TODO: Add another factory method to build from on-chain IDL
}
