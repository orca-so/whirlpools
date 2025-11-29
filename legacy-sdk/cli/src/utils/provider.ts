import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { WhirlpoolContext } from "@orca-so/whirlpools-sdk";
import { existsSync, readFileSync } from "fs";
import { parse } from "yaml";
import { isAbsolute } from "path";
import type { Wallet as WalletType } from "@coral-xyz/anchor/dist/cjs/provider";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

/*
 * Normal (sign + send):
 * export ANCHOR_PROVIDER_URL=http://localhost:8899
 * export ANCHOR_WALLET=~/.config/solana/id.json
 *
 * Export (print unsigned tx):
 * export ANCHOR_PROVIDER_URL=http://localhost:8899
 * export ANCHOR_WALLET=<YOUR_PUBLIC_KEY>
 */

const configPath = `${process.env.HOME}/.config/solana/cli/config.yml`;

let walletPath = (process.env.ANCHOR_WALLET ?? "").replace(
  "~/",
  `${process.env.HOME}/`,
);
let rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? "";

if (existsSync(configPath)) {
  const configFile = readFileSync(
    `${process.env.HOME}/.config/solana/cli/config.yml`,
    { encoding: "utf-8" },
  );
  const config = parse(configFile);

  if (walletPath === "") {
    walletPath = config.keypair_path ?? "";
  }
  if (rpcUrl === "") {
    rpcUrl = config.json_rpc_url ?? "";
  }
}

if (walletPath === "" || rpcUrl === "") {
  console.error("No wallet path or RPC URL provided");
  process.exit(1);
}

const connection = new Connection(rpcUrl);

let wallet: WalletType & { noSign?: boolean };
if (isAbsolute(walletPath)) {
  const json = readFileSync(walletPath, { encoding: "utf-8" });
  const bytes = new Uint8Array(JSON.parse(json));
  const keypair = Keypair.fromSecretKey(bytes);
  wallet = new Wallet(keypair);
} else {
  wallet = {
    publicKey: new PublicKey(walletPath),
    signTransaction: async (x) => x,
    signAllTransactions: async (x) => x,
    noSign: true,
  };
}

export const provider = new AnchorProvider(connection, wallet);
console.info("connection endpoint", provider.connection.rpcEndpoint);
console.info("wallet", provider.wallet.publicKey.toBase58());

export const ctx = WhirlpoolContext.from(provider.connection, provider.wallet);
