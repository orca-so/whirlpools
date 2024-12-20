import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { WhirlpoolIx, getAllWhirlpoolAccountsForConfig, WhirlpoolData } from "@orca-so/whirlpools-sdk";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";
import { ComputeBudgetProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  DecimalUtil,
  TransactionBuilder,
  estimateComputeBudgetLimit,
} from "@orca-so/common-sdk";
import Decimal from "decimal.js";
import PQueue from "p-queue";
import base58 from "bs58";

// 20 whirlpools will be updated in a single transaction
const CHUNK_SIZE = 20;

console.info("batch update protocol fee rate...");

// prompt
const whirlpoolsConfigStr = await promptText("whirlpoolsConfigPubkey");
const newProtocolFeeRatePer10000Str = await promptText(
  "newProtocolFeeRatePer10000",
);
const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigStr);
const newProtocolFeeRate = Number.parseInt(newProtocolFeeRatePer10000Str);

// check fee authority
const whirlpoolsConfig = await ctx.fetcher.getConfig(whirlpoolsConfigPubkey);
if (!whirlpoolsConfig) {
  throw new Error("whirlpools config not found");
}
if (!whirlpoolsConfig.feeAuthority.equals(ctx.wallet.publicKey)) {
  throw new Error(
    `the current wallet must be the fee authority(${whirlpoolsConfig.feeAuthority.toBase58()})`,
  );
}

// find whirlpools
console.info("searching whirlpools...");
const whirlpools = await getAllWhirlpoolAccountsForConfig({
  connection: ctx.connection,
  programId: ctx.program.programId,
  configId: new PublicKey(whirlpoolsConfigStr),
});
console.info("found whirlpools:", whirlpools.size);

// drop whirlpools if its protocol fee rate is already same to new one
const targetWhirlpools: { pubkey: PublicKey; data: WhirlpoolData; }[] = [];
for (const [pubkeyStr, data] of whirlpools) {
  if (data.protocolFeeRate === newProtocolFeeRate) {
    continue;
  }
  targetWhirlpools.push({ pubkey: new PublicKey(pubkeyStr), data });
}
console.info("target whirlpools:", targetWhirlpools.length);

if (targetWhirlpools.length === 0) {
  console.info("no whirlpools to update");
  process.exit(0);
}

// set priority fee for each transaction
let priorityFeeInLamports = 0;
while (true) {
  const priorityFeeInSOL = await promptText("priorityFeeInSOL");
  priorityFeeInLamports = DecimalUtil.toBN(
    new Decimal(priorityFeeInSOL),
    9,
  ).toNumber();
  if (priorityFeeInLamports > LAMPORTS_PER_SOL) {
    console.info("> 1 SOL is obviously too much for priority fee");
    continue;
  }
  if (priorityFeeInLamports > 5_000_000) {
    console.info(
      `Is it okay to use ${priorityFeeInLamports / LAMPORTS_PER_SOL} SOL for priority fee ? (if it is OK, enter OK)`,
    );
    const ok = await promptConfirm("OK");
    if (!ok) continue;
  }

  console.info(
    "Priority fee:",
    priorityFeeInLamports / LAMPORTS_PER_SOL,
    "SOL",
  );
  break;
}

// confirm
console.info(
  "setting...",
  "\n\twhirlpoolConfig",
  whirlpoolsConfigPubkey.toBase58(),
  "\n\tnewProtocolFeeRate",
  newProtocolFeeRate,
  `(${newProtocolFeeRate / 10000 * 100}%)`,
  "\n\ttargetWhirlpools",
  targetWhirlpools.length,
  "\n\tpriorityFeeInSOL(Each transaction)",
  priorityFeeInLamports / LAMPORTS_PER_SOL,
  "\n\tpriorityFeeInSOL(Total)",
  priorityFeeInLamports * Math.ceil(targetWhirlpools.length / CHUNK_SIZE) / LAMPORTS_PER_SOL,
);
const yesno = await promptConfirm("if the above is OK, enter YES");
if (!yesno) {
  throw new Error("stopped");
}

// process transactions in parallel
const promises: Promise<boolean | void>[] = [];
const jobQueue = new PQueue({
  autoStart: true,
  concurrency: 5,
});

for (let i = 0; i < targetWhirlpools.length; i += CHUNK_SIZE) {
  const chunk = targetWhirlpools.slice(i, i + CHUNK_SIZE);

  promises.push(jobQueue.add(async () => {
    const builder = new TransactionBuilder(ctx.connection, ctx.wallet);

    for (const { pubkey } of chunk) {
      builder.addInstruction(
        WhirlpoolIx.setProtocolFeeRateIx(ctx.program, {
          whirlpool: pubkey,
          whirlpoolsConfig: whirlpoolsConfigPubkey,
          feeAuthority: whirlpoolsConfig.feeAuthority,
          protocolFeeRate: newProtocolFeeRate,
        }),
      );
    }

    console.info(`sending transaction... (range: ${i} ~ ${i + CHUNK_SIZE})`);
    return await sendTransaction(builder, priorityFeeInLamports);
  }));
}

