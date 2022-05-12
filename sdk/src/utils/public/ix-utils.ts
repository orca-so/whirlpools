import { TransactionBuilder, Instruction } from "@orca-so/common-sdk";
import { WhirlpoolContext } from "../../context";

export function toTx(ctx: WhirlpoolContext, ix: Instruction): TransactionBuilder {
  return new TransactionBuilder(ctx.provider).addInstruction(ix);
}
