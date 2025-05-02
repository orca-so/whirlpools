import type { Transaction, VersionedTransaction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

export interface Wallet {
  signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]>;
  publicKey: PublicKey;
}

export class ReadOnlyWallet implements Wallet {
  constructor(public publicKey: PublicKey = PublicKey.default) {}

  signTransaction<T extends Transaction | VersionedTransaction>(
    _transaction: T,
  ): Promise<T> {
    throw new Error("Read only wallet cannot sign transaction.");
  }
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    _transactions: T[],
  ): Promise<T[]> {
    throw new Error("Read only wallet cannot sign transactions.");
  }
}
