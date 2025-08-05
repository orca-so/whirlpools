import type { ExtensionArgs } from "@solana-program/token-2022";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  getMintSize,
  getInitializeMint2Instruction,
} from "@solana-program/token-2022";
import type { Address, IInstruction } from "@solana/kit";
import { sendTransaction, signer } from "./mockRpc";
import { getCreateAccountInstruction } from "@solana-program/system";
import { getNextKeypair } from "./keypair";

// Transfer hook program ID from legacy SDK tests
// This should match the transfer hook program used in legacy SDK
export const TEST_TRANSFER_HOOK_PROGRAM_ID = "7N4HggYEJAtCLJdnHGCtFqfxcB5rhQCsQTze3ftYstVj";

/**
 * Creates a Token-2022 mint with transfer hook extension enabled.
 * This will initially fail when used with SDK functions because they don't support transfer hooks yet.
 * 
 * @param config Configuration for the mint
 * @returns The mint address
 */
export async function setupMintWithTransferHook(
  config: { decimals?: number } = {},
): Promise<Address> {
  const keypair = getNextKeypair();
  const instructions: IInstruction[] = [];

  const extensions: ExtensionArgs[] = [
    {
      __kind: "TransferHook",
      authority: signer.address,
      programId: TEST_TRANSFER_HOOK_PROGRAM_ID,
    },
  ];

  instructions.push(
    getCreateAccountInstruction({
      payer: signer,
      newAccount: keypair,
      lamports: 1e8,
      space: getMintSize(extensions),
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),
  );

  // TODO: Add transfer hook initialization instruction once we have proper imports
  // This would require porting the transfer hook initialization logic from legacy SDK

  instructions.push(
    getInitializeMint2Instruction({
      mint: keypair.address,
      mintAuthority: signer.address,
      freezeAuthority: null,
      decimals: config.decimals ?? 6,
    }),
  );

  await sendTransaction(instructions);

  return keypair.address;
}

/**
 * Helper function to resolve transfer hook accounts for a token.
 * This is a stub implementation that will need to be properly implemented
 * when we add transfer hook support to the SDK.
 * 
 * @param mint The mint address
 * @param source Source token account
 * @param destination Destination token account  
 * @param owner Owner of the source account
 * @returns Array of account metas needed for transfer hook (currently empty stub)
 */
export async function getTransferHookAccounts(
  mint: Address,
  source: Address,
  destination: Address,
  owner: Address,
): Promise<any[]> {
  // TODO: Implement proper transfer hook account resolution
  // This should resolve the extra accounts needed for the transfer hook program
  // For now, return empty array - this will cause tests to fail until implemented
  return [];
}

/**
 * Helper to check if a mint has transfer hook extension.
 * This is a stub that will need proper implementation.
 * 
 * @param mint The mint address
 * @returns True if mint has transfer hook extension
 */
export async function hasTransferHookExtension(mint: Address): Promise<boolean> {
  // TODO: Implement proper check for transfer hook extension
  // For now, assume all mints created with setupMintWithTransferHook have the extension
  return true;
}