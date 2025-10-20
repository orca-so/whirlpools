import type { AnchorProvider } from "@coral-xyz/anchor";
import { BN, web3 } from "@coral-xyz/anchor";
import { TokenUtil, TransactionBuilder } from "@orca-so/common-sdk";
import type { AuthorityType } from "@solana/spl-token";
import {
  AccountLayout,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createApproveInstruction,
  createAssociatedTokenAccountInstruction,
  createBurnInstruction,
  createInitializeAccount3Instruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { TEST_TOKEN_PROGRAM_ID } from "./test-consts";

export async function createMint(
  provider: AnchorProvider,
  authority?: web3.PublicKey,
): Promise<web3.PublicKey> {
  if (authority === undefined) {
    authority = provider.wallet.publicKey;
  }
  const mint = web3.Keypair.generate();
  const instructions = await createMintInstructions(
    provider,
    authority,
    mint.publicKey,
  );

  const tx = new web3.Transaction();
  tx.add(...instructions);

  await provider.sendAndConfirm(tx, [mint], { commitment: "confirmed" });

  return mint.publicKey;
}

export async function createMintInstructions(
  provider: AnchorProvider,
  authority: web3.PublicKey,
  mint: web3.PublicKey,
) {
  let instructions = [
    web3.SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: mint,
      space: 82,
      lamports: await provider.connection.getMinimumBalanceForRentExemption(82),
      programId: TEST_TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint, 0, authority, null),
  ];
  return instructions;
}

export async function createTokenAccount(
  provider: AnchorProvider,
  mint: web3.PublicKey,
  owner: web3.PublicKey,
) {
  const tokenAccount = web3.Keypair.generate();
  const tx = new web3.Transaction();
  tx.add(
    ...(await createTokenAccountInstrs(
      provider,
      tokenAccount.publicKey,
      mint,
      owner,
    )),
  );
  await provider.sendAndConfirm(tx, [tokenAccount], {
    commitment: "confirmed",
  });
  return tokenAccount.publicKey;
}

export async function createAssociatedTokenAccount(
  provider: AnchorProvider,
  mint: web3.PublicKey,
  owner: web3.PublicKey,
  payer: web3.PublicKey,
) {
  const ataAddress = getAssociatedTokenAddressSync(mint, owner);
  const instr = createAssociatedTokenAccountInstruction(
    payer,
    ataAddress,
    owner,
    mint,
  );
  const tx = new web3.Transaction();
  tx.add(instr);
  await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
  return ataAddress;
}

async function createTokenAccountInstrs(
  provider: AnchorProvider,
  newAccountPubkey: web3.PublicKey,
  mint: web3.PublicKey,
  owner: web3.PublicKey,
  lamports?: number,
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
    createInitializeAccount3Instruction(newAccountPubkey, mint, owner),
  ];
}

/**
 * Mints tokens to the specified destination token account.
 * @param provider An anchor AnchorProvider object used to send transactions
 * @param mint Mint address of the token
 * @param destination Destination token account to receive tokens
 * @param amount Number of tokens to mint
 */
export async function mintToDestination(
  provider: AnchorProvider,
  mint: web3.PublicKey,
  destination: web3.PublicKey,
  amount: number | BN,
): Promise<string> {
  const tx = new web3.Transaction();
  const amountVal = amount instanceof BN ? BigInt(amount.toString()) : amount;
  tx.add(
    createMintToInstruction(
      mint,
      destination,
      provider.wallet.publicKey,
      amountVal,
    ),
  );
  return provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
}

/**
 * Creates a token account for the mint and mints the specified amount of tokens into the token account.
 * The caller is assumed to be the mint authority.
 * @param provider An anchor AnchorProvider object used to send transactions
 * @param mint The mint address of the token
 * @param amount Number of tokens to mint to the newly created token account
 */
export async function createAndMintToTokenAccount(
  provider: AnchorProvider,
  mint: web3.PublicKey,
  amount: number | BN,
): Promise<web3.PublicKey> {
  const tokenAccount = await createTokenAccount(
    provider,
    mint,
    provider.wallet.publicKey,
  );
  await mintToDestination(
    provider,
    mint,
    tokenAccount,
    new BN(amount.toString()),
  );
  return tokenAccount;
}

