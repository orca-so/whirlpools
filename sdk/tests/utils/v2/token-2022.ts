import { AnchorProvider, BN, web3 } from "@coral-xyz/anchor";
import { AddressUtil, TokenUtil, TransactionBuilder } from "@orca-so/common-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AccountLayout,
  ExtensionType,
  NATIVE_MINT,
  NATIVE_MINT_2022,
  addExtraAccountMetasForExecute,
  createApproveInstruction,
  createAssociatedTokenAccountInstruction,
  createDisableRequiredMemoTransfersInstruction,
  createEnableRequiredMemoTransfersInstruction,
  createInitializeAccount3Instruction,
  createInitializeMintInstruction,
  createInitializePermanentDelegateInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  createMintToInstruction,
  createReallocateInstruction,
  getAccount,
  getAccountLen,
  getAccountLenForMint,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  getMemoTransfer,
  getMint,
  getMintLen
} from "@solana/spl-token";
import { TEST_TOKEN_PROGRAM_ID, TEST_TOKEN_2022_PROGRAM_ID, TEST_TRANSFER_HOOK_PROGRAM_ID } from "../test-consts";
import { TokenTrait } from "./init-utils-v2";
import { Keypair, SystemProgram, TransactionInstruction, AccountMeta } from "@solana/web3.js";
import invariant from "tiny-invariant";
import { PoolUtil } from "../../../src";
import * as assert from "assert";
import { PublicKey } from "@solana/web3.js";
import { createInitializeExtraAccountMetaListInstruction } from "./test-transfer-hook-program";

export async function createMintV2(
  provider: AnchorProvider,
  tokenTrait: TokenTrait,
  authority?: web3.PublicKey,
  mintKeypair?: web3.Keypair,
): Promise<web3.PublicKey> {
  if (authority === undefined) {
    authority = provider.wallet.publicKey;
  }
  const mint = mintKeypair ?? web3.Keypair.generate();
  const instructions = await createMintInstructions(provider, tokenTrait, authority, mint.publicKey);

  const tx = new web3.Transaction();
  tx.add(...instructions);

  await provider.sendAndConfirm(tx, [mint], { commitment: "confirmed" });

  return mint.publicKey;
}

async function createMintInstructions(
  provider: AnchorProvider,
  tokenTrait: TokenTrait,
  authority: web3.PublicKey,
  mint: web3.PublicKey
) {
  invariant(!tokenTrait.isNativeMint, "Cannot create a mint for the native token");

  if (!tokenTrait.isToken2022) {
    const instructions = [
      web3.SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: mint,
        space: 82,
        lamports: await provider.connection.getMinimumBalanceForRentExemption(82),
        programId: TEST_TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(mint, 0, authority, tokenTrait.hasFreezeAuthority ? authority : null, TEST_TOKEN_PROGRAM_ID),
    ];
    return instructions;
  } else {
    const extensionTypes: ExtensionType[] = [];
    const extensions: TransactionInstruction[] = [];
    const postInitialization: TransactionInstruction[] = [];
    if (tokenTrait.hasPermanentDelegate) {
      extensionTypes.push(ExtensionType.PermanentDelegate);
      extensions.push(
        createInitializePermanentDelegateInstruction(
          mint,
          authority,
          TEST_TOKEN_2022_PROGRAM_ID
        )
      );
    }
    if (tokenTrait.hasTransferFeeExtension) {
      extensionTypes.push(ExtensionType.TransferFeeConfig);
      extensions.push(
        createInitializeTransferFeeConfigInstruction(
          mint,
          authority,
          authority,
          100,
          100000n,
          TEST_TOKEN_2022_PROGRAM_ID
        )
      );
    }
    if (tokenTrait.hasTransferHookExtension) {
      extensionTypes.push(ExtensionType.TransferHook);
      extensions.push(
        createInitializeTransferHookInstruction(
          mint,
          authority,
          TEST_TRANSFER_HOOK_PROGRAM_ID,
          TEST_TOKEN_2022_PROGRAM_ID,
        )
      );

      // create ExtraAccountMetaList account
      postInitialization.push(createInitializeExtraAccountMetaListInstruction(
        provider.wallet.publicKey,
        mint,
      ));
    }
    const space = getMintLen(extensionTypes);
    const instructions = [
      web3.SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: mint,
        space,
        lamports: await provider.connection.getMinimumBalanceForRentExemption(space),
        programId: TEST_TOKEN_2022_PROGRAM_ID,
      }),
      ...extensions,
      createInitializeMintInstruction(mint, 0, authority, tokenTrait.hasFreezeAuthority ? authority : null, TEST_TOKEN_2022_PROGRAM_ID),
      ...postInitialization,
    ];
    return instructions;    
  }
}

