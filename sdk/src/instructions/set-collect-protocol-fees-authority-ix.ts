import { WhirlpoolContext } from "../context";
import { TransformableInstruction } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { transformTx } from "../utils/instructions-util";

/**
 * Parameters to set the collect fee authority in a WhirlpoolsConfig
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig this pool is initialized in
 * @param collectProtocolFeesAuthority - The current collectProtocolFeesAuthority in the WhirlpoolsConfig
 * @param newCollectProtocolFeesAuthority - The new collectProtocolFeesAuthority in the WhirlpoolsConfig
 */
export type SetCollectProtocolFeesAuthorityParams = {
  whirlpoolsConfig: PublicKey;
  collectProtocolFeesAuthority: PublicKey;
  newCollectProtocolFeesAuthority: PublicKey;
};

/**
 * Sets the fee authority to collect protocol fees for a WhirlpoolsConfig.
 * Only the current collect protocol fee authority has permission to invoke this instruction.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetCollectProtocolFeesAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setCollectProtocolFeesAuthorityIx(
  context: WhirlpoolContext,
  params: SetCollectProtocolFeesAuthorityParams
): TransformableInstruction {
  const { whirlpoolsConfig, collectProtocolFeesAuthority, newCollectProtocolFeesAuthority } =
    params;

  const ix = context.program.instruction.setCollectProtocolFeesAuthority({
    accounts: {
      whirlpoolsConfig,
      collectProtocolFeesAuthority,
      newCollectProtocolFeesAuthority,
    },
  });

  return transformTx(context, {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  });
}
