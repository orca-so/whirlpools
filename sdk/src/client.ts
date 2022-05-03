import { WhirlpoolContext } from "./context";
import { PublicKey } from "@solana/web3.js";
import { WhirlpoolConfigAccount } from "./types/public/account-types";
import { TransactionBuilder } from "./utils/transactions/transactions-builder";
import { buildInitializeConfigIx } from "./instructions/initialize-config-ix";
import {
  ClosePositionParams,
  CollectFeesParams,
  CollectProtocolFeesParams,
  CollectRewardParams,
  InitConfigParams,
  InitializeRewardParams,
  InitPoolParams,
  InitTickArrayParams,
  OpenPositionParams,
  SetCollectProtocolFeesAuthorityParams,
  SetFeeAuthorityParams,
  SetRewardAuthorityBySuperAuthorityParams,
  parsePosition,
  parseTickArray,
  parseWhirlpool,
  parseWhirlpoolsConfig,
  SetRewardAuthorityParams,
  SetRewardEmissionsParams,
  SetRewardEmissionsSuperAuthorityParams,
  SwapParams,
  UpdateFeesAndRewardsParams,
  SetFeeRateParams,
  SetDefaultProtocolFeeRateParams,
  SetProtocolFeeRateParams,
  SetDefaultFeeRateParams,
  DecreaseLiquidityParams,
  IncreaseLiquidityParams,
  InitFeeTierParams,
} from ".";
import { buildInitPoolIx } from "./instructions/initialize-pool-ix";
import {
  FeeTierData,
  PositionData,
  TickArrayData,
  WhirlpoolData,
} from "./types/public/anchor-types";
import {
  buildOpenPositionIx,
  buildOpenPositionWithMetadataIx,
} from "./instructions/open-position-ix";
import { buildInitTickArrayIx } from "./instructions/initialize-tick-array-ix";
import { buildIncreaseLiquidityIx } from "./instructions/increase-liquidity-ix";
import { buildCollectFeesIx } from "./instructions/collect-fees-ix";
import { buildCollectRewardIx } from "./instructions/collect-reward-ix";
import { buildSwapIx } from "./instructions/swap-ix";
import { buildInitializeRewardIx } from "./instructions/initialize-reward-ix";
import { buildSetRewardEmissionsSuperAuthorityIx } from "./instructions/set-reward-emissions-super-authority-ix";
import { buildSetRewardAuthorityIx } from "./instructions/set-reward-authority-ix";
import { buildSetRewardEmissionsIx } from "./instructions/set-reward-emissions-ix";
import { buildClosePositionIx } from "./instructions/close-position-ix";
import { buildSetRewardAuthorityBySuperAuthorityIx } from "./instructions/set-reward-authority-by-super-authority-ix";
import { buildSetFeeAuthorityIx } from "./instructions/set-fee-authority-ix";
import { buildSetCollectProtocolFeesAuthorityIx } from "./instructions/set-collect-protocol-fees-authority-ix";
import { buildUpdateFeesAndRewardsIx } from "./instructions/update-fees-and-rewards-ix";
import { buildCollectProtocolFeesIx } from "./instructions/collect-protocol-fees-ix";
import { buildDecreaseLiquidityIx } from "./instructions/decrease-liquidity-ix";
import { buildSetFeeRateIx } from "./instructions/set-fee-rate-ix";
import { buildSetDefaultProtocolFeeRateIx } from "./instructions/set-default-protocol-fee-rate-ix";
import { buildSetDefaultFeeRateIx } from "./instructions/set-default-fee-rate-ix";
import { buildSetProtocolFeeRateIx } from "./instructions/set-protocol-fee-rate-ix";
import { buildInitializeFeeTier } from "./instructions/initialize-fee-tier";
import { Decimal } from "decimal.js";

// Global rules for Decimals
//  - 40 digits of precision for the largest number
//  - 20 digits of precision for the smallest number
//  - Always round towards 0 to mirror smart contract rules
Decimal.set({ precision: 40, toExpPos: 40, toExpNeg: -20, rounding: 1 });

/**
 * WhirlpoolClient provides a portal to perform admin-type tasks on the Whirlpool protocol.
 */
export class WhirlpoolClient {
  readonly context: WhirlpoolContext;

  public constructor(context: WhirlpoolContext) {
    this.context = context;
  }