const result = await Promise.all(promises);

const successCount = result.filter((v) => v).length;
console.info(`success: ${successCount}/${result.length}`);

///////////////////////////////////////////////////////////////////////////////
// cloned from utils/transaction_sender.ts
// - remove console.info output
// - pass priorityFeeInLamports as an argument
///////////////////////////////////////////////////////////////////////////////

export async function sendTransaction(
  builder: TransactionBuilder,
  priorityFeeInLamports: number,
): Promise<boolean> {
  if (priorityFeeInLamports > 0) {
    const estimatedComputeUnits = await estimateComputeBudgetLimit(
      builder.connection,
      [builder.compressIx(true)],
      undefined,
      builder.wallet.publicKey,
      0.1, // + 10%
    );
  
    const setComputeUnitPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: Math.floor(
        (priorityFeeInLamports * 1_000_000) / estimatedComputeUnits,
      ),
    });
    const setComputeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: estimatedComputeUnits,
    });

    builder.prependInstruction({
      instructions: [setComputeUnitLimitIx, setComputeUnitPriceIx],
      cleanupInstructions: [],
      signers: [],
    });
  }

  const result = await send(builder);
  return result.landed && result.success;
}

async function send(
  builder: TransactionBuilder,
): Promise<{ landed: boolean; success: boolean }> {
  const connection = builder.connection;
  const wallet = builder.wallet;

  // manual build
  const built = await builder.build({ maxSupportedTransactionVersion: 0 });

  const blockhash = await connection.getLatestBlockhashAndContext("confirmed");
  const blockHeight = await connection.getBlockHeight({
    commitment: "confirmed",
    minContextSlot: await blockhash.context.slot,
  });

  // why 151: https://solana.com/docs/core/transactions/confirmation#how-does-transaction-expiration-work
  const transactionTTL = blockHeight + 151;

  const notSigned = built.transaction as VersionedTransaction;
  notSigned.message.recentBlockhash = blockhash.value.blockhash;

  if (built.signers.length > 0) notSigned.sign(built.signers);
  const signed = await wallet.signTransaction(notSigned);
  const signature = base58.encode(signed.signatures[0]);

  // manual send and confirm
  const waitToConfirm = () =>
    new Promise((resolve) => setTimeout(resolve, 5000));
  const waitToRetry = () => new Promise((resolve) => setTimeout(resolve, 3000));

  const numTry = 100; // break by expiration
  let landed = false;
  let success = false;
  for (let i = 0; i < numTry; i++) {
    // check transaction TTL
    const blockHeight = await connection.getBlockHeight("confirmed");
    if (blockHeight > transactionTTL) {
      // check signature status (to avoid false negative)
      const sigStatus = await connection.getSignatureStatus(signature);
      if (sigStatus.value?.confirmationStatus === "confirmed") {
        success = sigStatus.value.err === null;
        landed = true;
        break;
      }

      break;
    }

    // send without retry on RPC server
    await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
      maxRetries: 0,
    });

    await waitToConfirm();

    // check signature status
    const sigStatus = await connection.getSignatureStatus(signature);
    if (sigStatus.value?.confirmationStatus === "confirmed") {
      success = sigStatus.value.err === null;
      landed = true;
      break;
    }

    await waitToRetry();
  }

  return { landed, success };
}

