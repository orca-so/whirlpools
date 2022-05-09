import { AddressUtil, deriveATA, TransactionBuilder } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import { WhirlpoolContext } from "../context";
import {
  IncreaseLiquidityInput,
  DecreaseLiquidityInput,
  increaseLiquidityIx,
  decreaseLiquidityIx,
} from "../instructions";
import { PositionData } from "../types/public";
import { Position } from "../whirlpool-client";
import { PublicKey, Signer } from "@solana/web3.js";
import { AccountFetcher } from "../network/public";
import { PDAUtil, TickUtil } from "../utils/public";
import { toTx } from "../utils/instructions-util";

export class PositionImpl implements Position {
  private data: PositionData;
  constructor(
    readonly ctx: WhirlpoolContext,
    readonly fetcher: AccountFetcher,
    readonly address: PublicKey,
    data: PositionData
  ) {
    this.data = data;
  }

  getData(): PositionData {
    return this.data;
  }

  async refreshData() {
    await this.refresh();
    return this.data;
  }

  async increaseLiquidity(
    liquidityInput: IncreaseLiquidityInput,
    sourceWallet?: Address,
    positionWallet?: Address
  ) {
    const sourceWalletKey = sourceWallet
      ? AddressUtil.toPubKey(sourceWallet)
      : this.ctx.wallet.publicKey;
    const positionWalletKey = positionWallet
      ? AddressUtil.toPubKey(positionWallet)
      : this.ctx.wallet.publicKey;

    const whirlpool = await this.fetcher.getPool(this.data.whirlpool, true);
    if (!whirlpool) {
      throw new Error("Unable to fetch whirlpool for this position.");
    }

    return toTx(
      this.ctx,
      increaseLiquidityIx(this.ctx.program, {
        ...liquidityInput,
        whirlpool: this.data.whirlpool,
        position: this.address,
        positionTokenAccount: await deriveATA(positionWalletKey, this.data.positionMint),
        tokenOwnerAccountA: await deriveATA(sourceWalletKey, whirlpool.tokenMintA),
        tokenOwnerAccountB: await deriveATA(sourceWalletKey, whirlpool.tokenMintB),
        tokenVaultA: whirlpool.tokenVaultA,
        tokenVaultB: whirlpool.tokenVaultB,
        tickArrayLower: PDAUtil.getTickArray(
          this.ctx.program.programId,
          this.data.whirlpool,
          TickUtil.getStartTickIndex(this.data.tickLowerIndex, whirlpool.tickSpacing)
        ).publicKey,
        tickArrayUpper: PDAUtil.getTickArray(
          this.ctx.program.programId,
          this.data.whirlpool,
          TickUtil.getStartTickIndex(this.data.tickUpperIndex, whirlpool.tickSpacing)
        ).publicKey,
        positionAuthority: positionWalletKey,
      })
    );
  }

  async decreaseLiquidity(
    liquidityInput: DecreaseLiquidityInput,
    sourceWallet?: Address,
    positionWallet?: Address
  ) {
    const sourceWalletKey = sourceWallet
      ? AddressUtil.toPubKey(sourceWallet)
      : this.ctx.wallet.publicKey;
    const positionWalletKey = positionWallet
      ? AddressUtil.toPubKey(positionWallet)
      : this.ctx.wallet.publicKey;
    const whirlpool = await this.fetcher.getPool(this.data.whirlpool, true);

    if (!whirlpool) {
      throw new Error("Unable to fetch whirlpool for this position.");
    }

    return toTx(
      this.ctx,
      decreaseLiquidityIx(this.ctx.program, {
        ...liquidityInput,
        whirlpool: this.data.whirlpool,
        position: this.address,
        positionTokenAccount: await deriveATA(positionWalletKey, this.data.positionMint),
        tokenOwnerAccountA: await deriveATA(sourceWalletKey, whirlpool.tokenMintA),
        tokenOwnerAccountB: await deriveATA(sourceWalletKey, whirlpool.tokenMintB),
        tokenVaultA: whirlpool.tokenVaultA,
        tokenVaultB: whirlpool.tokenVaultB,
        tickArrayLower: PDAUtil.getTickArray(
          this.ctx.program.programId,
          this.data.whirlpool,
          TickUtil.getStartTickIndex(this.data.tickLowerIndex, whirlpool.tickSpacing)
        ).publicKey,
        tickArrayUpper: PDAUtil.getTickArray(
          this.ctx.program.programId,
          this.data.whirlpool,
          TickUtil.getStartTickIndex(this.data.tickUpperIndex, whirlpool.tickSpacing)
        ).publicKey,
        positionAuthority: positionWalletKey,
      })
    );
  }

  private async refresh() {
    const account = await this.fetcher.getPosition(this.address, true);
    if (!!account) {
      this.data = account;
    }
  }
}
