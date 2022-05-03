import { PublicKey, Connection, ConfirmOptions } from "@solana/web3.js";
import { Provider, Program, Idl } from "@project-serum/anchor";
import WhirlpoolIDL from "./artifacts/whirlpool.json";
import { Whirlpool } from "./artifacts/whirlpool";
import { Wallet } from "@project-serum/anchor/dist/cjs/provider";

export class WhirlpoolContext {
  readonly connection: Connection;
  readonly wallet: Wallet;
  readonly opts: ConfirmOptions;
  readonly program: Program<Whirlpool>;
  readonly provider: Provider;

  public static from(
    connection: Connection,
    wallet: Wallet,
    programId: PublicKey,
    opts: ConfirmOptions = Provider.defaultOptions()
  ): WhirlpoolContext {
    const provider = new Provider(connection, wallet, opts);
    const program = new Program(WhirlpoolIDL as Idl, programId, provider);
    return new WhirlpoolContext(provider, program, opts);
  }

  public static fromWorkspace(
    provider: Provider,
    program: Program,
    opts: ConfirmOptions = Provider.defaultOptions()
  ) {
    return new WhirlpoolContext(provider, program, opts);
  }

  public static withProvider(
    provider: Provider,
    programId: PublicKey,
    opts: ConfirmOptions = Provider.defaultOptions()
  ): WhirlpoolContext {
    const program = new Program(WhirlpoolIDL as Idl, programId, provider);
    return new WhirlpoolContext(provider, program, opts);
  }

  public constructor(provider: Provider, program: Program, opts: ConfirmOptions) {
    this.connection = provider.connection;
    this.wallet = provider.wallet;
    this.opts = opts;
    // It's a hack but it works on Anchor workspace *shrug*
    this.program = program as unknown as Program<Whirlpool>;
    this.provider = provider;
  }

  // TODO: Add another factory method to build from on-chain IDL
}
