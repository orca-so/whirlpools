import type {
  AddressLookupTableAccount,
  Commitment,
  Connection,
  PublicKey,
  RecentPrioritizationFees,
  SendOptions,
  Signer,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ComputeBudgetProgram,
  PACKET_DATA_SIZE,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Wallet } from "../wallet";
import {
  DEFAULT_MAX_COMPUTE_UNIT_LIMIT,
  DEFAULT_MAX_PRIORITY_FEE_LAMPORTS,
  DEFAULT_MIN_PRIORITY_FEE_LAMPORTS,
  DEFAULT_PRIORITY_FEE_PERCENTILE,
  MICROLAMPORTS_PER_LAMPORT,
  estimateComputeBudgetLimit,
  getLockWritableAccounts,
  getPriorityFeeInLamports,
  setLoadedAccountsDataSizeLimitInstruction,
} from "./compute-budget";
import { MEASUREMENT_BLOCKHASH } from "./constants";
import type { Instruction, TransactionPayload } from "./types";
import { getJitoTipAddress } from "./jito-tip";

/**
  Build options when building a transaction using TransactionBuilder
  @param latestBlockhash
  The latest blockhash to use when building the transaction.
  @param blockhashCommitment
  If latestBlockhash is not provided, the commitment level to use when fetching the latest blockhash.
  @param maxSupportedTransactionVersion
  The transaction version to build. If set to "legacy", the transaction will
  be built using the legacy transaction format. Otherwise, the transaction
  will be built using the VersionedTransaction format.
  @param lookupTableAccounts
  If the build support VersionedTransactions, allow providing the lookup
  table accounts to use when building the transaction. This is only used
  when maxSupportedTransactionVersion is set to a number.
  @param computeBudgetOption
  The compute budget limit and priority fee to use when building the transaction.
  This defaults to 'none'.
 */
export type BuildOptions = LegacyBuildOption | V0BuildOption;

type LegacyBuildOption = {
  maxSupportedTransactionVersion: "legacy";
} & BaseBuildOption;

type V0BuildOption = {
  maxSupportedTransactionVersion: number;
  lookupTableAccounts?: AddressLookupTableAccount[];
} & BaseBuildOption;

type BaseBuildOption = {
  latestBlockhash?: {
    blockhash: string;
    lastValidBlockHeight: number;
  };
  computeBudgetOption?: ComputeBudgetOption;
  blockhashCommitment: Commitment;
};

type ComputeBudgetOption =
  | {
      type: "none";
    }
  | {
      type: "fixed";
      priorityFeeLamports: number;
      computeBudgetLimit?: number;
      jitoTipLamports?: number;
      accountDataSizeLimit?: number;
    }
  | {
      type: "auto";
      maxPriorityFeeLamports?: number;
      minPriorityFeeLamports?: number;
      jitoTipLamports?: number;
      accountDataSizeLimit?: number;
      computeLimitMargin?: number;
      computePricePercentile?: number;
      getPriorityFeePerUnit?: (
        lockedWritableAccounts: PublicKey[],
      ) => Promise<RecentPrioritizationFees[]>;
    };

type SyncBuildOptions = BuildOptions & Required<BaseBuildOption>;

const LEGACY_TX_UNIQUE_KEYS_LIMIT = 35;

/**
 * A set of options that the builder will use by default, unless overridden by the user in each method.
 */
export type TransactionBuilderOptions = {
  defaultBuildOption: BuildOptions;
  defaultSendOption: SendOptions;
  defaultConfirmationCommitment: Commitment;
};

export const defaultTransactionBuilderOptions: TransactionBuilderOptions = {
  defaultBuildOption: {
    maxSupportedTransactionVersion: 0,
    blockhashCommitment: "confirmed",
  },
  defaultSendOption: {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  },
  defaultConfirmationCommitment: "confirmed",
};

/**
 * Transaction builder for composing, building and sending transactions.
 * @category Transactions
 */
export class TransactionBuilder {
  private instructions: Instruction[];
  private signers: Signer[];
  readonly opts: TransactionBuilderOptions;

