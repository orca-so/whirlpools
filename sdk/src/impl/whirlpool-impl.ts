import {
  AddressUtil,
  deriveATA,
  Percentage,
  resolveOrCreateATAs,
  TransactionBuilder,
  ZERO,
} from "@orca-so/common-sdk";
import { Address, BN, translateAddress } from "@project-serum/anchor";
import { WhirlpoolContext } from "../context";
import {
  IncreaseLiquidityInput,
  openPositionIx,
  openPositionWithMetadataIx,
  initTickArrayIx,
  increaseLiquidityIx,
  decreaseLiquidityIx,
  closePositionIx,
  swapIx,
} from "../instructions";
import { MAX_SQRT_PRICE, MIN_SQRT_PRICE, TokenInfo, WhirlpoolData } from "../types/public";
import { Whirlpool } from "../whirlpool-client";
import { PublicKey, Keypair } from "@solana/web3.js";
import { u64 } from "@solana/spl-token";
import { AccountFetcher } from "../network/public";
import invariant from "tiny-invariant";
import { PDAUtil, PriceMath, TickUtil } from "../utils/public";
import { decreaseLiquidityQuoteByLiquidityWithParams, SwapQuote } from "../quotes/public";

export class WhirlpoolImpl implements Whirlpool {
  private data: WhirlpoolData;
  constructor(
    readonly ctx: WhirlpoolContext,
    readonly fetcher: AccountFetcher,
    readonly address: PublicKey,
    readonly tokenAInfo: TokenInfo,
    readonly tokenBInfo: TokenInfo,
    data: WhirlpoolData
  ) {
    this.data = data;
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

  async refreshData() {
    await this.refresh();
    return this.data;
  }

  async openPosition(
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
      !!positionWallet ? AddressUtil.toPubKey(positionWallet) : this.ctx.wallet.publicKey,
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
      !!positionWallet ? AddressUtil.toPubKey(positionWallet) : this.ctx.wallet.publicKey,
      !!funder ? AddressUtil.toPubKey(funder) : this.ctx.wallet.publicKey,
      true
    );
  }

  initTickArrayForTicks(ticks: number[], funder?: Address) {
    const startTicks = ticks.map((tick) => TickUtil.getStartTickIndex(tick, this.data.tickSpacing));
    const tx = new TransactionBuilder(this.ctx.provider);
    const initializedArrayTicks: number[] = [];

    startTicks.forEach((startTick) => {
      if (initializedArrayTicks.includes(startTick)) {
        return;
      }
      initializedArrayTicks.push(startTick);

      const tickArrayPda = PDAUtil.getTickArray(
        this.ctx.program.programId,
        this.address,
        startTick
      );

      tx.addInstruction(
        initTickArrayIx(this.ctx.program, {
          startTick,
          tickArrayPda,
          whirlpool: this.address,
          funder: !!funder ? AddressUtil.toPubKey(funder) : this.ctx.wallet.publicKey,
        })
      );
    });
    return tx;
  }

  async closePosition(
    positionAddress: Address,
    slippageTolerance: Percentage,
    destinationWallet?: Address,
    positionWallet?: Address
  ) {
    await this.refresh();
    const positionWalletKey = positionWallet
      ? AddressUtil.toPubKey(positionWallet)
      : this.ctx.wallet.publicKey;
    const destinationWalletKey = destinationWallet
      ? AddressUtil.toPubKey(destinationWallet)
      : this.ctx.wallet.publicKey;
    return this.getClosePositionIx(
      AddressUtil.toPubKey(positionAddress),
      slippageTolerance,
      destinationWalletKey,
      positionWalletKey
    );
  }

  async swap(quote: SwapQuote, sourceWallet?: Address) {
    const sourceWalletKey = sourceWallet
      ? AddressUtil.toPubKey(sourceWallet)
      : this.ctx.wallet.publicKey;
    return this.getSwapTx(quote, sourceWalletKey);
  }

