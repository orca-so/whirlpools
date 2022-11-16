import { AddressUtil, TransactionBuilder } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";
import { WhirlpoolContext } from "../context";
import { initTickArrayIx } from "../instructions";
import { WhirlpoolIx } from "../ix";
import { AccountFetcher } from "../network/public";
import { WhirlpoolData } from "../types/public";
import { PDAUtil, PoolUtil, PriceMath, TickArrayUtil, TickUtil } from "../utils/public";
import { WhirlpoolClient, Whirlpool, Position } from "../whirlpool-client";
import { PositionImpl } from "./position-impl";
import { getRewardInfos, getTokenMintInfos, getTokenVaultAccountInfos } from "./util";
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
    const tokenInfos = await getTokenMintInfos(this.ctx.fetcher, account, refresh);
    const vaultInfos = await getTokenVaultAccountInfos(this.ctx.fetcher, account, refresh);
    const rewardInfos = await getRewardInfos(this.ctx.fetcher, account, refresh);
    return new WhirlpoolImpl(
      this.ctx,
      this.ctx.fetcher,
      AddressUtil.toPubKey(poolAddress),
      tokenInfos[0],
      tokenInfos[1],
      vaultInfos[0],
      vaultInfos[1],
      rewardInfos,
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
    const tokenAccounts = new Set<string>();
    accounts.forEach((account) => {
      tokenMints.add(account.tokenMintA.toBase58());
      tokenMints.add(account.tokenMintB.toBase58());
      tokenAccounts.add(account.tokenVaultA.toBase58());
      tokenAccounts.add(account.tokenVaultB.toBase58());
      account.rewardInfos.forEach((rewardInfo) => {
        if (PoolUtil.isRewardInitialized(rewardInfo)) {
          tokenAccounts.add(rewardInfo.vault.toBase58());
        }
      });
    });
    await this.ctx.fetcher.listMintInfos(Array.from(tokenMints), refresh);
    await this.ctx.fetcher.listTokenInfos(Array.from(tokenAccounts), refresh);

    const whirlpools: Whirlpool[] = [];
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const poolAddress = poolAddresses[i];
      const tokenInfos = await getTokenMintInfos(this.ctx.fetcher, account, false);
      const vaultInfos = await getTokenVaultAccountInfos(this.ctx.fetcher, account, false);
      const rewardInfos = await getRewardInfos(this.ctx.fetcher, account, false);
      whirlpools.push(
        new WhirlpoolImpl(
          this.ctx,
          this.ctx.fetcher,
          AddressUtil.toPubKey(poolAddress),
          tokenInfos[0],
          tokenInfos[1],
          vaultInfos[0],
          vaultInfos[1],
          rewardInfos,
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

  public async getPositions(
    positionAddresses: Address[],
    refresh = false
  ): Promise<Record<string, Position | null>> {
    const accounts = await this.ctx.fetcher.listPositions(positionAddresses, refresh);
    const results = accounts.map((positionAccount, index) => {
      const address = positionAddresses[index];
      if (!positionAccount) {
        return [address, null];
      }

      return [
        address,
        new PositionImpl(
          this.ctx,
          this.ctx.fetcher,
          AddressUtil.toPubKey(address),
          positionAccount
        ),
      ];
    });

    return Object.fromEntries(results);
  }

  public async createPool(
    whirlpoolsConfig: Address,
    tokenMintA: Address,
    tokenMintB: Address,
    tickSpacing: number,
    initialTick: number,
    funder: Address,
    refresh = false
  ): Promise<{ pubkey: PublicKey; tx: TransactionBuilder }> {
    invariant(TickUtil.checkTickInBounds(initialTick), "initialTick is out of bounds.");
    invariant(
      TickUtil.isTickInitializable(initialTick, tickSpacing),
      `initial tick ${initialTick} is not an initializable tick for tick-spacing ${tickSpacing}`
    );

    [tokenMintA, tokenMintB] = PoolUtil.orderMints(tokenMintA, tokenMintB).map(
      (addr) => new PublicKey(addr)
    );

    whirlpoolsConfig = AddressUtil.toPubKey(whirlpoolsConfig);

    const feeTierKey = PDAUtil.getFeeTier(
      this.ctx.program.programId,
      whirlpoolsConfig,
      tickSpacing
    ).publicKey;

    const initSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(initialTick);
    const tokenVaultAKeypair = Keypair.generate();
    const tokenVaultBKeypair = Keypair.generate();

    const whirlpoolPda = PDAUtil.getWhirlpool(
      this.ctx.program.programId,
      whirlpoolsConfig,
      tokenMintA,
      tokenMintB,
      tickSpacing
    );

    const feeTier = await this.ctx.fetcher.getFeeTier(feeTierKey, refresh);
    invariant(!!feeTier, `Fee tier for ${tickSpacing} doesn't exist`);

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet
    );

    const initPoolIx = WhirlpoolIx.initializePoolIx(this.ctx.program, {
      initSqrtPrice,
      whirlpoolsConfig,
      whirlpoolPda,
      tokenMintA: new PublicKey(tokenMintA),
      tokenMintB: new PublicKey(tokenMintB),
      tokenVaultAKeypair,
      tokenVaultBKeypair,
      feeTierKey,
      tickSpacing,
      funder: new PublicKey(funder),
    });

    const initialTickArrayStartTick = TickUtil.getStartTickIndex(initialTick, tickSpacing);
    const initialTickArrayPda = PDAUtil.getTickArray(
      this.ctx.program.programId,
      whirlpoolPda.publicKey,
      initialTickArrayStartTick
    );

    txBuilder.addInstruction(initPoolIx);
    txBuilder.addInstruction(
      initTickArrayIx(this.ctx.program, {
        startTick: initialTickArrayStartTick,
        tickArrayPda: initialTickArrayPda,
        whirlpool: whirlpoolPda.publicKey,
        funder: AddressUtil.toPubKey(funder),
      })
    );

    return {
      pubkey: whirlpoolPda.publicKey,
      tx: txBuilder,
    };
  }
}
