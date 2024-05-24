import {
  Instruction,
  MEASUREMENT_BLOCKHASH,
  ResolvedTokenAddressInstruction,
  TokenUtil,
  TransactionBuilder,
  TransactionBuilderOptions,
  ZERO,
  defaultTransactionBuilderOptions,
} from "@orca-so/common-sdk";
import { WhirlpoolContext, WhirlpoolContextOpts as WhirlpoolContextOptions, toTx } from "..";
import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

export function convertListToMap<T>(fetchedData: T[], addresses: string[]): Record<string, T> {
  const result: Record<string, T> = {};
  fetchedData.forEach((data, index) => {
    if (data) {
      const addr = addresses[index];
      result[addr] = data;
    }
  });
  return result;
}

// Filter out null objects in the first array and remove the corresponding objects in the second array
export function filterNullObjects<T, K>(
  firstArray: ReadonlyArray<T | null>,
  secondArray: ReadonlyArray<K>
): [Array<T>, Array<K>] {
  const filteredFirstArray: Array<T> = [];
  const filteredSecondArray: Array<K> = [];

  firstArray.forEach((item, idx) => {
    if (item !== null) {
      filteredFirstArray.push(item);
      filteredSecondArray.push(secondArray[idx]);
    }
  });

  return [filteredFirstArray, filteredSecondArray];
}

export async function checkMergedTransactionSizeIsValid(
  ctx: WhirlpoolContext,
  builders: TransactionBuilder[],
  latestBlockhash: Readonly<{
    blockhash: string;
    lastValidBlockHeight: number;
  }>
): Promise<boolean> {
  const merged = new TransactionBuilder(ctx.connection, ctx.wallet, ctx.txBuilderOpts);
  builders.forEach((builder) => merged.addInstruction(builder.compressIx(true)));
  try {
    const size = await merged.txnSize({
      latestBlockhash,
    });
    return true;
  } catch (e) {
    return false;
  }
}

export function contextOptionsToBuilderOptions(
  opts: WhirlpoolContextOptions
): TransactionBuilderOptions | undefined {
  return {
    defaultBuildOption: {
      ...defaultTransactionBuilderOptions.defaultBuildOption,
      ...opts.userDefaultBuildOptions,
    },
    defaultSendOption: {
      ...defaultTransactionBuilderOptions.defaultSendOption,
      ...opts.userDefaultSendOptions,
    },
    defaultConfirmationCommitment:
      opts.userDefaultConfirmCommitment ??
      defaultTransactionBuilderOptions.defaultConfirmationCommitment,
  };
}

export class MultipleTransactionBuilderFactoryWithAccountResolver {
  private txBuilders: TransactionBuilder[] = [];
  private pendingTxBuilder: TransactionBuilder | null = null;
  private touchedMints: Set<string> | null = null;
  private accountExemption: number | null = null;

  constructor(
    private ctx: WhirlpoolContext,
    private resolvedAtas: Record<string, ResolvedTokenAddressInstruction>,
    private tokenOwner: PublicKey = ctx.wallet.publicKey,
    private payer: PublicKey = tokenOwner,
  ) {}

  public async addInstructions(generator: (resolve: (mint: string) => PublicKey) => Promise<Instruction[]>) {
    if (this.accountExemption === null) {
      this.accountExemption = await this.ctx.fetcher.getAccountRentExempt();
    }

    for (let iter = 0; iter < 2; iter++) {
      if (!this.pendingTxBuilder || !this.touchedMints) {
        this.pendingTxBuilder = new TransactionBuilder(this.ctx.connection, this.ctx.wallet, this.ctx.txBuilderOpts);
        this.touchedMints = new Set<string>();
        this.resolvedAtas[NATIVE_MINT.toBase58()] = TokenUtil.createWrappedNativeAccountInstruction(
          this.tokenOwner,
          ZERO,
          this.accountExemption,
          this.payer,
          this.tokenOwner,
          this.ctx.accountResolverOpts.createWrappedSolAccountMethod
        );
      }

      const newTxBuilder = new TransactionBuilder(this.ctx.connection, this.ctx.wallet, this.ctx.txBuilderOpts);
      const resolve = (mint: string): PublicKey => {
        if (!this.touchedMints!.has(mint)) {
          newTxBuilder.addInstruction(this.resolvedAtas[mint]);
          this.touchedMints!.add(mint);
        }
        return this.resolvedAtas[mint].address;        
      };

      const ixs = await generator(resolve.bind(this));
      newTxBuilder.addInstructions(ixs);
  
      // Attempt to push the new instructions into the pending builder
      const mergeable = await checkMergedTransactionSizeIsValid(
        this.ctx,
        [this.pendingTxBuilder, newTxBuilder],
        MEASUREMENT_BLOCKHASH
      );
      if (mergeable) {
        this.pendingTxBuilder.addInstruction(newTxBuilder.compressIx(false));
        break;
      } else {
        if (iter !== 0) {
          throw new Error(
            `instruction is too large.`
          );
        }
  
        this.txBuilders.push(this.pendingTxBuilder);
        this.pendingTxBuilder = null;
        this.touchedMints = null;
      }
    }
  }

  public build(): TransactionBuilder[] {
    return this.pendingTxBuilder
      ? [...this.txBuilders, this.pendingTxBuilder]
      : [...this.txBuilders];
  }
}