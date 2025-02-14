import {
  Address,
  address,
  lamports,
  prependTransactionMessageInstruction,
  TransactionSigner,
} from "@solana/web3.js";
import { FeeSetting, Percentile } from "./config";
import { getTransferSolInstruction } from "@solana-program/system";
import { TxMessage } from "./priorityFees";

async function processJitoTipForTxMessage(
  message: TxMessage,
  signer: TransactionSigner,
  jito: FeeSetting,
  priorityFeePercentile: Percentile
) {
  let jitoTipLamports = BigInt(0);

  if (jito.type === "exact") {
    jitoTipLamports = jito.amountLamports;
  } else if (jito.type === "dynamic") {
    jitoTipLamports = await recentJitoTip(priorityFeePercentile);
  }
  if (jitoTipLamports > 0) {
    return prependTransactionMessageInstruction(
      getTransferSolInstruction({
        source: signer,
        destination: getJitoTipAddress(),
        amount: jitoTipLamports,
      }),
      message
    );
  } else {
    return message;
  }
}

// returns recent jito tip in lamports
async function recentJitoTip(priorityFeePercentile: Percentile) {
  const response = await fetch(
    "https://bundles.jito.wtf/api/v1/bundles/tip_floor"
  );
  if (!response.ok) {
    return BigInt(0);
  }
  const data = await response.json().then((res) => res[0]);

  const percentileToKey: Record<Percentile, string> = {
    "25": "landed_tips_25th_percentile",
    "50": "landed_tips_50th_percentile",
    "75": "landed_tips_75th_percentile",
    "95": "landed_tips_95th_percentile",
    "99": "landed_tips_99th_percentile",
    "50ema": "ema_landed_tips_50th_percentile",
  };

  const key = percentileToKey[priorityFeePercentile];
  if (!key || !data[key]) {
    return BigInt(0);
  }
  return lamports(BigInt(Math.floor(Number(data[key]) * 10 ** 9))).valueOf();
}

// should we add an argument that dictates if we should use cached value in case fetch fails ?

// below is taken from legacy sdk (no need to add the whole library)
// https://jito-foundation.gitbook.io/mev/mev-payment-and-distribution/on-chain-addresses
const jitoTipAddresses = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

function getJitoTipAddress(): Address {
  // just pick a random one from the list. There are multiple addresses so that no single one
  // can cause local congestion.
  return address(
    jitoTipAddresses[Math.floor(Math.random() * jitoTipAddresses.length)]
  );
}

export { recentJitoTip, processJitoTipForTxMessage };
