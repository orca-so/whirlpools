import {
  NATIVE_MINT,
  NATIVE_MINT_2022,
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { Connection, PublicKey } from "@solana/web3.js";
import type BN from "bn.js";
import { ZERO } from "../math";
import {
  ParsableMintInfo,
  ParsableTokenAccountInfo,
  getMultipleParsedAccounts,
} from "./network";
import type {
  ResolvedTokenAddressInstruction,
  WrappedSolAccountCreateMethod,
} from "./token-util";
import { TokenUtil } from "./token-util";
import { EMPTY_INSTRUCTION } from "./transactions/types";

/**
 * IMPORTANT: wrappedSolAmountIn should only be used for input/source token that
 *            could be SOL. This is because when SOL is the output, it is the end
 *            destination, and thus does not need to be wrapped with an amount.
 *
 * @param connection Solana connection class
 * @param ownerAddress The user's public key
 * @param tokenMint Token mint address
 * @param wrappedSolAmountIn Optional. Only use for input/source token that could be SOL
 * @param payer Payer that would pay the rent for the creation of the ATAs
 * @param modeIdempotent Optional. Use CreateIdempotent instruction instead of Create instruction
 * @param allowPDAOwnerAddress Optional. Allow PDA to be used as the ATA owner address
 * @param wrappedSolAccountCreateMethod - Optional. How to create the temporary WSOL account.
 * @returns
 */
export async function resolveOrCreateATA(
  connection: Connection,
  ownerAddress: PublicKey,
  tokenMint: PublicKey,
  getAccountRentExempt: () => Promise<number>,
  wrappedSolAmountIn = ZERO,
  payer = ownerAddress,
  modeIdempotent: boolean = false,
  allowPDAOwnerAddress: boolean = false,
  wrappedSolAccountCreateMethod: WrappedSolAccountCreateMethod = "keypair",
): Promise<ResolvedTokenAddressInstruction> {
  const instructions = await resolveOrCreateATAs(
    connection,
    ownerAddress,
    [{ tokenMint, wrappedSolAmountIn }],
    getAccountRentExempt,
    payer,
    modeIdempotent,
    allowPDAOwnerAddress,
    wrappedSolAccountCreateMethod,
  );
  return instructions[0]!;
}

type ResolvedTokenAddressRequest = {
  tokenMint: PublicKey;
  wrappedSolAmountIn?: BN;
};

/**
 * IMPORTANT: wrappedSolAmountIn should only be used for input/source token that
 *            could be SOL. This is because when SOL is the output, it is the end
 *            destination, and thus does not need to be wrapped with an amount.
 *
 * @param connection Solana connection class
 * @param ownerAddress The user's public key
 * @param tokenMint Token mint address
 * @param wrappedSolAmountIn Optional. Only use for input/source token that could be SOL
 * @param payer Payer that would pay the rent for the creation of the ATAs
 * @param modeIdempotent Optional. Use CreateIdempotent instruction instead of Create instruction
 * @param allowPDAOwnerAddress Optional. Allow PDA to be used as the ATA owner address
 * @param wrappedSolAccountCreateMethod - Optional. How to create the temporary WSOL account.
 * @returns
 */
export async function resolveOrCreateATAs(
  connection: Connection,
  ownerAddress: PublicKey,
  requests: ResolvedTokenAddressRequest[],
  getAccountRentExempt: () => Promise<number>,
  payer = ownerAddress,
  modeIdempotent: boolean = false,
  allowPDAOwnerAddress: boolean = false,
  wrappedSolAccountCreateMethod: WrappedSolAccountCreateMethod = "keypair",
): Promise<ResolvedTokenAddressInstruction[]> {
  const nonNativeMints = requests.filter(
    ({ tokenMint }) => !tokenMint.equals(NATIVE_MINT),
  );
  const nativeMints = requests.filter(({ tokenMint }) =>
    tokenMint.equals(NATIVE_MINT),
  );
  const nativeMint2022 = requests.filter(({ tokenMint }) =>
    tokenMint.equals(NATIVE_MINT_2022),
  );

  if (nativeMints.length > 1) {
    throw new Error("Cannot resolve multiple WSolAccounts");
  }

  if (nativeMint2022.length > 0) {
    throw new Error("NATIVE_MINT_2022 is not supported");
  }

  let instructionMap: { [tokenMint: string]: ResolvedTokenAddressInstruction } =
    {};
  if (nonNativeMints.length > 0) {
    const mints = await getMultipleParsedAccounts(
      connection,
      nonNativeMints.map((a) => a.tokenMint),
      ParsableMintInfo,
    );

    const nonNativeAddresses = nonNativeMints.map(({ tokenMint }, index) =>
      getAssociatedTokenAddressSync(
        tokenMint,
        ownerAddress,
        allowPDAOwnerAddress,
        mints[index]!.tokenProgram,
      ),
    );

    const tokenAccounts = await getMultipleParsedAccounts(
      connection,
      nonNativeAddresses,
      ParsableTokenAccountInfo,
    );

    tokenAccounts.forEach((tokenAccount, index) => {
      const ataAddress = nonNativeAddresses[index]!;
      let resolvedInstruction: ResolvedTokenAddressInstruction;
      if (tokenAccount) {
        // ATA whose owner has been changed is abnormal entity.
        // To prevent to send swap/withdraw/collect output to the ATA, an error should be thrown.
        if (!tokenAccount.owner.equals(ownerAddress)) {
          throw new Error(
            `ATA with change of ownership detected: ${ataAddress.toBase58()}`,
          );
        }

        resolvedInstruction = {
          address: ataAddress,
          tokenProgram: tokenAccount.tokenProgram,
          ...EMPTY_INSTRUCTION,
        };
      } else {
        const createAtaInstruction = modeIdempotent
          ? createAssociatedTokenAccountIdempotentInstruction(
              payer,
              ataAddress,
              ownerAddress,
              nonNativeMints[index]!.tokenMint,
              mints[index]!.tokenProgram,
            )
          : createAssociatedTokenAccountInstruction(
              payer,
              ataAddress,
              ownerAddress,
              nonNativeMints[index]!.tokenMint,
              mints[index]!.tokenProgram,
            );

        resolvedInstruction = {
          address: ataAddress,
          tokenProgram: mints[index]!.tokenProgram,
          instructions: [createAtaInstruction],
          cleanupInstructions: [],
          signers: [],
        };
      }
      instructionMap[nonNativeMints[index].tokenMint.toBase58()] =
        resolvedInstruction;
    });
  }

  if (nativeMints.length > 0) {
    const accountRentExempt = await getAccountRentExempt();
    const wrappedSolAmountIn = nativeMints[0]?.wrappedSolAmountIn || ZERO;
    instructionMap[NATIVE_MINT.toBase58()] =
      TokenUtil.createWrappedNativeAccountInstruction(
        ownerAddress,
        wrappedSolAmountIn,
        accountRentExempt,
        payer,
        undefined, // use default
        wrappedSolAccountCreateMethod,
      );
  }

  // Preserve order of resolution
  return requests.map(({ tokenMint }) => instructionMap[tokenMint.toBase58()]);
}
