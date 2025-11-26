import { PublicKey } from "@solana/web3.js";
import { WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptText } from "../utils/prompt";

console.info("set FeeRate...");

const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");
const whirlpoolPubkeyStr = await promptText("whirlpoolPubkey");
const feeRatePer1000000Str = await promptText("feeRatePer1000000");

const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigPubkeyStr);
const whirlpoolPubkey = new PublicKey(whirlpoolPubkeyStr);
const feeRate = Number.parseInt(feeRatePer1000000Str);

const whirlpoolsConfig = await ctx.fetcher.getConfig(whirlpoolsConfigPubkey);
if (!whirlpoolsConfig) {
  throw new Error("whirlpoolsConfig not found");
}

if (!whirlpoolsConfig.feeAuthority.equals(ctx.wallet.publicKey)) {
  throw new Error(
    `the current wallet must be the fee authority(${whirlpoolsConfig.feeAuthority.toBase58()})`,
  );
}

const whirlpool = await ctx.fetcher.getPool(whirlpoolPubkey);
if (!whirlpool) {
  throw new Error("whirlpool not found");
}
const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.setFeeRateIx(ctx.program, {
    whirlpoolsConfig: new PublicKey(whirlpoolsConfigPubkeyStr),
    whirlpool: whirlpoolPubkey,
    feeAuthority: whirlpoolsConfig.feeAuthority,
    feeRate: feeRate,
  }),
);

console.info(
  "setting...",
  "\n\twhirlpoolsConfig",
  whirlpoolsConfigPubkey.toBase58(),
  "\n\twhirlpool",
  whirlpoolPubkey.toBase58(),
  "\n\tfeeRate",
  `${feeRate / 10000}%`,
);

const landed = await processTransaction(builder);
if (landed) {
  console.info("tx landed");
}
