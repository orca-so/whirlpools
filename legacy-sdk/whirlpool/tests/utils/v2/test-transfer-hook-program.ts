import type { AnchorProvider } from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import type { AccountMeta } from "@solana/web3.js";
import { getExtraAccountMetasForHookProgram } from "./token-2022";
import {
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TRANSFER_HOOK_PROGRAM_ID,
} from "../test-consts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createUpdateTransferHookInstruction,
} from "@solana/spl-token";

export async function getExtraAccountMetasForTestTransferHookProgram(
  provider: AnchorProvider,
  mint: web3.PublicKey,
  source: web3.PublicKey,
  destination: web3.PublicKey,
  owner: web3.PublicKey,
): Promise<AccountMeta[] | undefined> {
  return getExtraAccountMetasForHookProgram(
    provider,
    TEST_TRANSFER_HOOK_PROGRAM_ID,
    source,
    mint,
    destination,
    owner,
    0, // not used to derive addresses
  );
}

export async function getTestTransferHookCounter(
  provider: AnchorProvider,
  mint: web3.PublicKey,
): Promise<number> {
  const [counterAccountPDA] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), mint.toBuffer()],
    TEST_TRANSFER_HOOK_PROGRAM_ID,
  );

  const data = await provider.connection.getAccountInfo(counterAccountPDA);
  return data!.data.readInt32LE(8);
}

export async function updateTransferHookProgram(
  provider: AnchorProvider,
  mint: web3.PublicKey,
  newTransferHookProgramId: web3.PublicKey,
  authority?: web3.Keypair,
) {
  const tx = new web3.Transaction();
  tx.add(
    createUpdateTransferHookInstruction(
      mint,
      authority?.publicKey ?? provider.wallet.publicKey,
      newTransferHookProgramId,
      undefined,
      TEST_TOKEN_2022_PROGRAM_ID,
    ),
  );
  return provider.sendAndConfirm(tx, !!authority ? [authority] : [], {
    commitment: "confirmed",
  });
}

export function createInitializeExtraAccountMetaListInstruction(
  payer: web3.PublicKey,
  mint: web3.PublicKey,
): web3.TransactionInstruction {
  // create ExtraAccountMetaList account
  const [extraAccountMetaListPDA] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    TEST_TRANSFER_HOOK_PROGRAM_ID,
  );
  const [counterAccountPDA] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), mint.toBuffer()],
    TEST_TRANSFER_HOOK_PROGRAM_ID,
  );

  return {
    programId: TEST_TRANSFER_HOOK_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: extraAccountMetaListPDA, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: counterAccountPDA, isSigner: false, isWritable: true },
      {
        pubkey: TEST_TOKEN_2022_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: web3.SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
    ],
    data: Buffer.from([0x5c, 0xc5, 0xae, 0xc5, 0x29, 0x7c, 0x13, 0x03]), // InitializeExtraAccountMetaList
  };
}
