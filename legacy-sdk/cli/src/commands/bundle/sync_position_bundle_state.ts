import { DecimalUtil, Percentage } from "@orca-so/common-sdk";
import type { WhirlpoolContext, WhirlpoolData } from "@orca-so/whirlpools-sdk";
import {
  IGNORE_CACHE,
  PoolUtil,
  POSITION_BUNDLE_SIZE,
} from "@orca-so/whirlpools-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { AddressLookupTableAccount } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import type Decimal from "decimal.js";
import { promptConfirm } from "../../utils/prompt";
import { ctx } from "../../utils/provider";
import {
  buildTransactions,
  calculateBalanceDifference,
  checkATAInitialization,
  checkPositionBundleStateDifference,
  checkTickArrayInitialization,
  generateQuotesToSync,
  readCustomPositionBundleStateCsv,
  sendTransactions
} from "./sync_position_bundle_state_impl";

console.info("sync PositionBundle state...");

// prompt
const positionBundlePubkeyStr = "2ZChq6FdKxY3Vgqg8PfqByWq4fVBvY9Rbnq5cJ8u2wPo"
const positionBundlePubkey = new PublicKey(positionBundlePubkeyStr);
const whirlpoolPubkeyStr = "C2EFirfhqx4f22c5auCwtSZk4YgAzqj41kKuthhr3qQv"
const whirlpoolPubkey = new PublicKey(whirlpoolPubkeyStr);

const positionBundleTargetStateCsvPath = "sample/price.csv";

const commaSeparatedAltPubkeyStrs = true ? "no ALTs" : "7Vyx1y8vG9e9Q1MedmXpopRC6ZhVaZzGcvYh5Z3Cs75i, AnXmyHSfuAaWkCxaUuTW39SN5H5ztH8bBxm647uESgTd, FjTZwDecYM3G66VKFuAaLgw3rY1QitziKdM5Ng4EpoKd";

const noAlts = commaSeparatedAltPubkeyStrs === "no ALTs";
const altPubkeyStrs = noAlts
  ? []
  : commaSeparatedAltPubkeyStrs
    .split(",")
    .map((str) => str.trim())
    .filter((str) => str.length > 0);
const altPubkeys = altPubkeyStrs.map((str) => new PublicKey(str));

console.info("check positionBundle...");
const positionBundle = await ctx.fetcher.getPositionBundle(
  positionBundlePubkey,
  IGNORE_CACHE,
);
if (!positionBundle) {
  throw new Error("positionBundle not found");
}

console.info("check whirlpool...");
const whirlpool = await ctx.fetcher.getPool(whirlpoolPubkey, IGNORE_CACHE);
if (!whirlpool) {
  throw new Error("whirlpool not found");
}

const alts: AddressLookupTableAccount[] = [];
if (altPubkeys.length > 0) {
  console.info("check ALTs...");
  for (const altPubkey of altPubkeys) {
    const res = await ctx.connection.getAddressLookupTable(altPubkey);
    if (!res || !res.value) {
      throw new Error(`altAddress not found: ${altPubkey.toBase58()}`);
    } else {
      console.info(
        `    loaded ALT ${altPubkey.toBase58()}, ${res.value.state.addresses.length} entries`,
      );
    }
    alts.push(res.value);
  }
}

// read position bundle target state
console.info("read position bundle target state...");
const positionBundleTargetState = await readCustomPositionBundleStateCsv(
  whirlpoolPubkey,
  positionBundleTargetStateCsvPath,
  whirlpool.tickSpacing,
);

// ensure that all required TickArrays are initialized
console.info("check if required TickArrays are initialized...");
await checkTickArrayInitialization(
  ctx,
  whirlpoolPubkey,
  positionBundleTargetState,
);

// ensure that all required ATA are initialized
console.info("check if required ATAs are initialized...");
await checkATAInitialization(ctx, whirlpool);

const { toDecimalAmountA, toDecimalAmountB, toDecimalAmountReward } =
  await getToDecimalAmountFunctions(ctx, whirlpool);

