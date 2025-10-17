import type { AnchorProvider } from "@coral-xyz/anchor";
import { NATIVE_MINT } from "@solana/spl-token";
import { TEST_TOKEN_PROGRAM_ID } from "../test-consts";
import { getLiteSVM } from "../litesvm";

/**
 * Initialize the native mint (WSOL) for the regular Token Program if not already initialized.
 * This is needed for LiteSVM testing as it doesn't automatically create the native mint.
 */
export async function initializeNativeMintIdempotent(provider: AnchorProvider) {
  const accountInfo = await provider.connection.getAccountInfo(
    NATIVE_MINT,
    "confirmed"
  );

  // already initialized
  if (accountInfo !== null) return;

  // For regular Token Program, we need to manually create the native mint account
  // NATIVE_MINT is a special hardcoded mint for wrapped SOL (So11111111111111111111111111111111111111112)
  // We can't create it via transaction because we don't have the private key
  // Instead, we directly set it in LiteSVM's internal state

  // Create a properly initialized mint account structure
  // Mint account layout:
  // - mint_authority_option (1 byte): 1 (present)
  // - mint_authority (32 bytes)
  // - supply (8 bytes): 0
  // - decimals (1 byte): 9
  // - is_initialized (1 byte): 1
  // - freeze_authority_option (1 byte): 0 (not present)
  // Total: 82 bytes (actually 44 + extensions)

  const mintData = Buffer.alloc(82);
  let offset = 0;

  // mint_authority_option (COption<Pubkey>)
  mintData.writeUInt32LE(1, offset); // option = some
  offset += 4;

  // mint_authority
  const authority = provider.wallet.publicKey.toBuffer();
  authority.copy(mintData, offset);
  offset += 32;

  // supply
  mintData.writeBigUInt64LE(0n, offset);
  offset += 8;

  // decimals
  mintData.writeUInt8(9, offset);
  offset += 1;

  // is_initialized
  mintData.writeUInt8(1, offset);
  offset += 1;

  // freeze_authority_option
  mintData.writeUInt32LE(0, offset); // option = none

  // Get litesvm instance and set the account directly
  const litesvm = getLiteSVM();
  const rentExemptLamports =
    await provider.connection.getMinimumBalanceForRentExemption(82);

  litesvm.setAccount(NATIVE_MINT, {
    lamports: Number(rentExemptLamports),
    data: new Uint8Array(mintData),
    owner: TEST_TOKEN_PROGRAM_ID,
    executable: false,
    rentEpoch: 0,
  });
}
