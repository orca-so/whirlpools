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
  getInitializeScaledUiAmountMintInstruction,
} from "@solana-program/token-2022";
import type { Address, Instruction } from "@solana/kit";
import { sendTransaction, signer } from "./mockRpc";
import { getCreateAccountInstruction } from "@solana-program/system";
import { DEFAULT_ADDRESS } from "../../src/config";
import { getNextKeypair } from "./keypair";

export async function setupAtaTE(
  mint: Address,
  config: { amount?: number | bigint; owner?: Address } = {},
): Promise<Address> {
  const ownerAddress = config.owner ?? signer.address;
  const ata = await findAssociatedTokenPda({
    mint,
    owner: ownerAddress,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  const instructions: Instruction[] = [];

  instructions.push(
    getCreateAssociatedTokenIdempotentInstruction({
      mint,
      owner: ownerAddress,
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
  const keypair = getNextKeypair();
  const instructions: Instruction[] = [];

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
        break;
      case "ScaledUiAmountConfig":
        instructions.push(
          getInitializeScaledUiAmountMintInstruction({
            mint: keypair.address,
            authority: signer.address,
            multiplier: 1,
          }),
        );
        break;
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

export async function setupMintTEScaledUiAmount(
  config: { decimals?: number } = {},
): Promise<Address> {
  return setupMintTE({
    ...config,
    extensions: [
      {
        __kind: "ScaledUiAmountConfig",
        authority: DEFAULT_ADDRESS,
        newMultiplierEffectiveTimestamp: 0n,
        multiplier: 1,
        newMultiplier: 1,
      },
    ],
  });
}
