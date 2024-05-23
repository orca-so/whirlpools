import BN from "bn.js";
import { ZERO } from "@orca-so/common-sdk";

export type TransferFeeIncludedAmount = {
  amount: BN;
  fee: BN;
};

export const TRANSFER_FEE_INCLUDED_ZERO: TransferFeeIncludedAmount = { amount: ZERO, fee: ZERO };

export type TransferFeeExcludedAmount = {
  amount: BN;
  fee: BN;
};

export const TRANSFER_FEE_EXCLUDED_ZERO: TransferFeeExcludedAmount = { amount: ZERO, fee: ZERO };
