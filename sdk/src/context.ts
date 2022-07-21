import { AnchorProvider, Idl, Program } from "@project-serum/anchor";
import { Wallet } from "@project-serum/anchor/dist/cjs/provider";
import { ConfirmOptions, Connection, PublicKey } from "@solana/web3.js";
import { Whirlpool } from "./artifacts/whirlpool";
import WhirlpoolIDL from "./artifacts/whirlpool.json";
import { AccountFetcher } from "./network/public";
/**
 * @category Core
 */
export class WhirlpoolContext {
  readonly connection: Connection;
  readonly wallet: Wallet;
  readonly opts: ConfirmOptions;
  readonly program: Program<Whirlpool>;
  readonly provider: AnchorProvider;
  readonly fetcher: AccountFetcher;

  public static from(
    connection: Connection,
    wallet: Wallet,
    programId: PublicKey,
    fetcher = new AccountFetcher(connection),
    opts: ConfirmOptions = AnchorProvider.defaultOptions()
  ): WhirlpoolContext {
    const anchorProvider = new AnchorProvider(connection, wallet, opts);
    const program = new Program(WhirlpoolIDL as Idl, programId, anchorProvider);
    return new WhirlpoolContext(anchorProvider, anchorProvider.wallet, program, fetcher, opts);
  }

  public static fromWorkspace(
    provider: AnchorProvider,
    program: Program,
    fetcher = new AccountFetcher(provider.connection),
    opts: ConfirmOptions = AnchorProvider.defaultOptions()
  ) {
    return new WhirlpoolContext(provider, provider.wallet, program, fetcher, opts);
  }

  public static withProvider(
    provider: AnchorProvider,
    programId: PublicKey,
    fetcher = new AccountFetcher(provider.connection),
    opts: ConfirmOptions = AnchorProvider.defaultOptions()
  ): WhirlpoolContext {
    const program = new Program(WhirlpoolIDL as Idl, programId, provider);
    return new WhirlpoolContext(provider, provider.wallet, program, fetcher, opts);
  }

  public constructor(
    provider: AnchorProvider,
    wallet: Wallet,
    program: Program,
    fetcher: AccountFetcher,
    opts: ConfirmOptions
  ) {
    this.connection = provider.connection;
    this.wallet = wallet;
    this.opts = opts;
    // It's a hack but it works on Anchor workspace *shrug*
    this.program = program as unknown as Program<Whirlpool>;
    this.provider = provider;
    this.fetcher = fetcher;
  }

  // TODO: Add another factory method to build from on-chain IDL
}
