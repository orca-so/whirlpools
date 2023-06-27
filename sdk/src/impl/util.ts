import BN from "bn.js";
import { PoolUtil, TokenInfo } from "..";
import {
  WhirlpoolAccountFetchOptions,
  WhirlpoolAccountFetcherInterface,
} from "../network/public/fetcher";
import {
  TokenAccountInfo,
  WhirlpoolData,
  WhirlpoolRewardInfo,
  WhirlpoolRewardInfoData,
} from "../types/public";

export async function getTokenMintInfos(
  fetcher: WhirlpoolAccountFetcherInterface,
  data: WhirlpoolData,
  opts?: WhirlpoolAccountFetchOptions
): Promise<TokenInfo[]> {
  const mintA = data.tokenMintA;
  const infoA = await fetcher.getMintInfo(mintA, opts);
  if (!infoA) {
    throw new Error(`Unable to fetch MintInfo for mint - ${mintA}`);
  }
  const mintB = data.tokenMintB;
  const infoB = await fetcher.getMintInfo(mintB, opts);
  if (!infoB) {
    throw new Error(`Unable to fetch MintInfo for mint - ${mintB}`);
  }
  return [
    { mint: mintA, ...infoA },
    { mint: mintB, ...infoB },
  ];
}

export async function getRewardInfos(
  fetcher: WhirlpoolAccountFetcherInterface,
  data: WhirlpoolData,
  opts?: WhirlpoolAccountFetchOptions
): Promise<WhirlpoolRewardInfo[]> {
  const rewardInfos: WhirlpoolRewardInfo[] = [];
  for (const rewardInfo of data.rewardInfos) {
    rewardInfos.push(await getRewardInfo(fetcher, rewardInfo, opts));
  }
  return rewardInfos;
}

async function getRewardInfo(
  fetcher: WhirlpoolAccountFetcherInterface,
  data: WhirlpoolRewardInfoData,
  opts?: WhirlpoolAccountFetchOptions
): Promise<WhirlpoolRewardInfo> {
  const rewardInfo = { ...data, initialized: false, vaultAmount: new BN(0) };
  if (PoolUtil.isRewardInitialized(data)) {
    const vaultInfo = await fetcher.getTokenInfo(data.vault, opts);
    if (!vaultInfo) {
      throw new Error(`Unable to fetch TokenAccountInfo for vault - ${data.vault}`);
    }
    rewardInfo.initialized = true;
    rewardInfo.vaultAmount = new BN(vaultInfo.amount.toString());
  }
  return rewardInfo;
}

export async function getTokenVaultAccountInfos(
  fetcher: WhirlpoolAccountFetcherInterface,
  data: WhirlpoolData,
  opts?: WhirlpoolAccountFetchOptions
): Promise<TokenAccountInfo[]> {
  const vaultA = data.tokenVaultA;
  const vaultInfoA = await fetcher.getTokenInfo(vaultA, opts);
  if (!vaultInfoA) {
    throw new Error(`Unable to fetch TokenAccountInfo for vault - ${vaultA}`);
  }
  const vaultB = data.tokenVaultB;
  const vaultInfoB = await fetcher.getTokenInfo(vaultB, opts);
  if (!vaultInfoB) {
    throw new Error(`Unable to fetch TokenAccountInfo for vault - ${vaultB}`);
  }
  return [vaultInfoA, vaultInfoB];
}
