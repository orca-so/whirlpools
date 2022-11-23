import {
  AddressUtil,
  deriveATA,
  Percentage,
  resolveOrCreateATAs,
  TokenUtil,
  TransactionBuilder,
  ZERO,
} from "@orca-so/common-sdk";
import { Address, BN, translateAddress } from "@project-serum/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";
import { WhirlpoolContext } from "../context";
import {
  closePositionIx,
  decreaseLiquidityIx,
  DevFeeSwapInput,
  IncreaseLiquidityInput,
  increaseLiquidityIx,
  initTickArrayIx,
  openPositionIx,
  openPositionWithMetadataIx,
  SwapInput,
  swapIx,
  updateFeesAndRewardsIx,
} from "../instructions";
import {
  collectFeesQuote,
  collectRewardsQuote,
  decreaseLiquidityQuoteByLiquidityWithParams,
} from "../quotes/public";
import { TokenAccountInfo, TokenInfo, WhirlpoolData, WhirlpoolRewardInfo } from "../types/public";
import { PDAUtil, TickArrayUtil, TickUtil } from "../utils/public";
import { getTokenMintsFromWhirlpools, resolveAtaForMints } from "../utils/whirlpool-ata-utils";
import { Whirlpool } from "../whirlpool-client";
import { PositionImpl } from "./position-impl";
import { getRewardInfos, getTokenVaultAccountInfos } from "./util";

export class WhirlpoolImpl implements Whirlpool {
  private data: WhirlpoolData;
  constructor(
    readonly ctx: WhirlpoolContext,
    readonly address: PublicKey,
    readonly tokenAInfo: TokenInfo,
    readonly tokenBInfo: TokenInfo,
    private tokenVaultAInfo: TokenAccountInfo,
    private tokenVaultBInfo: TokenAccountInfo,
    private rewardInfos: WhirlpoolRewardInfo[],
    data: WhirlpoolData
  ) {
    this.data = data;
  }

  getAddress(): PublicKey {
    return this.address;
  }

  getData(): WhirlpoolData {
    return this.data;
  }

  getTokenAInfo(): TokenInfo {
    return this.tokenAInfo;
  }

  getTokenBInfo(): TokenInfo {
    return this.tokenBInfo;
  }

  getTokenVaultAInfo(): TokenAccountInfo {
    return this.tokenVaultAInfo;
  }

  getTokenVaultBInfo(): TokenAccountInfo {
    return this.tokenVaultBInfo;
  }

  getRewardInfos(): WhirlpoolRewardInfo[] {
    return this.rewardInfos;
  }

  async refreshData() {
    await this.refresh();
    return this.data;
  }

  async openPosition(
    tickLower: number,
    tickUpper: number,
    liquidityInput: IncreaseLiquidityInput,
    wallet?: Address,
    funder?: Address
  ) {
    await this.refresh();
    return this.getOpenPositionWithOptMetadataTx(
      tickLower,
      tickUpper,
      liquidityInput,
      !!wallet ? AddressUtil.toPubKey(wallet) : this.ctx.wallet.publicKey,
      !!funder ? AddressUtil.toPubKey(funder) : this.ctx.wallet.publicKey
    );
  }

  async openPositionWithMetadata(
    tickLower: number,
    tickUpper: number,
    liquidityInput: IncreaseLiquidityInput,
    sourceWallet?: Address,
    positionWallet?: Address,
    funder?: Address
  ) {
    await this.refresh();
    return this.getOpenPositionWithOptMetadataTx(
      tickLower,
      tickUpper,
      liquidityInput,
      !!sourceWallet ? AddressUtil.toPubKey(sourceWallet) : this.ctx.wallet.publicKey,
      !!funder ? AddressUtil.toPubKey(funder) : this.ctx.wallet.publicKey,
      true
    );
  }

