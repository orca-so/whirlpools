// [Mar 6, 2024] ConfidentialTransfer is not supported in @solana/spl-token, so we need to build instructions manually...

import { ExtensionType, TOKEN_2022_PROGRAM_ID, TokenInstruction, TokenUnsupportedInstructionError, getExtensionTypes, getMint, programSupportsExtensions } from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { struct, u8,  } from '@solana/buffer-layout';
import { publicKey } from '@solana/buffer-layout-utils';
import { AnchorProvider } from "@coral-xyz/anchor";
import { TEST_TOKEN_2022_PROGRAM_ID } from "../test-consts";

enum ConfidentialTransferInstruction {
  // We are interested in initilization only
  InitializeMint = 0,
  // ...
  // https://github.com/solana-labs/solana-program-library/blob/master/token/program-2022/src/extension/confidential_transfer/instruction.rs
}

interface InitializeConfidentialTransferMintInstructionData {
  instruction: TokenInstruction.ConfidentialTransferExtension;
  confidentialTransferInstruction: ConfidentialTransferInstruction.InitializeMint;
  authority: PublicKey | null;
  autoApproveNewAccounts: boolean;
  auditorElgamalPubkey: PublicKey | null;
}

/*

Sample transaction instruction data

1b 00 0c 8e 98 78 4f 83 30 4f 46 14 80 d7 86 b4 
7b da 04 59 14 d2 21 b4 ac 77 74 02 97 af b6 71 
53 35 01 00 00 00 00 00 00 00 00 00 00 00 00 00 
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 
00 00 00 

data length: 67 bytes

   1: confidential transfer prefix
   1: confidential transfer ix
  32: authority
   1: auto approve
  32: elgamal

*/
const initializeConfidentialTransferMintInstructionData = struct<InitializeConfidentialTransferMintInstructionData>([
  u8('instruction'),
  u8('confidentialTransferInstruction'),
  publicKey('authority'),
  u8('autoApproveNewAccounts'),
  publicKey('auditorElgamalPubkey'),
]);

export function createInitializeConfidentialTransferMintInstruction(
  mint: PublicKey,
  authority: PublicKey,
  autoApproveNewAccounts: boolean = true,
  auditorElgamalPubkey: PublicKey = PublicKey.default,
  programId: PublicKey = TOKEN_2022_PROGRAM_ID,
) {
  if (!programSupportsExtensions(programId)) {
    throw new TokenUnsupportedInstructionError();
  }

  const keys = [{ pubkey: mint, isSigner: false, isWritable: true }];
  const data = Buffer.alloc(initializeConfidentialTransferMintInstructionData.span);
  initializeConfidentialTransferMintInstructionData.encode(
    {
        instruction: TokenInstruction.ConfidentialTransferExtension,
        confidentialTransferInstruction: ConfidentialTransferInstruction.InitializeMint,
        authority,
        auditorElgamalPubkey,
        autoApproveNewAccounts,
    },
    data
  );

  return new TransactionInstruction({ keys, programId, data });
}

export async function hasConfidentialTransferMintExtension(
  provider: AnchorProvider,
  mint: PublicKey,
): Promise<boolean> {
  const account = await getMint(provider.connection, mint, "confirmed", TEST_TOKEN_2022_PROGRAM_ID);

  const extensions = getExtensionTypes(account.tlvData);
  return extensions.includes(ExtensionType.ConfidentialTransferMint);
}