export async function createTokenAccountV2(
  provider: AnchorProvider,
  tokenTrait: TokenTrait,
  mint: web3.PublicKey,
  owner: web3.PublicKey
) {
  const tokenAccount = web3.Keypair.generate();
  const tx = new web3.Transaction();
  tx.add(...(await createTokenAccountInstructions(provider, tokenTrait, tokenAccount.publicKey, mint, owner)));
  await provider.sendAndConfirm(tx, [tokenAccount], { commitment: "confirmed" });
  return tokenAccount.publicKey;
}

export async function createAssociatedTokenAccountV2(
  provider: AnchorProvider,
  tokenTrait: TokenTrait,
  mint: web3.PublicKey,
  owner: web3.PublicKey,
  payer: web3.PublicKey
) {
  const tokenProgram = tokenTrait.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID;
  const ataAddress = getAssociatedTokenAddressSync(mint, owner, undefined, tokenProgram);
  const instr = createAssociatedTokenAccountInstruction(
    payer,
    ataAddress,
    owner,
    mint,
    tokenProgram,
  );
  const tx = new web3.Transaction();
  tx.add(instr);
  await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
  return ataAddress;
}

async function createTokenAccountInstructions(
  provider: AnchorProvider,
  tokenTrait: TokenTrait,
  newAccountPubkey: web3.PublicKey,
  mint: web3.PublicKey,
  owner: web3.PublicKey,
  lamports?: number
) {
  const mintAccountInfo = await provider.connection.getAccountInfo(mint);
  const mintData = await getMint(provider.connection, mint, undefined, mintAccountInfo!.owner);

  const isToken2022 = mintAccountInfo!.owner.equals(TEST_TOKEN_2022_PROGRAM_ID);

  if (!isToken2022) {
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
      createInitializeAccount3Instruction(newAccountPubkey, mint, owner, TEST_TOKEN_PROGRAM_ID)
    ];
  } else {
    const accountLen = getAccountLenForMint(mintData);
    if (lamports === undefined) {
      lamports = await provider.connection.getMinimumBalanceForRentExemption(accountLen);
    }
    return [
      web3.SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey,
        space: accountLen,
        lamports,
        programId: TEST_TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(newAccountPubkey, mint, owner, TEST_TOKEN_2022_PROGRAM_ID)
    ];
  }
}

export async function mintToDestinationV2(
  provider: AnchorProvider,
  tokenTrait: TokenTrait,
  mint: web3.PublicKey,
  destination: web3.PublicKey,
  amount: number | BN
): Promise<string> {
  const tx = new web3.Transaction();
  const amountVal = amount instanceof BN ? BigInt(amount.toString()) : amount;
  tx.add(
    createMintToInstruction(
      mint,
      destination,
      provider.wallet.publicKey,
      amountVal,
      undefined,
      tokenTrait.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID
    )
  );
  return provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
}

export async function createAndMintToTokenAccountV2(
  provider: AnchorProvider,
  tokenTrait: TokenTrait,
  mint: web3.PublicKey,
  amount: number | BN
): Promise<web3.PublicKey> {
  const tokenAccount = await createTokenAccountV2(provider, tokenTrait, mint, provider.wallet.publicKey);
  await mintToDestinationV2(provider, tokenTrait, mint, tokenAccount, new BN(amount.toString()));
  return tokenAccount;
}

