import type { Address } from "@coral-xyz/anchor";
import { BN, translateAddress } from "@coral-xyz/anchor";
import type { Percentage } from "@orca-so/common-sdk";
import {
  AddressUtil,
  TokenUtil,
  TransactionBuilder,
  ZERO,
  resolveOrCreateATAs,
} from "@orca-so/common-sdk";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import invariant from "tiny-invariant";
import type { WhirlpoolContext } from "../context";
import type {
  DevFeeSwapInput,
  IncreaseLiquidityInput,
  SwapInput,
} from "../instructions";
import {
  closePositionIx,
  closePositionWithTokenExtensionsIx,
  increaseLiquidityIx,
  increaseLiquidityV2Ix,
  initTickArrayIx,
  openPositionIx,
  openPositionWithMetadataIx,
  openPositionWithTokenExtensionsIx,
  swapAsync,
} from "../instructions";
import { WhirlpoolIx } from "../ix";
import { IGNORE_CACHE, PREFER_CACHE } from "../network/public/fetcher";
import {
  collectFeesQuote,
  collectRewardsQuote,
  decreaseLiquidityQuoteByLiquidityWithParams,
  decreaseLiquidityQuoteByLiquidityWithParamsUsingPriceSlippage,
} from "../quotes/public";
import type {
  TokenAccountInfo,
  TokenInfo,
  WhirlpoolData,
  WhirlpoolRewardInfo,
} from "../types/public";
import { getTickArrayDataForPosition } from "../utils/builder/position-builder-util";
import { PDAUtil, TickArrayUtil, TickUtil } from "../utils/public";
import { TokenExtensionUtil } from "../utils/public/token-extension-util";
import {
  MultipleTransactionBuilderFactoryWithAccountResolver,
  convertListToMap,
} from "../utils/txn-utils";
import {
  TokenMintTypes,
  getTokenMintsFromWhirlpools,
} from "../utils/whirlpool-ata-utils";
import type { Whirlpool } from "../whirlpool-client";
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
    data: WhirlpoolData,
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
    positionMint?: PublicKey,
    tokenProgramId?: PublicKey,
  ) {
    await this.refresh();
    return this.getOpenPositionWithOptMetadataTx(
      tickLower,
      tickUpper,
      liquidityInput,
      !!wallet ? AddressUtil.toPubKey(wallet) : this.ctx.wallet.publicKey,
      !!funder ? AddressUtil.toPubKey(funder) : this.ctx.wallet.publicKey,
      // TOKEN_PROGRAM_ID for v0.13.x, TOKEN_2022_PROGRAM_ID for future releases
      tokenProgramId ?? TOKEN_PROGRAM_ID,
      false,
      positionMint,
    );
  }

  async openPositionWithMetadata(
    tickLower: number,
    tickUpper: number,
    liquidityInput: IncreaseLiquidityInput,
    sourceWallet?: Address,
    funder?: Address,
    positionMint?: PublicKey,
    tokenProgramId?: PublicKey,
  ) {
    await this.refresh();
    return this.getOpenPositionWithOptMetadataTx(
      tickLower,
      tickUpper,
      liquidityInput,
      !!sourceWallet
        ? AddressUtil.toPubKey(sourceWallet)
        : this.ctx.wallet.publicKey,
      !!funder ? AddressUtil.toPubKey(funder) : this.ctx.wallet.publicKey,
      // TOKEN_PROGRAM_ID for v0.13.x, TOKEN_2022_PROGRAM_ID for future releases
      tokenProgramId ?? TOKEN_PROGRAM_ID,
      true,
      positionMint,
    );
  }

  async initTickArrayForTicks(
    ticks: number[],
    funder?: Address,
    opts = IGNORE_CACHE,
  ) {
    const initTickArrayStartPdas =
      await TickArrayUtil.getUninitializedArraysPDAs(
        ticks,
        this.ctx.program.programId,
        this.address,
        this.data.tickSpacing,
        this.ctx.fetcher,
        opts,
      );

    if (!initTickArrayStartPdas.length) {
      return null;
    }

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts,
    );
    initTickArrayStartPdas.forEach((initTickArrayInfo) => {
      txBuilder.addInstruction(
        initTickArrayIx(this.ctx.program, {
          startTick: initTickArrayInfo.startIndex,
          tickArrayPda: initTickArrayInfo.pda,
          whirlpool: this.address,
          funder: !!funder
            ? AddressUtil.toPubKey(funder)
            : this.ctx.provider.wallet.publicKey,
        }),
      );
    });
    return txBuilder;
  }

  async closePosition(
    positionAddress: Address,
    slippageTolerance: Percentage,
    destinationWallet?: Address,
    positionWallet?: Address,
    payer?: Address,
    usePriceSlippage = false,
  ) {
    await this.refresh();
    const positionWalletKey = positionWallet
      ? AddressUtil.toPubKey(positionWallet)
      : this.ctx.wallet.publicKey;
    const destinationWalletKey = destinationWallet
      ? AddressUtil.toPubKey(destinationWallet)
      : this.ctx.wallet.publicKey;
    const payerKey = payer
      ? AddressUtil.toPubKey(payer)
      : this.ctx.wallet.publicKey;
    return this.getClosePositionIx(
      AddressUtil.toPubKey(positionAddress),
      slippageTolerance,
      destinationWalletKey,
      positionWalletKey,
      payerKey,
      usePriceSlippage,
    );
  }

  async swap(
    quote: SwapInput,
    sourceWallet?: Address,
  ): Promise<TransactionBuilder> {
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
      IGNORE_CACHE,
    );
  }

  async swapWithDevFees(
    quote: DevFeeSwapInput,
    devFeeWallet: PublicKey,
    wallet?: PublicKey | undefined,
    payer?: PublicKey | undefined,
  ): Promise<TransactionBuilder> {
    const sourceWalletKey = wallet
      ? AddressUtil.toPubKey(wallet)
      : this.ctx.wallet.publicKey;
    const payerKey = payer
      ? AddressUtil.toPubKey(payer)
      : this.ctx.wallet.publicKey;
    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts,
    );

    if (!quote.devFeeAmount.eq(ZERO)) {
      const inputToken =
        quote.aToB === quote.amountSpecifiedIsInput
          ? this.getTokenAInfo()
          : this.getTokenBInfo();

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
          this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        ),
      );
    }

    const swapTxBuilder = await swapAsync(
      this.ctx,
      {
        swapInput: quote,
        whirlpool: this,
        wallet: sourceWalletKey,
      },
      IGNORE_CACHE,
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
    tokenProgramId: PublicKey,
    withMetadata: boolean = false,
    positionMint?: PublicKey,
  ): Promise<{ positionMint: PublicKey; tx: TransactionBuilder }> {
    invariant(
      TickUtil.checkTickInBounds(tickLower),
      "tickLower is out of bounds.",
    );
    invariant(
      TickUtil.checkTickInBounds(tickUpper),
      "tickUpper is out of bounds.",
    );
    invariant(
      tokenProgramId.equals(TOKEN_PROGRAM_ID) ||
        tokenProgramId.equals(TOKEN_2022_PROGRAM_ID),
      "tokenProgramId must be either TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID",
    );

    const { liquidityAmount: liquidity, tokenMaxA, tokenMaxB } = liquidityInput;

    invariant(liquidity.gt(new BN(0)), "liquidity must be greater than zero");

    const whirlpool = await this.ctx.fetcher.getPool(
      this.address,
      PREFER_CACHE,
    );
    if (!whirlpool) {
      throw new Error(
        `Whirlpool not found: ${translateAddress(this.address).toBase58()}`,
      );
    }

    const tokenExtensionCtx =
      await TokenExtensionUtil.buildTokenExtensionContext(
        this.ctx.fetcher,
        whirlpool,
        IGNORE_CACHE,
      );

    invariant(
      TickUtil.isTickInitializable(tickLower, whirlpool.tickSpacing),
      `lower tick ${tickLower} is not an initializable tick for tick-spacing ${whirlpool.tickSpacing}`,
    );
    invariant(
      TickUtil.isTickInitializable(tickUpper, whirlpool.tickSpacing),
      `upper tick ${tickUpper} is not an initializable tick for tick-spacing ${whirlpool.tickSpacing}`,
    );

    const positionMintKeypair = Keypair.generate();
    const positionMintPubkey = positionMint ?? positionMintKeypair.publicKey;
    const positionPda = PDAUtil.getPosition(
      this.ctx.program.programId,
      positionMintPubkey,
    );
    const metadataPda = PDAUtil.getPositionMetadata(positionMintPubkey);
    const positionTokenAccountAddress = getAssociatedTokenAddressSync(
      positionMintPubkey,
      wallet,
      this.ctx.accountResolverOpts.allowPDAOwnerAddress,
      tokenProgramId,
    );

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts,
    );

    const params = {
      funder,
      owner: wallet,
      positionPda,
      positionTokenAccount: positionTokenAccountAddress,
      whirlpool: this.address,
      tickLowerIndex: tickLower,
      tickUpperIndex: tickUpper,
    };
    const positionIx = tokenProgramId.equals(TOKEN_2022_PROGRAM_ID)
      ? openPositionWithTokenExtensionsIx(this.ctx.program, {
          ...params,
          positionMint: positionMintPubkey,
          withTokenMetadataExtension: withMetadata,
        })
      : (withMetadata ? openPositionWithMetadataIx : openPositionIx)(
          this.ctx.program,
          {
            ...params,
            positionMintAddress: positionMintPubkey,
            metadataPda,
          },
        );
    txBuilder.addInstruction(positionIx);

    if (positionMint === undefined) {
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
      this.ctx.accountResolverOpts.createWrappedSolAccountMethod,
    );
    const { address: tokenOwnerAccountA, ...tokenOwnerAccountAIx } = ataA;
    const { address: tokenOwnerAccountB, ...tokenOwnerAccountBIx } = ataB;

    txBuilder.addInstruction(tokenOwnerAccountAIx);
    txBuilder.addInstruction(tokenOwnerAccountBIx);

    const tickArrayLowerPda = PDAUtil.getTickArrayFromTickIndex(
      tickLower,
      this.data.tickSpacing,
      this.address,
      this.ctx.program.programId,
    );
    const tickArrayUpperPda = PDAUtil.getTickArrayFromTickIndex(
      tickUpper,
      this.data.tickSpacing,
      this.address,
      this.ctx.program.programId,
    );

    const baseParams = {
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
    };
    // V2 can handle TokenProgram/TokenProgram pool, but it increases the size of transaction, so V1 is prefer if possible.
    const liquidityIx = !TokenExtensionUtil.isV2IxRequiredPool(
      tokenExtensionCtx,
    )
      ? increaseLiquidityIx(this.ctx.program, baseParams)
      : increaseLiquidityV2Ix(this.ctx.program, {
          ...baseParams,
          tokenMintA: whirlpool.tokenMintA,
          tokenMintB: whirlpool.tokenMintB,
          tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
          tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
          ...(await TokenExtensionUtil.getExtraAccountMetasForTransferHookForPool(
            this.ctx.connection,
            tokenExtensionCtx,
            baseParams.tokenOwnerAccountA,
            baseParams.tokenVaultA,
            baseParams.positionAuthority,
            baseParams.tokenOwnerAccountB,
            baseParams.tokenVaultB,
            baseParams.positionAuthority,
          )),
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
    payerKey: PublicKey,
    usePriceSlippage = false,
  ): Promise<TransactionBuilder[]> {
    const positionData = await this.ctx.fetcher.getPosition(
      positionAddress,
      IGNORE_CACHE,
    );
    if (!positionData) {
      throw new Error(`Position not found: ${positionAddress.toBase58()}`);
    }

    const positionMint = await this.ctx.fetcher.getMintInfo(
      positionData.positionMint,
    );
    if (!positionMint) {
      throw new Error(
        `Position mint not found: ${positionData.positionMint.toBase58()}`,
      );
    }

    const whirlpool = this.data;

    invariant(
      positionData.whirlpool.equals(this.address),
      `Position ${positionAddress.toBase58()} is not a position for Whirlpool ${this.address.toBase58()}`,
    );

    const positionTokenAccount = getAssociatedTokenAddressSync(
      positionData.positionMint,
      positionWallet,
      this.ctx.accountResolverOpts.allowPDAOwnerAddress,
      positionMint.tokenProgram,
    );

    const accountExemption = await this.ctx.fetcher.getAccountRentExempt();

    const tickArrayLower = PDAUtil.getTickArrayFromTickIndex(
      positionData.tickLowerIndex,
      whirlpool.tickSpacing,
      positionData.whirlpool,
      this.ctx.program.programId,
    ).publicKey;

    const tickArrayUpper = PDAUtil.getTickArrayFromTickIndex(
      positionData.tickUpperIndex,
      whirlpool.tickSpacing,
      positionData.whirlpool,
      this.ctx.program.programId,
    ).publicKey;

    const [tickArrayLowerData, tickArrayUpperData] =
      await getTickArrayDataForPosition(
        this.ctx,
        positionData,
        whirlpool,
        IGNORE_CACHE,
      );

    invariant(
      !!tickArrayLowerData,
      `Tick array ${tickArrayLower} expected to be initialized for whirlpool ${this.address}`,
    );

    invariant(
      !!tickArrayUpperData,
      `Tick array ${tickArrayUpper} expected to be initialized for whirlpool ${this.address}`,
    );

    const tokenExtensionCtx =
      await TokenExtensionUtil.buildTokenExtensionContext(
        this.ctx.fetcher,
        whirlpool,
        IGNORE_CACHE,
      );

    const position = new PositionImpl(
      this.ctx,
      positionAddress,
      positionData,
      whirlpool,
      tickArrayLowerData,
      tickArrayUpperData,
      positionMint.tokenProgram,
    );

    const tickLower = position.getLowerTickData();
    const tickUpper = position.getUpperTickData();

    const feesQuote = collectFeesQuote({
      position: positionData,
      whirlpool,
      tickLower,
      tickUpper,
      tokenExtensionCtx,
    });

    const rewardsQuote = collectRewardsQuote({
      position: positionData,
      whirlpool,
      tickLower,
      tickUpper,
      tokenExtensionCtx,
    });

    const shouldCollectFees =
      feesQuote.feeOwedA.gtn(0) || feesQuote.feeOwedB.gtn(0);
    invariant(
      this.data.rewardInfos.length === rewardsQuote.rewardOwed.length,
      "Rewards quote does not match reward infos length",
    );

    const shouldDecreaseLiquidity = positionData.liquidity.gtn(0);

    const rewardsToCollect = this.data.rewardInfos
      .filter((_, i) => {
        return (
          (rewardsQuote.rewardOwed[i] ?? ZERO).gtn(0) ||
          // we need to collect reward even if all reward will be deducted as transfer fee
          (rewardsQuote.transferFee.deductedFromRewardOwed[i] ?? ZERO).gtn(0)
        );
      })
      .map((info) => info.mint);

    const shouldCollectRewards = rewardsToCollect.length > 0;

    let mintType = TokenMintTypes.ALL;
    if (
      (shouldDecreaseLiquidity || shouldCollectFees) &&
      !shouldCollectRewards
    ) {
      mintType = TokenMintTypes.POOL_ONLY;
    } else if (
      !(shouldDecreaseLiquidity || shouldCollectFees) &&
      shouldCollectRewards
    ) {
      mintType = TokenMintTypes.REWARD_ONLY;
    }

    const allMints = getTokenMintsFromWhirlpools([whirlpool], mintType);
    const resolvedAtas = convertListToMap(
      await resolveOrCreateATAs(
        this.ctx.connection,
        destinationWallet,
        allMints.mintMap.map((tokenMint) => ({ tokenMint })),
        async () => accountExemption,
        payerKey,
        true, // CreateIdempotent
        this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        this.ctx.accountResolverOpts.createWrappedSolAccountMethod,
      ),
      allMints.mintMap.map((mint) => mint.toBase58()),
    );

    const builder = new MultipleTransactionBuilderFactoryWithAccountResolver(
      this.ctx,
      resolvedAtas,
      destinationWallet,
      payerKey,
    );

    if (shouldDecreaseLiquidity) {
      await builder.addInstructions(async (resolveTokenAccount) => {
        const tokenOwnerAccountA = resolveTokenAccount(
          whirlpool.tokenMintA.toBase58(),
        );
        const tokenOwnerAccountB = resolveTokenAccount(
          whirlpool.tokenMintB.toBase58(),
        );

        const params = {
          liquidity: positionData.liquidity,
          slippageTolerance,
          sqrtPrice: whirlpool.sqrtPrice,
          tickCurrentIndex: whirlpool.tickCurrentIndex,
          tickLowerIndex: positionData.tickLowerIndex,
          tickUpperIndex: positionData.tickUpperIndex,
          tokenExtensionCtx,
        };
        const decreaseLiqQuote = usePriceSlippage
          ? decreaseLiquidityQuoteByLiquidityWithParamsUsingPriceSlippage(
              params,
            )
          : decreaseLiquidityQuoteByLiquidityWithParams(params);

        const baseParams = {
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
        };

        // V2 can handle TokenProgram/TokenProgram pool, but it increases the size of transaction, so V1 is prefer if possible.
        const ix = !TokenExtensionUtil.isV2IxRequiredPool(tokenExtensionCtx)
          ? WhirlpoolIx.decreaseLiquidityIx(this.ctx.program, baseParams)
          : WhirlpoolIx.decreaseLiquidityV2Ix(this.ctx.program, {
              ...baseParams,
              tokenMintA: whirlpool.tokenMintA,
              tokenMintB: whirlpool.tokenMintB,
              tokenProgramA:
                tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
              tokenProgramB:
                tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
              ...(await TokenExtensionUtil.getExtraAccountMetasForTransferHookForPool(
                this.ctx.connection,
                tokenExtensionCtx,
                baseParams.tokenVaultA,
                baseParams.tokenOwnerAccountA,
                baseParams.whirlpool, // vault to owner, so pool is authority
                baseParams.tokenVaultB,
                baseParams.tokenOwnerAccountB,
                baseParams.whirlpool, // vault to owner, so pool is authority
              )),
            });

        return [ix];
      });
    }

    if (shouldCollectFees) {
      await builder.addInstructions(async (resolveTokenAccount) => {
        const tokenOwnerAccountA = resolveTokenAccount(
          whirlpool.tokenMintA.toBase58(),
        );
        const tokenOwnerAccountB = resolveTokenAccount(
          whirlpool.tokenMintB.toBase58(),
        );

        const collectFeesBaseParams = {
          whirlpool: positionData.whirlpool,
          position: positionAddress,
          positionAuthority: positionWallet,
          positionTokenAccount,
          tokenOwnerAccountA,
          tokenOwnerAccountB,
          tokenVaultA: whirlpool.tokenVaultA,
          tokenVaultB: whirlpool.tokenVaultB,
        };

        const ix = !TokenExtensionUtil.isV2IxRequiredPool(tokenExtensionCtx)
          ? WhirlpoolIx.collectFeesIx(this.ctx.program, collectFeesBaseParams)
          : WhirlpoolIx.collectFeesV2Ix(this.ctx.program, {
              ...collectFeesBaseParams,
              tokenMintA: tokenExtensionCtx.tokenMintWithProgramA.address,
              tokenMintB: tokenExtensionCtx.tokenMintWithProgramB.address,
              tokenProgramA:
                tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
              tokenProgramB:
                tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
              ...(await TokenExtensionUtil.getExtraAccountMetasForTransferHookForPool(
                this.ctx.connection,
                tokenExtensionCtx,
                collectFeesBaseParams.tokenVaultA,
                collectFeesBaseParams.tokenOwnerAccountA,
                collectFeesBaseParams.whirlpool, // vault to owner, so pool is authority
                collectFeesBaseParams.tokenVaultB,
                collectFeesBaseParams.tokenOwnerAccountB,
                collectFeesBaseParams.whirlpool, // vault to owner, so pool is authority
              )),
            });

        return [ix];
      });
    }

    if (shouldCollectRewards) {
      for (
        let rewardIndex = 0;
        rewardIndex < rewardsToCollect.length;
        rewardIndex++
      ) {
        await builder.addInstructions(async (resolveTokenAccount) => {
          const rewardOwnerAccount = resolveTokenAccount(
            rewardsToCollect[rewardIndex].toBase58(),
          );

          const collectRewardBaseParams = {
            whirlpool: positionData.whirlpool,
            position: positionAddress,
            positionAuthority: positionWallet,
            positionTokenAccount,
            rewardIndex,
            rewardOwnerAccount,
            rewardVault: whirlpool.rewardInfos[rewardIndex].vault,
          };

          const ix = !TokenExtensionUtil.isV2IxRequiredReward(
            tokenExtensionCtx,
            rewardIndex,
          )
            ? WhirlpoolIx.collectRewardIx(
                this.ctx.program,
                collectRewardBaseParams,
              )
            : WhirlpoolIx.collectRewardV2Ix(this.ctx.program, {
                ...collectRewardBaseParams,
                rewardMint:
                  tokenExtensionCtx.rewardTokenMintsWithProgram[rewardIndex]!
                    .address,
                rewardTokenProgram:
                  tokenExtensionCtx.rewardTokenMintsWithProgram[rewardIndex]!
                    .tokenProgram,
                rewardTransferHookAccounts:
                  await TokenExtensionUtil.getExtraAccountMetasForTransferHook(
                    this.ctx.connection,
                    tokenExtensionCtx.rewardTokenMintsWithProgram[rewardIndex]!,
                    collectRewardBaseParams.rewardVault,
                    collectRewardBaseParams.rewardOwnerAccount,
                    collectRewardBaseParams.whirlpool, // vault to owner, so pool is authority
                  ),
              });

          return [ix];
        });
      }
    }

    /* Close position */
    await builder.addInstructions(async () => {
      const closePositionParams = {
        positionAuthority: positionWallet,
        receiver: destinationWallet,
        positionTokenAccount,
        position: positionAddress,
        positionMint: positionData.positionMint,
      };

      if (positionMint.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
        return [
          closePositionWithTokenExtensionsIx(
            this.ctx.program,
            closePositionParams,
          ),
        ];
      } else {
        return [closePositionIx(this.ctx.program, closePositionParams)];
      }
    });

    return builder.build();
  }

  private async refresh() {
    const account = await this.ctx.fetcher.getPool(this.address, IGNORE_CACHE);
    if (!!account) {
      const rewardInfos = await getRewardInfos(
        this.ctx.fetcher,
        account,
        IGNORE_CACHE,
      );
      const [tokenVaultAInfo, tokenVaultBInfo] =
        await getTokenVaultAccountInfos(
          this.ctx.fetcher,
          account,
          IGNORE_CACHE,
        );
      this.data = account;
      this.tokenVaultAInfo = tokenVaultAInfo;
      this.tokenVaultBInfo = tokenVaultBInfo;
      this.rewardInfos = rewardInfos;
    }
  }
}
