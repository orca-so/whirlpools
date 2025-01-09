import { AddressLookupTableProgram, PublicKey } from "@solana/web3.js";
import { IGNORE_CACHE, PDAUtil, POSITION_BUNDLE_SIZE, toTx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { sendTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptText } from "../utils/prompt";

console.info("initialize ALT for bundled positions...");

// prompt
const positionBundlePubkeyStr = await promptText("positionBundlePubkey");
const positionBundlePubkey = new PublicKey(positionBundlePubkeyStr);

const positionBundle = await ctx.fetcher.getPositionBundle(positionBundlePubkey, IGNORE_CACHE);
if (!positionBundle) {
  throw new Error("positionBundle not found");
}

const bundledPositionAddresses: PublicKey[] = [];
for (let bundleIndex = 0; bundleIndex < POSITION_BUNDLE_SIZE; bundleIndex++) {
  bundledPositionAddresses.push(
    PDAUtil.getBundledPosition(ctx.program.programId, positionBundle.positionBundleMint, bundleIndex).publicKey
  );
}

const txs: TransactionBuilder[] = [];
let altAddressPubkey: PublicKey;
let altAddressPubkeyStr = await promptText("altAddressPubkey", "create new ALT");
let altEntries = 0;
if (altAddressPubkeyStr === "create new ALT") {
  const [createLookupTableIx, alt] = AddressLookupTableProgram.createLookupTable({
    authority: ctx.wallet.publicKey,
    payer: ctx.wallet.publicKey,
    recentSlot: await ctx.connection.getSlot({commitment: "confirmed"}),
  });
  altAddressPubkey = alt;
  txs.push(toTx(ctx, {
    instructions: [createLookupTableIx],
    cleanupInstructions: [],
    signers: [],
  }));
} else {
  altAddressPubkey = new PublicKey(altAddressPubkeyStr);
  const res = await ctx.connection.getAddressLookupTable(altAddressPubkey);
  if (!res || !res.value) {
    throw new Error("altAddress not found");
  }
  altEntries = res.value.state.addresses.length;
}

console.info("ALT address:", altAddressPubkey.toBase58());

for (let bundleIndexStart = altEntries; bundleIndexStart < POSITION_BUNDLE_SIZE; bundleIndexStart += 16) {
  const extendLookupTableIx = AddressLookupTableProgram.extendLookupTable({
    lookupTable: altAddressPubkey,
    authority: ctx.wallet.publicKey,
    payer: ctx.wallet.publicKey,
    addresses: bundledPositionAddresses.slice(bundleIndexStart, bundleIndexStart + 16),
  });

  const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
  builder.addInstruction({ instructions: [extendLookupTableIx], cleanupInstructions: [], signers: [] });
  txs.push(builder);
}

if (txs.length === 0) {
  console.info("ALT is full");
  process.exit(0);
}

const defaultPriorityFeeInLamports = 10_000; // 0.00001 SOL
for (const tx of txs) {
  const landed = await sendTransaction(tx, defaultPriorityFeeInLamports);
  if (!landed) {
    throw new Error("transaction failed");
  }
}

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
initialize PositionBundle...
estimatedComputeUnits: 170954
✔ priorityFeeInSOL … 0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 151 blocks left (at most)
sending...
confirming...
successfully landed
signature 55Qs1vGXeQ8EXokLLdPbD3iYEjPPM2ryvStU3cQm4Qw4sVhboRxzFZwdjPqZR4rGcRQygJut9puYWS1V8i94zsUH
positionBundle address: 3XmaBcpvHdNTv6u35M13w55SpJKVhxSahTkzMiVRVsqC

*/
