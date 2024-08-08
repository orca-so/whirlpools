import { Instruction, TransactionBuilder } from "@orca-so/common-sdk";
import { WhirlpoolContext } from "../../context";

export function toTx(ctx: WhirlpoolContext, ix: Instruction): TransactionBuilder {
  return new TransactionBuilder(
    ctx.provider.connection,
    ctx.provider.wallet,
    ctx.txBuilderOpts
  ).addInstruction(ix);
}