export async function createAndMintToAssociatedTokenAccountV2(
  provider: AnchorProvider,
  tokenTrait: TokenTrait,
  mint: web3.PublicKey,
  amount: number | BN,
  destinationWallet?: web3.PublicKey,
  payer?: web3.PublicKey
): Promise<web3.PublicKey> {
  const destinationWalletKey = destinationWallet ? destinationWallet : provider.wallet.publicKey;
  const payerKey = payer ? payer : provider.wallet.publicKey;

  // Workaround For SOL - just create a wSOL account to satisfy the rest of the test building pipeline.
  // Tests who want to test with SOL will have to request their own airdrop.
  if (mint.equals(NATIVE_MINT)) {
    invariant(tokenTrait.isNativeMint, "Mint must be the native mint");
    const rentExemption = await provider.connection.getMinimumBalanceForRentExemption(
      AccountLayout.span,
      "confirmed"
    );
    const txBuilder = new TransactionBuilder(provider.connection, provider.wallet);
    const { address: tokenAccount, ...ix } = TokenUtil.createWrappedNativeAccountInstruction(
      destinationWalletKey,
      new BN(amount.toString()),
      rentExemption
    );
    txBuilder.addInstruction({ ...ix, cleanupInstructions: [] });
    await txBuilder.buildAndExecute();
    return tokenAccount;
  }
  if (mint.equals(NATIVE_MINT_2022)) {
    invariant(tokenTrait.isNativeMint, "Mint must be the native mint");

    const space = getAccountLen([]);
    const rentExemption = await provider.connection.getMinimumBalanceForRentExemption(space, "confirmed");
    const tokenAccountKeypair = Keypair.generate();

    const txBuilder = new TransactionBuilder(provider.connection, provider.wallet);
    txBuilder.addInstruction({
      instructions: [
        web3.SystemProgram.createAccount({
          fromPubkey: provider.wallet.publicKey,
          newAccountPubkey: tokenAccountKeypair.publicKey,
          space,
          lamports: rentExemption,
          programId: TEST_TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeAccount3Instruction(tokenAccountKeypair.publicKey, mint, destinationWalletKey, TEST_TOKEN_2022_PROGRAM_ID)
      ],
      cleanupInstructions: [],
      signers: [tokenAccountKeypair]
    });
    await txBuilder.buildAndExecute();
    return tokenAccountKeypair.publicKey;
  }

  const tokenAccounts = await provider.connection.getParsedTokenAccountsByOwner(destinationWalletKey, {
    programId: tokenTrait.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID,
  });

  let tokenAccount = tokenAccounts.value.map((account) => {
    if (account.account.data.parsed.info.mint === mint.toString()) {
      return account.pubkey
    }
  }).filter(Boolean)[0];

  if (!tokenAccount) {
    tokenAccount = await createAssociatedTokenAccountV2(
      provider,
      tokenTrait,
      mint,
      destinationWalletKey,
      payerKey
    );
  }

  await mintToDestinationV2(provider, tokenTrait, mint, tokenAccount!, new BN(amount.toString()));
  return tokenAccount!;
}

export async function getTokenBalance(provider: AnchorProvider, vault: web3.PublicKey) {
  return (await provider.connection.getTokenAccountBalance(vault, "confirmed")).value.amount;
}

export async function createInOrderMintsV2(provider: AnchorProvider, tokenTraitA: TokenTrait, tokenTraitB: TokenTrait) {
  if (tokenTraitA.isNativeMint && !tokenTraitB.isNativeMint) {
    const tokenXMintPubKey = tokenTraitA.isToken2022 ? NATIVE_MINT_2022 : NATIVE_MINT;

    let ordered;
    do {
      const tokenYMintPubKey = await createMintV2(provider, tokenTraitB);
      ordered = PoolUtil.orderMints(tokenXMintPubKey, tokenYMintPubKey).map(AddressUtil.toPubKey);
    } while (!ordered[0].equals(tokenXMintPubKey));
    return ordered;  
  } else if (!tokenTraitA.isNativeMint && tokenTraitB.isNativeMint) {
    const tokenYMintPubKey = tokenTraitB.isToken2022 ? NATIVE_MINT_2022 : NATIVE_MINT;

    let ordered;
    do {
      const tokenXMintPubKey = await createMintV2(provider, tokenTraitA);
      ordered = PoolUtil.orderMints(tokenXMintPubKey, tokenYMintPubKey).map(AddressUtil.toPubKey);
    } while (!ordered[1].equals(tokenYMintPubKey));
    return ordered;
  }
  else if (!tokenTraitA.isNativeMint && !tokenTraitB.isNativeMint) {
    while (true) {
      const tokenXMintPubKey = await createMintV2(provider, tokenTraitA);
      const tokenYMintPubKey = await createMintV2(provider, tokenTraitB);
      const ordered = PoolUtil.orderMints(tokenXMintPubKey, tokenYMintPubKey).map(AddressUtil.toPubKey);
      if (ordered[0].equals(tokenXMintPubKey)) {
        return ordered;
      }
    }
  } else {
    // A must be WSOL: So11111111111111111111111111111111111111112
    // B must be WSOL-2022: 9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP
    invariant(!tokenTraitA.isToken2022, "A must be the native mint");
    invariant(tokenTraitB.isToken2022, "B must be the native mint 2022");
    return [NATIVE_MINT, NATIVE_MINT_2022];
  }
};

export async function approveTokenV2(
  provider: AnchorProvider,
  tokenTrait: TokenTrait,
  tokenAccount: web3.PublicKey,
  delegate: web3.PublicKey,
  amount: number | BN,
  owner?: web3.Keypair
) {
  const tx = new web3.Transaction();
  const tokenProgram = tokenTrait.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID;
  const amountVal = amount instanceof BN ? BigInt(amount.toString()) : amount;
  tx.add(
    createApproveInstruction(
      tokenAccount,
      delegate,
      owner?.publicKey || provider.wallet.publicKey,
      amountVal,
      undefined,
      tokenProgram,
    )
  );
  return provider.sendAndConfirm(tx, !!owner ? [owner] : [], { commitment: "confirmed" });
}

export async function enableRequiredMemoTransfers(
  provider: AnchorProvider,
  tokenAccount: web3.PublicKey,
  owner?: web3.Keypair,
) {
  const tx = new web3.Transaction();
  tx.add(
    createReallocateInstruction(
      tokenAccount,
      owner?.publicKey || provider.wallet.publicKey,
      [ExtensionType.MemoTransfer],
      owner?.publicKey || provider.wallet.publicKey,
      undefined,
      TEST_TOKEN_2022_PROGRAM_ID,
    )
  );
  tx.add(
    createEnableRequiredMemoTransfersInstruction(
      tokenAccount,
      owner?.publicKey || provider.wallet.publicKey,
      undefined,
      TEST_TOKEN_2022_PROGRAM_ID
    )
  );
  return provider.sendAndConfirm(tx, !!owner ? [owner] : [], { commitment: "confirmed" });
}

export async function disableRequiredMemoTransfers(
  provider: AnchorProvider,
  tokenAccount: web3.PublicKey,
  owner?: web3.Keypair,
) {
  const tx = new web3.Transaction();
  tx.add(
    createDisableRequiredMemoTransfersInstruction(
      tokenAccount,
      owner?.publicKey || provider.wallet.publicKey,
      undefined,
      TEST_TOKEN_2022_PROGRAM_ID
    )
  );
  return provider.sendAndConfirm(tx, !!owner ? [owner] : [], { commitment: "confirmed" });
}

export async function isRequiredMemoTransfersEnabled(
  provider: AnchorProvider,
  tokenAccount: web3.PublicKey,
) {
  const account = await getAccount(provider.connection, tokenAccount, "confirmed", TEST_TOKEN_2022_PROGRAM_ID);

  const extensions = getExtensionTypes(account.tlvData);
  if (!extensions.includes(ExtensionType.MemoTransfer)) return false;

  const memoTransferData = getMemoTransfer(account);
  return memoTransferData?.requireIncomingTransferMemos;
}

export async function asyncAssertTokenVaultV2(
  provider: AnchorProvider,
  account: web3.PublicKey,
  expectedMint: web3.PublicKey,
  expectedAccountOwner: web3.PublicKey,
  expectedTokenProgram: web3.PublicKey,
) {
  const accountInfo = await provider.connection.getAccountInfo(account);
  assert.ok(accountInfo);
  assert.ok(accountInfo.owner.equals(expectedTokenProgram));
  const parsedAccount = AccountLayout.decode(accountInfo.data);
  assert.ok(parsedAccount.mint.equals(expectedMint));
  assert.ok(parsedAccount.owner.equals(expectedAccountOwner));
}

export async function asyncAssertOwnerProgram(
  provider: AnchorProvider,
  account: web3.PublicKey,
  programId: web3.PublicKey
) {
  const accountInfo = await provider.connection.getAccountInfo(account);
  assert.ok(accountInfo);
  assert.ok(accountInfo.owner.equals(programId));
}

export async function getExtraAccountMetasForHookProgram(
  provider: AnchorProvider,
  hookProgramId: web3.PublicKey,
  source: web3.PublicKey,
  mint: web3.PublicKey,
  destination: web3.PublicKey,
  owner: web3.PublicKey,
  amount: number | bigint,
): Promise<AccountMeta[] | undefined> {
  const instruction = new TransactionInstruction({
    programId: TEST_TOKEN_2022_PROGRAM_ID,
    keys: [
      {pubkey: source, isSigner: false, isWritable: false},
      {pubkey: mint, isSigner: false, isWritable: false},
      {pubkey: destination, isSigner: false, isWritable: false},
      {pubkey: owner, isSigner: false, isWritable: false},
      {pubkey: owner, isSigner: false, isWritable: false},
    ]
  });

  await addExtraAccountMetasForExecute(
    provider.connection,
    instruction,
    hookProgramId,
    source,
    mint,
    destination,
    owner,
    amount,
    "confirmed"
  );

  const extraAccountMetas = instruction.keys.slice(5);
  return extraAccountMetas.length > 0
    ? extraAccountMetas
    : undefined;
}
