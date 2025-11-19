import { PublicKey } from "@solana/web3.js";
import { WhirlpoolIx, PoolUtil } from "@orca-so/whirlpools-sdk";
import { DecimalUtil, TransactionBuilder } from "@orca-so/common-sdk";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";
import BN from "bn.js";
import Decimal from "decimal.js";

console.info("set reward emissions...");

const X64 = new BN(2).pow(new BN(64));
const SECONDS_PER_WEEK = 60 * 60 * 24 * 7;

function emissionsPerSecondX64ToDecimal(
  emissionsPerSecondX64: BN,
  decimals: number,
): { perSecond: Decimal; perWeek: Decimal } {
  const perSecond = DecimalUtil.fromBN(emissionsPerSecondX64, decimals)
    .div(X64.toString())
    .toDecimalPlaces(decimals);
  const perWeek = DecimalUtil.fromBN(emissionsPerSecondX64, decimals)
    .mul(SECONDS_PER_WEEK.toString())
    .div(X64.toString())
    .toDecimalPlaces(decimals);
  return { perSecond, perWeek };
}

// prompt
const whirlpoolPubkeyStr = await promptText("whirlpoolPubkey");
const whirlpoolPubkey = new PublicKey(whirlpoolPubkeyStr);
const whirlpool = await ctx.fetcher.getPool(whirlpoolPubkey);
if (!whirlpool) {
  throw new Error("whirlpool not found");
}

const initializedRewards = whirlpool.rewardInfos.filter((ri) =>
  PoolUtil.isRewardInitialized(ri),
);
if (initializedRewards.length === 0) {
  throw new Error("no reward initialized");
}

const initializedRewardMintPubkeys = initializedRewards.map((ri) => ri.mint);
const initializedRewardVaultPubkeys = initializedRewards.map((ri) => ri.vault);
const initializedRewardMints = await ctx.fetcher.getMintInfos(
  initializedRewardMintPubkeys,
);
const initializedRewardVaults = await ctx.fetcher.getTokenInfos(
  initializedRewardVaultPubkeys,
);
const initializedRewardInfos = initializedRewards.map((ri) => {
  return {
    ...ri,
    vaultAmount: new BN(
      initializedRewardVaults.get(ri.vault.toBase58())!.amount.toString(),
    ),
    mintDecimals: initializedRewardMints.get(ri.mint.toBase58())!.decimals,
    mintTokenProgram: initializedRewardMints.get(ri.mint.toBase58())!
      .tokenProgram,
  };
});

const rewardAuthority = PoolUtil.getRewardAuthority(whirlpool);

console.info("pool", whirlpoolPubkey.toBase58());
console.info("initialized rewards:");

console.info(
  "authority",
  rewardAuthority.toBase58(),
  rewardAuthority.equals(ctx.wallet.publicKey) ? "(current wallet)" : "",
);

initializedRewardInfos.forEach((ri, i) => {
  const currentEmissions = emissionsPerSecondX64ToDecimal(
    ri.emissionsPerSecondX64,
    ri.mintDecimals,
  );

  console.info(
    `[${i}]:`,
    "mint",
    ri.mint.toBase58(),
    "\n     tokenProgram",
    ri.mintTokenProgram.toBase58(),
    "\n     vault",
    ri.vault.toBase58(),
    "\n     vaultAmount",
    DecimalUtil.fromBN(ri.vaultAmount, ri.mintDecimals),
    "\n     currentEmissions",
    `${currentEmissions.perWeek} per week (${currentEmissions.perSecond} per second)`,
  );
});

if (rewardAuthority.equals(ctx.wallet.publicKey)) {
  throw new Error(
    `the current wallet must be the reward authority(${rewardAuthority.toBase58()})`,
  );
}

const rewardIndexStr = await promptText("rewardIndex");
const rewardIndex = parseInt(rewardIndexStr);
if (isNaN(rewardIndex)) {
  throw new Error("rewardIndex is not a number");
}
if (rewardIndex < 0 || rewardIndex >= initializedRewards.length) {
  throw new Error("rewardIndex is out of range");
}
const rewardInfo = initializedRewardInfos[rewardIndex];