/*

SAMPLE EXECUTION LOG

$ yarn start batchUpdateProtocolFeeRate
connection endpoint <RPC>
wallet 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo
batch update protocol fee rate...
✔ whirlpoolsConfigPubkey … FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR
✔ newProtocolFeeRatePer10000 … 300
searching whirlpools...
found whirlpools: 1983
target whirlpools: 1983
✔ priorityFeeInSOL … 0.00001
Priority fee: 0.00001 SOL
setting... 
        whirlpoolConfig FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR 
        newProtocolFeeRate 300 (3%) 
        targetWhirlpools 1983 
        priorityFeeInSOL(Each transaction) 0.00001 
        priorityFeeInSOL(Total) 0.001
✔ if the above is OK, enter YES › Yes
sending transaction... (range: 0 ~ 20)
sending transaction... (range: 20 ~ 40)
sending transaction... (range: 40 ~ 60)
sending transaction... (range: 60 ~ 80)
sending transaction... (range: 80 ~ 100)
sending transaction... (range: 100 ~ 120)
sending transaction... (range: 120 ~ 140)
sending transaction... (range: 140 ~ 160)
sending transaction... (range: 160 ~ 180)
sending transaction... (range: 180 ~ 200)
sending transaction... (range: 200 ~ 220)
sending transaction... (range: 220 ~ 240)
sending transaction... (range: 240 ~ 260)
sending transaction... (range: 260 ~ 280)
sending transaction... (range: 280 ~ 300)
sending transaction... (range: 300 ~ 320)
sending transaction... (range: 320 ~ 340)
sending transaction... (range: 340 ~ 360)
sending transaction... (range: 360 ~ 380)
sending transaction... (range: 380 ~ 400)
sending transaction... (range: 400 ~ 420)
sending transaction... (range: 420 ~ 440)
sending transaction... (range: 440 ~ 460)
sending transaction... (range: 460 ~ 480)
sending transaction... (range: 480 ~ 500)
sending transaction... (range: 500 ~ 520)
sending transaction... (range: 520 ~ 540)
sending transaction... (range: 540 ~ 560)
sending transaction... (range: 560 ~ 580)
sending transaction... (range: 580 ~ 600)
sending transaction... (range: 600 ~ 620)
sending transaction... (range: 620 ~ 640)
sending transaction... (range: 640 ~ 660)
sending transaction... (range: 660 ~ 680)
sending transaction... (range: 680 ~ 700)
sending transaction... (range: 700 ~ 720)
sending transaction... (range: 720 ~ 740)
sending transaction... (range: 740 ~ 760)
sending transaction... (range: 760 ~ 780)
sending transaction... (range: 780 ~ 800)
sending transaction... (range: 800 ~ 820)
sending transaction... (range: 820 ~ 840)
sending transaction... (range: 840 ~ 860)
sending transaction... (range: 860 ~ 880)
sending transaction... (range: 880 ~ 900)
sending transaction... (range: 900 ~ 920)
sending transaction... (range: 920 ~ 940)
sending transaction... (range: 940 ~ 960)
sending transaction... (range: 960 ~ 980)
sending transaction... (range: 980 ~ 1000)
sending transaction... (range: 1000 ~ 1020)
sending transaction... (range: 1020 ~ 1040)
sending transaction... (range: 1040 ~ 1060)
sending transaction... (range: 1060 ~ 1080)
sending transaction... (range: 1080 ~ 1100)
sending transaction... (range: 1100 ~ 1120)
sending transaction... (range: 1120 ~ 1140)
sending transaction... (range: 1140 ~ 1160)
sending transaction... (range: 1160 ~ 1180)
sending transaction... (range: 1180 ~ 1200)
sending transaction... (range: 1200 ~ 1220)
sending transaction... (range: 1220 ~ 1240)
sending transaction... (range: 1240 ~ 1260)
sending transaction... (range: 1260 ~ 1280)
sending transaction... (range: 1280 ~ 1300)
sending transaction... (range: 1300 ~ 1320)
sending transaction... (range: 1320 ~ 1340)
sending transaction... (range: 1340 ~ 1360)
sending transaction... (range: 1360 ~ 1380)
sending transaction... (range: 1380 ~ 1400)
sending transaction... (range: 1400 ~ 1420)
sending transaction... (range: 1420 ~ 1440)
sending transaction... (range: 1440 ~ 1460)
sending transaction... (range: 1460 ~ 1480)
sending transaction... (range: 1480 ~ 1500)
sending transaction... (range: 1500 ~ 1520)
sending transaction... (range: 1520 ~ 1540)
sending transaction... (range: 1540 ~ 1560)
sending transaction... (range: 1560 ~ 1580)
sending transaction... (range: 1580 ~ 1600)
sending transaction... (range: 1600 ~ 1620)
sending transaction... (range: 1620 ~ 1640)
sending transaction... (range: 1640 ~ 1660)
sending transaction... (range: 1660 ~ 1680)
sending transaction... (range: 1680 ~ 1700)
sending transaction... (range: 1700 ~ 1720)
sending transaction... (range: 1720 ~ 1740)
sending transaction... (range: 1740 ~ 1760)
sending transaction... (range: 1760 ~ 1780)
sending transaction... (range: 1780 ~ 1800)
sending transaction... (range: 1800 ~ 1820)
sending transaction... (range: 1820 ~ 1840)
sending transaction... (range: 1840 ~ 1860)
sending transaction... (range: 1860 ~ 1880)
sending transaction... (range: 1880 ~ 1900)
sending transaction... (range: 1900 ~ 1920)
sending transaction... (range: 1920 ~ 1940)
sending transaction... (range: 1940 ~ 1960)
sending transaction... (range: 1960 ~ 1980)
sending transaction... (range: 1980 ~ 2000)
success: 100/100


$ yarn start batchUpdateProtocolFeeRate
connection endpoint <RPC>
wallet 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo
batch update protocol fee rate...
✔ whirlpoolsConfigPubkey … FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR
✔ newProtocolFeeRatePer10000 … 300
searching whirlpools...
found whirlpools: 1983
target whirlpools: 0
no whirlpools to update

*/