  /**
   * Construct a transaction for opening an new position with optional metadata
   */
  async getOpenPositionWithOptMetadataTx(
    tickLower: number,
    tickUpper: number,
    liquidityInput: IncreaseLiquidityInput,
    sourceWallet: PublicKey,
    positionWallet: PublicKey,
    funder: PublicKey,
    withMetadata: boolean = false
  ): Promise<{ positionMint: PublicKey; tx: TransactionBuilder }> {
    invariant(TickUtil.checkTickInBounds(tickLower), "tickLower is out of bounds.");
    invariant(TickUtil.checkTickInBounds(tickUpper), "tickUpper is out of bounds.");

    const { liquidityAmount: liquidity, tokenMaxA, tokenMaxB, tokenEstA, tokenEstB } = liquidityInput;

    invariant(liquidity.gt(new u64(0)), "liquidity must be greater than zero");

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
    const positionTokenAccountAddress = await deriveATA(
      positionWallet,
      positionMintKeypair.publicKey
    );

    const txBuilder = new TransactionBuilder(this.ctx.provider);

    const positionIx = (withMetadata ? openPositionWithMetadataIx : openPositionIx)(
      this.ctx.program,
      {
        funder,
        owner: positionWallet,
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

    const[ataA, ataB] = await resolveOrCreateATAs(
      this.ctx.connection,
      sourceWallet,
      [
        { tokenMint: whirlpool.tokenMintA, wrappedSolAmountIn: tokenMaxA },
        { tokenMint: whirlpool.tokenMintB, wrappedSolAmountIn: tokenMaxB },
      ],
      () => this.fetcher.getAccountRentExempt(),
    )
    const { address: tokenOwnerAccountA, ... tokenOwnerAccountAIx } = ataA;
    const { address: tokenOwnerAccountB, ... tokenOwnerAccountBIx } = ataB;

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

    const [tickArrayLower, tickArrayUpper] = await this.fetcher.listTickArrays(
      [tickArrayLowerPda.publicKey, tickArrayUpperPda.publicKey],
      true
    );

    invariant(!!tickArrayLower, "tickArray for the tickLower has not been initialized");
    invariant(!!tickArrayUpper, "tickArray for the tickUpper has not been initialized");

    const liquidityIx = increaseLiquidityIx(this.ctx.program, {
      liquidityAmount: liquidity,
      tokenMaxA,
      tokenMaxB,
      tokenEstA,
      tokenEstB,
      whirlpool: this.address,
      positionAuthority: positionWallet,
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
    positionWallet: PublicKey
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

    const txBuilder = new TransactionBuilder(this.ctx.provider);

    const resolvedAssociatedTokenAddresses: Record<string, PublicKey> = {};
    const [ataA, ataB] = await resolveOrCreateATAs(
      this.ctx.connection,
      destinationWallet,
      [{ tokenMint: whirlpool.tokenMintA }, { tokenMint: whirlpool.tokenMintB }],
      () => this.fetcher.getAccountRentExempt(),
    );

    const { address: tokenOwnerAccountA, ... createTokenOwnerAccountAIx } = ataA;
    const { address: tokenOwnerAccountB, ... createTokenOwnerAccountBIx } = ataB;

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
    if (position.liquidity.gt(new u64(0))) {
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
        tokenEstA: decreaseLiqQuote.tokenEstA,
        tokenEstB: decreaseLiqQuote.tokenEstB,
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
      positionAuthority: this.ctx.wallet.publicKey,
      receiver: this.ctx.wallet.publicKey,
      positionTokenAccount,
      position: positionAddress,
      positionMint: position.positionMint,
    });
    txBuilder.addInstruction(positionIx);

    return txBuilder;
  }

  private async getSwapTx(quote: SwapQuote, wallet: PublicKey): Promise<TransactionBuilder> {
    const {
      sqrtPriceLimit,
      otherAmountThreshold,
      estimatedAmountIn,
      estimatedAmountOut,
      aToB,
      amountSpecifiedIsInput,
    } = quote;
    const whirlpool = this.data;
    const txBuilder = new TransactionBuilder(this.ctx.provider);
    
    const [ataA, ataB] = await resolveOrCreateATAs(
      this.ctx.connection,
      wallet,
      [
        { tokenMint: whirlpool.tokenMintA, wrappedSolAmountIn: aToB ? estimatedAmountIn: ZERO },
        { tokenMint: whirlpool.tokenMintB, wrappedSolAmountIn: !aToB ? estimatedAmountIn: ZERO },
      ],
      () => this.fetcher.getAccountRentExempt(),
    );

    const { address: tokenOwnerAccountA, ... tokenOwnerAccountAIx } = ataA;
    const { address: tokenOwnerAccountB, ... tokenOwnerAccountBIx } = ataB;

    txBuilder.addInstruction(tokenOwnerAccountAIx);
    txBuilder.addInstruction(tokenOwnerAccountBIx);

    const targetSqrtPriceLimitX64 = sqrtPriceLimit || this.getDefaultSqrtPriceLimit(aToB);

    const tickArrayAddresses = await this.getTickArrayPublicKeysForSwap(
      whirlpool.tickCurrentIndex,
      targetSqrtPriceLimitX64,
      whirlpool.tickSpacing,
      this.address,
      this.ctx.program.programId,
      aToB
    );

    const oraclePda = PDAUtil.getOracle(this.ctx.program.programId, this.address);

    txBuilder.addInstruction(
      swapIx(this.ctx.program, {
        amount: amountSpecifiedIsInput ? estimatedAmountIn : estimatedAmountOut,
        otherAmountThreshold,
        sqrtPriceLimit: targetSqrtPriceLimitX64,
        amountSpecifiedIsInput,
        aToB,
        whirlpool: this.address,
        tokenAuthority: wallet,
        tokenOwnerAccountA,
        tokenVaultA: whirlpool.tokenVaultA,
        tokenOwnerAccountB,
        tokenVaultB: whirlpool.tokenVaultB,
        tickArray0: tickArrayAddresses[0],
        tickArray1: tickArrayAddresses[1],
        tickArray2: tickArrayAddresses[2],
        oracle: oraclePda.publicKey,
      })
    );

    return txBuilder;
  }

  private async getTickArrayPublicKeysForSwap(
    tickCurrentIndex: number,
    targetSqrtPriceX64: BN,
    tickSpacing: number,
    poolAddress: PublicKey,
    programId: PublicKey,
    aToB: boolean
  ): Promise<[PublicKey, PublicKey, PublicKey]> {
    // TODO: fix directionality
    const nextInitializableTickIndex = (
      aToB ? TickUtil.getPrevInitializableTickIndex : TickUtil.getNextInitializableTickIndex
    )(tickCurrentIndex, tickSpacing);
    const targetTickIndex = PriceMath.sqrtPriceX64ToTickIndex(targetSqrtPriceX64);

    let currentStartTickIndex = TickUtil.getStartTickIndex(nextInitializableTickIndex, tickSpacing);
    const targetStartTickIndex = TickUtil.getStartTickIndex(targetTickIndex, tickSpacing);

    const offset = nextInitializableTickIndex < targetTickIndex ? 1 : -1;

    let count = 1;
    const tickArrayAddresses: [PublicKey, PublicKey, PublicKey] = [
      PDAUtil.getTickArray(programId, poolAddress, currentStartTickIndex).publicKey,
      PublicKey.default,
      PublicKey.default,
    ];

    while (currentStartTickIndex !== targetStartTickIndex && count < 3) {
      const nextStartTickIndex = TickUtil.getStartTickIndex(
        nextInitializableTickIndex,
        tickSpacing,
        offset * count
      );
      const nextTickArrayAddress = PDAUtil.getTickArray(
        programId,
        poolAddress,
        nextStartTickIndex
      ).publicKey;

      const nextTickArray = await this.fetcher.getTickArray(nextTickArrayAddress, false);
      if (!nextTickArray) {
        break;
      }

      tickArrayAddresses[count] = nextTickArrayAddress;
      count++;
      currentStartTickIndex = nextStartTickIndex;
    }

    while (count < 3) {
      tickArrayAddresses[count] = PDAUtil.getTickArray(
        programId,
        poolAddress,
        currentStartTickIndex
      ).publicKey;
      count++;
    }

    return tickArrayAddresses;
  }

  private getDefaultSqrtPriceLimit(aToB: boolean): BN {
    return new BN(aToB ? MIN_SQRT_PRICE : MAX_SQRT_PRICE);
  }

  private async refresh() {
    const account = await this.fetcher.getPool(this.address, true);
    if (!!account) {
      this.data = account;
    }
  }
}
