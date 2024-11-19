import {
  AccountLayout,
  NATIVE_MINT,
  NATIVE_MINT_2022,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createInitializeAccountInstruction,
  createSyncNativeInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { Connection, TransactionInstruction } from "@solana/web3.js";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import type BN from "bn.js";
import invariant from "tiny-invariant";
import { ZERO } from "../math";
import type { Instruction } from "../web3";
import { resolveOrCreateATA } from "../web3";
/**
 * @category Util
 */
export type ResolvedTokenAddressInstruction = {
  address: PublicKey;
  tokenProgram: PublicKey;
} & Instruction;

/**
 * @category Util
 */
export type WrappedSolAccountCreateMethod = "keypair" | "withSeed" | "ata";

/**
 * @category Util
 */
export class TokenUtil {
  public static isNativeMint(mint: PublicKey) {
    return mint.equals(NATIVE_MINT);
  }

  /**
   * Create an ix to send a native-mint and unwrap it to the user's wallet.
   * @param owner - PublicKey for the owner of the temporary WSOL account.
   * @param amountIn - Amount of SOL to wrap.
   * @param rentExemptLamports - Rent exempt lamports for the temporary WSOL account.
   * @param payer - PublicKey for the payer that would fund the temporary WSOL accounts. (must sign the txn)
   * @param unwrapDestination - PublicKey for the receiver that would receive the unwrapped SOL including rent.
   * @param createAccountMethod - How to create the temporary WSOL account.
   * @returns
   */
  public static createWrappedNativeAccountInstruction(
    owner: PublicKey,
    amountIn: BN,
    rentExemptLamports: number,
    payer?: PublicKey,
    unwrapDestination?: PublicKey,
    createAccountMethod: WrappedSolAccountCreateMethod = "keypair",
  ): ResolvedTokenAddressInstruction {
    const payerKey = payer ?? owner;
    const unwrapDestinationKey = unwrapDestination ?? owner;

    switch (createAccountMethod) {
      case "ata":
        return createWrappedNativeAccountInstructionWithATA(
          owner,
          amountIn,
          rentExemptLamports,
          payerKey,
          unwrapDestinationKey,
        );
      case "keypair":
        return createWrappedNativeAccountInstructionWithKeypair(
          owner,
          amountIn,
          rentExemptLamports,
          payerKey,
          unwrapDestinationKey,
        );
      case "withSeed":
        return createWrappedNativeAccountInstructionWithSeed(
          owner,
          amountIn,
          rentExemptLamports,
          payerKey,
          unwrapDestinationKey,
        );
      default:
        throw new Error(`Invalid createAccountMethod: ${createAccountMethod}`);
    }
  }

  /**
   * Create an ix to send a spl-token / native-mint to another wallet.
   * This function will handle the associated token accounts internally for spl-token.
   * SOL is sent directly to the user's wallet.
   *
   * @param connection - Connection object
   * @param sourceWallet - PublicKey for the sender's wallet
   * @param destinationWallet - PublicKey for the receiver's wallet
   * @param tokenMint - Mint for the token that is being sent.
   * @param tokenDecimals - Decimal for the token that is being sent.
   * @param amount - Amount of token to send
   * @param getAccountRentExempt - Fn to fetch the account rent exempt value
   * @param payer - PublicKey for the payer that would fund the possibly new token-accounts. (must sign the txn)
   * @param allowPDASourceWallet - Allow PDA to be used as the source wallet.
   * @returns
   */
  static async createSendTokensToWalletInstruction(
    connection: Connection,
    sourceWallet: PublicKey,
    destinationWallet: PublicKey,
    tokenMint: PublicKey,
    tokenDecimals: number,
    amount: BN,
    getAccountRentExempt: () => Promise<number>,
    payer?: PublicKey,
    allowPDASourceWallet: boolean = false,
  ): Promise<Instruction> {
    invariant(
      !amount.eq(ZERO),
      "SendToken transaction must send more than 0 tokens.",
    );
    invariant(
      !tokenMint.equals(NATIVE_MINT_2022),
      "NATIVE_MINT_2022 is not supported.",
    );

    // Specifically handle SOL, which is not a spl-token.
    if (tokenMint.equals(NATIVE_MINT)) {
      const sendSolTxn = SystemProgram.transfer({
        fromPubkey: sourceWallet,
        toPubkey: destinationWallet,
        lamports: BigInt(amount.toString()),
      });
      return {
        instructions: [sendSolTxn],
        cleanupInstructions: [],
        signers: [],
      };
    }

    const mintAccountInfo = await connection.getAccountInfo(tokenMint);
    if (mintAccountInfo === null) throw Error("Cannot fetch tokenMint.");
    const tokenProgram = mintAccountInfo.owner;

    const sourceTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      sourceWallet,
      allowPDASourceWallet,
      tokenProgram,
    );
    const { address: destinationTokenAccount, ...destinationAtaIx } =
      await resolveOrCreateATA(
        connection,
        destinationWallet,
        tokenMint,
        getAccountRentExempt,
        amount,
        payer,
        undefined,
        true,
      );

    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      connection,
      sourceTokenAccount,
      tokenMint,
      destinationTokenAccount,
      sourceWallet,
      BigInt(amount.toString()),
      tokenDecimals,
      undefined,
      undefined,
      tokenProgram,
    );

    return {
      instructions: destinationAtaIx.instructions.concat(transferIx),
      cleanupInstructions: destinationAtaIx.cleanupInstructions,
      signers: destinationAtaIx.signers,
    };
  }
}

