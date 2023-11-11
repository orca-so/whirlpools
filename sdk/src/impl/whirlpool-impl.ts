import { Address, BN, translateAddress } from "@coral-xyz/anchor";
import {
  AddressUtil,
  Percentage,
  TokenUtil,
  TransactionBuilder,
  ZERO,
  resolveOrCreateATAs,
} from "@orca-so/common-sdk";
import { NATIVE_MINT, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";
import { WhirlpoolContext } from "../context";
import {
  DevFeeSwapInput,
  IncreaseLiquidityInput,
  SwapInput,
  closePositionIx,
  decreaseLiquidityIx,
  increaseLiquidityIx,
  initTickArrayIx,
  openPositionIx,
  openPositionWithMetadataIx,
  swapAsync,
} from "../instructions";
import { IGNORE_CACHE, PREFER_CACHE } from "../network/public/fetcher";
import {
  collectFeesQuote,
  collectRewardsQuote,
  decreaseLiquidityQuoteByLiquidityWithParams,
} from "../quotes/public";
import { TokenAccountInfo, TokenInfo, WhirlpoolData, WhirlpoolRewardInfo } from "../types/public";
import { getTickArrayDataForPosition } from "../utils/builder/position-builder-util";
import { PDAUtil, TickArrayUtil, TickUtil } from "../utils/public";
import {
  TokenMintTypes,
  getTokenMintsFromWhirlpools,
  resolveAtaForMints,
} from "../utils/whirlpool-ata-utils";
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
    funder?: Address,
    positionMint?: PublicKey
  ) {
    await this.refresh();
    return this.getOpenPositionWithOptMetadataTx(
      tickLower,
      tickUpper,
      liquidityInput,
      !!wallet ? AddressUtil.toPubKey(wallet) : this.ctx.wallet.publicKey,
      !!funder ? AddressUtil.toPubKey(funder) : this.ctx.wallet.publicKey,
      false,
      positionMint
    );
  }

  async openPositionWithMetadata(
    tickLower: number,
    tickUpper: number,
    liquidityInput: IncreaseLiquidityInput,
    sourceWallet?: Address,
    funder?: Address,
    positionMint?: PublicKey
  ) {
    await this.refresh();
    return this.getOpenPositionWithOptMetadataTx(
      tickLower,
      tickUpper,
      liquidityInput,
      !!sourceWallet ? AddressUtil.toPubKey(sourceWallet) : this.ctx.wallet.publicKey,
      !!funder ? AddressUtil.toPubKey(funder) : this.ctx.wallet.publicKey,
      true,
      positionMint
    );
  }

  async initTickArrayForTicks(ticks: number[], funder?: Address, opts = IGNORE_CACHE) {
    const initTickArrayStartPdas = await TickArrayUtil.getUninitializedArraysPDAs(
      ticks,
      this.ctx.program.programId,
      this.address,
      this.data.tickSpacing,
      this.ctx.fetcher,
      opts
    );

    if (!initTickArrayStartPdas.length) {
      return null;
    }

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts
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

  async swap(quote: SwapInput, sourceWallet?: Address): Promise<TransactionBuilder> {
    const sourceWalletKey = sourceWallet
      ? AddressUtil.toPubKey(sourceWallet)
      : this.ctx.wallet.publicKey;
    return swapAsync(
      this.ctx,
      {
        swapInput: quote,
        whirlpool: this,
        wallet: sourceWalletKey,
      },
      IGNORE_CACHE
    );
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
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts
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
          payerKey,
          this.ctx.accountResolverOpts.allowPDAOwnerAddress
        )
      );
    }

    const swapTxBuilder = await swapAsync(
      this.ctx,
      {
        swapInput: quote,
        whirlpool: this,
        wallet: sourceWalletKey,
      },
      IGNORE_CACHE
    );

    txBuilder.addInstruction(swapTxBuilder.compressIx(true));

    return txBuilder;
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
    withMetadata: boolean = false,
    positionMint?: PublicKey
  ): Promise<{ positionMint: PublicKey; tx: TransactionBuilder }> {
    invariant(TickUtil.checkTickInBounds(tickLower), "tickLower is out of bounds.");
    invariant(TickUtil.checkTickInBounds(tickUpper), "tickUpper is out of bounds.");

    const { liquidityAmount: liquidity, tokenMaxA, tokenMaxB } = liquidityInput;

    invariant(liquidity.gt(new BN(0)), "liquidity must be greater than zero");

    const whirlpool = await this.ctx.fetcher.getPool(this.address, PREFER_CACHE);
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

    const positionMintKeypair =  Keypair.generate();
    const positionMintPubkey = positionMint ?? positionMintKeypair.publicKey;
    const positionPda = PDAUtil.getPosition(
      this.ctx.program.programId,
      positionMintPubkey
    );
    const metadataPda = PDAUtil.getPositionMetadata(positionMintPubkey);
    const positionTokenAccountAddress = getAssociatedTokenAddressSync(
      positionMintPubkey,
      wallet,
      this.ctx.accountResolverOpts.allowPDAOwnerAddress
    );

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts
    );

    const positionIx = (withMetadata ? openPositionWithMetadataIx : openPositionIx)(
      this.ctx.program,
      {
        funder,
        owner: wallet,
        positionPda,
        metadataPda,
        positionMintAddress: positionMintPubkey,
        positionTokenAccount: positionTokenAccountAddress,
        whirlpool: this.address,
        tickLowerIndex: tickLower,
        tickUpperIndex: tickUpper,
      }
    );
    txBuilder.addInstruction(positionIx);
    if(positionMint === undefined) {
      txBuilder.addSigner(positionMintKeypair);
    }

    const [ataA, ataB] = await resolveOrCreateATAs(
      this.ctx.connection,
      wallet,
      [
        { tokenMint: whirlpool.tokenMintA, wrappedSolAmountIn: tokenMaxA },
        { tokenMint: whirlpool.tokenMintB, wrappedSolAmountIn: tokenMaxB },
      ],
      () => this.ctx.fetcher.getAccountRentExempt(),
      funder,
      undefined, // use default
      this.ctx.accountResolverOpts.allowPDAOwnerAddress,
      this.ctx.accountResolverOpts.createWrappedSolAccountMethod
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
      positionMint: positionMintPubkey,
      tx: txBuilder,
    };
  }

  async getClosePositionIx(
    positionAddress: PublicKey,
    slippageTolerance: Percentage,
    destinationWallet: PublicKey,
    positionWallet: PublicKey,
    payerKey: PublicKey
  ): Promise<TransactionBuilder[]> {
    const positionData = await this.ctx.fetcher.getPosition(positionAddress, IGNORE_CACHE);
    if (!positionData) {
      throw new Error(`Position not found: ${positionAddress.toBase58()}`);
    }

    const whirlpool = this.data;

    invariant(
      positionData.whirlpool.equals(this.address),
      `Position ${positionAddress.toBase58()} is not a position for Whirlpool ${this.address.toBase58()}`
    );

    const positionTokenAccount = getAssociatedTokenAddressSync(
      positionData.positionMint,
      positionWallet,
      this.ctx.accountResolverOpts.allowPDAOwnerAddress
    );

    const tokenAccountsTxBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts
    );

    const accountExemption = await this.ctx.fetcher.getAccountRentExempt();

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts
    );

    const tickArrayLower = PDAUtil.getTickArrayFromTickIndex(
      positionData.tickLowerIndex,
      whirlpool.tickSpacing,
      positionData.whirlpool,
      this.ctx.program.programId
    ).publicKey;

    const tickArrayUpper = PDAUtil.getTickArrayFromTickIndex(
      positionData.tickUpperIndex,
      whirlpool.tickSpacing,
      positionData.whirlpool,
      this.ctx.program.programId
    ).publicKey;

    const [tickArrayLowerData, tickArrayUpperData] = await getTickArrayDataForPosition(
      this.ctx,
      positionData,
      whirlpool,
      IGNORE_CACHE
    );

    invariant(
      !!tickArrayLowerData,
      `Tick array ${tickArrayLower} expected to be initialized for whirlpool ${this.address}`
    );

    invariant(
      !!tickArrayUpperData,
      `Tick array ${tickArrayUpper} expected to be initialized for whirlpool ${this.address}`
    );

    const position = new PositionImpl(
      this.ctx,
      positionAddress,
      positionData,
      whirlpool,
      tickArrayLowerData,
      tickArrayUpperData
    );

    const tickLower = position.getLowerTickData();
    const tickUpper = position.getUpperTickData();

    const feesQuote = collectFeesQuote({
      position: positionData,
      whirlpool,
      tickLower,
      tickUpper,
    });

    const rewardsQuote = collectRewardsQuote({
      position: positionData,
      whirlpool,
      tickLower,
      tickUpper,
    });

    const shouldCollectFees = feesQuote.feeOwedA.gtn(0) || feesQuote.feeOwedB.gtn(0);
    invariant(
      this.data.rewardInfos.length === rewardsQuote.length,
      "Rewards quote does not match reward infos length"
    );

    const shouldDecreaseLiquidity = positionData.liquidity.gtn(0);

    const rewardsToCollect = this.data.rewardInfos
      .filter((_, i) => (rewardsQuote[i] ?? ZERO).gtn(0))
      .map((info) => info.mint);

    const shouldCollectRewards = rewardsToCollect.length > 0;

    let mintType = TokenMintTypes.ALL;
    if ((shouldDecreaseLiquidity || shouldCollectFees) && !shouldCollectRewards) {
      mintType = TokenMintTypes.POOL_ONLY;
    } else if (!(shouldDecreaseLiquidity || shouldCollectFees) && shouldCollectRewards) {
      mintType = TokenMintTypes.REWARD_ONLY;
    }

    const affiliatedMints = getTokenMintsFromWhirlpools([whirlpool], mintType);
    const { ataTokenAddresses: walletTokenAccountsByMint, resolveAtaIxs } =
      await resolveAtaForMints(this.ctx, {
        mints: affiliatedMints.mintMap,
        accountExemption,
        receiver: destinationWallet,
        payer: payerKey,
      });

    tokenAccountsTxBuilder.addInstructions(resolveAtaIxs);

    // Handle native mint
    if (affiliatedMints.hasNativeMint) {
      let { address: wSOLAta, ...resolveWSolIx } = TokenUtil.createWrappedNativeAccountInstruction(
        destinationWallet,
        ZERO,
        accountExemption,
        payerKey,
        destinationWallet,
        this.ctx.accountResolverOpts.createWrappedSolAccountMethod
      );
      walletTokenAccountsByMint[NATIVE_MINT.toBase58()] = wSOLAta;
      txBuilder.addInstruction(resolveWSolIx);
    }

    if (shouldDecreaseLiquidity) {
      /* Remove all liquidity remaining in the position */
      const tokenOwnerAccountA = walletTokenAccountsByMint[whirlpool.tokenMintA.toBase58()];
      const tokenOwnerAccountB = walletTokenAccountsByMint[whirlpool.tokenMintB.toBase58()];

      const decreaseLiqQuote = decreaseLiquidityQuoteByLiquidityWithParams({
        liquidity: positionData.liquidity,
        slippageTolerance,
        sqrtPrice: whirlpool.sqrtPrice,
        tickCurrentIndex: whirlpool.tickCurrentIndex,
        tickLowerIndex: positionData.tickLowerIndex,
        tickUpperIndex: positionData.tickUpperIndex,
      });

      const liquidityIx = decreaseLiquidityIx(this.ctx.program, {
        ...decreaseLiqQuote,
        whirlpool: positionData.whirlpool,
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

    if (shouldCollectFees) {
      const collectFeexTx = await position.collectFees(
        false,
        walletTokenAccountsByMint,
        destinationWallet,
        positionWallet,
        payerKey,
        IGNORE_CACHE
      );

      txBuilder.addInstruction(collectFeexTx.compressIx(false));
    }

    if (shouldCollectRewards) {
      const collectRewardsTx = await position.collectRewards(
        rewardsToCollect,
        false,
        walletTokenAccountsByMint,
        destinationWallet,
        positionWallet,
        payerKey
      );

      txBuilder.addInstruction(collectRewardsTx.compressIx(false));
    }

    /* Close position */
    const positionIx = closePositionIx(this.ctx.program, {
      positionAuthority: positionWallet,
      receiver: destinationWallet,
      positionTokenAccount,
      position: positionAddress,
      positionMint: positionData.positionMint,
    });

    txBuilder.addInstruction(positionIx);

    const txBuilders: TransactionBuilder[] = [];

    if (!tokenAccountsTxBuilder.isEmpty()) {
      txBuilders.push(tokenAccountsTxBuilder);
    }

    txBuilders.push(txBuilder);

    return txBuilders;
  }

  private async refresh() {
    const account = await this.ctx.fetcher.getPool(this.address, IGNORE_CACHE);
    if (!!account) {
      const rewardInfos = await getRewardInfos(this.ctx.fetcher, account, IGNORE_CACHE);
      const [tokenVaultAInfo, tokenVaultBInfo] = await getTokenVaultAccountInfos(
        this.ctx.fetcher,
        account,
        IGNORE_CACHE
      );
      this.data = account;
      this.tokenVaultAInfo = tokenVaultAInfo;
      this.tokenVaultBInfo = tokenVaultBInfo;
      this.rewardInfos = rewardInfos;
    }
  }
}
