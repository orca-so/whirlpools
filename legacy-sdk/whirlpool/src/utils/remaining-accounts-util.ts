import type { AccountMeta, PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";
import { MAX_SUPPLEMENTAL_TICK_ARRAYS } from "../types/public";

export enum RemainingAccountsType {
  TransferHookA = "transferHookA",
  TransferHookB = "transferHookB",
  TransferHookReward = "transferHookReward",
  TransferHookInput = "transferHookInput",
  TransferHookIntermediate = "transferHookIntermediate",
  TransferHookOutput = "transferHookOutput",
  SupplementalTickArrays = "supplementalTickArrays",
  SupplementalTickArraysOne = "supplementalTickArraysOne",
  SupplementalTickArraysTwo = "supplementalTickArraysTwo",
}

type RemainingAccountsAnchorType =
  | { transferHookA: object }
  | { transferHookB: object }
  | { transferHookReward: object }
  | { transferHookInput: object }
  | { transferHookIntermediate: object }
  | { transferHookOutput: object }
  | { supplementalTickArrays: object }
  | { supplementalTickArraysOne: object }
  | { supplementalTickArraysTwo: object };

export type RemainingAccountsSliceData = {
  accountsType: RemainingAccountsAnchorType;
  length: number;
};

export type RemainingAccountsInfoData = {
  slices: RemainingAccountsSliceData[];
};

// Option<RemainingAccountsInfoData> on Rust
// null is treated as None in Rust. undefined doesn't work.
export type OptionRemainingAccountsInfoData = RemainingAccountsInfoData | null;

export class RemainingAccountsBuilder {
  private remainingAccounts: AccountMeta[] = [];
  private slices: RemainingAccountsSliceData[] = [];

  addSlice(
    accountsType: RemainingAccountsType,
    accounts?: AccountMeta[],
  ): this {
    if (!accounts || accounts.length === 0) return this;

    this.slices.push({
      accountsType: { [accountsType]: {} } as RemainingAccountsAnchorType,
      length: accounts.length,
    });
    this.remainingAccounts.push(...accounts);

    return this;
  }

  build(): [OptionRemainingAccountsInfoData, AccountMeta[] | undefined] {
    return this.slices.length === 0
      ? [null, undefined]
      : [{ slices: this.slices }, this.remainingAccounts];
  }
}

export function toSupplementalTickArrayAccountMetas(
  tickArrayPubkeys: PublicKey[] | undefined,
): AccountMeta[] | undefined {
  if (!tickArrayPubkeys) return undefined;

  invariant(
    tickArrayPubkeys.length <= MAX_SUPPLEMENTAL_TICK_ARRAYS,
    "Too many supplemental tick arrays provided",
  );
  return tickArrayPubkeys.map((pubkey) => ({
    pubkey,
    isWritable: true,
    isSigner: false,
  }));
}
