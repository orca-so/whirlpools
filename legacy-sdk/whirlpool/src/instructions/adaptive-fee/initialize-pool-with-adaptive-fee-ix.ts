import type { BN, Program } from "@coral-xyz/anchor";
import type { Instruction, PDA } from "@orca-so/common-sdk";
import type { Keypair, PublicKey } from "@solana/web3.js";
import { SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to initialize a Whirlpool account with AdaptiveFee.
 *
 * @category Instruction Types
 * @param initSqrtPrice - The desired initial sqrt-price for this pool
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig this pool is initialized in
 * @param whirlpoolPda - PDA for the whirlpool account that would be initialized
 * @param oraclePda - PDA for the oracle account that would be initialized
 * @param tokenMintA - Mint public key for token A
 * @param tokenMintB - Mint public key for token B
 * @param tokenBadgeA - TokenBadge public key for token A
 * @param tokenBadgeB - TokenBadge public key for token B
 * @param tokenProgramA - Token program public key for token A
 * @param tokenProgramB - Token program public key for token B
 * @param tokenVaultAKeypair - Keypair of the token A vault for this pool
 * @param tokenVaultBKeypair - Keypair of the token B vault for this pool
 * @param adaptiveFeeTierKey - PublicKey of the adaptive fee-tier account that this pool would use for the fee-rate
 * @param initializePoolAuthority - The authority that would initialize this pool
 * @param funder - The account that would fund the creation of this account
 */
export type InitPoolWithAdaptiveFeeParams = {
  initSqrtPrice: BN;
  tradeEnableTimestamp?: BN;
  whirlpoolsConfig: PublicKey;
  whirlpoolPda: PDA;
  oraclePda: PDA;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  tokenBadgeA: PublicKey;
  tokenBadgeB: PublicKey;
  tokenProgramA: PublicKey;
  tokenProgramB: PublicKey;
  tokenVaultAKeypair: Keypair;
  tokenVaultBKeypair: Keypair;
  adaptiveFeeTierKey: PublicKey;
  initializePoolAuthority: PublicKey;
  funder: PublicKey;
};

/**
 * Initializes a Whirlpool account with adaptive fee.
 *
 * Special Errors
 * `InvalidTokenMintOrder` - The order of mints have to be ordered by
 * `SqrtPriceOutOfBounds` - provided initial_sqrt_price is not between 2^-64 to 2^64
 * `InvalidTradeEnableTimestamp` - provided trade_enable_timestamp is not in the valid range
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - InitPoolWithAdaptiveFeeTierParams object
 * @returns - Instruction to perform the action.
 */
export function initializePoolWithAdaptiveFeeIx(
  program: Program<Whirlpool>,
  params: InitPoolWithAdaptiveFeeParams,
): Instruction {
  const {
    initSqrtPrice,
    tradeEnableTimestamp,
    tokenMintA,
    tokenMintB,
    tokenBadgeA,
    tokenBadgeB,
    tokenProgramA,
    tokenProgramB,
    whirlpoolsConfig,
    whirlpoolPda,
    oraclePda,
    adaptiveFeeTierKey,
    tokenVaultAKeypair,
    tokenVaultBKeypair,
    funder,
    initializePoolAuthority,
  } = params;

  const optionTradeEnableTimestamp = tradeEnableTimestamp ?? null; // null = None (undefined is not allowed)

  const ix = program.instruction.initializePoolWithAdaptiveFee(initSqrtPrice, optionTradeEnableTimestamp, {
    accounts: {
      whirlpoolsConfig,
      tokenMintA,
      tokenMintB,
      tokenBadgeA,
      tokenBadgeB,
      funder,
      initializePoolAuthority,
      whirlpool: whirlpoolPda.publicKey,
      oracle: oraclePda.publicKey,
      tokenVaultA: tokenVaultAKeypair.publicKey,
      tokenVaultB: tokenVaultBKeypair.publicKey,
      adaptiveFeeTier: adaptiveFeeTierKey,
      systemProgram: SystemProgram.programId,
      tokenProgramA,
      tokenProgramB,
      rent: SYSVAR_RENT_PUBKEY,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [tokenVaultAKeypair, tokenVaultBKeypair],
  };
}