let firstIteration = true;
while (true) {
  console.info("check position bundle state difference...");
  const difference = await checkPositionBundleStateDifference(
    ctx,
    positionBundlePubkey,
    whirlpoolPubkey,
    positionBundleTargetState,
  );

  if (difference.noDifference.length === POSITION_BUNDLE_SIZE) {
    console.info("synced");
    break;
  }

  if (!firstIteration) {
    console.warn(
      "There are still differences between the current state and the target state (some transaction may have failed)",
    );
  }

  // TODO: prompt for slippage
  const slippage = Percentage.fromFraction(1, 100); // 1%
  const quotes = await generateQuotesToSync(
    ctx,
    whirlpoolPubkey,
    positionBundleTargetState,
    difference,
    slippage,
  );
  const balanceDifference = calculateBalanceDifference(quotes);

  const { tokenABalance, tokenBBalance } = await getWalletATABalance(
    ctx,
    whirlpool,
  );

  // console.info(JSON.stringify(quotes, null, 2));

  console.info("building transactions...");
  const transactions = await buildTransactions(
    ctx,
    alts,
    positionBundlePubkey,
    whirlpoolPubkey,
    difference,
    positionBundleTargetState,
    quotes,
  );

  console.info(
    [
      "\n📝 ACTION SUMMARY\n",
      "\n",
      `Pool:           ${whirlpoolPubkey.toBase58()}\n`,
      `PositionBundle: ${positionBundlePubkey.toBase58()}\n`,
      `Target state:   ${positionBundleTargetStateCsvPath}\n`,
      "\n",
      "Position state changes:\n",
      "\n",
      `    close position:     ${difference.shouldBeClosed.length.toString().padStart(3, " ")} position(s)\n`,
      `    open  position:     ${difference.shouldBeOpened.length.toString().padStart(3, " ")} position(s)\n`,
      `    withdraw liquidity: ${difference.shouldBeDecreased.length.toString().padStart(3, " ")} position(s)\n`,
      `    deposit  liquidity: ${difference.shouldBeIncreased.length.toString().padStart(3, " ")} position(s)\n`,
      "\n",
      "Balance changes:\n",
      "\n",
      `    slippage: ${slippage.toDecimal().mul(100).toString()} %\n`,
      "\n",
      `    tokenA withdrawn (est): ${toDecimalAmountA(balanceDifference.tokenAWithdrawnEst)}\n`,
      `    tokenB withdrawn (est): ${toDecimalAmountB(balanceDifference.tokenBWithdrawnEst)}\n`,
      `    tokenA withdrawn (min): ${toDecimalAmountA(balanceDifference.tokenAWithdrawnMin)}\n`,
      `    tokenB withdrawn (min): ${toDecimalAmountB(balanceDifference.tokenBWithdrawnMin)}\n`,
      `    tokenA collected:       ${toDecimalAmountA(balanceDifference.tokenACollected)}\n`,
      `    tokenB collected:       ${toDecimalAmountB(balanceDifference.tokenBCollected)}\n`,
      `    rewards collected:      ${balanceDifference.rewardsCollected.map((reward, i) => (reward ? toDecimalAmountReward(reward, i).toString() : "no reward")).join(", ")}\n`,
      `    tokenA deposited (est): ${toDecimalAmountA(balanceDifference.tokenADepositedEst)}\n`,
      `    tokenB deposited (est): ${toDecimalAmountB(balanceDifference.tokenBDepositedEst)}\n`,
      `    tokenA deposited (max): ${toDecimalAmountA(balanceDifference.tokenADepositedMax)}\n`,
      `    tokenB deposited (max): ${toDecimalAmountB(balanceDifference.tokenBDepositedMax)}\n`,
      "\n",
      `    tokenA balance delta (est): ${toDecimalAmountA(balanceDifference.tokenABalanceDeltaEst)}\n`,
      `    tokenB balance delta (est): ${toDecimalAmountB(balanceDifference.tokenBBalanceDeltaEst)}\n`,
      "\n",
      "    * negative balance delta means deposited more than withdrawn\n",
      "\n",
      "Wallet balances:\n",
      "\n",
      `    tokenA: ${toDecimalAmountA(tokenABalance)}\n`,
      `    tokenB: ${toDecimalAmountB(tokenBBalance)}\n`,
      "\n",
      "Transactions:\n",
      "\n",
      `    withdraw: ${transactions.withdrawTransactions.length} transaction(s)\n`,
      `    deposit:  ${transactions.depositTransactions.length} transaction(s)\n`,
    ].join(""),
  );

  if (
    balanceDifference.tokenABalanceDeltaEst.isNeg() &&
    balanceDifference.tokenABalanceDeltaEst.abs().gt(tokenABalance)
  ) {
    console.warn(
      "WARNING: tokenA balance delta exceeds the wallet balance, some deposits may fail\n",
    );
  }
  if (
    balanceDifference.tokenBBalanceDeltaEst.isNeg() &&
    balanceDifference.tokenBBalanceDeltaEst.abs().gt(tokenBBalance)
  ) {
    console.warn(
      "WARNING: tokenB balance delta exceeds the wallet balance, some deposits may fail\n",
    );
  }

  // prompt for confirmation
  const confirmed = await promptConfirm("proceed?");
  if (!confirmed) {
    console.info("canceled");
    break;
  }

  // TODO: prompt for priority fee
  const defaultPriorityFeeInLamports = 10_000; // 0.00001 SOL
  await sendTransactions(
    ctx,
    alts,
    transactions.withdrawTransactions,
    defaultPriorityFeeInLamports,
  );
  await sendTransactions(
    ctx,
    alts,
    transactions.depositTransactions,
    defaultPriorityFeeInLamports,
  );

  firstIteration = false;
}

