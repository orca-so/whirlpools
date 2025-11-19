import { Keypair, PublicKey } from "@solana/web3.js";
import { WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptText } from "../utils/prompt";

console.info("initialize WhirlpoolsConfig...");

// prompt
const feeAuthorityPubkeyStr = await promptText("feeAuthorityPubkey");
const collectProtocolFeesAuthorityPubkeyStr = await promptText(
  "collectProtocolFeesAuthorityPubkey",
);
const rewardEmissionsSuperAuthorityPubkeyStr = await promptText(
  "rewardEmissionsSuperAuthorityPubkey",
);
const defaultProtocolFeeRatePer10000Str = await promptText(
  "defaultProtocolFeeRatePer10000",
);

const configKeypair = Keypair.generate();

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.initializeConfigIx(ctx.program, {
    whirlpoolsConfigKeypair: configKeypair,
    funder: ctx.wallet.publicKey,
    feeAuthority: new PublicKey(feeAuthorityPubkeyStr),
    collectProtocolFeesAuthority: new PublicKey(
      collectProtocolFeesAuthorityPubkeyStr,
    ),
    rewardEmissionsSuperAuthority: new PublicKey(
      rewardEmissionsSuperAuthorityPubkeyStr,
    ),
    defaultProtocolFeeRate: Number.parseInt(defaultProtocolFeeRatePer10000Str),
  }),
);

const landed = await processTransaction(builder);
if (landed) {
  console.info("whirlpoolsConfig address:", configKeypair.publicKey.toBase58());
}

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
create WhirlpoolsConfig...
prompt: feeAuthorityPubkey:  r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
prompt: collectProtocolFeesAuthorityPubkey:  r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
prompt: rewardEmissionsSuperAuthorityPubkey:  r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
prompt: defaultProtocolFeeRatePer10000:  300
tx: 5k733gttt65s2vAuABVhVcyGMkFDKRU3MQLhmxZ1crxCaxxXn2PsucntLN6rxqz3VeAv1jPTxfZoxUbkChbDngzT
whirlpoolsConfig address: 8raEdn1tNEft7MnbMQJ1ktBqTKmHLZu7NJ7teoBkEPKm

*/
