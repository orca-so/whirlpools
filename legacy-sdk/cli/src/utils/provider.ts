import { AnchorProvider } from "@coral-xyz/anchor";
import {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  WhirlpoolContext,
} from "@orca-so/whirlpools-sdk";

// export ANCHOR_PROVIDER_URL=http://localhost:8899
// export ANCHOR_WALLET=~/.config/solana/id.json

export const provider = AnchorProvider.env();
console.info("connection endpoint", provider.connection.rpcEndpoint);
console.info("wallet", provider.wallet.publicKey.toBase58());

export const ctx = WhirlpoolContext.from(
  provider.connection,
  provider.wallet,
  ORCA_WHIRLPOOL_PROGRAM_ID,
);