  constructor(
    readonly connection: Connection,
    readonly wallet: Wallet,
    defaultOpts?: TransactionBuilderOptions,
  ) {
    this.instructions = [];
    this.signers = [];
    this.opts = defaultOpts ?? defaultTransactionBuilderOptions;
  }

  /**
   * Append an instruction into this builder.
   * @param instruction - An Instruction
   * @returns Returns this transaction builder.
   */
  addInstruction(instruction: Instruction): TransactionBuilder {
    this.instructions.push(instruction);
    return this;
  }

  /**
   * Append a list of instructions into this builder.
   * @param instructions - A list of Instructions
   * @returns Returns this transaction builder.
   */
  addInstructions(instructions: Instruction[]): TransactionBuilder {
    this.instructions = this.instructions.concat(instructions);
    return this;
  }

  /**
   * Prepend a list of instructions into this builder.
   * @param instruction - An Instruction
   * @returns Returns this transaction builder.
   */
  prependInstruction(instruction: Instruction): TransactionBuilder {
    this.instructions.unshift(instruction);
    return this;
  }

  /**
   * Prepend a list of instructions into this builder.
   * @param instructions - A list of Instructions
   * @returns Returns this transaction builder.
   */
  prependInstructions(instructions: Instruction[]): TransactionBuilder {
    this.instructions = instructions.concat(this.instructions);
    return this;
  }

  addSigner(signer: Signer): TransactionBuilder {
    this.signers.push(signer);
    return this;
  }

  /**
   * Checks whether this builder contains any instructions.
   * @returns Whether this builder contains any instructions.
   */
  isEmpty(): boolean {
    return this.instructions.length == 0;
  }

  /**
   * Compresses all instructions & signers in this builder
   * into one single instruction
   * @param compressPost Compress all post instructions into the instructions field
   * @returns Instruction object containing all
   */
  compressIx(compressPost: boolean): Instruction {
    let instructions: TransactionInstruction[] = [];
    let cleanupInstructions: TransactionInstruction[] = [];
    let signers: Signer[] = [];
    this.instructions.forEach((curr) => {
      instructions = instructions.concat(curr.instructions);
      // Cleanup instructions should execute in reverse order
      cleanupInstructions =
        curr.cleanupInstructions.concat(cleanupInstructions);
      signers = signers.concat(curr.signers);
    });

    if (compressPost) {
      instructions = instructions.concat(cleanupInstructions);
      cleanupInstructions = [];
    }

    return {
      instructions: [...instructions],
      cleanupInstructions: [...cleanupInstructions],
      signers,
    };
  }

  /**
   * Returns the size of the current transaction in bytes. Measurement method can differ based on the maxSupportedTransactionVersion.
   * @param userOptions - Options to override the default build options
   * @returns the size of the current transaction in bytes.
   * @throws error if there is an error measuring the transaction size.
   *         This can happen if the transaction is too large, or if the transaction contains too many keys to be serialized.
   */
  txnSize(userOptions?: Partial<BuildOptions>): number {
    const finalOptions: SyncBuildOptions = {
      ...this.opts.defaultBuildOption,
      ...userOptions,
      latestBlockhash: MEASUREMENT_BLOCKHASH,
      computeBudgetOption: this.opts.defaultBuildOption.computeBudgetOption ?? {
        type: "none",
      },
    };
    if (this.isEmpty()) {
      return 0;
    }
    const request = this.buildSync(finalOptions);
    const tx = request.transaction;
    return isVersionedTransaction(tx) ? measureV0Tx(tx) : measureLegacyTx(tx);
  }