  /**
   * Construct a TransactionBuilder to initialize a WhirlpoolConfig account with the provided parameters.
   * @param params Parameters to configure the initialized WhirlpoolConfig account
   * @returns A TransactionBuilder to initialize a WhirlpoolConfig account with the provided parameters.
   */
  public initConfigTx(params: InitConfigParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildInitializeConfigIx(this.context, params)
    );
  }

  /**
   * Fetches and parses a WhirlpoolConfig account.
   * @param poolPubKey A public key of a WhirlpoolConfig account
   * @returns A WhirlpoolConfig type containing the parameters stored on the account
   */
  public async getConfig(configPubKey: PublicKey): Promise<WhirlpoolConfigAccount> {
    const program = this.context.program;
    const account = await program.account.whirlpoolsConfig.fetch(configPubKey);
    // TODO: If we feel nice we can build a builder or something instead of casting
    return account as WhirlpoolConfigAccount;
  }

  /**
   * Parses a WhirlpoolConfig account.
   * @param data A buffer containing data fetched from an account
   * @returns A WhirlpoolConfig type containing the parameters stored on the account
   */
  public parseConfig(data: Buffer): WhirlpoolConfigAccount | null {
    return parseWhirlpoolsConfig(data);
  }

  /**
   * Construct a TransactionBuilder to initialize a FeeTier account with the provided parameters.
   * @param params Parameters to configure the initialized FeeTier account
   * @returns A TransactionBuilder to initialize a FeeTier account with the provided parameters.
   */
  public initFeeTierTx(params: InitFeeTierParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildInitializeFeeTier(this.context, params)
    );
  }

  /**
   * Fetches and parses a FeeTier account.
   * @param feeTierKey A public key of a FeeTier account
   * @returns A FeeTier type containing the parameters stored on the account
   */
  public async getFeeTier(feeTierKey: PublicKey): Promise<FeeTierData> {
    const program = this.context.program;

    const feeTierAccount = await program.account.feeTier.fetch(feeTierKey);
    return feeTierAccount as unknown as FeeTierData;
  }

  /**
   * Construct a TransactionBuilder to initialize a Whirlpool account with the provided parameters.
   * @param params Parameters to configure the initialized Whirlpool account
   * @returns A TransactionBuilder to initialize a Whirlpool account with the provided parameters.
   */
  public initPoolTx(params: InitPoolParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildInitPoolIx(this.context, params)
    );
  }

  /**
   * Fetches and parses a Whirlpool account.
   * @param poolPubKey A public key of a Whirlpool account
   * @returns A Whirlpool type containing the parameters stored on the account
   */
  public async getPool(poolKey: PublicKey): Promise<WhirlpoolData> {
    const program = this.context.program;

    const whirlpoolAccount = await program.account.whirlpool.fetch(poolKey);
    return whirlpoolAccount as unknown as WhirlpoolData;
  }

  /**
   * Parses a Whirlpool account.
   * @param data A buffer containing data fetched from an account
   * @returns A Whirlpool type containing the parameters stored on the account
   */
  public parsePool(data: Buffer): WhirlpoolData | null {
    return parseWhirlpool(data);
  }

  /**
   * Construct a TransactionBuilder to open a Position account.
   * @param params Parameters to configure the initialized Position account.
   * @returns A TransactionBuilder to initialize a Position account with the provided parameters.
   */
  public openPositionTx(params: OpenPositionParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildOpenPositionIx(this.context, params)
    );
  }

  /**
   * Construct a TransactionBuilder to open a Position account with metadata.
   * @param params Parameters to configure the initialized Position account.
   * @returns A TransactionBuilder to initialize a Position account with the provided parameters.
   */
  public openPositionWithMetadataTx(params: Required<OpenPositionParams>): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildOpenPositionWithMetadataIx(this.context, params)
    );
  }

  public closePositionTx(params: ClosePositionParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildClosePositionIx(this.context, params)
    );
  }

  /**
   * Fetches a Position account.
   * @param positionKey The public key of the Position account
   * @returns A Position type containing the parameters stored on the account
   */
  public async getPosition(positionKey: PublicKey): Promise<PositionData> {
    const positionAccount = await this.context.program.account.position.fetch(positionKey);
    return positionAccount as unknown as PositionData;
  }

  /**
   * Parses a Position account.
   * @param data A buffer containing data fetched from an account
   * @returns A Position type containing the parameters stored on the account
   */
  public parsePosition(data: Buffer): PositionData | null {
    return parsePosition(data);
  }

  /*
   * Construct a TransactionBuilder to initialize a TickArray account with the provided parameters.
   * @param params Parameters to configure the initialized TickArray account
   * @returns A TransactionBuilder to initialize a TickArray account with the provided parameters.
   */
  public initTickArrayTx(params: InitTickArrayParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildInitTickArrayIx(this.context, params)
    );
  }

  /**
   * Fetches and parses a TickArray account. Account is used to store Ticks for a Whirlpool.
   * @param arrayPubKey A public key of a TickArray account
   * @returns A TickArrayData type containing the parameters stored on the account
   */
  public async getTickArray(arrayPubKey: PublicKey): Promise<TickArrayData> {
    const program = this.context.program;
    const tickArrayAccount = await program.account.tickArray.fetch(arrayPubKey);
    return tickArrayAccount as unknown as TickArrayData;
  }

  /**
   * Parses a TickArray account.
   * @param data A buffer containing data fetched from an account
   * @returns A Position type containing the parameters stored on the account
   */
  public parseTickArray(data: Buffer): TickArrayData | null {
    return parseTickArray(data);
  }

  public initializeRewardTx(params: InitializeRewardParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildInitializeRewardIx(this.context, params)
    );
  }

  public setRewardEmissionsTx(params: SetRewardEmissionsParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildSetRewardEmissionsIx(this.context, params)
    );
  }

  /**
   * Construct a TransactionBuilder to increase the liquidity of a Position.
   * @param params Parameters to configure the increase liquidity instruction
   * @returns A TransactionBuilder containing one increase liquidity instruction
   */
  public increaseLiquidityTx(params: IncreaseLiquidityParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildIncreaseLiquidityIx(this.context, params)
    );
  }

  public decreaseLiquidityTx(params: DecreaseLiquidityParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildDecreaseLiquidityIx(this.context, params)
    );
  }

  public updateFeesAndRewards(params: UpdateFeesAndRewardsParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildUpdateFeesAndRewardsIx(this.context, params)
    );
  }

  /**
   * Construct a TransactionBuilder to collect the fees for a Position.
   * @param params Parameters to configure the collect fees instruction
   * @returns A TransactionBuilder containing one collect fees instruction
   */
  public collectFeesTx(params: CollectFeesParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildCollectFeesIx(this.context, params)
    );
  }

  /**
   * Construct a TransactionBuilder to collect a reward at the specified index for a Position.
   * @param params Parameters to configure the collect reward instruction
   * @returns A TransactionBuilder containing one collect reward instruction
   */
  public collectRewardTx(params: CollectRewardParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildCollectRewardIx(this.context, params)
    );
  }

  public collectProtocolFeesTx(params: CollectProtocolFeesParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildCollectProtocolFeesIx(this.context, params)
    );
  }

  public swapTx(params: SwapParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildSwapIx(this.context, params)
    );
  }

  public setRewardEmissionsSuperAuthorityTx(
    params: SetRewardEmissionsSuperAuthorityParams
  ): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildSetRewardEmissionsSuperAuthorityIx(this.context, params)
    );
  }

  public setRewardAuthorityTx(params: SetRewardAuthorityParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildSetRewardAuthorityIx(this.context, params)
    );
  }

  public setRewardAuthorityBySuperAuthorityTx(
    params: SetRewardAuthorityBySuperAuthorityParams
  ): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildSetRewardAuthorityBySuperAuthorityIx(this.context, params)
    );
  }

  public setFeeAuthorityTx(params: SetFeeAuthorityParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildSetFeeAuthorityIx(this.context, params)
    );
  }

  public setCollectProtocolFeesAuthorityTx(
    params: SetCollectProtocolFeesAuthorityParams
  ): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildSetCollectProtocolFeesAuthorityIx(this.context, params)
    );
  }

  public setFeeRateIx(params: SetFeeRateParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildSetFeeRateIx(this.context, params)
    );
  }

  public setProtocolFeeRateIx(params: SetProtocolFeeRateParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildSetProtocolFeeRateIx(this.context, params)
    );
  }

  public setDefaultFeeRateIx(params: SetDefaultFeeRateParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildSetDefaultFeeRateIx(this.context, params)
    );
  }

  public setDefaultProtocolFeeRateIx(params: SetDefaultProtocolFeeRateParams): TransactionBuilder {
    return new TransactionBuilder(this.context.provider).addInstruction(
      buildSetDefaultProtocolFeeRateIx(this.context, params)
    );
  }
}
