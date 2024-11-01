import {
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToInstruction,
  getMintSize,
  getInitializeMint2Instruction,
} from "@solana-program/token-2022";
import type { Address, IInstruction } from "@solana/web3.js";
import { generateKeyPairSigner } from "@solana/web3.js";
import { sendTransaction, signer } from "./mockRpc";
import { getCreateAccountInstruction } from "@solana-program/system";

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
  config: { decimals?: number } = {},
): Promise<Address> {
  const keypair = await generateKeyPairSigner();
  const instructions: IInstruction[] = [];

  instructions.push(
    getCreateAccountInstruction({
      payer: signer,
      newAccount: keypair,
      lamports: 1e8,
      space: getMintSize(),
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),
  );

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

export async function setupMintTEFee(
  config: { decimals?: number } = {},
): Promise<Address> {
  // TODO: Implement fee
  return setupMintTE(config);
}

export async function setupMintTEHook(
  config: { decimals?: number } = {},
): Promise<Address> {
  // TODO: Implement hook
  return setupMintTE(config);
}
