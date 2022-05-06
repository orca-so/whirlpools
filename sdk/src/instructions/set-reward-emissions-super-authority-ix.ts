import { WhirlpoolContext } from "../context";
import { TransformableInstruction } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { transformTx } from "../utils/instructions-util";

/**
 * Parameters to set rewards emissions for a reward in a Whirlpool
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - PublicKey for the WhirlpoolsConfig that we want to update.
 * @param rewardEmissionsSuperAuthority - Current reward emission super authority in this WhirlpoolsConfig
 * @param newRewardEmissionsSuperAuthority - New reward emission super authority for this WhirlpoolsConfig
 */
export type SetRewardEmissionsSuperAuthorityParams = {
  whirlpoolsConfig: PublicKey;
  rewardEmissionsSuperAuthority: PublicKey;
  newRewardEmissionsSuperAuthority: PublicKey;
};

/**
 * Set the whirlpool reward super authority for a WhirlpoolsConfig
 * Only the current reward super authority has permission to invoke this instruction.
 * This instruction will not change the authority on any `WhirlpoolRewardInfo` whirlpool rewards.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetRewardEmissionsSuperAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setRewardEmissionsSuperAuthorityIx(
  context: WhirlpoolContext,
  params: SetRewardEmissionsSuperAuthorityParams
): TransformableInstruction {
  const { whirlpoolsConfig, rewardEmissionsSuperAuthority, newRewardEmissionsSuperAuthority } =
    params;

  const ix = context.program.instruction.setRewardEmissionsSuperAuthority({
    accounts: {
      whirlpoolsConfig,
      rewardEmissionsSuperAuthority: rewardEmissionsSuperAuthority,
      newRewardEmissionsSuperAuthority,
    },
  });

  return transformTx(context, {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  });
}
