import { AddressUtil } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import { WhirlpoolContext } from "../context";
import { AccountFetcher } from "../network/public";
import { WhirlpoolData, TokenInfo, TokenAccountInfo } from "../types/public";
import { WhirlpoolClient, Whirlpool, Position } from "../whirlpool-client";
import { PositionImpl } from "./position-impl";
import { WhirlpoolImpl } from "./whirlpool-impl";

export class WhirlpoolClientImpl implements WhirlpoolClient {
  constructor(readonly ctx: WhirlpoolContext) {}

  public getContext(): WhirlpoolContext {
    return this.ctx;
  }

  public getFetcher(): AccountFetcher {
    return this.ctx.fetcher;
  }

  public async getPool(poolAddress: Address, refresh = false): Promise<Whirlpool> {
    const account = await this.ctx.fetcher.getPool(poolAddress, refresh);
    if (!account) {
      throw new Error(`Unable to fetch Whirlpool at address at ${poolAddress}`);
    }
    const tokenInfos = await getTokenInfos(this.ctx.fetcher, account, false);
    const vaultInfos = await getTokenAccountInfos(this.ctx.fetcher, account, false);
    return new WhirlpoolImpl(
      this.ctx,
      this.ctx.fetcher,
      AddressUtil.toPubKey(poolAddress),
      tokenInfos[0],
      tokenInfos[1],
      vaultInfos[0],
      vaultInfos[1],
      account
    );
  }

  public async getPools(poolAddresses: Address[], refresh = false): Promise<Whirlpool[]> {
    const accounts = (await this.ctx.fetcher.listPools(poolAddresses, refresh)).filter(
      (account): account is WhirlpoolData => !!account
    );
    if (accounts.length !== poolAddresses.length) {
      throw new Error(`Unable to fetch all Whirlpools at addresses ${poolAddresses}`);
    }
    const tokenMints = new Set<string>();
    const vaultAddresses = new Set<string>();
    accounts.forEach((account) => {
      tokenMints.add(account.tokenMintA.toBase58());
      tokenMints.add(account.tokenMintB.toBase58());
      vaultAddresses.add(account.tokenVaultA.toBase58());
      vaultAddresses.add(account.tokenVaultB.toBase58());
    });
    await this.ctx.fetcher.listMintInfos(Array.from(tokenMints), false);
    await this.ctx.fetcher.listTokenInfos(Array.from(tokenMints), false);

    const whirlpools: Whirlpool[] = [];
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const poolAddress = poolAddresses[i];
      const tokenInfos = await getTokenInfos(this.ctx.fetcher, account, false);
      const vaultInfos = await getTokenAccountInfos(this.ctx.fetcher, account, false);
      whirlpools.push(
        new WhirlpoolImpl(
          this.ctx,
          this.ctx.fetcher,
          AddressUtil.toPubKey(poolAddress),
          tokenInfos[0],
          tokenInfos[1],
          vaultInfos[0],
          vaultInfos[1],
          account
        )
      );
    }
    return whirlpools;
  }

  public async getPosition(positionAddress: Address, refresh = false): Promise<Position> {
    const account = await this.ctx.fetcher.getPosition(positionAddress, refresh);
    if (!account) {
      throw new Error(`Unable to fetch Position at address at ${positionAddress}`);
    }
    return new PositionImpl(
      this.ctx,
      this.ctx.fetcher,
      AddressUtil.toPubKey(positionAddress),
      account
    );
  }
}

async function getTokenInfos(
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

async function getTokenAccountInfos(
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
