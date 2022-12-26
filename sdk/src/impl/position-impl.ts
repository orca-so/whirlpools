import {
  AddressUtil,
  deriveATA,
  Instruction,
  resolveOrCreateATAs,
  TransactionBuilder,
  ZERO,
} from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";
import { WhirlpoolContext } from "../context";
import {
  collectFeesIx,
  collectRewardIx,
  DecreaseLiquidityInput,
  decreaseLiquidityIx,
  IncreaseLiquidityInput,
  increaseLiquidityIx,
  updateFeesAndRewardsIx,
} from "../instructions";
import { PositionData, TickArrayData, TickData, WhirlpoolData } from "../types/public";
import { getTickArrayDataForPosition } from "../utils/builder/position-builder-util";
import { PDAUtil, PoolUtil, TickArrayUtil, TickUtil } from "../utils/public";
import { createWSOLAccountInstructions } from "../utils/spl-token-utils";
import {
  getTokenMintsFromWhirlpools,
  resolveAtaForMints,
  TokenMintTypes,
} from "../utils/whirlpool-ata-utils";
import { Position } from "../whirlpool-client";

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

    const whirlpool = await this.ctx.fetcher.getPool(this.data.whirlpool, true);
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
        () => this.ctx.fetcher.getAccountRentExempt(),
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
    const whirlpool = await this.ctx.fetcher.getPool(this.data.whirlpool, true);

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
        () => this.ctx.fetcher.getAccountRentExempt(),
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
    updateFeesAndRewards: boolean = true,
    ownerTokenAccountMap?: Partial<Record<string, Address>>,
    destinationWallet?: Address,
    positionWallet?: Address,
    ataPayer?: Address,
    refresh = false
  ): Promise<TransactionBuilder> {
    const [destinationWalletKey, positionWalletKey, ataPayerKey] = AddressUtil.toPubKeys([
      destinationWallet ?? this.ctx.wallet.publicKey,
      positionWallet ?? this.ctx.wallet.publicKey,
      ataPayer ?? this.ctx.wallet.publicKey,
    ]);

    const whirlpool = await this.ctx.fetcher.getPool(this.data.whirlpool, refresh);
    if (!whirlpool) {
      throw new Error(
        `Unable to fetch whirlpool (${this.data.whirlpool}) for this position (${this.address}).`
      );
    }

    let txBuilder = new TransactionBuilder(this.ctx.provider.connection, this.ctx.provider.wallet);

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
        let { address: wSOLAta, ...resolveWSolIx } = createWSOLAccountInstructions(
          destinationWalletKey,
          ZERO,
          accountExemption,
          ataPayerKey,
          destinationWalletKey
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

    const positionTokenAccount = await deriveATA(positionWalletKey, this.data.positionMint);

    if (updateFeesAndRewards && !this.data.liquidity.isZero()) {
      const updateIx = await this.updateFeesAndRewards();
      txBuilder.addInstruction(updateIx);
    }

    const ix = collectFeesIx(this.ctx.program, {
      whirlpool: this.data.whirlpool,
      position: this.address,
      positionTokenAccount,
      tokenOwnerAccountA: AddressUtil.toPubKey(tokenOwnerAccountA),
      tokenOwnerAccountB: AddressUtil.toPubKey(tokenOwnerAccountB),
      tokenVaultA: whirlpool.tokenVaultA,
      tokenVaultB: whirlpool.tokenVaultB,
      positionAuthority: positionWalletKey,
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
    refresh = true
  ): Promise<TransactionBuilder> {
    const [destinationWalletKey, positionWalletKey, ataPayerKey] = AddressUtil.toPubKeys([
      destinationWallet ?? this.ctx.wallet.publicKey,
      positionWallet ?? this.ctx.wallet.publicKey,
      ataPayer ?? this.ctx.wallet.publicKey,
    ]);

    const whirlpool = await this.ctx.fetcher.getPool(this.data.whirlpool, refresh);
    if (!whirlpool) {
      throw new Error(
        `Unable to fetch whirlpool(${this.data.whirlpool}) for this position(${this.address}).`
      );
    }

    const initializedRewards = whirlpool.rewardInfos.filter((info) =>
      PoolUtil.isRewardInitialized(info)
    );

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet
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
        let { address: wSOLAta, ...resolveWSolIx } = createWSOLAccountInstructions(
          destinationWalletKey,
          ZERO,
          accountExemption
        );
        affliatedTokenAtaMap[NATIVE_MINT.toBase58()] = wSOLAta;
        txBuilder.addInstruction(resolveWSolIx);
      }

      txBuilder.addInstructions(resolveAtaIxs);

      ataMap = { ...affliatedTokenAtaMap };
    }

    const positionTokenAccount = await deriveATA(positionWalletKey, this.data.positionMint);
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

      const ix = collectRewardIx(this.ctx.program, {
        whirlpool: this.data.whirlpool,
        position: this.address,
        positionTokenAccount,
        rewardIndex: index,
        rewardOwnerAccount: AddressUtil.toPubKey(rewardOwnerAccount),
        rewardVault: info.vault,
        positionAuthority: positionWalletKey,
      });

      txBuilder.addInstruction(ix);
    });

    return txBuilder;
  }

  private async refresh() {
    const positionAccount = await this.ctx.fetcher.getPosition(this.address, true);
    if (!!positionAccount) {
      this.data = positionAccount;
    }
    const whirlpoolAccount = await this.ctx.fetcher.getPool(this.data.whirlpool, true);
    if (!!whirlpoolAccount) {
      this.whirlpoolData = whirlpoolAccount;
    }

    const [lowerTickArray, upperTickArray] = await getTickArrayDataForPosition(
      this.ctx,
      this.data,
      this.whirlpoolData,
      true
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
