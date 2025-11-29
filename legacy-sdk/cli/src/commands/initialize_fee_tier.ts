import { PublicKey } from "@solana/web3.js";
import { PDAUtil, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptText } from "../utils/prompt";

console.info("initialize FeeTier...");

// prompt
const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");
const tickSpacingStr = await promptText("tickSpacing");
const defaultFeeRatePer1000000Str = await promptText(
  "defaultFeeRatePer1000000",
);

const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigPubkeyStr);
const tickSpacing = Number.parseInt(tickSpacingStr);

const pda = PDAUtil.getFeeTier(
  ctx.program.programId,
  whirlpoolsConfigPubkey,
  tickSpacing,
);
const whirlpoolsConfig = await ctx.fetcher.getConfig(whirlpoolsConfigPubkey);

if (!whirlpoolsConfig) {
  throw new Error("whirlpoolsConfig not found");
}

if (!whirlpoolsConfig.feeAuthority.equals(ctx.wallet.publicKey)) {
  throw new Error(
    `the current wallet must be the fee authority(${whirlpoolsConfig.feeAuthority.toBase58()})`,
  );
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.initializeFeeTierIx(ctx.program, {
    feeTierPda: pda,
    funder: ctx.wallet.publicKey,
    whirlpoolsConfig: whirlpoolsConfigPubkey,
    feeAuthority: whirlpoolsConfig.feeAuthority,
    tickSpacing,
    defaultFeeRate: Number.parseInt(defaultFeeRatePer1000000Str),
  }),
);

const landed = await processTransaction(builder);
if (landed) {
  console.info("feeTier address:", pda.publicKey.toBase58());
}

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
create FeeTier...
prompt: whirlpoolsConfigPubkey:  8raEdn1tNEft7MnbMQJ1ktBqTKmHLZu7NJ7teoBkEPKm
prompt: tickSpacing:  64
prompt: defaultFeeRatePer1000000:  3000
tx: gomSUyS88MbjVFTfTw2JPgQumVGttDYgm2Si7kqR5JYaqCgLA1fnSycRhjdAxXdfUWbpK1FZJQxKHgfNJrXgn2h
feeTier address: BYUiw9LdPsn5n8qHQhL7SNphubKtLXKwQ4tsSioP6nTj

*/
