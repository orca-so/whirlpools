import {
  AddressUtil,
  deriveATA,
  resolveOrCreateATAs,
  TransactionBuilder,
} from "@orca-so/common-sdk";
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
import { PublicKey } from "@solana/web3.js";
import { AccountFetcher } from "../network/public";
import { PDAUtil, TickUtil, toTx } from "../utils/public";

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

    const txBuilder = new TransactionBuilder(this.ctx.provider);
    const [ataA, ataB] = await resolveOrCreateATAs(
      this.ctx.connection,
      sourceWalletKey,
      [
        { tokenMint: whirlpool.tokenMintA, wrappedSolAmountIn: liquidityInput.tokenMaxA },
        { tokenMint: whirlpool.tokenMintB, wrappedSolAmountIn: liquidityInput.tokenMaxB },
      ],
      () => this.fetcher.getAccountRentExempt()
    );
    const { address: tokenOwnerAccountA, ...tokenOwnerAccountAIx } = ataA!;
    const { address: tokenOwnerAccountB, ...tokenOwnerAccountBIx } = ataB!;
    txBuilder.addInstruction(tokenOwnerAccountAIx);
    txBuilder.addInstruction(tokenOwnerAccountBIx);

    const increaseIx = increaseLiquidityIx(this.ctx.program, {
      ...liquidityInput,
      whirlpool: this.data.whirlpool,
      position: this.address,
      positionTokenAccount: await deriveATA(positionWalletKey, this.data.positionMint),
      tokenOwnerAccountA,
      tokenOwnerAccountB,
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
    });
    txBuilder.addInstruction(increaseIx);
    return txBuilder;
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

    const txBuilder = new TransactionBuilder(this.ctx.provider);
    const [ataA, ataB] = await resolveOrCreateATAs(
      this.ctx.connection,
      sourceWalletKey,
      [{ tokenMint: whirlpool.tokenMintA }, { tokenMint: whirlpool.tokenMintB }],
      () => this.fetcher.getAccountRentExempt()
    );
    const { address: tokenOwnerAccountA, ...tokenOwnerAccountAIx } = ataA!;
    const { address: tokenOwnerAccountB, ...tokenOwnerAccountBIx } = ataB!;
    txBuilder.addInstruction(tokenOwnerAccountAIx);
    txBuilder.addInstruction(tokenOwnerAccountBIx);

    const decreaseIx = decreaseLiquidityIx(this.ctx.program, {
      ...liquidityInput,
      whirlpool: this.data.whirlpool,
      position: this.address,
      positionTokenAccount: await deriveATA(positionWalletKey, this.data.positionMint),
      tokenOwnerAccountA,
      tokenOwnerAccountB,
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
    });
    txBuilder.addInstruction(decreaseIx);
    return txBuilder;
  }

  private async refresh() {
    const account = await this.fetcher.getPosition(this.address, true);
    if (!!account) {
      this.data = account;
    }
  }
}
