import { AnchorProvider, BN, web3 } from "@coral-xyz/anchor";
import { AddressUtil, TokenUtil, TransactionBuilder, U64_MAX, ZERO } from "@orca-so/common-sdk";
import {
  AccountLayout,
  AccountState,
  ExtensionType,
  LENGTH_SIZE,
  NATIVE_MINT,
  NATIVE_MINT_2022,
  TYPE_SIZE,
  TransferFee,
  addExtraAccountMetasForExecute,
  calculateFee,
  createApproveInstruction,
  createAssociatedTokenAccountInstruction,
  createCreateNativeMintInstruction,
  createDisableRequiredMemoTransfersInstruction,
  createEnableRequiredMemoTransfersInstruction,
  createInitializeAccount3Instruction,
  createInitializeDefaultAccountStateInstruction,
  createInitializeGroupMemberPointerInstruction,
  createInitializeGroupPointerInstruction,
  createInitializeInterestBearingMintInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintCloseAuthorityInstruction,
  createInitializeMintInstruction,
  createInitializeNonTransferableMintInstruction,
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
  getMintLen,
  getTypeLen
} from "@solana/spl-token";
import {
  TokenMetadata,
  pack as packTokenMetadata,
  createInitializeInstruction as createInitializeTokenMetadataInstruction,
} from "@solana/spl-token-metadata";
import {
  createInitializeGroupInstruction,
  createInitializeMemberInstruction,
  packTokenGroup,
  packTokenGroupMember,
  TokenGroup,
  TokenGroupMember,
} from "@solana/spl-token-group";
import { TEST_TOKEN_PROGRAM_ID, TEST_TOKEN_2022_PROGRAM_ID, TEST_TRANSFER_HOOK_PROGRAM_ID, ZERO_BN } from "../test-consts";
import { TokenTrait } from "./init-utils-v2";
import { Keypair, TransactionInstruction, AccountMeta } from "@solana/web3.js";
import invariant from "tiny-invariant";
import { PoolUtil } from "../../../src";
import * as assert from "assert";
import { PublicKey } from "@solana/web3.js";
import { createInitializeExtraAccountMetaListInstruction } from "./test-transfer-hook-program";
import { createInitializeConfidentialTransferMintInstruction } from "./confidential-transfer";

