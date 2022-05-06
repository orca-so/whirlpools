import { Program } from "@project-serum/anchor";
import { Whirlpool } from "../artifacts/whirlpool";
import { Instruction } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";

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
  program: Program<Whirlpool>,
  params: SetCollectProtocolFeesAuthorityParams
): Instruction {
  const { whirlpoolsConfig, collectProtocolFeesAuthority, newCollectProtocolFeesAuthority } =
    params;

  const ix = program.instruction.setCollectProtocolFeesAuthority({
    accounts: {
      whirlpoolsConfig,
      collectProtocolFeesAuthority,
      newCollectProtocolFeesAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