async function getToDecimalAmountFunctions(
  ctx: WhirlpoolContext,
  whirlpool: WhirlpoolData,
): Promise<{
  toDecimalAmountA: (amount: BN) => Decimal;
  toDecimalAmountB: (amount: BN) => Decimal;
  toDecimalAmountReward: (amount: BN, rewardIndex: number) => Decimal;
}> {
  const mintStrings = new Set<string>();
  mintStrings.add(whirlpool.tokenMintA.toBase58());
  mintStrings.add(whirlpool.tokenMintB.toBase58());
  whirlpool.rewardInfos.forEach((rewardInfo) => {
    if (PoolUtil.isRewardInitialized(rewardInfo)) {
      mintStrings.add(rewardInfo.mint.toBase58());
    }
  });

  const mintAddresses = Array.from(mintStrings).map(
    (mintStr) => new PublicKey(mintStr),
  );
  const mints = await ctx.fetcher.getMintInfos(mintAddresses, IGNORE_CACHE);

  const decimalsA = mints.get(whirlpool.tokenMintA.toBase58())!.decimals;
  const decimalsB = mints.get(whirlpool.tokenMintB.toBase58())!.decimals;
  const decimalsRewards = whirlpool.rewardInfos.map((rewardInfo) => {
    if (PoolUtil.isRewardInitialized(rewardInfo)) {
      return mints.get(rewardInfo.mint.toBase58())!.decimals;
    } else {
      return 0;
    }
  });

  const toDecimalAmountA = (amount: BN) =>
    DecimalUtil.fromBN(amount, decimalsA);
  const toDecimalAmountB = (amount: BN) =>
    DecimalUtil.fromBN(amount, decimalsB);
  const toDecimalAmountReward = (amount: BN, rewardIndex: number) =>
    DecimalUtil.fromBN(amount, decimalsRewards[rewardIndex]);

  return { toDecimalAmountA, toDecimalAmountB, toDecimalAmountReward };
}

