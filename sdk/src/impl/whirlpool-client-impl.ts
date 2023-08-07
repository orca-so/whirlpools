import { Address } from "@coral-xyz/anchor";
import { AddressUtil, TransactionBuilder } from "@orca-so/common-sdk";
import { Keypair, PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";
import { WhirlpoolContext } from "../context";
import { initTickArrayIx } from "../instructions";
import {
  collectAllForPositionAddressesTxns,
  collectProtocolFees,
} from "../instructions/composites";
import { WhirlpoolIx } from "../ix";
import {
  IGNORE_CACHE,
  PREFER_CACHE,
  WhirlpoolAccountFetchOptions,
  WhirlpoolAccountFetcherInterface,
} from "../network/public/fetcher";
import { WhirlpoolRouter, WhirlpoolRouterBuilder } from "../router/public";
import { WhirlpoolData } from "../types/public";
import { getTickArrayDataForPosition } from "../utils/builder/position-builder-util";
import { PDAUtil, PoolUtil, PriceMath, TickUtil } from "../utils/public";
import { Position, Whirlpool, WhirlpoolClient } from "../whirlpool-client";
import { PositionImpl } from "./position-impl";
import { getRewardInfos, getTokenMintInfos, getTokenVaultAccountInfos } from "./util";
import { WhirlpoolImpl } from "./whirlpool-impl";

export class WhirlpoolClientImpl implements WhirlpoolClient {
  constructor(readonly ctx: WhirlpoolContext) {}

  public getContext(): WhirlpoolContext {
    return this.ctx;
  }

  public getFetcher(): WhirlpoolAccountFetcherInterface {
    return this.ctx.fetcher;
  }

  public getRouter(poolAddresses: Address[]): Promise<WhirlpoolRouter> {
    return WhirlpoolRouterBuilder.buildWithPools(this.ctx, poolAddresses);
  }

  public async getPool(poolAddress: Address, opts = PREFER_CACHE): Promise<Whirlpool> {
    const account = await this.ctx.fetcher.getPool(poolAddress, opts);
    if (!account) {
      throw new Error(`Unable to fetch Whirlpool at address at ${poolAddress}`);
    }
    const tokenInfos = await getTokenMintInfos(this.ctx.fetcher, account, opts);
    const vaultInfos = await getTokenVaultAccountInfos(this.ctx.fetcher, account, opts);
    const rewardInfos = await getRewardInfos(this.ctx.fetcher, account, opts);
    return new WhirlpoolImpl(
      this.ctx,
      AddressUtil.toPubKey(poolAddress),
      tokenInfos[0],
      tokenInfos[1],
      vaultInfos[0],
      vaultInfos[1],
      rewardInfos,
      account
    );
  }

  public async getPools(poolAddresses: Address[], opts = PREFER_CACHE): Promise<Whirlpool[]> {
    const accounts = Array.from(
      (await this.ctx.fetcher.getPools(poolAddresses, opts)).values()
    ).filter((account): account is WhirlpoolData => !!account);
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
    await this.ctx.fetcher.getMintInfos(Array.from(tokenMints), opts);
    await this.ctx.fetcher.getTokenInfos(Array.from(tokenAccounts), opts);

    const whirlpools: Whirlpool[] = [];
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const poolAddress = poolAddresses[i];
      const tokenInfos = await getTokenMintInfos(this.ctx.fetcher, account, PREFER_CACHE);
      const vaultInfos = await getTokenVaultAccountInfos(this.ctx.fetcher, account, PREFER_CACHE);
      const rewardInfos = await getRewardInfos(this.ctx.fetcher, account, PREFER_CACHE);
      whirlpools.push(
        new WhirlpoolImpl(
          this.ctx,
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

  public async getPosition(positionAddress: Address, opts = PREFER_CACHE): Promise<Position> {
    const account = await this.ctx.fetcher.getPosition(positionAddress, opts);
    if (!account) {
      throw new Error(`Unable to fetch Position at address at ${positionAddress}`);
    }
    const whirlAccount = await this.ctx.fetcher.getPool(account.whirlpool, opts);
    if (!whirlAccount) {
      throw new Error(`Unable to fetch Whirlpool for Position at address at ${positionAddress}`);
    }

    const [lowerTickArray, upperTickArray] = await getTickArrayDataForPosition(
      this.ctx,
      account,
      whirlAccount,
      opts
    );
    if (!lowerTickArray || !upperTickArray) {
      throw new Error(`Unable to fetch TickArrays for Position at address at ${positionAddress}`);
    }
    return new PositionImpl(
      this.ctx,
      AddressUtil.toPubKey(positionAddress),
      account,
      whirlAccount,
      lowerTickArray,
      upperTickArray
    );
  }

  public async getPositions(
    positionAddresses: Address[],
    opts = PREFER_CACHE
  ): Promise<Record<string, Position | null>> {
    // TODO: Prefetch and use fetcher as a cache - Think of a cleaner way to prefetch
    const positions = Array.from(
      (await this.ctx.fetcher.getPositions(positionAddresses, opts)).values()
    );
    const whirlpoolAddrs = positions
      .map((position) => position?.whirlpool.toBase58())
      .flatMap((x) => (!!x ? x : []));
    await this.ctx.fetcher.getPools(whirlpoolAddrs, opts);
    const tickArrayAddresses: Set<string> = new Set();
    await Promise.all(
      positions.map(async (pos) => {
        if (pos) {
          const pool = await this.ctx.fetcher.getPool(pos.whirlpool, PREFER_CACHE);
          if (pool) {
            const lowerTickArrayPda = PDAUtil.getTickArrayFromTickIndex(
              pos.tickLowerIndex,
              pool.tickSpacing,
              pos.whirlpool,
              this.ctx.program.programId
            ).publicKey;
            const upperTickArrayPda = PDAUtil.getTickArrayFromTickIndex(
              pos.tickUpperIndex,
              pool.tickSpacing,
              pos.whirlpool,
              this.ctx.program.programId
            ).publicKey;
            tickArrayAddresses.add(lowerTickArrayPda.toBase58());
            tickArrayAddresses.add(upperTickArrayPda.toBase58());
          }
        }
      })
    );
    await this.ctx.fetcher.getTickArrays(Array.from(tickArrayAddresses), IGNORE_CACHE);

    // Use getPosition and the prefetched values to generate the Positions
    const results = await Promise.all(
      positionAddresses.map(async (pos) => {
        try {
          const position = await this.getPosition(pos, PREFER_CACHE);
          return [pos, position];
        } catch {
          return [pos, null];
        }
      })
    );
    return Object.fromEntries(results);
  }

  public async createPool(
    whirlpoolsConfig: Address,
    tokenMintA: Address,
    tokenMintB: Address,
    tickSpacing: number,
    initialTick: number,
    funder: Address,
    opts = PREFER_CACHE
  ): Promise<{ poolKey: PublicKey; tx: TransactionBuilder }> {
    invariant(TickUtil.checkTickInBounds(initialTick), "initialTick is out of bounds.");
    invariant(
      TickUtil.isTickInitializable(initialTick, tickSpacing),
      `initial tick ${initialTick} is not an initializable tick for tick-spacing ${tickSpacing}`
    );

    const correctTokenOrder = PoolUtil.orderMints(tokenMintA, tokenMintB).map((addr) =>
      addr.toString()
    );

    invariant(
      correctTokenOrder[0] === tokenMintA.toString(),
      "Token order needs to be flipped to match the canonical ordering (i.e. sorted on the byte repr. of the mint pubkeys)"
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
      new PublicKey(tokenMintA),
      new PublicKey(tokenMintB),
      tickSpacing
    );

    const feeTier = await this.ctx.fetcher.getFeeTier(feeTierKey, opts);
    invariant(!!feeTier, `Fee tier for ${tickSpacing} doesn't exist`);

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts
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
      poolKey: whirlpoolPda.publicKey,
      tx: txBuilder,
    };
  }

  public async collectFeesAndRewardsForPositions(
    positionAddresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<TransactionBuilder[]> {
    const walletKey = this.ctx.wallet.publicKey;
    return collectAllForPositionAddressesTxns(
      this.ctx,
      {
        positions: positionAddresses,
        receiver: walletKey,
        positionAuthority: walletKey,
        positionOwner: walletKey,
        payer: walletKey,
      },
      opts
    );
  }

  public async collectProtocolFeesForPools(poolAddresses: Address[]): Promise<TransactionBuilder> {
    return collectProtocolFees(this.ctx, poolAddresses);
  }
}
