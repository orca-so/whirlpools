import {
  fetchAllMaybeToken,
  fetchAllMint,
  findAssociatedTokenPda,
  getCloseAccountInstruction,
  getCreateAssociatedTokenInstruction,
  getInitializeAccount3Instruction,
  getSyncNativeInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import type {
  Account,
  Address,
  GetAccountInfoApi,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  IInstruction,
  MaybeAccount,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import {
  address,
  generateKeyPairSigner,
  getAddressDecoder,
  getAddressEncoder,
  lamports,
} from "@solana/kit";
import { NATIVE_MINT_WRAPPING_STRATEGY, ENFORCE_TOKEN_BALANCE_CHECK } from "./config";
import {
  getCreateAccountInstruction,
  getCreateAccountWithSeedInstruction,
  getTransferSolInstruction,
} from "@solana-program/system";
import { getTokenSize } from "@solana-program/token";
import { getTokenSize as getTokenSizeWithExtensions } from "@solana-program/token-2022";
import type { ExtensionArgs, Mint } from "@solana-program/token-2022";
import type { TransferFee } from "@orca-so/whirlpools-core";
import assert from "assert";

// This file is not exported through the barrel file

/** The public key for the native mint (SOL) */
export const NATIVE_MINT = address(
  "So11111111111111111111111111111111111111112",
);

/**
 * Represents the instructions and associated addresses for preparing token accounts during a transaction.
 */
type TokenAccountInstructions = {
  /** A list of instructions required to create the necessary token accounts. */
  createInstructions: IInstruction[];

  /** A list of instructions to clean up (e.g., close) token accounts after the transaction is complete. */
  cleanupInstructions: IInstruction[];

  /** A mapping of mint addresses to their respective token account addresses. */
  tokenAccountAddresses: Record<Address, Address>;
};

function mintFilter(x: Address) {
  if (
    NATIVE_MINT_WRAPPING_STRATEGY === "none" ||
    NATIVE_MINT_WRAPPING_STRATEGY === "ata"
  ) {
    return true;
  }
  return x != NATIVE_MINT;
}

/**
 *
 * Prepare token acounts required for a transaction. This will create
 * ATAs for the supplied mints.
 *
 * The NATIVE_MINT is a special case where this function will optionally wrap/unwrap
 * Native Mint based on the NATIVE_MINT_WRAPPING_STRATEGY.
 *
 * @param rpc
 * @param owner the owner to create token accounts for
 * @param spec the mints (and amounts) required in the token accounts
 * @returns Instructions and addresses for the required token accounts
 */
export async function prepareTokenAccountsInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
    GetMultipleAccountsApi &
    GetMinimumBalanceForRentExemptionApi
  >,
  owner: TransactionSigner,
  spec: Address[] | Record<Address, bigint | number>,
): Promise<TokenAccountInstructions> {
  const mintAddresses = Array.isArray(spec)
    ? spec
    : (Object.keys(spec) as Address[]);
  const nativeMintIndex = mintAddresses.indexOf(NATIVE_MINT);
  const hasNativeMint = nativeMintIndex !== -1;
  const mints = await fetchAllMint(rpc, mintAddresses.filter(mintFilter));
  const tokenAddresses = await Promise.all(
    mints.map((mint) =>
      findAssociatedTokenPda({
        owner: owner.address,
        mint: mint.address,
        tokenProgram: mint.programAddress,
      }).then((x) => x[0]),
    ),
  );
  const tokenAccounts = await fetchAllMaybeToken(rpc, tokenAddresses);
  const tokenAccountAddresses: Record<Address, Address> = {};

  const createInstructions: IInstruction[] = [];
  const cleanupInstructions: IInstruction[] = [];

  for (let i = 0; i < mints.length; i++) {
    const mint = mints[i];
    const tokenAccount = tokenAccounts[i];
    tokenAccountAddresses[mint.address] = tokenAccount.address;
    if (tokenAccount.exists) {
      continue;
    }
    createInstructions.push(
      getCreateAssociatedTokenInstruction({
        payer: owner,
        owner: owner.address,
        ata: tokenAccount.address,
        mint: mint.address,
        tokenProgram: mint.programAddress,
      }),
    );
  }

  if (!Array.isArray(spec)) {
    for (let i = 0; i < mints.length; i++) {
      const mint = mints[i];
      if (
        mint.address === NATIVE_MINT &&
        NATIVE_MINT_WRAPPING_STRATEGY !== "none"
      ) {
        continue;
      }
      const tokenAccount = tokenAccounts[i];
      const existingBalance = tokenAccount.exists
        ? tokenAccount.data.amount
        : 0n;
      if (ENFORCE_TOKEN_BALANCE_CHECK) {
        assert(
          BigInt(spec[mint.address]) <= existingBalance,
          `Token account for ${mint.address} does not have the required balance`,
        );
      }
    }
  }

  if (hasNativeMint && NATIVE_MINT_WRAPPING_STRATEGY === "keypair") {
    const keypair = await generateKeyPairSigner();
    const space = getTokenSize();
    let amount = await rpc
      .getMinimumBalanceForRentExemption(BigInt(space))
      .send();

    if (!Array.isArray(spec)) {
      amount = lamports(amount + BigInt(spec[NATIVE_MINT]));
    }

    createInstructions.push(
      getCreateAccountInstruction({
        payer: owner,
        newAccount: keypair,
        lamports: amount,
        space,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeAccount3Instruction({
        account: keypair.address,
        mint: NATIVE_MINT,
        owner: owner.address,
      }),
    );
    cleanupInstructions.push(
      getCloseAccountInstruction({
        account: keypair.address,
        owner,
        destination: owner.address,
      }),
    );
    tokenAccountAddresses[NATIVE_MINT] = keypair.address;
  }

  if (hasNativeMint && NATIVE_MINT_WRAPPING_STRATEGY === "seed") {
    const space = getTokenSize();
    let amount = await rpc
      .getMinimumBalanceForRentExemption(BigInt(space))
      .send();

    if (!Array.isArray(spec)) {
      amount = lamports(amount + BigInt(spec[NATIVE_MINT]));
    }

    // Generating secure seed takes longer and is not really needed here.
    // With date, it should only create collisions if the same owner
    // creates multiple accounts at exactly the same time (in ms)
    const seed = Date.now().toString();
    const buffer = await crypto.subtle.digest(
      "SHA-256",
      Buffer.concat([
        Buffer.from(getAddressEncoder().encode(owner.address)),
        Buffer.from(seed),
        Buffer.from(getAddressEncoder().encode(TOKEN_PROGRAM_ADDRESS)),
      ]),
    );
    tokenAccountAddresses[NATIVE_MINT] = getAddressDecoder().decode(
      new Uint8Array(buffer),
    );

    createInstructions.push(
      getCreateAccountWithSeedInstruction({
        payer: owner,
        newAccount: tokenAccountAddresses[NATIVE_MINT],
        base: owner.address,
        baseAccount: owner,
        seed: seed,
        space,
        amount,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeAccount3Instruction({
        account: tokenAccountAddresses[NATIVE_MINT],
        mint: NATIVE_MINT,
        owner: owner.address,
      }),
    );

    cleanupInstructions.push(
      getCloseAccountInstruction({
        account: tokenAccountAddresses[NATIVE_MINT],
        owner,
        destination: owner.address,
      }),
    );
  }

  if (hasNativeMint && NATIVE_MINT_WRAPPING_STRATEGY === "ata") {
    const account = tokenAccounts[nativeMintIndex];
    const existingBalance = account.exists ? account.data.amount : 0n;

    if (!Array.isArray(spec) && existingBalance < BigInt(spec[NATIVE_MINT])) {
      createInstructions.push(
        getTransferSolInstruction({
          source: owner,
          destination: tokenAccountAddresses[NATIVE_MINT],
          amount: BigInt(spec[NATIVE_MINT]) - existingBalance,
        }),
        getSyncNativeInstruction({
          account: tokenAccountAddresses[NATIVE_MINT],
        }),
      );
    }

    if (!account.exists) {
      cleanupInstructions.push(
        getCloseAccountInstruction({
          account: account.address,
          owner,
          destination: owner.address,
        }),
      );
    }
  }

  return {
    createInstructions,
    cleanupInstructions,
    tokenAccountAddresses,
  };
}

/**
 * Retrieves the current transfer fee configuration for a given token mint based on the current epoch.
 *
 * This function checks the mint's transfer fee configuration and returns the appropriate fee
 * structure (older or newer) depending on the current epoch. If no transfer fee configuration is found,
 * it returns `undefined`.
 *
 * @param {Mint} mint - The mint account of the token, which may include transfer fee extensions.
 * @param {bigint} currentEpoch - The current epoch to determine the applicable transfer fee.
 *
 * @returns {TransferFee | undefined} - The transfer fee configuration for the given mint, or `undefined` if no transfer fee is configured.
 */
export function getCurrentTransferFee(
  mint: MaybeAccount<Mint> | Account<Mint> | null,
  currentEpoch: bigint,
): TransferFee | undefined {
  if (
    mint == null ||
    ("exists" in mint && !mint.exists) ||
    mint.data.extensions.__option === "None"
  ) {
    return undefined;
  }
  const feeConfig = mint.data.extensions.value.find(
    (x) => x.__kind === "TransferFeeConfig",
  );
  if (feeConfig == null) {
    return undefined;
  }
  const transferFee =
    currentEpoch >= feeConfig.newerTransferFee.epoch
      ? feeConfig.newerTransferFee
      : feeConfig.olderTransferFee;
  return {
    feeBps: transferFee.transferFeeBasisPoints,
    maxFee: transferFee.maximumFee,
  };
}

/**
 * Builds the required account extensions for a given mint. This should only be used
 * for non-ATA token accounts since ATA accounts should also add the ImmutableOwner extension.
 *
 * https://github.com/solana-labs/solana-program-library/blob/3844bfac50990c1aa4dfb30f244f8c13178fc3fa/token/program-2022/src/extension/mod.rs#L1276
 *
 * @param {Mint} mint - The mint account to build extensions for.
 * @returns {ExtensionArgs[]} An array of extension arguments.
 */
export function getAccountExtensions(mint: Mint): ExtensionArgs[] {
  if (mint.extensions.__option === "None") {
    return [];
  }
  const extensions: ExtensionArgs[] = [];
  for (const extension of mint.extensions.value) {
    switch (extension.__kind) {
      case "TransferFeeConfig":
        extensions.push({
          __kind: "TransferFeeAmount",
          withheldAmount: 0n,
        });
        break;
      case "NonTransferable":
        extensions.push({
          __kind: "NonTransferableAccount",
        });
        break;
      case "TransferHook":
        extensions.push({
          __kind: "TransferHookAccount",
          transferring: false,
        });
        break;
    }
  }
  return extensions;
}

/**
 * Orders two mints by canonical byte order.
 *
 * @param {Address} mint1
 * @param {Address} mint2
 * @returns {[Address, Address]} [mint1, mint2] if mint1 should come first, [mint2, mint1] otherwise
 */
export function orderMints(mint1: Address, mint2: Address): [Address, Address] {
  const encoder = getAddressEncoder();
  const mint1Bytes = new Uint8Array(encoder.encode(mint1));
  const mint2Bytes = new Uint8Array(encoder.encode(mint2));
  return Buffer.compare(mint1Bytes, mint2Bytes) < 0
    ? [mint1, mint2]
    : [mint2, mint1];
}

/**
 * Returns the token size for a given mint account.
 *
 * @param {Account<Mint>} mint - The mint account to get the token size for.
 * @returns {number} The token size for the given mint account.
 */
export function getTokenSizeForMint(mint: Account<Mint>): number {
  const extensions = getAccountExtensions(mint.data);
  return extensions.length === 0
    ? getTokenSize()
    : getTokenSizeWithExtensions(extensions);
}
