import BN from "bn.js";
import { AccountFetcher, TokenInfo } from "..";
import {
  WhirlpoolData,
  WhirlpoolRewardInfo,
  WhirlpoolRewardInfoData,
  TokenAccountInfo,
} from "../types/public";

export async function getTokenMintInfos(
  fetcher: AccountFetcher,
  data: WhirlpoolData,
  refresh: boolean
): Promise<TokenInfo[]> {
  const mintA = data.tokenMintA;
  const infoA = await fetcher.getMintInfo(mintA, refresh);
  if (!infoA) {
    throw new Error(`Unable to fetch MintInfo for mint - ${mintA}`);
  }
  const mintB = data.tokenMintB;
  const infoB = await fetcher.getMintInfo(mintB, refresh);
  if (!infoB) {
    throw new Error(`Unable to fetch MintInfo for mint - ${mintB}`);
  }
  return [
    { mint: mintA, ...infoA },
    { mint: mintB, ...infoB },
  ];
}

export async function getRewardInfos(
  fetcher: AccountFetcher,
  data: WhirlpoolData,
  refresh: boolean
): Promise<WhirlpoolRewardInfo[]> {
  const rewardInfos: WhirlpoolRewardInfo[] = [];
  for (const rewardInfo of data.rewardInfos) {
    rewardInfos.push(await getRewardInfo(fetcher, rewardInfo, refresh));
  }
  return rewardInfos;
}

async function getRewardInfo(
  fetcher: AccountFetcher,
  data: WhirlpoolRewardInfoData,
  refresh: boolean
): Promise<WhirlpoolRewardInfo> {
  const rewardInfo = { ...data, initialized: false, vaultAmount: new BN(0) };
  if (isInitialized(data)) {
    const vaultInfo = await fetcher.getTokenInfo(data.vault, refresh);
    if (!vaultInfo) {
      throw new Error(`Unable to fetch TokenAccountInfo for vault - ${data.vault}`);
    }
    rewardInfo.initialized = true;
    rewardInfo.vaultAmount = vaultInfo.amount;
  }
  return rewardInfo;
}

// Uninitialized pubkeys onchain default to this value.
// If the mint equal to this value, then we assume the field was never initialized.
const EMPTY_MINT = "11111111111111111111111111111111";
export function isInitialized(rewardInfo: WhirlpoolRewardInfoData): boolean {
  return rewardInfo.vault.toBase58() !== EMPTY_MINT;
}

export async function getTokenVaultAccountInfos(
  fetcher: AccountFetcher,
  data: WhirlpoolData,
  refresh: boolean
): Promise<TokenAccountInfo[]> {
  const vaultA = data.tokenVaultA;
  const vaultInfoA = await fetcher.getTokenInfo(vaultA, refresh);
  if (!vaultInfoA) {
    throw new Error(`Unable to fetch TokenAccountInfo for vault - ${vaultA}`);
  }
  const vaultB = data.tokenVaultB;
  const vaultInfoB = await fetcher.getTokenInfo(vaultB, refresh);
  if (!vaultInfoB) {
    throw new Error(`Unable to fetch TokenAccountInfo for vault - ${vaultB}`);
  }
  return [vaultInfoA, vaultInfoB];
}
