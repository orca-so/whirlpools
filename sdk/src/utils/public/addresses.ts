import { PublicKey } from "@solana/web3.js";
import { findProgramAddress } from "../find-program-address";
import { BN } from "@project-serum/anchor";

const PDA_WHIRLPOOL_SEED = "whirlpool";
const PDA_VAULT_A_SEED = "token_vault_a";
const PDA_VAULT_B_SEED = "token_vault_b";
const PDA_POSITION_SEED = "position";
const PDA_METADATA_SEED = "metadata";
const PDA_TICK_ARRAY_SEED = "tick_array";
const PDA_FEE_TIER_SEED = "fee_tier";
const PDA_ORACLE_SEED = "oracle";

export function getWhirlpoolPda(
  programId: PublicKey,
  whirlpoolConfigKey: PublicKey,
  tokenMintAKey: PublicKey,
  tokenMintBKey: PublicKey,
  tickSpacing: number
) {
  return findProgramAddress(
    [
      Buffer.from(PDA_WHIRLPOOL_SEED),
      whirlpoolConfigKey.toBuffer(),
      tokenMintAKey.toBuffer(),
      tokenMintBKey.toBuffer(),
      new BN(tickSpacing).toArrayLike(Buffer, "le", 2),
    ],
    programId
  );
}

export function getWhirlpoolVaultAPda(
  programId: PublicKey,
  whirlpoolKey: PublicKey,
  tokenMintAKey: PublicKey
) {
  return findProgramAddress(
    [Buffer.from(PDA_VAULT_A_SEED), whirlpoolKey.toBuffer(), tokenMintAKey.toBuffer()],
    programId
  );
}

export function getWhirlpoolVaultBPda(
  programId: PublicKey,
  whirlpoolKey: PublicKey,
  tokenMintBKey: PublicKey
) {
  return findProgramAddress(
    [Buffer.from(PDA_VAULT_B_SEED), whirlpoolKey.toBuffer(), tokenMintBKey.toBuffer()],
    programId
  );
}

export function getPositionPda(programId: PublicKey, positionMintKey: PublicKey) {
  return findProgramAddress(
    [Buffer.from(PDA_POSITION_SEED), positionMintKey.toBuffer()],
    programId
  );
}

export const METADATA_PROGRAM_ADDRESS = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);
export function getPositionMetadataPda(positionMintKey: PublicKey) {
  return findProgramAddress(
    [
      Buffer.from(PDA_METADATA_SEED),
      METADATA_PROGRAM_ADDRESS.toBuffer(),
      positionMintKey.toBuffer(),
    ],
    METADATA_PROGRAM_ADDRESS
  );
}

export function getTickArrayPda(
  programId: PublicKey,
  whirlpoolAddress: PublicKey,
  startTick: number
) {
  return findProgramAddress(
    [
      Buffer.from(PDA_TICK_ARRAY_SEED),
      whirlpoolAddress.toBuffer(),
      Buffer.from(startTick.toString()),
    ],
    programId
  );
}

export function getFeeTierPda(
  programId: PublicKey,
  whirlpoolsConfigAddress: PublicKey,
  tickSpacing: number
) {
  return findProgramAddress(
    [
      Buffer.from(PDA_FEE_TIER_SEED),
      whirlpoolsConfigAddress.toBuffer(),
      new BN(tickSpacing).toArrayLike(Buffer, "le", 2),
    ],
    programId
  );
}

export function getOraclePda(programId: PublicKey, whirlpoolAddress: PublicKey) {
  return findProgramAddress([Buffer.from(PDA_ORACLE_SEED), whirlpoolAddress.toBuffer()], programId);
}
