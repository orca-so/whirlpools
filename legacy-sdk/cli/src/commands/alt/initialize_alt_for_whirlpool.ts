import { AddressLookupTableProgram, PublicKey } from "@solana/web3.js";
import { IGNORE_CACHE, MAX_TICK_INDEX, MIN_TICK_INDEX, PDAUtil, PoolUtil, TICK_ARRAY_SIZE, TickUtil } from "@orca-so/whirlpools-sdk";
import { MintWithTokenProgram, TransactionBuilder } from "@orca-so/common-sdk";
import { sendTransaction } from "../../utils/transaction_sender";
import { ctx } from "../../utils/provider";
import { promptText } from "../../utils/prompt";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

console.info("initialize ALT for whirlpool...");

// prompt
const whirlpoolPubkeyStr = await promptText("whirlpoolPubkey");
const whirlpoolPubkey = new PublicKey(whirlpoolPubkeyStr);

const whirlpool = await ctx.fetcher.getPool(whirlpoolPubkey, IGNORE_CACHE);
if (!whirlpool) {
  throw new Error("whirlpool not found");
}
const mintA = await ctx.fetcher.getMintInfo(whirlpool.tokenMintA) as MintWithTokenProgram;
const mintB = await ctx.fetcher.getMintInfo(whirlpool.tokenMintB) as MintWithTokenProgram;

// 8 keys
const addresses: PublicKey[] = [
  whirlpoolPubkey,
  whirlpool.whirlpoolsConfig,
  whirlpool.tokenMintA,
  whirlpool.tokenMintB,
  whirlpool.tokenVaultA,
  whirlpool.tokenVaultB,
  // This ALT is just for ctx.wallet
  getAssociatedTokenAddressSync(whirlpool.tokenMintA, ctx.wallet.publicKey, true, mintA.tokenProgram),
  getAssociatedTokenAddressSync(whirlpool.tokenMintB, ctx.wallet.publicKey, true, mintB.tokenProgram),
];
// max 9 keys
for (const rewardInfo of whirlpool.rewardInfos.filter((rewardInfo) => PoolUtil.isRewardInitialized(rewardInfo))) {
  const mint = await ctx.fetcher.getMintInfo(rewardInfo.mint) as MintWithTokenProgram;

  addresses.push(rewardInfo.mint);
  addresses.push(rewardInfo.vault);
  // This ALT is just for ctx.wallet
  addresses.push(getAssociatedTokenAddressSync(rewardInfo.mint, ctx.wallet.publicKey, true, mint.tokenProgram));
}
// 1 key
addresses.push(PDAUtil.getOracle(ctx.program.programId, whirlpoolPubkey).publicKey);

// at most 11 TickArrays (previous 5 + current + next 5)
const minStartTickIndex = TickUtil.getStartTickIndex(MIN_TICK_INDEX, whirlpool.tickSpacing);
const maxStartTickIndex = TickUtil.getStartTickIndex(MAX_TICK_INDEX, whirlpool.tickSpacing);
const currentStartTickIndex = TickUtil.getStartTickIndex(whirlpool.tickCurrentIndex, whirlpool.tickSpacing);
const ticksInArray = whirlpool.tickSpacing * TICK_ARRAY_SIZE;

const firstStartTickIndex = Math.max(minStartTickIndex, currentStartTickIndex - 5*ticksInArray);
const lastStartTickIndex = Math.min(maxStartTickIndex, currentStartTickIndex + 5*ticksInArray);
for (let startTickIndex = firstStartTickIndex; startTickIndex <= lastStartTickIndex; startTickIndex += ticksInArray) {
  addresses.push(PDAUtil.getTickArray(ctx.program.programId, whirlpoolPubkey, startTickIndex).publicKey);
}

// at most 29 entries (8 + 9 + 1 + 11)
// single transaction (createLookupTable + extendLookupTable can cover up to 30 entries based on local test)

const [createLookupTableIx, alt] = AddressLookupTableProgram.createLookupTable({
  authority: ctx.wallet.publicKey,
  payer: ctx.wallet.publicKey,
  recentSlot: await ctx.connection.getSlot({commitment: "confirmed"}),
});

const extendLookupTableIx = AddressLookupTableProgram.extendLookupTable({
  lookupTable: alt,
  authority: ctx.wallet.publicKey,
  payer: ctx.wallet.publicKey,
  addresses,
});

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction({ instructions: [createLookupTableIx, extendLookupTableIx], cleanupInstructions: [], signers: [] });

const landed = await sendTransaction(builder);
if (landed) {
  console.info(`ALT initialized: ${alt.toBase58()}`);
  console.info("Entries:");
  addresses.forEach((address, index) => {
    console.info(`\t${index}: ${address.toBase58()}`);
  });
}

/*

SAMPLE EXECUTION LOG

$ yarn start initializeAltForWhirlpool
connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
initialize ALT for whirlpool...
✔ whirlpoolPubkey … 95XaJMqCLiWtUwF9DtSvDpDbPYhEHoVyCeeNwmUD7cwr
estimatedComputeUnits: 1400000
✔ priorityFeeInSOL … 0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 151 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 3Xxo22EJ7BmMob7J2q2QJCtnJrcgvG8BAiya1wf3Ka66RKCxsz2w6ss8ywbK2XwWzcJHbAmpDVMuiD3iVjZFy1T9
ALT initialized: 5Fk3kjiAyz1TEQUpvHThibfssgQqkMkddjBMbPL2TgiZ
Entries:
        0: 95XaJMqCLiWtUwF9DtSvDpDbPYhEHoVyCeeNwmUD7cwr
        1: 2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ
        2: orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE
        3: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
        4: 8tgCn1xei522Di8AjYtfkFEjhn6MmUHW2YcQr8mDYfL2
        5: 2PieLBFZd3GjwMdeMcQwkr5fcxk4xNPYfMEHNAZxGjey
        6: 7B8yNHX62NLvRswD86ttbGcV5TYxUsDNxEg2ZRMZLPRt
        7: FbQdXCQgGQYj3xcGeryVVFjKCTsAuu53vmCRtmjQEqM5
        8: 5S8p3uciu7AaEREiibf4Z4hEB3B61mSf671taY497mvv
        9: 3ScwtoeaBQBzxncQZeiZSBCdTwd8jTfQsy52JrsRdpp2
        10: 7bfNn3E5jgFXs4sbXiXVWBo2JJ5vWKhFhExR6TcamsQy
        11: 4ronWzGzbV2wEWHKvBQBxdHNPcUqor6vE4KNg6B4wbXT
        12: Eq4tmgWRG4jpAxwiktmh4sbBr8q1rvUDDFMXb4121F2i
        13: GwtBgneHFYQnLGFwVmQdDWB1qw5jYj3HbqAaErzYW8PZ
        14: HhQN6yDwC6Bv7DMn6fbREWTjJR7hKMycPr9nmo8tK3pL
        15: Hbjh64DET4ER9vSiCNwVJmiwR2NaedVSM36bh2urZeLS
        16: DGYoQK2gEtvanRt6ci6mz42PGne6eWjmHYBu9D1YZUrX
        17: BhiUaDDpsguydMWeoQy4k9qBtyh8rBLDssFLw9e4LYXq
        18: HMnbcY8bGLdcH2vmBMDgi4XCYnQKXqPhmWMPP1vYvo5z
        19: AryTbgjgHbt9o59DtcLS2RnhsDpudRVaCJzDge9Hieo8

*/
