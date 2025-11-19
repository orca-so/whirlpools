import { TransactionBuilder } from "@orca-so/common-sdk";
import { WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { PublicKey } from "@solana/web3.js";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptText } from "../utils/prompt";

const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");
const feeAuthorityPubkeyStr = await promptText("feeAuthorityPubkey");
const defaultProtocolFeeRatePer10000Str = await promptText(
  "defaultProtocolFeeRatePer10000",
);

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.setDefaultProtocolFeeRateIx(ctx.program, {
    whirlpoolsConfig: new PublicKey(whirlpoolsConfigPubkeyStr),
    feeAuthority: new PublicKey(feeAuthorityPubkeyStr),
    defaultProtocolFeeRate: Number.parseInt(defaultProtocolFeeRatePer10000Str),
  }),
);

const landed = await processTransaction(builder);
if (landed) {
  console.info("tx landed");
}
