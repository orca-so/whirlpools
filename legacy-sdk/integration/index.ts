import { clusterApiUrl, Connection } from "@solana/web3.js";
import { AnchorProvider, type Wallet } from "@coral-xyz/anchor";
import { buildWhirlpoolClient, WhirlpoolContext, ORCA_WHIRLPOOL_PROGRAM_ID } from "@oasismystre/whirlpools";

import Decimal from "decimal.js";
import { isVersionedTransaction, Percentage } from "@orca-so/common-sdk";
import type {
  VersionedTransaction,
  PublicKey,
  TransactionInstruction,
  Blockhash,
} from "@solana/web3.js";
import {
  toTx,
  PDAUtil,
  PriceMath,
  TickUtil,
  WhirlpoolIx,
  TokenExtensionUtil,
  increaseLiquidityQuoteByInputToken,
  decreaseLiquidityQuoteByLiquidity,
  type Whirlpool,
  type Position,
  type WhirlpoolClient,
  type WhirlpoolAccountFetcherInterface,
} from "@orca-so/whirlpools-sdk";

type SharedBuildCreatePositionArgs = {
  pool: Whirlpool;
  owner: PublicKey;
  slippage: number;
  inputAmount: number;
  inputMint: PublicKey;
};

type BuildCreatePositionArgs = (
  | {
      strategyType: "Full";
    }
  | {
      strategyType: "Custom";
      priceChanges: [number, number];
    }
) &
  SharedBuildCreatePositionArgs;

export class OrcaLegacyDLMM {
  readonly context: WhirlpoolContext;
  readonly fetcher: WhirlpoolAccountFetcherInterface;

  constructor(readonly client: WhirlpoolClient) {
    this.fetcher = this.client.getFetcher();
    this.context = this.client.getContext();
  }

  readonly buildCreatePosition = async (
    args: BuildCreatePositionArgs & {
      appendInstructions?: TransactionInstruction | TransactionInstruction[];
    },
  ) => {
    const {
      pool,
      slippage,
      inputAmount,
      inputMint,
      owner,
      appendInstructions,
    } = args;
    this.context.provider.wallet.publicKey = owner;

    const poolData = pool.getData();
    const poolTokenAInfo = pool.getTokenAInfo();
    const poolTokenBInfo = pool.getTokenBInfo();

    let lowerTick: number, upperTick: number;
    const transactions: VersionedTransaction[] = [];

    const latestBlockhash = await this.context.connection.getLatestBlockhash();
    const txConfig = {
      latestBlockhash,
      maxSupportedTransactionVersion: 0,
      blockhashCommitment: "confirmed",
      computeBudgetOption: {
        type: "none",
      },
    } as const;

    if (args.strategyType === "Custom") {
      const [lowerPriceChange, upperPriceChange] = args.priceChanges;

      const currentPrice = PriceMath.tickIndexToPrice(
        poolData.tickCurrentIndex,
        poolTokenAInfo.decimals,
        poolTokenBInfo.decimals,
      ).toNumber();

      lowerTick = TickUtil.getInitializableTickIndex(
        PriceMath.priceToTickIndex(
          new Decimal(currentPrice + currentPrice * lowerPriceChange),
          poolTokenAInfo.decimals,
          poolTokenBInfo.decimals,
        ),
        poolData.tickSpacing,
      );
      upperTick = TickUtil.getInitializableTickIndex(
        PriceMath.priceToTickIndex(
          new Decimal(currentPrice + currentPrice * upperPriceChange),
          poolTokenAInfo.decimals,
          poolTokenBInfo.decimals,
        ),
        poolData.tickSpacing,
      );
      const taPdas = [
        PDAUtil.getTickArray(
          this.context.program.programId,
          pool.getAddress(),
          lowerTick,
        ),
        PDAUtil.getTickArray(
          this.context.program.programId,
          pool.getAddress(),
          upperTick,
        ),
      ];

      const uninitalizedTickArrays = mapFilter(
        await this.fetcher.getTickArrays(taPdas.map((pda) => pda.publicKey)),
        (ta, index) => {
          const pda = taPdas[index];
          if (pda && !ta)
            return {
              pda,
              startTickIndex: index === 0 ? lowerTick : upperTick,
            };
        },
      );

      transactions.push(
        ...mapFilter(uninitalizedTickArrays, (ta) => {
          const txBuilder = toTx(
            this.context,
            WhirlpoolIx.initTickArrayIx(this.context.program, {
              funder: owner,
              tickArrayPda: ta.pda,
              whirlpool: pool.getAddress(),
              startTick: ta.startTickIndex,
            }),
          );

          const { transaction, signers } = txBuilder.buildSync(txConfig);
          if (isVersionedTransaction(transaction)) {
            transaction.sign(signers);
            return transaction;
          }

          return null;
        }),
      );
    } else
      [lowerTick, upperTick] = TickUtil.getFullRangeTickIndex(
        poolData.tickSpacing,
      );

    const tokenExtension = await TokenExtensionUtil.buildTokenExtensionContext(
      this.client.getFetcher(),
      poolData,
    );

    const quote = increaseLiquidityQuoteByInputToken(
      inputMint,
      new Decimal(inputAmount),
      lowerTick,
      upperTick,
      Percentage.fromDecimal(new Decimal(slippage)),
      pool,
      tokenExtension,
    );

    const { tx, positionMint } = await pool.openPosition(
      lowerTick,
      upperTick,
      quote,
      owner,
      owner,
    );
    if (appendInstructions)
      tx.addInstructions([
        {
          signers: [],
          cleanupInstructions: [],
          instructions: Array.isArray(appendInstructions)
            ? appendInstructions
            : [appendInstructions],
        },
      ]);
    const { signers, transaction } = tx.buildSync(txConfig);
    if (isVersionedTransaction(transaction)) {
      transaction.sign(signers);
      transactions.push(transaction);
    }

    return {
      transactions,
      positionMint,
    };
  };