export async function createAndMintToAssociatedTokenAccount(
  provider: AnchorProvider,
  mint: web3.PublicKey,
  amount: number | BN,
  destinationWallet?: web3.PublicKey,
  payer?: web3.PublicKey,
): Promise<web3.PublicKey> {
  const destinationWalletKey = destinationWallet
    ? destinationWallet
    : provider.wallet.publicKey;
  const payerKey = payer ? payer : provider.wallet.publicKey;

  // Workaround For SOL - just create a wSOL account to satisfy the rest of the test building pipeline.
  // Tests who want to test with SOL will have to request their own airdrop.
  if (mint.equals(NATIVE_MINT)) {
    const rentExemption =
      await provider.connection.getMinimumBalanceForRentExemption(
        AccountLayout.span,
        "confirmed",
      );
    const txBuilder = new TransactionBuilder(
      provider.connection,
      provider.wallet,
    );
    const { address: tokenAccount, ...ix } =
      TokenUtil.createWrappedNativeAccountInstruction(
        destinationWalletKey,
        new BN(amount.toString()),
        rentExemption,
      );
    txBuilder.addInstruction({ ...ix, cleanupInstructions: [] });
    await txBuilder.buildAndExecute();
    return tokenAccount;
  }

  const tokenAccounts = await provider.connection.getParsedTokenAccountsByOwner(
    destinationWalletKey,
    {
      programId: TOKEN_PROGRAM_ID,
    },
  );

  let tokenAccount = tokenAccounts.value
    .map((account) => {
      if (account.account.data.parsed.info.mint === mint.toString()) {
        return account.pubkey;
      }
      return undefined;
    })
    .filter(Boolean)[0];

  if (!tokenAccount) {
    tokenAccount = await createAssociatedTokenAccount(
      provider,
      mint,
      destinationWalletKey,
      payerKey,
    );
  }

  await mintToDestination(
    provider,
    mint,
    tokenAccount!,
    new BN(amount.toString()),
  );
  return tokenAccount!;
}

export async function getTokenBalance(
  provider: AnchorProvider,
  vault: web3.PublicKey,
) {
  return (await provider.connection.getTokenAccountBalance(vault, "confirmed"))
    .value.amount;
}

export async function approveToken(
  provider: AnchorProvider,
  tokenAccount: web3.PublicKey,
  delegate: web3.PublicKey,
  amount: number | BN,
  owner?: web3.Keypair,
  tokenProgram: web3.PublicKey = TOKEN_PROGRAM_ID,
) {
  const tx = new web3.Transaction();
  const amountVal = amount instanceof BN ? BigInt(amount.toString()) : amount;
  tx.add(
    createApproveInstruction(
      tokenAccount,
      delegate,
      owner?.publicKey || provider.wallet.publicKey,
      amountVal,
      undefined,
      tokenProgram,
    ),
  );
  return provider.sendAndConfirm(tx, !!owner ? [owner] : [], {
    commitment: "confirmed",
  });
}

export async function setAuthority(
  provider: AnchorProvider,
  tokenAccount: web3.PublicKey,
  newAuthority: web3.PublicKey | null,
  authorityType: AuthorityType,
  authority: web3.Keypair,
  tokenProgram: web3.PublicKey = TOKEN_PROGRAM_ID,
) {
  const tx = new web3.Transaction();
  tx.add(
    createSetAuthorityInstruction(
      tokenAccount,
      authority.publicKey,
      authorityType,
      newAuthority,
      undefined,
      tokenProgram,
    ),
  );

  return provider.sendAndConfirm(tx, [authority], { commitment: "confirmed" });
}

export async function transferToken(
  provider: AnchorProvider,
  source: web3.PublicKey,
  destination: web3.PublicKey,
  amount: number,
  tokenProgram: web3.PublicKey = TOKEN_PROGRAM_ID,
) {
  const tx = new web3.Transaction();
  tx.add(
    createTransferInstruction(
      source,
      destination,
      provider.wallet.publicKey,
      amount,
      undefined,
      tokenProgram,
    ),
  );
  return provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
}

export async function burnToken(
  provider: AnchorProvider,
  account: web3.PublicKey,
  mint: web3.PublicKey,
  amount: number | BN,
  owner?: web3.PublicKey,
) {
  const ownerKey = owner ?? provider.wallet.publicKey;
  const tx = new web3.Transaction();
  const amountVal = amount instanceof BN ? BigInt(amount.toString()) : amount;
  tx.add(createBurnInstruction(account, mint, ownerKey, amountVal));
  return provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
}
