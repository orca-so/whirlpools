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
  collectFeesIx,
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

  getAddress(): PublicKey {
    return this.address;
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
    resolveATA = true,
    sourceWallet?: Address,
    positionWallet?: Address,
    ataPayer?: Address
  ) {
    const sourceWalletKey = sourceWallet
      ? AddressUtil.toPubKey(sourceWallet)
      : this.ctx.wallet.publicKey;
    const positionWalletKey = positionWallet
      ? AddressUtil.toPubKey(positionWallet)
      : this.ctx.wallet.publicKey;
    const ataPayerKey = ataPayer ? AddressUtil.toPubKey(ataPayer) : this.ctx.wallet.publicKey;

    const whirlpool = await this.fetcher.getPool(this.data.whirlpool, true);
    if (!whirlpool) {
      throw new Error("Unable to fetch whirlpool for this position.");
    }

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet
    );

    let tokenOwnerAccountA: PublicKey;
    let tokenOwnerAccountB: PublicKey;

    if (resolveATA) {
      const [ataA, ataB] = await resolveOrCreateATAs(
        this.ctx.connection,
        sourceWalletKey,
        [
          { tokenMint: whirlpool.tokenMintA, wrappedSolAmountIn: liquidityInput.tokenMaxA },
          { tokenMint: whirlpool.tokenMintB, wrappedSolAmountIn: liquidityInput.tokenMaxB },
        ],
        () => this.fetcher.getAccountRentExempt(),
        ataPayerKey
      );
      const { address: ataAddrA, ...tokenOwnerAccountAIx } = ataA!;
      const { address: ataAddrB, ...tokenOwnerAccountBIx } = ataB!;
      tokenOwnerAccountA = ataAddrA;
      tokenOwnerAccountB = ataAddrB;
      txBuilder.addInstruction(tokenOwnerAccountAIx);
      txBuilder.addInstruction(tokenOwnerAccountBIx);
    } else {
      tokenOwnerAccountA = await deriveATA(sourceWalletKey, whirlpool.tokenMintA);
      tokenOwnerAccountB = await deriveATA(sourceWalletKey, whirlpool.tokenMintB);
    }
    const positionTokenAccount = await deriveATA(positionWalletKey, this.data.positionMint);

    const increaseIx = increaseLiquidityIx(this.ctx.program, {
      ...liquidityInput,
      whirlpool: this.data.whirlpool,
      position: this.address,
      positionTokenAccount,
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
    resolveATA = true,
    sourceWallet?: Address,
    positionWallet?: Address,
    ataPayer?: Address
  ) {
    const sourceWalletKey = sourceWallet
      ? AddressUtil.toPubKey(sourceWallet)
      : this.ctx.wallet.publicKey;
    const positionWalletKey = positionWallet
      ? AddressUtil.toPubKey(positionWallet)
      : this.ctx.wallet.publicKey;
    const ataPayerKey = ataPayer ? AddressUtil.toPubKey(ataPayer) : this.ctx.wallet.publicKey;
    const whirlpool = await this.fetcher.getPool(this.data.whirlpool, true);

    if (!whirlpool) {
      throw new Error("Unable to fetch whirlpool for this position.");
    }

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet
    );
    let tokenOwnerAccountA: PublicKey;
    let tokenOwnerAccountB: PublicKey;

    if (resolveATA) {
      const [ataA, ataB] = await resolveOrCreateATAs(
        this.ctx.connection,
        sourceWalletKey,
        [{ tokenMint: whirlpool.tokenMintA }, { tokenMint: whirlpool.tokenMintB }],
        () => this.fetcher.getAccountRentExempt(),
        ataPayerKey
      );
      const { address: ataAddrA, ...tokenOwnerAccountAIx } = ataA!;
      const { address: ataAddrB, ...tokenOwnerAccountBIx } = ataB!;
      tokenOwnerAccountA = ataAddrA;
      tokenOwnerAccountB = ataAddrB;
      txBuilder.addInstruction(tokenOwnerAccountAIx);
      txBuilder.addInstruction(tokenOwnerAccountBIx);
    } else {
      tokenOwnerAccountA = await deriveATA(sourceWalletKey, whirlpool.tokenMintA);
      tokenOwnerAccountB = await deriveATA(sourceWalletKey, whirlpool.tokenMintB);
    }

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

  async collectFees(
    resolveATA: boolean = true,
    destinationWallet?: Address,
    positionWallet?: Address,
    ataPayer?: Address
  ): Promise<TransactionBuilder> {
    const [destinationWalletKey, positionWalletKey, ataPayerKey] = AddressUtil.toPubKeys([
      destinationWallet ?? this.ctx.wallet.publicKey,
      positionWallet ?? this.ctx.wallet.publicKey,
      ataPayer ?? this.ctx.wallet.publicKey,
    ]);

    const whirlpool = await this.fetcher.getPool(this.data.whirlpool, true);
    if (!whirlpool) {
      throw new Error("Unable to fetch whirlpool for this position.");
    }

    // Question @meep: Can either fee_owed_a or fee_owed_b be 0 while the other is non-zero?
    //                 If so, will the collect_fees IX fail since it just blindly calls a token transfer CPI?

    // TODO(atamari): Resolve the following questions:
    // 1. Question mentioned above
    // 2. Question asked on discord re: stale on-chain values of fee_owed_a and fee_owed_b preventing valid fee collection

    let tokenOwnerAccountA: PublicKey;
    let tokenOwnerAccountB: PublicKey;

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet
    );

    if (resolveATA) {
      const [ataA, ataB] = await resolveOrCreateATAs(
        this.ctx.connection,
        destinationWalletKey,
        [{ tokenMint: whirlpool.tokenMintA }, { tokenMint: whirlpool.tokenMintB }],
        () => this.fetcher.getAccountRentExempt(),
        ataPayerKey
      );
      const { address: ataAddrA, ...tokenOwnerAccountAIx } = ataA!;
      const { address: ataAddrB, ...tokenOwnerAccountBIx } = ataB!;
      tokenOwnerAccountA = ataAddrA;
      tokenOwnerAccountB = ataAddrB;
      txBuilder.addInstruction(tokenOwnerAccountAIx);
      txBuilder.addInstruction(tokenOwnerAccountBIx);
    } else {
      tokenOwnerAccountA = await deriveATA(destinationWalletKey, whirlpool.tokenMintA);
      tokenOwnerAccountB = await deriveATA(destinationWalletKey, whirlpool.tokenMintB);
    }

    const positionTokenAccount = await deriveATA(positionWalletKey, this.data.positionMint);

    const ix = collectFeesIx(this.ctx.program, {
      whirlpool: this.data.whirlpool,
      position: this.address,
      positionTokenAccount,
      tokenOwnerAccountA,
      tokenOwnerAccountB,
      tokenVaultA: whirlpool.tokenVaultA,
      tokenVaultB: whirlpool.tokenVaultB,
      positionAuthority: positionWalletKey,
    });

    txBuilder.addInstruction(ix);

    return txBuilder;
  }

  private async refresh() {
    const account = await this.fetcher.getPosition(this.address, true);
    if (!!account) {
      this.data = account;
    }
  }
}
