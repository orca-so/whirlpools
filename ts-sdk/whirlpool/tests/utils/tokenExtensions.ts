import type { ExtensionArgs } from "@solana-program/token-2022";
import {
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToInstruction,
  getMintSize,
  getInitializeMint2Instruction,
  getInitializeTransferFeeConfigInstruction,
  getSetTransferFeeInstruction,
} from "@solana-program/token-2022";
import type { Address, IInstruction } from "@solana/web3.js";
import { generateKeyPairSigner } from "@solana/web3.js";
import { sendTransaction, signer } from "./mockRpc";
import { getCreateAccountInstruction } from "@solana-program/system";
import { DEFAULT_ADDRESS } from "../../src/config";

export async function setupAtaTE(
  mint: Address,
  config: { amount?: number | bigint } = {},
): Promise<Address> {
  const ata = await findAssociatedTokenPda({
    mint,
    owner: signer.address,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  const instructions: IInstruction[] = [];

  instructions.push(
    getCreateAssociatedTokenIdempotentInstruction({
      mint,
      owner: signer.address,
      ata: ata[0],
      payer: signer,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }),
  );

  if (config.amount) {
    instructions.push(
      getMintToInstruction({
        mint,
        token: ata[0],
        mintAuthority: signer,
        amount: config.amount,
      }),
    );
  }

  await sendTransaction(instructions);

  return ata[0];
}

export async function setupMintTE(
  config: { decimals?: number; extensions?: ExtensionArgs[] } = {},
): Promise<Address> {
  const keypair = await generateKeyPairSigner();
  const instructions: IInstruction[] = [];

  instructions.push(
    getCreateAccountInstruction({
      payer: signer,
      newAccount: keypair,
      lamports: 1e8,
      space: getMintSize(config.extensions),
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),
  );

  for (const extension of config.extensions ?? []) {
    switch (extension.__kind) {
      case "TransferFeeConfig":
        instructions.push(
          getInitializeTransferFeeConfigInstruction({
            mint: keypair.address,
            transferFeeConfigAuthority: signer.address,
            withdrawWithheldAuthority: signer.address,
            transferFeeBasisPoints:
              extension.olderTransferFee.transferFeeBasisPoints,
            maximumFee: extension.olderTransferFee.maximumFee,
          }),
        );
    }
  }

  instructions.push(
    getInitializeMint2Instruction({
      mint: keypair.address,
      mintAuthority: signer.address,
      freezeAuthority: null,
      decimals: config.decimals ?? 6,
    }),
  );

  for (const extension of config.extensions ?? []) {
    switch (extension.__kind) {
      case "TransferFeeConfig":
        instructions.push(
          getSetTransferFeeInstruction({
            mint: keypair.address,
            transferFeeConfigAuthority: signer.address,
            transferFeeBasisPoints:
              extension.newerTransferFee.transferFeeBasisPoints,
            maximumFee: extension.newerTransferFee.maximumFee,
          }),
        );
    }
  }

  await sendTransaction(instructions);

  return keypair.address;
}

export async function setupMintTEFee(
  config: { decimals?: number } = {},
): Promise<Address> {
  return setupMintTE({
    ...config,
    extensions: [
      {
        __kind: "TransferFeeConfig",
        transferFeeConfigAuthority: DEFAULT_ADDRESS,
        withdrawWithheldAuthority: DEFAULT_ADDRESS,
        withheldAmount: 0n,
        olderTransferFee: {
          epoch: 0n,
          maximumFee: 1e9,
          transferFeeBasisPoints: 100,
        },
        newerTransferFee: {
          epoch: 10n,
          maximumFee: 1e9,
          transferFeeBasisPoints: 150,
        },
      },
    ],
  });
}
