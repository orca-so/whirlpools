import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

let cachedJitoTip: number | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

// returns recent jito tip in lamports
export const recentJitoTip = async () => {
  const now = Date.now();
  if (cachedJitoTip && now - lastFetchTime < CACHE_TTL) {
    return cachedJitoTip;
  }

  const response = await fetch(
    "https://bundles.jito.wtf/api/v1/bundles/tip_floor"
  );

  if (!response.ok) {
    throw new Error("Failed to fetch recent Jito tips");
  }
  const data = await response.json().then((res) => res[0]);
  cachedJitoTip = data.landed_tips_50th_percentile * LAMPORTS_PER_SOL;
  lastFetchTime = now;
  return cachedJitoTip;
};

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

export function getJitoTipAddress(): PublicKey {
  // just pick a random one from the list. There are multiple addresses so that no single one
  // can cause local congestion.
  return new PublicKey(
    jitoTipAddresses[Math.floor(Math.random() * jitoTipAddresses.length)]
  );
}
