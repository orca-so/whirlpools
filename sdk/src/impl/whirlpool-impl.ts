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
  IncreaseLiquidityInput,
  increaseLiquidityIx,
  initTickArrayIx,
  openPositionIx,
  openPositionWithMetadataIx,
  SwapInput,
  swapIx,
} from "../instructions";
import { AccountFetcher } from "../network/public";
import { decreaseLiquidityQuoteByLiquidityWithParams, SwapQuote } from "../quotes/public";
import { DevFeeSwapQuote } from "../quotes/public/dev-fee-swap-quote";
import { TokenAccountInfo, TokenInfo, WhirlpoolData, WhirlpoolRewardInfo } from "../types/public";
import { PDAUtil, TickArrayUtil, TickUtil } from "../utils/public";
import { Whirlpool } from "../whirlpool-client";
import { getRewardInfos, getTokenVaultAccountInfos } from "./util";

export class WhirlpoolImpl implements Whirlpool {
  private data: WhirlpoolData;
  constructor(
    readonly ctx: WhirlpoolContext,
    readonly fetcher: AccountFetcher,
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
      this.fetcher,
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

  async swap(quote: SwapQuote, sourceWallet?: Address) {
    const sourceWalletKey = sourceWallet
      ? AddressUtil.toPubKey(sourceWallet)
      : this.ctx.wallet.publicKey;
    return this.getSwapTx(quote, sourceWalletKey);
  }

  async swapWithDevFees(
    quote: DevFeeSwapQuote,
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
          this.ctx.fetcher.getAccountRentExempt,
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

    const whirlpool = await this.fetcher.getPool(this.address, false);
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
      () => this.fetcher.getAccountRentExempt(),
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
  ): Promise<TransactionBuilder> {
    const position = await this.fetcher.getPosition(positionAddress, true);
    if (!position) {
      throw new Error(`Position not found: ${positionAddress.toBase58()}`);
    }
    const whirlpool = this.data;

    invariant(
      position.whirlpool.equals(this.address),
      `Position ${positionAddress.toBase58()} is not a position for Whirlpool ${this.address.toBase58()}`
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

    const positionTokenAccount = await deriveATA(positionWallet, position.positionMint);

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet
    );

    const resolvedAssociatedTokenAddresses: Record<string, PublicKey> = {};
    const [ataA, ataB] = await resolveOrCreateATAs(
      this.ctx.connection,
      destinationWallet,
      [{ tokenMint: whirlpool.tokenMintA }, { tokenMint: whirlpool.tokenMintB }],
      () => this.fetcher.getAccountRentExempt(),
      payerKey
    );

    const { address: tokenOwnerAccountA, ...createTokenOwnerAccountAIx } = ataA;
    const { address: tokenOwnerAccountB, ...createTokenOwnerAccountBIx } = ataB;

    txBuilder.addInstruction(createTokenOwnerAccountAIx).addInstruction(createTokenOwnerAccountBIx);
    resolvedAssociatedTokenAddresses[whirlpool.tokenMintA.toBase58()] = tokenOwnerAccountA;
    resolvedAssociatedTokenAddresses[whirlpool.tokenMintB.toBase58()] = tokenOwnerAccountB;

    // TODO: Collect all Fees and rewards for the position.
    // TODO: Optimize - no need to call updateFee if we call decreaseLiquidity first.
    // const collectTx = await buildCollectFeesAndRewardsTx(this.dal, {
    //   provider,
    //   positionAddress: positionAddress,
    //   resolvedAssociatedTokenAddresses,
    // });
    // txBuilder.addInstruction(collectTx.compressIx(false));

    /* Remove all liquidity remaining in the position */
    if (position.liquidity.gt(new BN(0))) {
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

    return txBuilder;
  }

  private async getSwapTx(
    input: SwapInput,
    wallet: PublicKey,
    initTxBuilder?: TransactionBuilder
  ): Promise<TransactionBuilder> {
    invariant(input.amount.gt(ZERO), "swap amount must be more than zero.");
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
      () => this.fetcher.getAccountRentExempt()
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
    const account = await this.fetcher.getPool(this.address, true);
    if (!!account) {
      const rewardInfos = await getRewardInfos(this.fetcher, account, true);
      const [tokenVaultAInfo, tokenVaultBInfo] = await getTokenVaultAccountInfos(
        this.fetcher,
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
