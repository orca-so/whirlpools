import { Address } from "@coral-xyz/anchor";
import {
  AddressUtil,
  Instruction,
  TokenUtil,
  TransactionBuilder,
  ZERO,
  resolveOrCreateATAs,
} from "@orca-so/common-sdk";
import { NATIVE_MINT, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";
import { WhirlpoolContext } from "../context";
import {
  DecreaseLiquidityInput,
  IncreaseLiquidityInput,
  collectFeesIx,
  collectFeesV2Ix,
  collectRewardIx,
  collectRewardV2Ix,
  decreaseLiquidityIx,
  decreaseLiquidityV2Ix,
  increaseLiquidityIx,
  increaseLiquidityV2Ix,
  updateFeesAndRewardsIx,
} from "../instructions";
import {
  IGNORE_CACHE,
  PREFER_CACHE,
  WhirlpoolAccountFetchOptions,
} from "../network/public/fetcher";
import { PositionData, TickArrayData, TickData, WhirlpoolData } from "../types/public";
import { getTickArrayDataForPosition } from "../utils/builder/position-builder-util";
import { PDAUtil, PoolUtil, TickArrayUtil, TickUtil } from "../utils/public";
import {
  TokenMintTypes,
  getTokenMintsFromWhirlpools,
  resolveAtaForMints,
} from "../utils/whirlpool-ata-utils";
import { Position } from "../whirlpool-client";
import { TokenExtensionUtil } from "../utils/token-extension-util";

export class PositionImpl implements Position {
  private data: PositionData;
  private whirlpoolData: WhirlpoolData;
  private lowerTickArrayData: TickArrayData;
  private upperTickArrayData: TickArrayData;
  constructor(
    readonly ctx: WhirlpoolContext,
    readonly address: PublicKey,
    data: PositionData,
    whirlpoolData: WhirlpoolData,
    lowerTickArrayData: TickArrayData,
    upperTickArrayData: TickArrayData
  ) {
    this.data = data;
    this.whirlpoolData = whirlpoolData;
    this.lowerTickArrayData = lowerTickArrayData;
    this.upperTickArrayData = upperTickArrayData;
  }

  getAddress(): PublicKey {
    return this.address;
  }

  getData(): PositionData {
    return this.data;
  }

  getWhirlpoolData(): WhirlpoolData {
    return this.whirlpoolData;
  }

  getLowerTickData(): TickData {
    return TickArrayUtil.getTickFromArray(
      this.lowerTickArrayData,
      this.data.tickLowerIndex,
      this.whirlpoolData.tickSpacing
    );
  }

  getUpperTickData(): TickData {
    return TickArrayUtil.getTickFromArray(
      this.upperTickArrayData,
      this.data.tickUpperIndex,
      this.whirlpoolData.tickSpacing
    );
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

    const whirlpool = await this.ctx.fetcher.getPool(this.data.whirlpool, IGNORE_CACHE);
    if (!whirlpool) {
      throw new Error("Unable to fetch whirlpool for this position.");
    }

    const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(this.ctx.fetcher, whirlpool, IGNORE_CACHE);

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts
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
        () => this.ctx.fetcher.getAccountRentExempt(),
        ataPayerKey,
        undefined, // use default
        this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        this.ctx.accountResolverOpts.createWrappedSolAccountMethod
      );
      const { address: ataAddrA, ...tokenOwnerAccountAIx } = ataA!;
      const { address: ataAddrB, ...tokenOwnerAccountBIx } = ataB!;
      tokenOwnerAccountA = ataAddrA;
      tokenOwnerAccountB = ataAddrB;
      txBuilder.addInstruction(tokenOwnerAccountAIx);
      txBuilder.addInstruction(tokenOwnerAccountBIx);
    } else {
      tokenOwnerAccountA = getAssociatedTokenAddressSync(
        whirlpool.tokenMintA,
        sourceWalletKey,
        this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
      );
      tokenOwnerAccountB = getAssociatedTokenAddressSync(
        whirlpool.tokenMintB,
        sourceWalletKey,
        this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
      );
    }
    const positionTokenAccount = getAssociatedTokenAddressSync(
      this.data.positionMint,
      positionWalletKey,
      this.ctx.accountResolverOpts.allowPDAOwnerAddress
    );

    const baseParams = {
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
    };
    // V2 can handle TokenProgram/TokenProgram pool, but it increases the size of transaction, so V1 is prefer if possible.
    const increaseIx = !TokenExtensionUtil.isV2IxRequiredPool(tokenExtensionCtx)
      ? increaseLiquidityIx(this.ctx.program, baseParams)
      : increaseLiquidityV2Ix(this.ctx.program, {
        ...baseParams,
        tokenMintA: whirlpool.tokenMintA,
        tokenMintB: whirlpool.tokenMintB,
        tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
        tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
        // TODO: transfer hook extra accounts
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
    const whirlpool = await this.ctx.fetcher.getPool(this.data.whirlpool, IGNORE_CACHE);

    if (!whirlpool) {
      throw new Error("Unable to fetch whirlpool for this position.");
    }

    const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(this.ctx.fetcher, whirlpool, IGNORE_CACHE);

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts
    );
    let tokenOwnerAccountA: PublicKey;
    let tokenOwnerAccountB: PublicKey;

    if (resolveATA) {
      const [ataA, ataB] = await resolveOrCreateATAs(
        this.ctx.connection,
        sourceWalletKey,
        [{ tokenMint: whirlpool.tokenMintA }, { tokenMint: whirlpool.tokenMintB }],
        () => this.ctx.fetcher.getAccountRentExempt(),
        ataPayerKey,
        undefined, // use default
        this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        this.ctx.accountResolverOpts.createWrappedSolAccountMethod
      );
      const { address: ataAddrA, ...tokenOwnerAccountAIx } = ataA!;
      const { address: ataAddrB, ...tokenOwnerAccountBIx } = ataB!;
      tokenOwnerAccountA = ataAddrA;
      tokenOwnerAccountB = ataAddrB;
      txBuilder.addInstruction(tokenOwnerAccountAIx);
      txBuilder.addInstruction(tokenOwnerAccountBIx);
    } else {
      tokenOwnerAccountA = getAssociatedTokenAddressSync(
        whirlpool.tokenMintA,
        sourceWalletKey,
        this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
      );
      tokenOwnerAccountB = getAssociatedTokenAddressSync(
        whirlpool.tokenMintB,
        sourceWalletKey,
        this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
      );
    }

    const baseParams = {
      ...liquidityInput,
      whirlpool: this.data.whirlpool,
      position: this.address,
      positionTokenAccount: getAssociatedTokenAddressSync(
        this.data.positionMint,
        positionWalletKey,
        this.ctx.accountResolverOpts.allowPDAOwnerAddress
      ),
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
    };
    // V2 can handle TokenProgram/TokenProgram pool, but it increases the size of transaction, so V1 is prefer if possible.
    const decreaseIx = !TokenExtensionUtil.isV2IxRequiredPool(tokenExtensionCtx)
      ? decreaseLiquidityIx(this.ctx.program, baseParams)
      : decreaseLiquidityV2Ix(this.ctx.program, {
        ...baseParams,
        tokenMintA: whirlpool.tokenMintA,
        tokenMintB: whirlpool.tokenMintB,
        tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
        tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
        // TODO: transfer hook extra accounts
      });
    txBuilder.addInstruction(decreaseIx);
    return txBuilder;
  }

  async collectFees(
    updateFeesAndRewards: boolean = true,
    ownerTokenAccountMap?: Partial<Record<string, Address>>,
    destinationWallet?: Address,
    positionWallet?: Address,
    ataPayer?: Address,
    opts: WhirlpoolAccountFetchOptions = PREFER_CACHE
  ): Promise<TransactionBuilder> {
    const [destinationWalletKey, positionWalletKey, ataPayerKey] = AddressUtil.toPubKeys([
      destinationWallet ?? this.ctx.wallet.publicKey,
      positionWallet ?? this.ctx.wallet.publicKey,
      ataPayer ?? this.ctx.wallet.publicKey,
    ]);

    const whirlpool = await this.ctx.fetcher.getPool(this.data.whirlpool, opts);
    if (!whirlpool) {
      throw new Error(
        `Unable to fetch whirlpool (${this.data.whirlpool}) for this position (${this.address}).`
      );
    }

    const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(this.ctx.fetcher, whirlpool, IGNORE_CACHE);

    let txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts
    );

    const accountExemption = await this.ctx.fetcher.getAccountRentExempt();

    let ataMap = { ...ownerTokenAccountMap };

    if (!ownerTokenAccountMap) {
      const affliatedMints = getTokenMintsFromWhirlpools([whirlpool], TokenMintTypes.POOL_ONLY);
      const { ataTokenAddresses: affliatedTokenAtaMap, resolveAtaIxs } = await resolveAtaForMints(
        this.ctx,
        {
          mints: affliatedMints.mintMap,
          accountExemption,
          receiver: destinationWalletKey,
          payer: ataPayerKey,
        }
      );

      txBuilder.addInstructions(resolveAtaIxs);

      if (affliatedMints.hasNativeMint) {
        let { address: wSOLAta, ...resolveWSolIx } =
          TokenUtil.createWrappedNativeAccountInstruction(
            destinationWalletKey,
            ZERO,
            accountExemption,
            ataPayerKey,
            destinationWalletKey,
            this.ctx.accountResolverOpts.createWrappedSolAccountMethod
          );
        affliatedTokenAtaMap[NATIVE_MINT.toBase58()] = wSOLAta;
        txBuilder.addInstruction(resolveWSolIx);
      }

      ataMap = { ...affliatedTokenAtaMap };
    }

    const tokenOwnerAccountA = ataMap[whirlpool.tokenMintA.toBase58()];
    invariant(
      !!tokenOwnerAccountA,
      `No owner token account provided for wallet ${destinationWalletKey.toBase58()} for token A ${whirlpool.tokenMintA.toBase58()} `
    );
    const tokenOwnerAccountB = ataMap[whirlpool.tokenMintB.toBase58()];
    invariant(
      !!tokenOwnerAccountB,
      `No owner token account provided for wallet ${destinationWalletKey.toBase58()} for token B ${whirlpool.tokenMintB.toBase58()} `
    );

    const positionTokenAccount = getAssociatedTokenAddressSync(
      this.data.positionMint,
      positionWalletKey,
      this.ctx.accountResolverOpts.allowPDAOwnerAddress
    );

    if (updateFeesAndRewards && !this.data.liquidity.isZero()) {
      const updateIx = await this.updateFeesAndRewards();
      txBuilder.addInstruction(updateIx);
    }

    const baseParams = {
      whirlpool: this.data.whirlpool,
      position: this.address,
      positionTokenAccount,
      tokenOwnerAccountA: AddressUtil.toPubKey(tokenOwnerAccountA),
      tokenOwnerAccountB: AddressUtil.toPubKey(tokenOwnerAccountB),
      tokenVaultA: whirlpool.tokenVaultA,
      tokenVaultB: whirlpool.tokenVaultB,
      positionAuthority: positionWalletKey,
    };
    // V2 can handle TokenProgram/TokenProgram pool, but it increases the size of transaction, so V1 is prefer if possible.
    const ix = !TokenExtensionUtil.isV2IxRequiredPool(tokenExtensionCtx)
      ? collectFeesIx(this.ctx.program, baseParams)
      : collectFeesV2Ix(this.ctx.program, {
        ...baseParams,
        tokenMintA: whirlpool.tokenMintA,
        tokenMintB: whirlpool.tokenMintB,
        tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
        tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
        // TODO: transfer hook extra accounts
      });
    txBuilder.addInstruction(ix);

    return txBuilder;
  }

  async collectRewards(
    rewardsToCollect?: Address[],
    updateFeesAndRewards: boolean = true,
    ownerTokenAccountMap?: Partial<Record<string, Address>>,
    destinationWallet?: Address,
    positionWallet?: Address,
    ataPayer?: Address,
    opts: WhirlpoolAccountFetchOptions = IGNORE_CACHE
  ): Promise<TransactionBuilder> {
    const [destinationWalletKey, positionWalletKey, ataPayerKey] = AddressUtil.toPubKeys([
      destinationWallet ?? this.ctx.wallet.publicKey,
      positionWallet ?? this.ctx.wallet.publicKey,
      ataPayer ?? this.ctx.wallet.publicKey,
    ]);

    const whirlpool = await this.ctx.fetcher.getPool(this.data.whirlpool, opts);
    if (!whirlpool) {
      throw new Error(
        `Unable to fetch whirlpool(${this.data.whirlpool}) for this position(${this.address}).`
      );
    }

    const initializedRewards = whirlpool.rewardInfos.filter((info) =>
      PoolUtil.isRewardInitialized(info)
    );

    const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(this.ctx.fetcher, whirlpool, IGNORE_CACHE);

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts
    );

    const accountExemption = await this.ctx.fetcher.getAccountRentExempt();

    let ataMap = { ...ownerTokenAccountMap };
    if (!ownerTokenAccountMap) {
      const rewardMints = getTokenMintsFromWhirlpools([whirlpool], TokenMintTypes.REWARD_ONLY);
      const { ataTokenAddresses: affliatedTokenAtaMap, resolveAtaIxs } = await resolveAtaForMints(
        this.ctx,
        {
          mints: rewardMints.mintMap,
          accountExemption,
          receiver: destinationWalletKey,
          payer: ataPayerKey,
        }
      );

      if (rewardMints.hasNativeMint) {
        let { address: wSOLAta, ...resolveWSolIx } =
          TokenUtil.createWrappedNativeAccountInstruction(
            destinationWalletKey,
            ZERO,
            accountExemption,
            ataPayerKey,
            destinationWalletKey,
            this.ctx.accountResolverOpts.createWrappedSolAccountMethod
          );
        affliatedTokenAtaMap[NATIVE_MINT.toBase58()] = wSOLAta;
        txBuilder.addInstruction(resolveWSolIx);
      }

      txBuilder.addInstructions(resolveAtaIxs);

      ataMap = { ...affliatedTokenAtaMap };
    }

    const positionTokenAccount = getAssociatedTokenAddressSync(
      this.data.positionMint,
      positionWalletKey,
      this.ctx.accountResolverOpts.allowPDAOwnerAddress
    );
    if (updateFeesAndRewards && !this.data.liquidity.isZero()) {
      const updateIx = await this.updateFeesAndRewards();
      txBuilder.addInstruction(updateIx);
    }

    initializedRewards.forEach((info, index) => {
      if (
        rewardsToCollect &&
        !rewardsToCollect.some((r) => r.toString() === info.mint.toBase58())
      ) {
        // If rewardsToCollect is specified and this reward is not in it,
        // don't include collectIX for that in TX
        return;
      }

      const rewardOwnerAccount = ataMap[info.mint.toBase58()];
      invariant(
        !!rewardOwnerAccount,
        `No owner token account provided for wallet ${destinationWalletKey.toBase58()} for reward ${index} token ${info.mint.toBase58()} `
      );

      const baseParams = {
        whirlpool: this.data.whirlpool,
        position: this.address,
        positionTokenAccount,
        rewardIndex: index,
        rewardOwnerAccount: AddressUtil.toPubKey(rewardOwnerAccount),
        rewardVault: info.vault,
        positionAuthority: positionWalletKey,
      };
      // V2 can handle TokenProgram/TokenProgram pool, but it increases the size of transaction, so V1 is prefer if possible.
      const ix = !TokenExtensionUtil.isV2IxRequiredReward(tokenExtensionCtx, index)
        ? collectRewardIx(this.ctx.program, baseParams)
        : collectRewardV2Ix(this.ctx.program, {
          ...baseParams,
          rewardMint: info.mint,
          rewardTokenProgram: tokenExtensionCtx.rewardTokenMintsWithProgram[index]!.tokenProgram,
          // TODO: transfer hook extension
        });
      txBuilder.addInstruction(ix);
    });

    return txBuilder;
  }

  private async refresh() {
    const positionAccount = await this.ctx.fetcher.getPosition(this.address, IGNORE_CACHE);
    if (!!positionAccount) {
      this.data = positionAccount;
    }
    const whirlpoolAccount = await this.ctx.fetcher.getPool(this.data.whirlpool, IGNORE_CACHE);
    if (!!whirlpoolAccount) {
      this.whirlpoolData = whirlpoolAccount;
    }

    const [lowerTickArray, upperTickArray] = await getTickArrayDataForPosition(
      this.ctx,
      this.data,
      this.whirlpoolData,
      IGNORE_CACHE
    );
    if (lowerTickArray) {
      this.lowerTickArrayData = lowerTickArray;
    }
    if (upperTickArray) {
      this.upperTickArrayData = upperTickArray;
    }
  }

  private async updateFeesAndRewards(): Promise<Instruction> {
    const whirlpool = await this.ctx.fetcher.getPool(this.data.whirlpool);
    if (!whirlpool) {
      throw new Error(
        `Unable to fetch whirlpool(${this.data.whirlpool}) for this position(${this.address}).`
      );
    }

    const [tickArrayLowerPda, tickArrayUpperPda] = [
      this.data.tickLowerIndex,
      this.data.tickUpperIndex,
    ].map((tickIndex) =>
      PDAUtil.getTickArrayFromTickIndex(
        tickIndex,
        whirlpool.tickSpacing,
        this.data.whirlpool,
        this.ctx.program.programId
      )
    );

    const updateIx = updateFeesAndRewardsIx(this.ctx.program, {
      whirlpool: this.data.whirlpool,
      position: this.address,
      tickArrayLower: tickArrayLowerPda.publicKey,
      tickArrayUpper: tickArrayUpperPda.publicKey,
    });

    return updateIx;
  }
}