  readonly buildPreloadedCreatePosition = async (
    args: Omit<BuildCreatePositionArgs, "priceChanges" | "strategyType"> & {
      lowerTick: number;
      upperTick: number;
      appendInstructions?: TransactionInstruction[];
    },
  ) => {
    const {
      pool,
      slippage,
      inputAmount,
      inputMint,
      owner,
      lowerTick,
      upperTick,
      appendInstructions,
    } = args;
    this.context.provider.wallet.publicKey = owner;
    const fetcher = this.client.getFetcher();
    const context = this.client.getContext();
    const poolData = pool.getData();

    const transactions: VersionedTransaction[] = [];
    const latestBlockhash = await this.context.connection.getLatestBlockhash();
    const txConfig = {
      latestBlockhash,
      maxSupportedTransactionVersion: 0,
      blockhashCommitment: "confirmed",
      computeBudgetOption: {
        type: "none",
      },
    } as const;

    const taPdas = [
      PDAUtil.getTickArray(
        context.program.programId,
        pool.getAddress(),
        lowerTick,
      ),
      PDAUtil.getTickArray(
        context.program.programId,
        pool.getAddress(),
        upperTick,
      ),
    ];

    const uninitalizedTickArrays = mapFilter(
      await fetcher.getTickArrays(taPdas.map((pda) => pda.publicKey)),
      (ta, index) => {
        const pda = taPdas[index];
        if (pda && !ta)
          return {
            pda,
            startTickIndex: index === 0 ? lowerTick : upperTick,
          };
      },
    );

    transactions.push(
      ...mapFilter(uninitalizedTickArrays, (ta) => {
        const { buildSync } = toTx(
          this.context,
          WhirlpoolIx.initTickArrayIx(this.context.program, {
            funder: owner,
            tickArrayPda: ta.pda,
            whirlpool: pool.getAddress(),
            startTick: ta.startTickIndex,
          }),
        );

        const { transaction, signers } = buildSync(txConfig);
        if (isVersionedTransaction(transaction)) {
          transaction.sign(signers);
          return transaction;
        }

        return null;
      }),
    );

    const tokenExtension = await TokenExtensionUtil.buildTokenExtensionContext(
      this.client.getFetcher(),
      poolData,
    );

    const quote = increaseLiquidityQuoteByInputToken(
      inputMint,
      new Decimal(inputAmount),
      lowerTick,
      upperTick,
      Percentage.fromDecimal(new Decimal(slippage)),
      pool,
      tokenExtension,
    );

    const { tx, positionMint } = await pool.openPosition(
      lowerTick,
      upperTick,
      quote,
      owner,
      owner,
    );
    if (appendInstructions)
      tx.addInstructions([
        {
          signers: [],
          cleanupInstructions: [],
          instructions: appendInstructions,
        },
      ]);
    const { signers, transaction } = tx.buildSync(txConfig);
    if (isVersionedTransaction(transaction)) {
      transaction.sign(signers);
      transactions.push(transaction);
    }

    return {
      transactions,
      positionMint,
    };
  };

