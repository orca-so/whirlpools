import { PublicKey } from "@solana/web3.js";
import { PDAUtil, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { sendTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptText } from "../utils/prompt";

console.info("initialize WhirlpoolsConfigExtension...");

// prompt
const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");

const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigPubkeyStr);

const pda = PDAUtil.getConfigExtension(
  ctx.program.programId,
  whirlpoolsConfigPubkey,
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
  WhirlpoolIx.initializeConfigExtensionIx(ctx.program, {
    whirlpoolsConfig: whirlpoolsConfigPubkey,
    whirlpoolsConfigExtensionPda: pda,
    feeAuthority: whirlpoolsConfig.feeAuthority,
    funder: ctx.wallet.publicKey,
  }),
);

const landed = await sendTransaction(builder);
if (landed) {
  console.info("whirlpoolsConfigExtension address:", pda.publicKey.toBase58());
}

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
initialize WhirlpoolsConfigExtension...
prompt: whirlpoolsConfigPubkey:  JChtLEVR9E6B5jiHTZS1Nd9WgMULMHv2UcVryYACAFYQ
tx: 67TqdLX2BisDS6dAm3ofNzoFzoiC8Xu2ZH7Z3j6PSSNm2r8s3RVbBzZA64trn4D7EdZy3Rxgk4aVjKwDonDh8k3j
whirlpoolsConfigExtension address: BbTBWGoiXTbekvLbK1bKzkZEPpTBCY3bXhyf5pCoX4V3

*/
