import { PublicKey } from "@solana/web3.js";
import { PDAUtil, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptText } from "../utils/prompt";

console.info("set FeeRate...");

const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");
const tickSpacingStr = await promptText("tickSpacing");
const feeRatePer1000000Str = await promptText("feeRatePer1000000");

const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigPubkeyStr);
const tickSpacing = Number.parseInt(tickSpacingStr);
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

const feeTierPda = PDAUtil.getFeeTier(ctx.program.programId, whirlpoolsConfigPubkey, tickSpacing);
const feeTier = await ctx.fetcher.getFeeTier(feeTierPda.publicKey);
if (!feeTier) {
  throw new Error("feeTier not found");
}
const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.setDefaultFeeRateIx(ctx.program, {
    whirlpoolsConfig: new PublicKey(whirlpoolsConfigPubkeyStr),
    feeAuthority: whirlpoolsConfig.feeAuthority,
    tickSpacing,
    defaultFeeRate: feeRate,
  }),
);

const landed = await processTransaction(builder);
if (landed) {
  console.info("tx landed");
}