  readonly buildClaimReward = async ({
    owner,
    latestBlockhash,
    prependInstructions,
    position: positionPubkey,
  }: {
    owner: PublicKey;
    position: PublicKey;
    prependInstructions?: TransactionInstruction | TransactionInstruction[];
    latestBlockhash?: {
      blockhash: Blockhash;
      lastValidBlockHeight: number;
    };
  }) => {
    this.context.provider.wallet.publicKey = owner;

    const position = await this.client.getPosition(positionPubkey);
    const transactions: VersionedTransaction[] = [];
    latestBlockhash = latestBlockhash
      ? latestBlockhash
      : await this.context.connection.getLatestBlockhash();
    const txConfig = {
      latestBlockhash,
      maxSupportedTransactionVersion: 0,
      blockhashCommitment: "confirmed",
      computeBudgetOption: {
        type: "none",
      },
    } as const;

    const collectFeeTxBuilder = await position.collectFees();
    if (prependInstructions)
      collectFeeTxBuilder.prependInstructions([
        {
          signers: [],
          cleanupInstructions: [],
          instructions: Array.isArray(prependInstructions)
            ? prependInstructions
            : [prependInstructions],
        },
      ]);
    const { transaction, signers } = collectFeeTxBuilder.buildSync(txConfig);
    if (isVersionedTransaction(transaction)) {
      transaction.sign(signers);
      transactions.push(transaction);
    }
    const collectRewardTxBuilders = await position.collectRewards();
    for (const txBuilder of collectRewardTxBuilders) {
      const { transaction, signers } = txBuilder.buildSync(txConfig);
      if (isVersionedTransaction(transaction)) {
        transaction.sign(signers);
        transactions.push(transaction);
      }
    }

    return transactions;
  };

  readonly buildClosePosition = async ({
    pool,
    owner,
    slippage,
    position,
    prependInstructions,
  }: {
    pool: Whirlpool;
    position: Position;
    slippage: number;
    owner: PublicKey;
    prependInstructions?: TransactionInstruction[] | TransactionInstruction;
  }) => {
    const positionData = position.getData();
    const poolData = pool.getData();

    this.context.provider.wallet.publicKey = owner;

    const transactions: VersionedTransaction[] = [];
    const latestBlockhash = await this.context.connection.getLatestBlockhash();
    const txConfig = {
      latestBlockhash,
      maxSupportedTransactionVersion: 0,
      blockhashCommitment: "confirmed",
      computeBudgetOption: {
        type: "none",
      },
    } as const;

    const claimTxs = await this.buildClaimReward({
      owner,
      latestBlockhash,
      prependInstructions,
      position: position.getAddress(),
    });
    const tokenExtension = await TokenExtensionUtil.buildTokenExtensionContext(
      this.client.getFetcher(),
      poolData,
    );
    const decreaseQuote = decreaseLiquidityQuoteByLiquidity(
      positionData.liquidity,
      Percentage.fromDecimal(new Decimal(slippage)),
      position,
      pool,
      tokenExtension,
    );

    const closePositionTxBuilders = await pool.closePosition(
      position.getAddress(),
      Percentage.fromDecimal(new Decimal(slippage)),
    );

    transactions.push(...claimTxs);
    if (positionData.liquidity.gtn(0)) {
      const { buildSync } = await position.decreaseLiquidity(decreaseQuote);
      const { transaction, signers } = buildSync(txConfig);
      if (isVersionedTransaction(transaction)) {
        transaction.sign(signers);
        transactions.push(transaction);
      }
    }

    for (const { buildSync } of closePositionTxBuilders) {
      const { transaction, signers } = buildSync(txConfig);
      if (isVersionedTransaction(transaction)) {
        transaction.sign(signers);
        transactions.push(transaction);
      }
    }

    return transactions;
  };
}


const connection = new Connection(clusterApiUrl('mainnet-beta'))

const provider = new AnchorProvider(
  connection,
  {  } as Wallet,
  {},
);
const orcaLegacy = new OrcaLegacyDLMM(
  buildWhirlpoolClient(
    WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID),
  ),
);


