import { deriveATA } from "@orca-so/common-sdk";
import { BN, Provider, web3 } from "@project-serum/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AuthorityType,
  Token,
  TOKEN_PROGRAM_ID,
  u64,
} from "@solana/spl-token";
import { TEST_TOKEN_PROGRAM_ID } from "./test-consts";

export async function createMint(
  provider: Provider,
  authority?: web3.PublicKey
): Promise<web3.PublicKey> {
  if (authority === undefined) {
    authority = provider.wallet.publicKey;
  }
  const mint = web3.Keypair.generate();
  const instructions = await createMintInstructions(provider, authority, mint.publicKey);

  const tx = new web3.Transaction();
  tx.add(...instructions);

  await provider.send(tx, [mint], { commitment: "confirmed" });

  return mint.publicKey;
}

export async function createMintInstructions(
  provider: Provider,
  authority: web3.PublicKey,
  mint: web3.PublicKey
) {
  let instructions = [
    web3.SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: mint,
      space: 82,
      lamports: await provider.connection.getMinimumBalanceForRentExemption(82),
      programId: TEST_TOKEN_PROGRAM_ID,
    }),
    Token.createInitMintInstruction(TEST_TOKEN_PROGRAM_ID, mint, 0, authority, null),
  ];
  return instructions;
}

export async function createTokenAccount(
  provider: Provider,
  mint: web3.PublicKey,
  owner: web3.PublicKey
) {
  const tokenAccount = web3.Keypair.generate();
  const tx = new web3.Transaction();
  tx.add(...(await createTokenAccountInstrs(provider, tokenAccount.publicKey, mint, owner)));
  await provider.send(tx, [tokenAccount], { commitment: "confirmed" });
  return tokenAccount.publicKey;
}

export async function createAssociatedTokenAccount(
  provider: Provider,
  mint: web3.PublicKey,
  owner: web3.PublicKey,
  payer: web3.PublicKey
) {
  const ataAddress = await deriveATA(owner, mint);

  const instr = Token.createAssociatedTokenAccountInstruction(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    mint,
    ataAddress,
    owner,
    payer
  );
  const tx = new web3.Transaction();
  tx.add(instr);
  await provider.send(tx, [], { commitment: "confirmed" });
  return ataAddress;
}

async function createTokenAccountInstrs(
  provider: Provider,
  newAccountPubkey: web3.PublicKey,
  mint: web3.PublicKey,
  owner: web3.PublicKey,
  lamports?: number
) {
  if (lamports === undefined) {
    lamports = await provider.connection.getMinimumBalanceForRentExemption(165);
  }
  return [
    web3.SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey,
      space: 165,
      lamports,
      programId: TEST_TOKEN_PROGRAM_ID,
    }),
    Token.createInitAccountInstruction(TEST_TOKEN_PROGRAM_ID, mint, newAccountPubkey, owner),
  ];
}

/**
 * Mints tokens to the specified destination token account.
 * @param provider An anchor Provider object used to send transactions
 * @param mint Mint address of the token
 * @param destination Destination token account to receive tokens
 * @param amount Number of tokens to mint
 */
export async function mintToByAuthority(
  provider: Provider,
  mint: web3.PublicKey,
  destination: web3.PublicKey,
  amount: number | BN
): Promise<string> {
  const tx = new web3.Transaction();
  tx.add(
    Token.createMintToInstruction(
      TOKEN_PROGRAM_ID,
      mint,
      destination,
      provider.wallet.publicKey,
      [],
      amount
    )
  );
  return provider.send(tx, [], { commitment: "confirmed" });
}

/**
 * Creates a token account for the mint and mints the specified amount of tokens into the token account.
 * The caller is assumed to be the mint authority.
 * @param provider An anchor Provider object used to send transactions
 * @param mint The mint address of the token
 * @param amount Number of tokens to mint to the newly created token account
 */
export async function createAndMintToTokenAccount(
  provider: Provider,
  mint: web3.PublicKey,
  amount: number | BN
): Promise<web3.PublicKey> {
  const tokenAccount = await createTokenAccount(provider, mint, provider.wallet.publicKey);
  await mintToByAuthority(provider, mint, tokenAccount, amount);
  return tokenAccount;
}

export async function createAndMintToAssociatedTokenAccount(
  provider: Provider,
  mint: web3.PublicKey,
  amount: number | BN,
  destinationWallet?: web3.PublicKey,
  payer?: web3.PublicKey
): Promise<web3.PublicKey> {
  const destinationWalletKey = destinationWallet ? destinationWallet : provider.wallet.publicKey;
  const payerKey = payer ? payer : provider.wallet.publicKey;
  const tokenAccount = await createAssociatedTokenAccount(
    provider,
    mint,
    destinationWalletKey,
    payerKey
  );
  await mintToByAuthority(provider, mint, tokenAccount, amount);
  return tokenAccount;
}

export async function getTokenBalance(provider: Provider, vault: web3.PublicKey) {
  return (await provider.connection.getTokenAccountBalance(vault, "confirmed")).value.amount;
}

export async function approveToken(
  provider: Provider,
  tokenAccount: web3.PublicKey,
  delegate: web3.PublicKey,
  amount: number | u64,
  owner?: web3.Keypair
) {
  const tx = new web3.Transaction();
  tx.add(
    Token.createApproveInstruction(
      TOKEN_PROGRAM_ID,
      tokenAccount,
      delegate,
      owner?.publicKey || provider.wallet.publicKey,
      [],
      amount
    )
  );
  return provider.send(tx, [owner], { commitment: "confirmed" });
}

export async function setAuthority(
  provider: Provider,
  tokenAccount: web3.PublicKey,
  newAuthority: web3.PublicKey,
  authorityType: AuthorityType,
  authority: web3.Keypair
) {
  const tx = new web3.Transaction();
  tx.add(
    Token.createSetAuthorityInstruction(
      TOKEN_PROGRAM_ID,
      tokenAccount,
      newAuthority,
      authorityType,
      authority.publicKey,
      []
    )
  );

  return provider.send(tx, [authority], { commitment: "confirmed" });
}

export async function transfer(
  provider: Provider,
  source: web3.PublicKey,
  destination: web3.PublicKey,
  amount: number
) {
  const tx = new web3.Transaction();
  tx.add(
    Token.createTransferInstruction(
      TOKEN_PROGRAM_ID,
      source,
      destination,
      provider.wallet.publicKey,
      [],
      amount
    )
  );
  return provider.send(tx, [], { commitment: "confirmed" });
}
