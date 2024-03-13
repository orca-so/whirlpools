import { AccountMeta } from "@solana/web3.js";

export enum RemainingAccountsType {
  TickArray = "tickArray",
  TickArrayOne = "tickArrayOne",
  TickArrayTwo = "tickArrayTwo",
  TransferHookA = "transferHookA",
  TransferHookB = "transferHookB",
  TransferHookReward = "transferHookReward",
  TransferHookOneA = "transferHookOneA",
  TransferHookOneB = "transferHookOneB",
  TransferHookTwoA = "transferHookTwoA",
  TransferHookTwoB = "transferHookTwoB",
}

type RemainingAccountsAnchorType = 
  { tickArray: {} } |
  { tickArrayOne: {} } |
  { tickArrayTwo: {} } |
  { transferHookA: {} } |
  { transferHookB: {} } |
  { transferHookReward: {} } |
  { transferHookOneA: {} } |
  { transferHookOneB: {} } |
  { transferHookTwoA: {} } |
  { transferHookTwoB: {} };

export type RemainingAccountsSliceData = {
  accountsType: RemainingAccountsAnchorType;
  length: number;
};

export type RemainingAccountsInfoData = {
  slices: RemainingAccountsSliceData[];
};
  
export class RemainingAccountsBuilder {
  private remainingAccounts: AccountMeta[] = [];
  private slices: RemainingAccountsSliceData[] = [];

  constructor() {}

  addSlice(accountsType: RemainingAccountsType, accounts?: AccountMeta[]): this {
    if (!accounts || accounts.length === 0) return this;

    this.slices.push({
      accountsType: { [accountsType]: {} } as RemainingAccountsAnchorType,
      length: accounts.length,
    });
    this.remainingAccounts.push(...accounts);

    return this;
  }

  build(): [RemainingAccountsInfoData, AccountMeta[]|undefined] {
    return [
      { slices: this.slices },
      this.remainingAccounts.length > 0 ? this.remainingAccounts : undefined,
    ];
  }
}