function createWrappedNativeAccountInstructionWithATA(
  owner: PublicKey,
  amountIn: BN,
  _rentExemptLamports: number,
  payerKey: PublicKey,
  unwrapDestinationKey: PublicKey,
): ResolvedTokenAddressInstruction {
  const tempAccount = getAssociatedTokenAddressSync(NATIVE_MINT, owner);

  const instructions: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(
      payerKey,
      tempAccount,
      owner,
      NATIVE_MINT,
    ),
  ];

  if (amountIn.gt(ZERO)) {
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: payerKey,
        toPubkey: tempAccount,
        lamports: amountIn.toNumber(),
      }),
    );

    instructions.push(createSyncNativeInstruction(tempAccount));
  }

  const closeWSOLAccountInstruction = createCloseAccountInstruction(
    tempAccount,
    unwrapDestinationKey,
    owner,
  );

  return {
    address: tempAccount,
    tokenProgram: TOKEN_PROGRAM_ID,
    instructions,
    cleanupInstructions: [closeWSOLAccountInstruction],
    signers: [],
  };
}

function createWrappedNativeAccountInstructionWithKeypair(
  owner: PublicKey,
  amountIn: BN,
  rentExemptLamports: number,
  payerKey: PublicKey,
  unwrapDestinationKey: PublicKey,
): ResolvedTokenAddressInstruction {
  const tempAccount = new Keypair();

  const createAccountInstruction = SystemProgram.createAccount({
    fromPubkey: payerKey,
    newAccountPubkey: tempAccount.publicKey,
    lamports: amountIn.toNumber() + rentExemptLamports,
    space: AccountLayout.span,
    programId: TOKEN_PROGRAM_ID,
  });

  const initAccountInstruction = createInitializeAccountInstruction(
    tempAccount.publicKey,
    NATIVE_MINT,
    owner,
  );

  const closeWSOLAccountInstruction = createCloseAccountInstruction(
    tempAccount.publicKey,
    unwrapDestinationKey,
    owner,
  );

  return {
    address: tempAccount.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    instructions: [createAccountInstruction, initAccountInstruction],
    cleanupInstructions: [closeWSOLAccountInstruction],
    signers: [tempAccount],
  };
}

function createWrappedNativeAccountInstructionWithSeed(
  owner: PublicKey,
  amountIn: BN,
  rentExemptLamports: number,
  payerKey: PublicKey,
  unwrapDestinationKey: PublicKey,
): ResolvedTokenAddressInstruction {
  // seed is always shorter than a signature.
  // So createWrappedNativeAccountInstructionWithSeed always generates small size instructions
  // than createWrappedNativeAccountInstructionWithKeypair.
  const seed = Keypair.generate().publicKey.toBase58().slice(0, 32); // 32 chars

  const tempAccount = (() => {
    // same to PublicKey.createWithSeed, but this one is synchronous
    const fromPublicKey = owner;
    const programId = TOKEN_PROGRAM_ID;
    const buffer = Buffer.concat([
      fromPublicKey.toBuffer(),
      Buffer.from(seed),
      programId.toBuffer(),
    ]);
    const publicKeyBytes = sha256(buffer);
    return new PublicKey(publicKeyBytes);
  })();

  const createAccountInstruction = SystemProgram.createAccountWithSeed({
    fromPubkey: payerKey,
    basePubkey: owner,
    seed,
    newAccountPubkey: tempAccount,
    lamports: amountIn.toNumber() + rentExemptLamports,
    space: AccountLayout.span,
    programId: TOKEN_PROGRAM_ID,
  });

  const initAccountInstruction = createInitializeAccountInstruction(
    tempAccount,
    NATIVE_MINT,
    owner,
  );

  const closeWSOLAccountInstruction = createCloseAccountInstruction(
    tempAccount,
    unwrapDestinationKey,
    owner,
  );

  return {
    address: tempAccount,
    tokenProgram: TOKEN_PROGRAM_ID,
    instructions: [createAccountInstruction, initAccountInstruction],
    cleanupInstructions: [closeWSOLAccountInstruction],
    signers: [],
  };
}
