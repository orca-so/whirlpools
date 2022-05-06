import { WhirlpoolContext } from "../context";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { transformTx } from "../utils/instructions-util";
import { TransformableInstruction } from "@orca-so/common-sdk";

/**
 * Parameters to collect fees from a position.
 *
 * @category Instruction Types
 * @param whirlpool - PublicKey for the whirlpool that the position will be opened for.
 * @param position - PublicKey for the  position will be opened for.
 * @param positionTokenAccount - PublicKey for the position token's associated token address.
 * @param tokenOwnerAccountA - PublicKey for the token A account that will be withdrawed from.
 * @param tokenOwnerAccountB - PublicKey for the token B account that will be withdrawed from.
 * @param tokenVaultA - PublicKey for the tokenA vault for this whirlpool.
 * @param tokenVaultB - PublicKey for the tokenB vault for this whirlpool.
 * @param positionAuthority - authority that owns the token corresponding to this desired position.
 */
export type CollectFeesParams = {
  whirlpool: PublicKey;
  position: PublicKey;
  positionTokenAccount: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  positionAuthority: PublicKey;
};

/**
 * Collect fees accrued for this position.
 * Call updateFeesAndRewards before this to update the position to the newest accrued values.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - CollectFeesParams object
 * @returns - Instruction to perform the action.
 */
export function collectFeesIx(
  context: WhirlpoolContext,
  params: CollectFeesParams
): TransformableInstruction {
  const {
    whirlpool,
    positionAuthority,
    position,
    positionTokenAccount,
    tokenOwnerAccountA,
    tokenOwnerAccountB,
    tokenVaultA,
    tokenVaultB,
  } = params;

  const ix = context.program.instruction.collectFees({
    accounts: {
      whirlpool,
      positionAuthority,
      position,
      positionTokenAccount,
      tokenOwnerAccountA,
      tokenOwnerAccountB,
      tokenVaultA,
      tokenVaultB,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
  });

  return transformTx(context, {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  });
}
