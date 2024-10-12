import {
  fetchAllMaybeToken,
  fetchAllMint,
  fetchMaybeToken,
  findAssociatedTokenPda,
  getCloseAccountInstruction,
  getCreateAssociatedTokenInstruction,
  getInitializeAccount3Instruction,
  getSyncNativeInstruction,
  getTokenSize,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import type {
  Address,
  GetAccountInfoApi,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  IInstruction,
  Rpc,
  TransactionSigner,
} from "@solana/web3.js";
import {
  address,
  generateKeyPairSigner,
  getAddressDecoder,
  getAddressEncoder,
} from "@solana/web3.js";
import { SOL_WRAPPING_STRATEGY } from "./config";
import {
  getCreateAccountInstruction,
  getCreateAccountWithSeedInstruction,
  getTransferSolInstruction,
} from "@solana-program/system";
import type { Mint } from "@solana-program/token-2022";
import type { TransferFee } from "@orca-so/whirlpools-core";

/** The public key for the native mint (SOL) */
export const NATIVE_MINT = address(
  "So11111111111111111111111111111111111111112",
);

type TokenAccountInstructions = {
  createInstructions: IInstruction[];
  cleanupInstructions: IInstruction[];
  tokenAccountAddresses: Record<Address, Address>;
};

function mintFilter(x: Address) {
  if (SOL_WRAPPING_STRATEGY === "none") {
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
 * SOL based on the SOL_WRAPPING_STRATEGY.
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
  const hasSolMint = mintAddresses.includes(NATIVE_MINT);
  const mints = await fetchAllMint(rpc, mintAddresses.filter(mintFilter));
  const tokenAddresses = await Promise.all(
    mints.map((mint) =>
      findAssociatedTokenPda(
        {
          owner: owner.address,
          mint: mint.address,
          tokenProgram: mint.programAddress,
        },
      ).then((x) => x[0]),
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

  if (hasSolMint && SOL_WRAPPING_STRATEGY === "keypair") {
    const keypair = await generateKeyPairSigner();
    const space = getTokenSize();
    const lamports = await rpc
      .getMinimumBalanceForRentExemption(BigInt(space))
      .send();
    createInstructions.push(
      getCreateAccountInstruction({
        payer: owner,
        newAccount: keypair,
        lamports,
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

  if (hasSolMint && SOL_WRAPPING_STRATEGY === "seed") {
    const space = getTokenSize();
    const amount = await rpc
      .getMinimumBalanceForRentExemption(BigInt(space))
      .send();

    // Generating secure seed takes longer and is not really needed here.
    // With date, it should only create collisions if the same owner
    // creates multiple accounts at exactly the same time (in ms)
    const seed = Date.now().toString();
    const buffer = await new SubtleCrypto().digest(
      "sha256",
      Buffer.concat([
        Buffer.from(getAddressEncoder().encode(owner.address)),
        Buffer.from(seed),
        Buffer.from(getAddressEncoder().encode(TOKEN_PROGRAM_ADDRESS)),
      ]),
    );
    const address = getAddressDecoder().decode(new Uint8Array(buffer));

    createInstructions.push(
      getCreateAccountWithSeedInstruction({
        payer: owner,
        newAccount: address,
        base: owner.address,
        baseAccount: owner,
        seed: seed,
        space,
        amount,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeAccount3Instruction({
        account: address,
        mint: NATIVE_MINT,
        owner: owner.address,
      }),
    );
  }

  if (hasSolMint && SOL_WRAPPING_STRATEGY === "ata") {
    const account = await fetchMaybeToken(
      rpc,
      tokenAccountAddresses[NATIVE_MINT],
    );
    if (!account.exists) {
      createInstructions.push(
        getCreateAssociatedTokenInstruction({
          payer: owner,
          owner: owner.address,
          ata: account.address,
          mint: NATIVE_MINT,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        }),
      );
      cleanupInstructions.push(
        getCloseAccountInstruction({
          account: account.address,
          owner,
          destination: owner.address,
        }),
      );
    }
  }

  if (
    hasSolMint &&
    !Array.isArray(spec) &&
    spec[NATIVE_MINT] > 0 &&
    SOL_WRAPPING_STRATEGY !== "none"
  ) {
    createInstructions.push(
      getTransferSolInstruction({
        source: owner,
        destination: tokenAccountAddresses[NATIVE_MINT],
        amount: spec[NATIVE_MINT],
      }),
      getSyncNativeInstruction({
        account: tokenAccountAddresses[NATIVE_MINT],
      }),
    );
  }

  return {
    createInstructions,
    cleanupInstructions,
    tokenAccountAddresses,
  };
}


export function getCurrentTransferFee(mint: Mint, currentEpoch: bigint): TransferFee | undefined {
  if (mint.extensions.__option === "None") {
    return undefined;
  }
  const feeConfig = mint.extensions.value.find(x => x.__kind === "TransferFeeConfig");
  if (feeConfig == null) {
    return undefined;
  }
  const transferFee = currentEpoch >= feeConfig.newerTransferFee.epoch ? feeConfig.newerTransferFee : feeConfig.olderTransferFee;
  return {
    feeBps: transferFee.transferFeeBasisPoints,
    maxFee: transferFee.maximumFee,
  };
}
