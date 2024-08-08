// [Mar 6, 2024] ConfidentialTransfer is not supported in @solana/spl-token, so we need to build instructions manually...

import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TokenInstruction,
  TokenUnsupportedInstructionError,
  getExtensionTypes,
  getMint,
  programSupportsExtensions,
} from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { struct, u8 } from "@solana/buffer-layout";
import { publicKey } from "@solana/buffer-layout-utils";
import type { AnchorProvider } from "@coral-xyz/anchor";
import { TEST_TOKEN_2022_PROGRAM_ID } from "../test-consts";

enum ConfidentialTransferInstruction {
  // We are interested in initilization only
  InitializeMint = 0,
  // ...
  // https://github.com/solana-labs/solana-program-library/blob/d4bbd51b5167d3f0c8a247b5f304a92e6482cd6f/token/program-2022/src/extension/confidential_transfer/instruction.rs#L33
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
const initializeConfidentialTransferMintInstructionData =
  struct<InitializeConfidentialTransferMintInstructionData>([
    u8("instruction"),
    u8("confidentialTransferInstruction"),
    publicKey("authority"),
    u8("autoApproveNewAccounts"),
    publicKey("auditorElgamalPubkey"),
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
  const data = Buffer.alloc(
    initializeConfidentialTransferMintInstructionData.span,
  );
  initializeConfidentialTransferMintInstructionData.encode(
    {
      instruction: TokenInstruction.ConfidentialTransferExtension,
      confidentialTransferInstruction:
        ConfidentialTransferInstruction.InitializeMint,
      authority,
      auditorElgamalPubkey,
      autoApproveNewAccounts,
    },
    data,
  );

  return new TransactionInstruction({ keys, programId, data });
}

export async function hasConfidentialTransferMintExtension(
  provider: AnchorProvider,
  mint: PublicKey,
): Promise<boolean> {
  const account = await getMint(
    provider.connection,
    mint,
    "confirmed",
    TEST_TOKEN_2022_PROGRAM_ID,
  );

  const extensions = getExtensionTypes(account.tlvData);
  return extensions.includes(ExtensionType.ConfidentialTransferMint);
}

enum ConfidentialTransferFeeInstruction {
  // We are interested in initilization only
  InitializeConfidentialTransferFeeConfig = 0,
  // ...
  // https://github.com/solana-labs/solana-program-library/blob/d4bbd51b5167d3f0c8a247b5f304a92e6482cd6f/token/program-2022/src/extension/confidential_transfer_fee/instruction.rs#L37
}

const TOKEN_INSTRUCTION_CONFIDENTIAL_TRANSFER_FEE_CONFIG_EXTENSION = 37;
const EXTENSION_TYPE_CONFIDENTIAL_TRANSFER_FEE_CONFIG = 16 as ExtensionType;

interface InitializeConfidentialTransferFeeConfigInstructionData {
  //TokenInstruction.ConfidentialTransferFeeExtension = 37 is commented out
  //instruction: TokenInstruction.ConfidentialTransferFeeExtension;
  instruction: 37;
  confidentialTransferFeeInstruction: ConfidentialTransferFeeInstruction.InitializeConfidentialTransferFeeConfig;
  authority: PublicKey | null;
  withdrawWithheldAuthorityElgamalPubkey: PublicKey | null;
}

/*

Sample transaction instruction data

25 00 d1 4f 53 ad b4 2c 4c 61 09 57 13 38 5d 13
6b e7 d5 37 30 d4 38 4a 38 d3 4c 84 cd c6 a9 93
83 09 1c 37 e6 43 3b 73 04 dd 82 73 7a e4 0d 9b
8b f3 c4 9f 5b 0e 6c 49 a8 d5 33 28 b3 e5 06 90
1c 57

data length: 67 bytes

   1: confidential transfer fee prefix
   1: confidential transfer fee ix
  32: authority
  32: withdraw withheld authority elgamal pubkey

*/
const initializeConfidentialTransferFeeConfigInstructionData =
  struct<InitializeConfidentialTransferFeeConfigInstructionData>([
    u8("instruction"),
    u8("confidentialTransferFeeInstruction"),
    publicKey("authority"),
    publicKey("withdrawWithheldAuthorityElgamalPubkey"),
  ]);

export function createInitializeConfidentialTransferFeeConfigInstruction(
  mint: PublicKey,
  authority: PublicKey,
  withdrawWithheldAuthorityElgamalPubkey: PublicKey = PublicKey.default,
  programId: PublicKey = TOKEN_2022_PROGRAM_ID,
) {
  if (!programSupportsExtensions(programId)) {
    throw new TokenUnsupportedInstructionError();
  }

  const keys = [{ pubkey: mint, isSigner: false, isWritable: true }];
  const data = Buffer.alloc(
    initializeConfidentialTransferFeeConfigInstructionData.span,
  );
  initializeConfidentialTransferFeeConfigInstructionData.encode(
    {
      instruction: TOKEN_INSTRUCTION_CONFIDENTIAL_TRANSFER_FEE_CONFIG_EXTENSION,
      confidentialTransferFeeInstruction:
        ConfidentialTransferFeeInstruction.InitializeConfidentialTransferFeeConfig,
      authority,
      withdrawWithheldAuthorityElgamalPubkey,
    },
    data,
  );

  return new TransactionInstruction({ keys, programId, data });
}

export async function hasConfidentialTransferFeeConfigExtension(
  provider: AnchorProvider,
  mint: PublicKey,
): Promise<boolean> {
  const account = await getMint(
    provider.connection,
    mint,
    "confirmed",
    TEST_TOKEN_2022_PROGRAM_ID,
  );

  const extensions = getExtensionTypes(account.tlvData);
  return extensions.includes(EXTENSION_TYPE_CONFIDENTIAL_TRANSFER_FEE_CONFIG);
}