const vaultAmount = DecimalUtil.fromBN(
  rewardInfo.vaultAmount,
  rewardInfo.mintDecimals,
);
const currentEmissions = emissionsPerSecondX64ToDecimal(
  rewardInfo.emissionsPerSecondX64,
  rewardInfo.mintDecimals,
);

let newEmissionsPerSecondX64: BN;
while (true) {
  console.info("vault amount:", vaultAmount.toString());

  const newEmissionsPerWeekStr = await promptText("newEmissionsPerWeek");
  const newEmissionsPerWeekOrg = new Decimal(newEmissionsPerWeekStr);
  if (newEmissionsPerWeekOrg.isNegative()) {
    console.info("negative value is not allowed");
    continue;
  }

  if (newEmissionsPerWeekOrg.greaterThan(vaultAmount)) {
    console.info("emissions per week is larger than vault amount");
    console.info(
      "you should set emissions per week less than or equal to vault amount for safety reason",
    );
    continue;
  }

  newEmissionsPerSecondX64 = new BN(
    newEmissionsPerWeekOrg
      .mul(10 ** rewardInfo.mintDecimals)
      .floor()
      .toString(),
  )
    .mul(X64)
    .divn(SECONDS_PER_WEEK);
  const newEmissions = emissionsPerSecondX64ToDecimal(
    newEmissionsPerSecondX64,
    rewardInfo.mintDecimals,
  );

  console.info(
    "current emission:",
    `${currentEmissions.perWeek} per week (${currentEmissions.perSecond} per second)`,
  );
  console.info(
    "new emission:",
    `${newEmissions.perWeek} per week (${newEmissions.perSecond} per second)`,
  );
  console.info(
    "vault amount / new emission:",
    `${vaultAmount.div(newEmissions.perWeek).mul(7).floor().toString()} days`,
  );

  const ok = await promptConfirm("If the above is OK, enter YES");
  if (ok) {
    break;
  }
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);

builder.addInstruction(
  WhirlpoolIx.setRewardEmissionsV2Ix(ctx.program, {
    rewardIndex,
    emissionsPerSecondX64: newEmissionsPerSecondX64,
    rewardAuthority: ctx.wallet.publicKey,
    whirlpool: whirlpoolPubkey,
    rewardVaultKey: rewardInfo.vault,
  }),
);

await processTransaction(builder);

/*

connection endpoint https://api.devnet.solana.com
wallet 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo
set reward emissions...
✔ whirlpoolPubkey … EgxU92G34jw6QDG9RuTX9StFg1PmHuDqkRKAE5kVEiZ4
pool EgxU92G34jw6QDG9RuTX9StFg1PmHuDqkRKAE5kVEiZ4
initialized rewards:
[0]: mint Afn8YB1p4NsoZeS5XJBZ18LTfEy5NFPwN46wapZcBQr6
     tokenProgram TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
     vault 6w8WRF1beG5yUc3Fvic8ncZfvJxZ2qVVd11PqFRNGkyF
     vaultAmount 509996915.457082
     authority 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo (current wallet)
     currentEmissions 999999.9072 per week (1.653439 per second)
[1]: mint Jd4M8bfJG3sAkd82RsGWyEXoaBXQP7njFzBwEaCTuDa
     tokenProgram TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
     vault 3dsun5fdUuQdcT4RuW7xjYy9UP7a2szQNPmqBjEpGtYv
     vaultAmount 5099969.154558917
     authority 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo (current wallet)
     currentEmissions 9999.9996768 per week (0.016534391 per second)
✔ rewardIndex … 0
vault amount: 509996915.457082
✔ newEmissionsPerWeek … 500000
current emission: 999999.9072 per week (1.653439 per second)
new emission: 499999.999999 per week (0.826719 per second)
vault amount / new emission: 7139 days
✔ If the above is OK, enter YES › Yes
estimatedComputeUnits: 108483
✔ priorityFeeInSOL … 0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 151 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 2vioNB9DsgL82wxJZSUWcZNyKKttJRQoXWpMJ6xgLoxQ2J26KFTHaL1Vn97D4DXwYunDwQxHhjrCbszyvMtCTaZ3

*/