async function getWalletATABalance(
  ctx: WhirlpoolContext,
  whirlpool: WhirlpoolData,
): Promise<{
  tokenABalance: BN;
  tokenBBalance: BN;
}> {
  const mintAddresses = [whirlpool.tokenMintA, whirlpool.tokenMintB];
  const mints = await ctx.fetcher.getMintInfos(mintAddresses);

  const ataAddresses = mintAddresses.map((mint) =>
    getAssociatedTokenAddressSync(
      mint,
      ctx.wallet.publicKey,
      true, // allow PDA for safety
      mints.get(mint.toBase58())!.tokenProgram, // may be Token-2022 token
    ),
  );

  const atas = await ctx.fetcher.getTokenInfos(ataAddresses, IGNORE_CACHE);

  return {
    tokenABalance: new BN(
      atas.get(ataAddresses[0].toBase58())!.amount.toString(),
    ),
    tokenBBalance: new BN(
      atas.get(ataAddresses[1].toBase58())!.amount.toString(),
    ),
  };
}

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
sync PositionBundle state...
✔ positionBundlePubkey … qHbk42b2ub8K6Rw6p7t1aUoJpwGZ6xpzDC75CQ4QgPD
✔ whirlpoolPubkey … 95XaJMqCLiWtUwF9DtSvDpDbPYhEHoVyCeeNwmUD7cwr
✔ positionBundleTargetStateCsvPath … sample/position_bundle_state/open.csv
✔ commaSeparatedAltPubkeys … 7Vyx1y8vG9e9Q1MedmXpopRC6ZhVaZzGcvYh5Z3Cs75i, AnXmyHSfuAaWkCxaUuTW39SN5H5ztH8bBxm647uESgTd, FjTZwDecYM3G66VKFuAaLgw3rY1QitziKdM5Ng4EpoKd
check positionBundle...
check whirlpool...
check ALTs...
    loaded ALT 7Vyx1y8vG9e9Q1MedmXpopRC6ZhVaZzGcvYh5Z3Cs75i, 254 entries
    loaded ALT AnXmyHSfuAaWkCxaUuTW39SN5H5ztH8bBxm647uESgTd, 256 entries
    loaded ALT FjTZwDecYM3G66VKFuAaLgw3rY1QitziKdM5Ng4EpoKd, 20 entries
read position bundle target state...
check if required TickArrays are initialized...
check if required ATAs are initialized...
check position bundle state difference...
building transactions...

📝 ACTION SUMMARY

Pool:           95XaJMqCLiWtUwF9DtSvDpDbPYhEHoVyCeeNwmUD7cwr
PositionBundle: qHbk42b2ub8K6Rw6p7t1aUoJpwGZ6xpzDC75CQ4QgPD
Target state:   sample/position_bundle_target_state_open.csv

Position state changes:

    close position:       0 position(s)
    open  position:     126 position(s)
    withdraw liquidity:   0 position(s)
    deposit  liquidity:   0 position(s)

Balance changes:

    slippage: 1 %

    tokenA withdrawn (est): 0
    tokenB withdrawn (est): 0
    tokenA withdrawn (min): 0
    tokenB withdrawn (min): 0
    tokenA collected:       0
    tokenB collected:       0
    rewards collected:      no reward, no reward, no reward
    tokenA deposited (est): 0
    tokenB deposited (est): 711326.515908
    tokenA deposited (max): 0
    tokenB deposited (max): 718439.781001

    tokenA balance delta (est): 0
    tokenB balance delta (est): -711326.515908

    * negative balance delta means deposited more than withdrawn

Wallet balances:

    tokenA: 1000000000
    tokenB: 999999999.999622

Transactions:

    withdraw: 0 transaction(s)
    deposit:  14 transaction(s)

✔ proceed? › Yes

estimatedComputeUnits: 1400000
process transaction...
transaction is still valid, 151 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 3K2nYSwpSCcHNvNtUCQZ9UCbpeR64BL7GGf2xdW1RMLim1wU53Ju9rfEYv1qLbhmm1vMYRvtV3g2CYxnoz4MQWTT
...
...
...
estimatedComputeUnits: 1400000
process transaction...
transaction is still valid, 151 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 2U1SLJSQnH434DgTTiAQw52YrSMBKUELJ73knfvNMV2KbMofSTk94w4DKY1fEuMe8rD2bTPT8V6C1qavBYMB2JCc
check position bundle state difference...
synced

*/
