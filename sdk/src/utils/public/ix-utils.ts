import { Instruction, TransactionBuilder } from "@orca-so/common-sdk";
import { WhirlpoolContext } from "../../context";
import { contextToBuilderOptions } from "../txn-utils";

export function toTx(ctx: WhirlpoolContext, ix: Instruction): TransactionBuilder {
  return new TransactionBuilder(ctx.provider.connection, ctx.provider.wallet, contextToBuilderOptions(ctx.opts)).addInstruction(ix);
}
