import { AccountMeta } from "@solana/web3.js";

export enum RemainingAccountsType {
  TransferHookA = "transferHookA",
  TransferHookB = "transferHookB",
  TransferHookReward = "transferHookReward",
  TransferHookInput = "transferHookInput",
  TransferHookIntermediate = "transferHookIntermediate",
  TransferHookOutput = "transferHookOutput",
  //TickArray = "tickArray",
  //TickArrayOne = "tickArrayOne",
  //TickArrayTwo = "tickArrayTwo",
}

type RemainingAccountsAnchorType = 
  { transferHookA: {} } |
  { transferHookB: {} } |
  { transferHookReward: {} } |
  { transferHookInput: {} } |
  { transferHookIntermediate: {} } |
  { transferHookOutput: {} }
  //{ tickArray: {} } |
  //{ tickArrayOne: {} } |
  //{ tickArrayTwo: {} } |

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