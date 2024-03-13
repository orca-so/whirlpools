// [Mar 12, 2024] SetTransferFee instruction is not supported in @solana/spl-token, so we need to build instructions manually...

import { TOKEN_2022_PROGRAM_ID, TokenInstruction, TokenUnsupportedInstructionError, TransferFeeInstruction, programSupportsExtensions } from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { struct, u16, u8 } from '@solana/buffer-layout';
import { u64 } from '@solana/buffer-layout-utils';

export interface SetTransferFeeInstructionData {
  instruction: TokenInstruction.TransferFeeExtension;
  transferFeeInstruction: TransferFeeInstruction.SetTransferFee;
  transferFeeBasisPoints: number;
  maximumFee: bigint;
}

export const setTransferFeeInstructionData = struct<SetTransferFeeInstructionData>([
  u8('instruction'),
  u8('transferFeeInstruction'),
  u16('transferFeeBasisPoints'),
  u64('maximumFee'),
]);

export function createSetTransferFeeInstruction(
  mint: PublicKey,
  newTransferFeeBasisPoints: number,
  newMaximumFee: bigint,
  transferFeeConfigAuthority: PublicKey,
  programId: PublicKey = TOKEN_2022_PROGRAM_ID,
) {
  if (!programSupportsExtensions(programId)) {
    throw new TokenUnsupportedInstructionError();
  }

  const keys = [
    { pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: transferFeeConfigAuthority, isSigner: true, isWritable: false },
  ];
  const data = Buffer.alloc(setTransferFeeInstructionData.span);
  setTransferFeeInstructionData.encode(
    {
        instruction: TokenInstruction.TransferFeeExtension,
        transferFeeInstruction: TransferFeeInstruction.SetTransferFee,
        transferFeeBasisPoints: newTransferFeeBasisPoints,
        maximumFee: newMaximumFee,
    },
    data
  );

  return new TransactionInstruction({ keys, programId, data });
}