  /**
   * Constructs a transaction payload with the gathered instructions synchronously
   * @param options - Options used to build the transaction
   * @returns a TransactionPayload object that can be excuted or agregated into other transactions
   */
  buildSync(options: SyncBuildOptions): TransactionPayload {
    const {
      latestBlockhash,
      maxSupportedTransactionVersion,
      computeBudgetOption,
    } = options;

    const ix = this.compressIx(true);
    let prependInstructions: TransactionInstruction[] = [];

    if (computeBudgetOption.type === "fixed") {
      const computeLimit =
        computeBudgetOption.computeBudgetLimit ??
        DEFAULT_MAX_COMPUTE_UNIT_LIMIT;
      const microLamports = Math.floor(
        (computeBudgetOption.priorityFeeLamports * MICROLAMPORTS_PER_LAMPORT) /
          computeLimit,
      );

      prependInstructions = [
        ComputeBudgetProgram.setComputeUnitLimit({
          units: computeLimit,
        }),
      ];
      if (microLamports > 0) {
        prependInstructions.push(
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports,
          }),
        );
      }
      if (computeBudgetOption.accountDataSizeLimit) {
        prependInstructions.push(
          setLoadedAccountsDataSizeLimitInstruction(
            computeBudgetOption.accountDataSizeLimit,
          ),
        );
      }
      if (
        computeBudgetOption.jitoTipLamports &&
        computeBudgetOption.jitoTipLamports > 0
      ) {
        prependInstructions.push(
          SystemProgram.transfer({
            fromPubkey: this.wallet.publicKey,
            toPubkey: getJitoTipAddress(),
            lamports: computeBudgetOption.jitoTipLamports,
          }),
        );
      }
    }

    if (computeBudgetOption.type === "auto") {
      // Auto only works using `build` so when we encounter `auto` here we
      // just use the use 0 priority budget and default compute budget.
      // This should only be happening for calucling the tx size so it should be fine.
      prependInstructions = [
        ComputeBudgetProgram.setComputeUnitLimit({
          units: DEFAULT_MAX_COMPUTE_UNIT_LIMIT,
        }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 0,
        }),
      ];
      if (computeBudgetOption.accountDataSizeLimit) {
        prependInstructions.push(
          setLoadedAccountsDataSizeLimitInstruction(
            computeBudgetOption.accountDataSizeLimit,
          ),
        );
      }
      if (
        computeBudgetOption.jitoTipLamports &&
        computeBudgetOption.jitoTipLamports > 0
      ) {
        prependInstructions.push(
          SystemProgram.transfer({
            fromPubkey: this.wallet.publicKey,
            toPubkey: getJitoTipAddress(),
            lamports: computeBudgetOption.jitoTipLamports,
          }),
        );
      }
    }

    const allSigners = ix.signers.concat(this.signers);

    const recentBlockhash = latestBlockhash;

    if (maxSupportedTransactionVersion === "legacy") {
      const transaction = new Transaction({
        ...recentBlockhash,
        feePayer: this.wallet.publicKey,
      });
      if (prependInstructions.length > 0) {
        transaction.add(...prependInstructions);
      }
      transaction.add(...ix.instructions);
      transaction.feePayer = this.wallet.publicKey;

      return {
        transaction: transaction,
        signers: allSigners,
        recentBlockhash,
      };
    }

    const txnMsg = new TransactionMessage({
      recentBlockhash: recentBlockhash.blockhash,
      payerKey: this.wallet.publicKey,
      instructions: [...prependInstructions, ...ix.instructions],
    });

    const { lookupTableAccounts } = options;

    const msg = txnMsg.compileToV0Message(lookupTableAccounts);
    const v0txn = new VersionedTransaction(msg);

    return {
      transaction: v0txn,
      signers: allSigners,
      recentBlockhash,
    };
  }

  /**
   * Estimates the fee for this transaction
   * @param getPriorityFeePerUnit - A function to get the priority fee per unit
   * @param computeLimitMargin - The margin for the compute budget limit
   * @param selectionPercentile - The percentile to use when calculating the priority fee
   * @param lookupTableAccounts - The lookup table accounts that will be used in the transaction
   * @returns An object containing the estimated values for consumed compute units, priority fee per unit in lamports, and the total priority fee in lamports
   */
  async estimateFee(
    getPriorityFeePerUnit?: (
      lockedWritableAccounts: PublicKey[],
    ) => Promise<RecentPrioritizationFees[]>,
    computeLimitMargin?: number,
    selectionPercentile?: number,
    lookupTableAccounts?: AddressLookupTableAccount[],
  ) {
    const estConsumedComputeUnits = await estimateComputeBudgetLimit(
      this.connection,
      this.instructions,
      lookupTableAccounts,
      this.wallet.publicKey,
      computeLimitMargin ?? 0.1,
    );

    const lockedWritableAccounts = getLockWritableAccounts(this.instructions);

    const estPriorityFeePerUnitInLamports = await (getPriorityFeePerUnit
      ? getPriorityFeePerUnit(lockedWritableAccounts)
      : this.connection.getRecentPrioritizationFees({
          lockedWritableAccounts,
        }));

    const estPriorityFeeInLamports = await getPriorityFeeInLamports(
      this.connection,
      estConsumedComputeUnits,
      lockedWritableAccounts,
      selectionPercentile ?? DEFAULT_PRIORITY_FEE_PERCENTILE,
      getPriorityFeePerUnit,
    );

    return {
      estConsumedComputeUnits,
      estPriorityFeePerUnitInLamports,
      estPriorityFeeInLamports,
    };
  }

  /**
   * Constructs a transaction payload with the gathered instructions
   * @param userOptions - Options to override the default build options
   * @returns a TransactionPayload object that can be excuted or agregated into other transactions
   */
  async build(
    userOptions?: Partial<BuildOptions>,
  ): Promise<TransactionPayload> {
    const finalOptions = { ...this.opts.defaultBuildOption, ...userOptions };
    const { latestBlockhash, blockhashCommitment, computeBudgetOption } =
      finalOptions;
    let recentBlockhash = latestBlockhash;
    if (!recentBlockhash) {
      recentBlockhash =
        await this.connection.getLatestBlockhash(blockhashCommitment);
    }
    let finalComputeBudgetOption = computeBudgetOption ?? { type: "none" };

    const lookupTableAccounts =
      finalOptions.maxSupportedTransactionVersion === "legacy"
        ? undefined
        : finalOptions.lookupTableAccounts;

    if (finalComputeBudgetOption.type === "auto") {
      const computeBudgetLimit = await estimateComputeBudgetLimit(
        this.connection,
        this.instructions,
        lookupTableAccounts,
        this.wallet.publicKey,
        finalComputeBudgetOption.computeLimitMargin ?? 0.1,
      );
      const percentile =
        finalComputeBudgetOption.computePricePercentile ??
        DEFAULT_PRIORITY_FEE_PERCENTILE;
      const priorityFee = await getPriorityFeeInLamports(
        this.connection,
        computeBudgetLimit,
        getLockWritableAccounts(this.instructions),
        percentile,
        finalComputeBudgetOption.getPriorityFeePerUnit,
      );
      const maxPriorityFeeLamports =
        finalComputeBudgetOption.maxPriorityFeeLamports ??
        DEFAULT_MAX_PRIORITY_FEE_LAMPORTS;
      const minPriorityFeeLamports =
        finalComputeBudgetOption.minPriorityFeeLamports ??
        DEFAULT_MIN_PRIORITY_FEE_LAMPORTS;
      const priorityFeeLamports = Math.max(
        Math.min(priorityFee, maxPriorityFeeLamports),
        minPriorityFeeLamports,
      );
      finalComputeBudgetOption = {
        type: "fixed",
        priorityFeeLamports,
        computeBudgetLimit,
        accountDataSizeLimit: finalComputeBudgetOption.accountDataSizeLimit,
        jitoTipLamports: finalComputeBudgetOption.jitoTipLamports,
      };
    } else if (
      finalComputeBudgetOption.type === "fixed" &&
      finalComputeBudgetOption.computeBudgetLimit === undefined
    ) {
      const computeBudgetLimit = await estimateComputeBudgetLimit(
        this.connection,
        this.instructions,
        lookupTableAccounts,
        this.wallet.publicKey,
        0.1,
      );
      finalComputeBudgetOption = {
        ...finalComputeBudgetOption,
        computeBudgetLimit,
      };
    }
    return this.buildSync({
      ...finalOptions,
      latestBlockhash: recentBlockhash,
      computeBudgetOption: finalComputeBudgetOption,
    });
  }

  /**
   * Constructs a transaction payload with the gathered instructions, sign it with the provider and send it out
   * @param options - Options to build the transaction. . Overrides the default options provided in the constructor.
   * @param sendOptions - Options to send the transaction. Overrides the default options provided in the constructor.
   * @param confirmCommitment - Commitment level to wait for transaction confirmation. Overrides the default options provided in the constructor.
   * @returns the txId of the transaction
   */
  async buildAndExecute(
    options?: Partial<BuildOptions>,
    sendOptions?: Partial<SendOptions>,
    confirmCommitment?: Commitment,
  ): Promise<string> {
    const sendOpts = { ...this.opts.defaultSendOption, ...sendOptions };
    const btx = await this.build(options);
    const txn = btx.transaction;
    const resolvedConfirmCommitment =
      confirmCommitment ?? this.opts.defaultConfirmationCommitment;

    let txId: string;
    if (isVersionedTransaction(txn)) {
      const signedTxn = await this.wallet.signTransaction(txn);
      signedTxn.sign(btx.signers);
      txId = await this.connection.sendTransaction(signedTxn, sendOpts);
    } else {
      const signedTxn = await this.wallet.signTransaction(txn);
      btx.signers
        .filter((s): s is Signer => s !== undefined)
        .forEach((keypair) => signedTxn.partialSign(keypair));
      txId = await this.connection.sendRawTransaction(
        signedTxn.serialize(),
        sendOpts,
      );
    }

    const result = await this.connection.confirmTransaction(
      {
        signature: txId,
        ...btx.recentBlockhash,
      },
      resolvedConfirmCommitment,
    );

    const confirmTxErr = result.value.err;
    if (confirmTxErr) {
      throw new Error(confirmTxErr.toString());
    }

    return txId;
  }
}

