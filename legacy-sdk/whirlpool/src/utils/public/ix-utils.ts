import type { Instruction } from "@orca-so/common-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import type { WhirlpoolContext } from "../../context";

export function toTx(
  ctx: WhirlpoolContext,
  ix: Instruction,
): TransactionBuilder {
  return new TransactionBuilder(
    ctx.provider.connection,
    ctx.provider.wallet,
    ctx.txBuilderOpts,
  ).addInstruction(ix);
}