export async function createMintV2(
  provider: AnchorProvider,
  tokenTrait: TokenTrait,
  authority?: web3.PublicKey,
  mintKeypair?: web3.Keypair,
): Promise<web3.PublicKey> {
  if (authority === undefined) {
    authority = provider.wallet.publicKey;
  }

  if (tokenTrait.isNativeMint) {
    if (tokenTrait.isToken2022) {
      await initializeNativeMint2022Idempotent(provider);
      return NATIVE_MINT_2022;
    }
    return NATIVE_MINT;
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
    const fixedLengthExtensions: ExtensionType[] = [];
    const rentReservedSpace: number[] = [];
    const extensions: TransactionInstruction[] = [];
    const postInitialization: TransactionInstruction[] = [];

    // PermanentDelegate
    if (tokenTrait.hasPermanentDelegate) {
      fixedLengthExtensions.push(ExtensionType.PermanentDelegate);
      extensions.push(
        createInitializePermanentDelegateInstruction(
          mint,
          authority,
          TEST_TOKEN_2022_PROGRAM_ID
        )
      );
    }

    // TransferFee
    if (tokenTrait.hasTransferFeeExtension) {
      fixedLengthExtensions.push(ExtensionType.TransferFeeConfig);
      extensions.push(
        createInitializeTransferFeeConfigInstruction(
          mint,
          authority,
          authority,
          tokenTrait.transferFeeInitialBps ?? 500, // default: 5%
          tokenTrait.transferFeeInitialMax ?? BigInt(U64_MAX.toString()), // default: virtually unlimited
          TEST_TOKEN_2022_PROGRAM_ID
        )
      );
    }

    // TransferHook
    if (tokenTrait.hasTransferHookExtension) {
      fixedLengthExtensions.push(ExtensionType.TransferHook);
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

    // ConfidentialTransfer
    // [March 6, 2024] getTypeLen(ExtensionType.ConfidentialTransferMint) return 97, but 65 (2 pubkey + 1 bool) is valid
    // https://github.com/solana-labs/solana-program-library/blob/d72289c79a04411c69a8bf1054f7156b6196f9b3/token/js/src/extensions/extensionType.ts#L74
    let confidentialTransferMintSizePatch = 0;
    if (tokenTrait.hasConfidentialTransferExtension) {
      fixedLengthExtensions.push(ExtensionType.ConfidentialTransferMint);
      confidentialTransferMintSizePatch = (65 - getTypeLen(ExtensionType.ConfidentialTransferMint));
      extensions.push(
        createInitializeConfidentialTransferMintInstruction(
          mint,
          authority,
          true, // autoApproveNewAccounts
          PublicKey.default, // auditorElgamal
          TEST_TOKEN_2022_PROGRAM_ID,
        )
      );
    }

    // InterestBearing
    if (tokenTrait.hasInterestBearingExtension) {
      fixedLengthExtensions.push(ExtensionType.InterestBearingConfig);
      extensions.push(
        createInitializeInterestBearingMintInstruction(
          mint,
          authority,
          1,
          TEST_TOKEN_2022_PROGRAM_ID,
        )
      );
    }

    // CloseMintAuthority
    if (tokenTrait.hasMintCloseAuthorityExtension) {
      fixedLengthExtensions.push(ExtensionType.MintCloseAuthority);
      extensions.push(
        createInitializeMintCloseAuthorityInstruction(
          mint,
          authority,
          TEST_TOKEN_2022_PROGRAM_ID,
        )
      );
    }

    // DefaultAccountState
    if (tokenTrait.hasDefaultAccountStateExtension) {
      fixedLengthExtensions.push(ExtensionType.DefaultAccountState);
      extensions.push(
        createInitializeDefaultAccountStateInstruction(
          mint,
          tokenTrait.defaultAccountInitialState ?? AccountState.Frozen,
          TEST_TOKEN_2022_PROGRAM_ID,
        )
      );
    }

    // NonTransferableMint
    if (tokenTrait.hasNonTransferableExtension) {
      fixedLengthExtensions.push(ExtensionType.NonTransferable);
      extensions.push(
        createInitializeNonTransferableMintInstruction(
          mint,
          TEST_TOKEN_2022_PROGRAM_ID,
        )
      );
    }

    // TokenMetadata
    if (tokenTrait.hasTokenMetadataExtension) {
      const identifier = mint.toBase58().slice(0, 8);
      const metadata: TokenMetadata = {
        mint,
        updateAuthority: authority,
        name: `test token ${identifier}`,
        symbol: identifier,
        uri: `https://test.orca.so/${identifier}.json`,
        additionalMetadata: [],
      };

      const tokenMetadataSize = packTokenMetadata(metadata).length;
      const tokenMetadataExtensionSize = TYPE_SIZE + LENGTH_SIZE + tokenMetadataSize;
      rentReservedSpace.push(tokenMetadataExtensionSize);
      postInitialization.push(
        createInitializeTokenMetadataInstruction({
          metadata: mint,
          mint,
          mintAuthority: authority,
          updateAuthority: metadata.updateAuthority!,
          name: metadata.name,
          symbol: metadata.symbol,
          uri: metadata.uri,
          programId: TEST_TOKEN_2022_PROGRAM_ID,
        })
      );
    }
    
    // MetadataPointer
    if (tokenTrait.hasMetadataPointerExtension) {
      fixedLengthExtensions.push(ExtensionType.MetadataPointer);
      extensions.push(
        createInitializeMetadataPointerInstruction(
          mint,
          authority,
          mint,
          TEST_TOKEN_2022_PROGRAM_ID,
        )
      );
    }

    // GroupPointer
    if (tokenTrait.hasGroupPointerExtension) {
      fixedLengthExtensions.push(ExtensionType.GroupPointer);
      extensions.push(
        createInitializeGroupPointerInstruction(
          mint,
          authority,
          mint,
          TEST_TOKEN_2022_PROGRAM_ID,
        )
      );
    }

    // MemberPointer
    if (tokenTrait.hasGroupMemberPointerExtension) {
      fixedLengthExtensions.push(ExtensionType.GroupMemberPointer);
      extensions.push(
        createInitializeGroupMemberPointerInstruction(
          mint,
          authority,
          null,
          TEST_TOKEN_2022_PROGRAM_ID,
        )
      );
    }

    // Group
    if (tokenTrait.hasGroupExtension) {
      const groupData: TokenGroup = {
        mint,
        updateAuthority: authority,
        maxSize: 10,
        size: 10,
      };

      const tokenGroupSize = packTokenGroup(groupData).length;
      const tokenGroupExtensionSize = TYPE_SIZE + LENGTH_SIZE + tokenGroupSize;
      rentReservedSpace.push(tokenGroupExtensionSize);
      postInitialization.push(
        createInitializeGroupInstruction({
          // maybe this data is meaning less, but it is okay, because we use this to test rejecting it.
          mint: mint,
          mintAuthority: authority,
          updateAuthority: PublicKey.default,// groupData.updateAuthority!,
          group: mint,
          maxSize: groupData.maxSize,
          programId: TEST_TOKEN_2022_PROGRAM_ID,
        })
      );
    }

    // Member
    if (tokenTrait.hasGroupMemberExtension) {
      const groupMemberData: TokenGroupMember = {
        mint: mint,
        group: mint,
        memberNumber: 10,
      };

      const tokenGroupMemberSize = packTokenGroupMember(groupMemberData).length;
      const tokenGroupMemberExtensionSize = TYPE_SIZE + LENGTH_SIZE + tokenGroupMemberSize;
      rentReservedSpace.push(tokenGroupMemberExtensionSize);
      postInitialization.push(
        createInitializeMemberInstruction({
          // maybe this data is meaning less, but it is okay, because we use this to test rejecting it.
          group: mint,
          memberMint: mint,
          groupUpdateAuthority: authority,
          member: mint,
          memberMintAuthority: authority,
          programId: TEST_TOKEN_2022_PROGRAM_ID,
        })
      );
    }

    const space = getMintLen(fixedLengthExtensions) + confidentialTransferMintSizePatch;
    const rentOnlySpace = rentReservedSpace.reduce((sum, n) => { return sum + n; }, 0);
    const instructions = [
      web3.SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: mint,
        space,
        lamports: await provider.connection.getMinimumBalanceForRentExemption(space + rentOnlySpace) ,
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

export async function initializeNativeMint2022Idempotent(
  provider: AnchorProvider,
) {
  const accountInfo = await provider.connection.getAccountInfo(NATIVE_MINT_2022, "confirmed");

  // already initialized
  if (accountInfo !== null) return;

  const ix = createCreateNativeMintInstruction(
    provider.wallet.publicKey,
    NATIVE_MINT_2022,
    TEST_TOKEN_2022_PROGRAM_ID,
  );

  const txBuilder = new TransactionBuilder(provider.connection, provider.wallet);
  txBuilder.addInstruction({ instructions: [ix], cleanupInstructions: [], signers: [] });
  await txBuilder.buildAndExecute();
}

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

function ceil_div_bn(num: BN, denom: BN): BN {
  return num.add(denom.subn(1)).div(denom);
}

export function calculateTransferFeeIncludedAmount(
  transferFee: TransferFee,
  amount: BN,
): { amount: BN, fee: BN } {
  // https://github.com/solana-labs/solana-program-library/blob/master/token/program-2022/src/extension/transfer_fee/mod.rs#L90

  const ONE_IN_BASIS_POINTS = 10_000;
  const maxFeeBN = new BN(transferFee.maximumFee.toString());

  // edge cases

  if (transferFee.transferFeeBasisPoints === 0) {
    return {
      amount,
      fee: ZERO_BN,
    };
  }

  if (amount.isZero()) {
    return {
      amount: ZERO_BN,
      fee: ZERO_BN,
    };
  }

  if (transferFee.transferFeeBasisPoints === ONE_IN_BASIS_POINTS) {
    if (amount.add(maxFeeBN).gt(U64_MAX)) {
      throw new Error("TransferFeeIncludedAmount exceeds U64_MAX");
    }
    return {
      amount: amount.add(maxFeeBN),
      fee: maxFeeBN,
    };
  }

  // normal case

  const num = amount.muln(ONE_IN_BASIS_POINTS);
  const denom = new BN(ONE_IN_BASIS_POINTS - transferFee.transferFeeBasisPoints);
  const rawFeeIncludedAmount = ceil_div_bn(num, denom);

  if (rawFeeIncludedAmount.sub(amount).gte(maxFeeBN)) {
    if (amount.add(maxFeeBN).gt(U64_MAX)) {
      throw new Error("TransferFeeIncludedAmount exceeds U64_MAX");
    }

    return {
      amount: amount.add(maxFeeBN),
      fee: maxFeeBN,
    };
  }

  if (rawFeeIncludedAmount.gt(U64_MAX)) {
    throw new Error("TransferFeeIncludedAmount exceeds U64_MAX");
  }

  return {
    amount: rawFeeIncludedAmount,
    fee: rawFeeIncludedAmount.sub(amount),
  };
}

export function calculateTransferFeeExcludedAmount(
  transferFee: TransferFee,
  amount: BN,
): { amount: BN, fee: BN } {
  const fee = calculateFee(transferFee, BigInt(amount.toString()));
  const feeBN = new BN(fee.toString());
  return {
    amount: amount.sub(feeBN),
    fee: feeBN,
  };
}

export async function mintTokensToTestAccountV2(
  provider: AnchorProvider,
  tokenAMint: PublicKey,
  tokenTraitA: TokenTrait,
  tokenMintForA: number,
  tokenBMint: PublicKey,
  tokenTraitB: TokenTrait,
  tokenMintForB: number,
  destinationWallet?: PublicKey
) {
  const userTokenAAccount = await createAndMintToAssociatedTokenAccountV2(
    provider,
    tokenTraitA,
    tokenAMint,
    tokenMintForA,
    destinationWallet
  );
  const userTokenBAccount = await createAndMintToAssociatedTokenAccountV2(
    provider,
    tokenTraitB,
    tokenBMint,
    tokenMintForB,
    destinationWallet
  );

  return [userTokenAAccount, userTokenBAccount];
}