import { PublicKey } from "@solana/web3.js";
import { PDAUtil, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { sendTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";

console.info("initialize TokenBadge...");

// prompt
const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");
const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigPubkeyStr);
const tokenMintStr = await promptText("tokenMint");
const tokenMint = new PublicKey(tokenMintStr);

const pda = PDAUtil.getTokenBadge(
  ctx.program.programId,
  whirlpoolsConfigPubkey,
  tokenMint,
);
const configExtensionPda = PDAUtil.getConfigExtension(
  ctx.program.programId,
  whirlpoolsConfigPubkey,
);
const configExtension = await ctx.fetcher.getConfigExtension(
  configExtensionPda.publicKey,
);

if (!configExtension) {
  throw new Error("configExtension not found");
}

if (!configExtension.tokenBadgeAuthority.equals(ctx.wallet.publicKey)) {
  throw new Error(
    `the current wallet must be the token badge authority(${configExtension.tokenBadgeAuthority.toBase58()})`,
  );
}

console.info(
  "setting...",
  "\n\twhirlpoolsConfig",
  whirlpoolsConfigPubkey.toBase58(),
  "\n\ttokenMint",
  tokenMint.toBase58(),
);
const yesno = await promptConfirm("if the above is OK, enter YES");
if (!yesno) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.initializeTokenBadgeIx(ctx.program, {
    whirlpoolsConfigExtension: configExtensionPda.publicKey,
    whirlpoolsConfig: whirlpoolsConfigPubkey,
    tokenMint,
    tokenBadgePda: pda,
    tokenBadgeAuthority: configExtension.tokenBadgeAuthority,
    funder: ctx.wallet.publicKey,
  }),
);

const landed = await sendTransaction(builder);
if (landed) {
  console.info("tokenBadge address:", pda.publicKey.toBase58());
}

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
initialize TokenBadge...
prompt: whirlpoolsConfigPubkey:  JChtLEVR9E6B5jiHTZS1Nd9WgMULMHv2UcVryYACAFYQ
prompt: tokenMint:  FfprBPB2ULqp4tyBfzrzwxNvpGYoh8hidzSmiA5oDtmu
setting...
        whirlpoolsConfig JChtLEVR9E6B5jiHTZS1Nd9WgMULMHv2UcVryYACAFYQ
        tokenMint FfprBPB2ULqp4tyBfzrzwxNvpGYoh8hidzSmiA5oDtmu

if the above is OK, enter YES
prompt: yesno:  YES
tx: 5sQvVXTWHMdn9YVsWSqNCT2rCArMLz3Wazu67LETs2Hpfs4uHuWvBoKsz2RhaBwpc2DcE233DYQ4rs9PyzW88hj2
tokenBadge address: FZViZVK1ANAH9Ca3SfshZRpUdSfy1qpX3KGbDBCfCJNh

*/