/**
 * Checks if a transaction is a versioned transaction.
 * @param tx Transaction to check.
 * @returns True if the transaction is a versioned transaction.
 */
export const isVersionedTransaction = (
  tx: Transaction | VersionedTransaction,
): tx is VersionedTransaction => {
  return "version" in tx;
};

function measureLegacyTx(tx: Transaction): number {
  // Due to the high cost of serialize, if the number of unique accounts clearly exceeds the limit of legacy transactions,
  // serialize is not performed and a determination of infeasibility is made.
  const uniqueKeys = new Set<string>();
  for (const instruction of tx.instructions) {
    for (const key of instruction.keys) {
      uniqueKeys.add(key.pubkey.toBase58());
    }
    uniqueKeys.add(instruction.programId.toBase58());
  }
  if (uniqueKeys.size > LEGACY_TX_UNIQUE_KEYS_LIMIT) {
    throw new Error(
      "Unable to measure transaction size. Too many unique keys in transaction.",
    );
  }

  try {
    // (Legacy)Transaction.serialize ensures that the size of successfully serialized data
    // is less than or equal to PACKET_DATA_SIZE(1232).
    // https://github.com/solana-labs/solana-web3.js/blob/77f78a8/packages/library-legacy/src/transaction/legacy.ts#L806
    const serialized = tx.serialize({ requireAllSignatures: false });
    return serialized.length;
  } catch {
    throw new Error(
      "Unable to measure transaction size. Unable to serialize transaction.",
    );
  }
}

function measureV0Tx(tx: VersionedTransaction): number {
  let serialized: Uint8Array;
  try {
    serialized = tx.serialize();
  } catch {
    throw new Error(
      "Unable to measure transaction size. Unable to serialize transaction.",
    );
  }

  // VersionedTransaction.serialize does NOT ensures that the size of successfully serialized data is
  // less than or equal to PACKET_DATA_SIZE(1232).
  // https://github.com/solana-labs/solana-web3.js/blob/77f78a8/packages/library-legacy/src/transaction/versioned.ts#L65
  //
  // BufferLayout.encode throws an error for writes that exceed the buffer size,
  // so obviously large transactions will throws an error.
  // However, depending on the size of the signature and message body, a size between 1233 - 2048 may be returned
  // as a successful result, so we need to check it here.
  if (serialized.length > PACKET_DATA_SIZE) {
    throw new Error(
      "Unable to measure transaction size. Transaction too large.",
    );
  }

  return serialized.length;
}