  async initTickArrayForTicks(ticks: number[], funder?: Address, refresh = true) {
    const initTickArrayStartPdas = await TickArrayUtil.getUninitializedArraysPDAs(
      ticks,
      this.ctx.program.programId,
      this.address,
      this.data.tickSpacing,
      this.ctx.fetcher,
      refresh
    );

    if (!initTickArrayStartPdas.length) {
      return null;
    }

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet
    );
    initTickArrayStartPdas.forEach((initTickArrayInfo) => {
      txBuilder.addInstruction(
        initTickArrayIx(this.ctx.program, {
          startTick: initTickArrayInfo.startIndex,
          tickArrayPda: initTickArrayInfo.pda,
          whirlpool: this.address,
          funder: !!funder ? AddressUtil.toPubKey(funder) : this.ctx.provider.wallet.publicKey,
        })
      );
    });
    return txBuilder;
  }

  async closePosition(
    positionAddress: Address,
    slippageTolerance: Percentage,
    destinationWallet?: Address,
    positionWallet?: Address,
    payer?: Address
  ) {
    await this.refresh();
    const positionWalletKey = positionWallet
      ? AddressUtil.toPubKey(positionWallet)
      : this.ctx.wallet.publicKey;
    const destinationWalletKey = destinationWallet
      ? AddressUtil.toPubKey(destinationWallet)
      : this.ctx.wallet.publicKey;
    const payerKey = payer ? AddressUtil.toPubKey(payer) : this.ctx.wallet.publicKey;
    return this.getClosePositionIx(
      AddressUtil.toPubKey(positionAddress),
      slippageTolerance,
      destinationWalletKey,
      positionWalletKey,
      payerKey
    );
  }

  async swap(quote: SwapInput, sourceWallet?: Address) {
    const sourceWalletKey = sourceWallet
      ? AddressUtil.toPubKey(sourceWallet)
      : this.ctx.wallet.publicKey;
    return this.getSwapTx(quote, sourceWalletKey);
  }

  async swapWithDevFees(
    quote: DevFeeSwapInput,
    devFeeWallet: PublicKey,
    wallet?: PublicKey | undefined,
    payer?: PublicKey | undefined
  ): Promise<TransactionBuilder> {
    const sourceWalletKey = wallet ? AddressUtil.toPubKey(wallet) : this.ctx.wallet.publicKey;
    const payerKey = payer ? AddressUtil.toPubKey(payer) : this.ctx.wallet.publicKey;
    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet
    );

    if (!quote.devFeeAmount.eq(ZERO)) {
      const inputToken =
        quote.aToB === quote.amountSpecifiedIsInput ? this.getTokenAInfo() : this.getTokenBInfo();

      txBuilder.addInstruction(
        await TokenUtil.createSendTokensToWalletInstruction(
          this.ctx.connection,
          sourceWalletKey,
          devFeeWallet,
          inputToken.mint,
          inputToken.decimals,
          quote.devFeeAmount,
          () => this.ctx.fetcher.getAccountRentExempt(),
          payerKey
        )
      );
    }

    return this.getSwapTx(quote, sourceWalletKey, txBuilder);
  }

  /**
   * Construct a transaction for opening an new position with optional metadata
   */
  async getOpenPositionWithOptMetadataTx(
    tickLower: number,
    tickUpper: number,
    liquidityInput: IncreaseLiquidityInput,
    wallet: PublicKey,
    funder: PublicKey,
    withMetadata: boolean = false
  ): Promise<{ positionMint: PublicKey; tx: TransactionBuilder }> {
    invariant(TickUtil.checkTickInBounds(tickLower), "tickLower is out of bounds.");
    invariant(TickUtil.checkTickInBounds(tickUpper), "tickUpper is out of bounds.");

    const { liquidityAmount: liquidity, tokenMaxA, tokenMaxB } = liquidityInput;

    invariant(liquidity.gt(new BN(0)), "liquidity must be greater than zero");

    const whirlpool = await this.ctx.fetcher.getPool(this.address, false);
    if (!whirlpool) {
      throw new Error(`Whirlpool not found: ${translateAddress(this.address).toBase58()}`);
    }

    invariant(
      TickUtil.isTickInitializable(tickLower, whirlpool.tickSpacing),
      `lower tick ${tickLower} is not an initializable tick for tick-spacing ${whirlpool.tickSpacing}`
    );
    invariant(
      TickUtil.isTickInitializable(tickUpper, whirlpool.tickSpacing),
      `upper tick ${tickUpper} is not an initializable tick for tick-spacing ${whirlpool.tickSpacing}`
    );

    const positionMintKeypair = Keypair.generate();
    const positionPda = PDAUtil.getPosition(
      this.ctx.program.programId,
      positionMintKeypair.publicKey
    );
    const metadataPda = PDAUtil.getPositionMetadata(positionMintKeypair.publicKey);
    const positionTokenAccountAddress = await deriveATA(wallet, positionMintKeypair.publicKey);

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet
    );

    const positionIx = (withMetadata ? openPositionWithMetadataIx : openPositionIx)(
      this.ctx.program,
      {
        funder,
        owner: wallet,
        positionPda,
        metadataPda,
        positionMintAddress: positionMintKeypair.publicKey,
        positionTokenAccount: positionTokenAccountAddress,
        whirlpool: this.address,
        tickLowerIndex: tickLower,
        tickUpperIndex: tickUpper,
      }
    );
    txBuilder.addInstruction(positionIx).addSigner(positionMintKeypair);

    const [ataA, ataB] = await resolveOrCreateATAs(
      this.ctx.connection,
      wallet,
      [
        { tokenMint: whirlpool.tokenMintA, wrappedSolAmountIn: tokenMaxA },
        { tokenMint: whirlpool.tokenMintB, wrappedSolAmountIn: tokenMaxB },
      ],
      () => this.ctx.fetcher.getAccountRentExempt(),
      funder
    );
    const { address: tokenOwnerAccountA, ...tokenOwnerAccountAIx } = ataA;
    const { address: tokenOwnerAccountB, ...tokenOwnerAccountBIx } = ataB;

    txBuilder.addInstruction(tokenOwnerAccountAIx);
    txBuilder.addInstruction(tokenOwnerAccountBIx);

    const tickArrayLowerPda = PDAUtil.getTickArrayFromTickIndex(
      tickLower,
      this.data.tickSpacing,
      this.address,
      this.ctx.program.programId
    );
    const tickArrayUpperPda = PDAUtil.getTickArrayFromTickIndex(
      tickUpper,
      this.data.tickSpacing,
      this.address,
      this.ctx.program.programId
    );

    const liquidityIx = increaseLiquidityIx(this.ctx.program, {
      liquidityAmount: liquidity,
      tokenMaxA,
      tokenMaxB,
      whirlpool: this.address,
      positionAuthority: wallet,
      position: positionPda.publicKey,
      positionTokenAccount: positionTokenAccountAddress,
      tokenOwnerAccountA,
      tokenOwnerAccountB,
      tokenVaultA: whirlpool.tokenVaultA,
      tokenVaultB: whirlpool.tokenVaultB,
      tickArrayLower: tickArrayLowerPda.publicKey,
      tickArrayUpper: tickArrayUpperPda.publicKey,
    });
    txBuilder.addInstruction(liquidityIx);

    return {
      positionMint: positionMintKeypair.publicKey,
      tx: txBuilder,
    };
  }

  async getClosePositionIx(
    positionAddress: PublicKey,
    slippageTolerance: Percentage,
    destinationWallet: PublicKey,
    positionWallet: PublicKey,
    payerKey: PublicKey
  ): Promise<{ ataTx: TransactionBuilder; closeTx: TransactionBuilder }> {
    const position = await this.ctx.fetcher.getPosition(positionAddress, true);
    if (!position) {
      throw new Error(`Position not found: ${positionAddress.toBase58()}`);
    }

    const whirlpool = this.data;

    invariant(
      position.whirlpool.equals(this.address),
      `Position ${positionAddress.toBase58()} is not a position for Whirlpool ${this.address.toBase58()}`
    );

    const positionTokenAccount = await deriveATA(positionWallet, position.positionMint);

    const ataTxBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet
    );

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet
    );

    const tickArrayLower = PDAUtil.getTickArrayFromTickIndex(
      position.tickLowerIndex,
      whirlpool.tickSpacing,
      position.whirlpool,
      this.ctx.program.programId
    ).publicKey;

    const tickArrayUpper = PDAUtil.getTickArrayFromTickIndex(
      position.tickUpperIndex,
      whirlpool.tickSpacing,
      position.whirlpool,
      this.ctx.program.programId
    ).publicKey;

    const affiliatedMints = getTokenMintsFromWhirlpools([whirlpool]);
    const accountExemption = await this.ctx.fetcher.getAccountRentExempt();
    const { ataTokenAddresses, resolveAtaIxs } = await resolveAtaForMints(this.ctx, {
      mints: affiliatedMints,
      accountExemption,
      receiver: destinationWallet,
      payer: payerKey,
    });

    ataTxBuilder.addInstructions(resolveAtaIxs);

    const tickArrayLowerData = await this.ctx.fetcher.getTickArray(tickArrayLower, true);
    const tickArrayUpperData = await this.ctx.fetcher.getTickArray(
      tickArrayUpper,
      !tickArrayUpper.equals(tickArrayLower)
    );

    invariant(
      !!tickArrayLowerData,
      `Tick array ${tickArrayLower} expected to be initialized for whirlpool ${this.address}`
    );

    invariant(
      !!tickArrayUpperData,
      `Tick array ${tickArrayUpper} expected to be initialized for whirlpool ${this.address}`
    );

    const tickLower = TickArrayUtil.getTickFromArray(
      tickArrayLowerData,
      position.tickLowerIndex,
      whirlpool.tickSpacing
    );

    const tickUpper = TickArrayUtil.getTickFromArray(
      tickArrayUpperData,
      position.tickUpperIndex,
      whirlpool.tickSpacing
    );

    const feesQuote = collectFeesQuote({
      position,
      whirlpool,
      tickLower,
      tickUpper,
    });

    const rewardsQuote = collectRewardsQuote({
      position,
      whirlpool,
      tickLower,
      tickUpper,
    });

    const shouldCollectFees = feesQuote.feeOwedA.gtn(0) || feesQuote.feeOwedB.gtn(0);
    invariant(
      this.data.rewardInfos.length === rewardsQuote.length,
      "Rewards quote does not match reward infos length"
    );

    const rewardsToCollect = this.data.rewardInfos
      .filter((_, i) => (rewardsQuote[i] ?? ZERO).gtn(0))
      .map((info) => info.mint);

    const shouldCollectRewards = rewardsToCollect.length > 0;

    const positionImpl = new PositionImpl(this.ctx, positionAddress, position);

    if (position.liquidity.gtn(0)) {
      /* Remove all liquidity remaining in the position */
      const tokenOwnerAccountA = ataTokenAddresses[whirlpool.tokenMintA.toBase58()];
      const tokenOwnerAccountB = ataTokenAddresses[whirlpool.tokenMintB.toBase58()];

      const decreaseLiqQuote = decreaseLiquidityQuoteByLiquidityWithParams({
        liquidity: position.liquidity,
        slippageTolerance,
        sqrtPrice: whirlpool.sqrtPrice,
        tickCurrentIndex: whirlpool.tickCurrentIndex,
        tickLowerIndex: position.tickLowerIndex,
        tickUpperIndex: position.tickUpperIndex,
      });

      const liquidityIx = decreaseLiquidityIx(this.ctx.program, {
        liquidityAmount: decreaseLiqQuote.liquidityAmount,
        tokenMinA: decreaseLiqQuote.tokenMinA,
        tokenMinB: decreaseLiqQuote.tokenMinB,
        whirlpool: position.whirlpool,
        positionAuthority: positionWallet,
        position: positionAddress,
        positionTokenAccount,
        tokenOwnerAccountA,
        tokenOwnerAccountB,
        tokenVaultA: whirlpool.tokenVaultA,
        tokenVaultB: whirlpool.tokenVaultB,
        tickArrayLower,
        tickArrayUpper,
      });

      txBuilder.addInstruction(liquidityIx);
    } else {
      if (shouldCollectFees || shouldCollectRewards) {
        // We need to manually udpate the fees/rewards since there is not liquidity IX to do so
        txBuilder.addInstruction(
          updateFeesAndRewardsIx(this.ctx.program, {
            whirlpool: position.whirlpool,
            position: positionAddress,
            tickArrayLower,
            tickArrayUpper,
          })
        );
      }
    }

    if (shouldCollectFees) {
      const collectFeexTx = await positionImpl.collectFees(
        false, // false because we already create Token A and B ATAs as part of close position
        false,
        destinationWallet,
        positionWallet,
        payerKey
      );

      txBuilder.addInstruction(collectFeexTx.compressIx(false));
    }

    if (rewardsToCollect.length > 0) {
      const collectRewardsTx = await positionImpl.collectRewards(
        false,
        false,
        destinationWallet,
        positionWallet,
        payerKey,
        rewardsToCollect
      );

      txBuilder.addInstruction(collectRewardsTx.compressIx(false));
    }

    /* Close position */
    const positionIx = closePositionIx(this.ctx.program, {
      positionAuthority: positionWallet,
      receiver: destinationWallet,
      positionTokenAccount,
      position: positionAddress,
      positionMint: position.positionMint,
    });

    txBuilder.addInstruction(positionIx);

    return {
      ataTx: ataTxBuilder,
      closeTx: txBuilder,
    };
  }

  private async getSwapTx(
    input: SwapInput,
    wallet: PublicKey,
    initTxBuilder?: TransactionBuilder
  ): Promise<TransactionBuilder> {
    invariant(input.amount.gt(ZERO), "swap amount must be more than zero.");

    // Check if all the tick arrays have been initialized.
    const tickArrayAddresses = [input.tickArray0, input.tickArray1, input.tickArray2];
    const tickArrays = await this.ctx.fetcher.listTickArrays(tickArrayAddresses, true);
    const uninitializedIndices = TickArrayUtil.getUninitializedArrays(tickArrays);
    if (uninitializedIndices.length > 0) {
      const uninitializedArrays = uninitializedIndices
        .map((index) => tickArrayAddresses[index].toBase58())
        .join(", ");
      throw new Error(`TickArray addresses - [${uninitializedArrays}] need to be initialized.`);
    }

    const { amount, aToB } = input;
    const whirlpool = this.data;
    const txBuilder =
      initTxBuilder ??
      new TransactionBuilder(this.ctx.provider.connection, this.ctx.provider.wallet);

    const [ataA, ataB] = await resolveOrCreateATAs(
      this.ctx.connection,
      wallet,
      [
        { tokenMint: whirlpool.tokenMintA, wrappedSolAmountIn: aToB ? amount : ZERO },
        { tokenMint: whirlpool.tokenMintB, wrappedSolAmountIn: !aToB ? amount : ZERO },
      ],
      () => this.ctx.fetcher.getAccountRentExempt()
    );

    const { address: tokenOwnerAccountA, ...tokenOwnerAccountAIx } = ataA;
    const { address: tokenOwnerAccountB, ...tokenOwnerAccountBIx } = ataB;

    txBuilder.addInstruction(tokenOwnerAccountAIx);
    txBuilder.addInstruction(tokenOwnerAccountBIx);

    const oraclePda = PDAUtil.getOracle(this.ctx.program.programId, this.address);

    txBuilder.addInstruction(
      swapIx(this.ctx.program, {
        ...input,
        whirlpool: this.address,
        tokenAuthority: wallet,
        tokenOwnerAccountA,
        tokenVaultA: whirlpool.tokenVaultA,
        tokenOwnerAccountB,
        tokenVaultB: whirlpool.tokenVaultB,
        oracle: oraclePda.publicKey,
      })
    );

    return txBuilder;
  }

  private async refresh() {
    const account = await this.ctx.fetcher.getPool(this.address, true);
    if (!!account) {
      const rewardInfos = await getRewardInfos(this.ctx.fetcher, account, true);
      const [tokenVaultAInfo, tokenVaultBInfo] = await getTokenVaultAccountInfos(
        this.ctx.fetcher,
        account,
        true
      );
      this.data = account;
      this.tokenVaultAInfo = tokenVaultAInfo;
      this.tokenVaultBInfo = tokenVaultBInfo;
      this.rewardInfos = rewardInfos;
    }
  }
}
