import {
  DEFAULT_PRIORITIZATION,
  getConnectionContext,
  getPriorityConfig,
  TransactionConfig,
} from "./config";
import {
  Address,
  addSignersToTransactionMessage,
  assertIsTransactionMessageWithBlockhashLifetime,
  assertTransactionIsFullySigned,
  getBase64EncodedWireTransaction,
  IInstruction,
  KeyPairSigner,
  signTransactionMessageWithSigners,
  Transaction,
  CompilableTransactionMessage,
  TransactionModifyingSigner,
  TransactionPartialSigner,
  compileTransaction,
  isTransactionModifyingSigner,
  isTransactionPartialSigner,
  TransactionWithLifetime,
  assertIsTransactionModifyingSigner,
  TransactionSigner,
  createKeyPairSignerFromPrivateKeyBytes,
  assertIsKeyPairSigner,
  assertIsTransactionSigner,
} from "@solana/web3.js";
import {
  rpcFromUrl,
  PublicKey,
  TransactionInstruction,
  forceAddress,
  Keypair,
} from "./compatibility";
import { buildTransaction } from "./buildTransaction";

async function buildAndSendTransaction(
  instructions: (IInstruction | TransactionInstruction)[],
  payer:
    | KeyPairSigner
    | {
        address: PublicKey;
        signTransaction: (tx: Transaction) => Promise<Transaction>;
      },
  lookupTableAddresses?: (Address | PublicKey)[],
  signers?: Keypair[] | KeyPairSigner[],
  rpcUrlString?: string,
  isTritonRpc?: boolean,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION
) {
  const { rpcUrl, isTriton } = getConnectionContext(rpcUrlString, isTritonRpc);
  const transactionSettings = getPriorityConfig(transactionConfig);

  const tx = await buildTransaction(
    instructions,
    payer.address,
    lookupTableAddresses,
    rpcUrl,
    isTriton,
    transactionSettings
  );
  assertIsTransactionMessageWithBlockhashLifetime(tx);

  const additionalSigners = await Promise.all(
    signers?.map(async (kp) => {
      const signer =
        kp instanceof Keypair
          ? await createKeyPairSignerFromPrivateKeyBytes(kp.secretKey)
          : kp;
      assertIsKeyPairSigner(signer);
      return signer;
    }) ?? []
  );

  const feePayer =
    "signTransaction" in payer
      ? ({
          modifyAndSignTransactions: (transactions: Transaction[]) => {
            return Promise.all(
              transactions.map(async (tx) => {
                const signedTx = await payer.signTransaction(tx);
                return signedTx;
              })
            );
          },
          address: forceAddress(payer.address),
        } as TransactionSigner)
      : payer;

  assertIsTransactionSigner(feePayer);

  const withSigners = addSignersToTransactionMessage(
    [...additionalSigners, feePayer],
    tx
  );
  const signed = await signTransactionMessageWithSigners(withSigners);

  assertTransactionIsFullySigned(signed);

  const rpc = rpcFromUrl(rpcUrl);
  const encodedTransaction = getBase64EncodedWireTransaction(signed);

  return rpc.sendTransaction(encodedTransaction, {}).send();
}

async function sendSignedTransactionMessage(
  transaction: CompilableTransactionMessage,
  rpcUrl: string = getConnectionContext().rpcUrl
) {
  const rpc = rpcFromUrl(rpcUrl);
  const compiled = compileTransaction(transaction);
  const encodedTransaction = getBase64EncodedWireTransaction(compiled);
  return rpc.sendTransaction(encodedTransaction, {}).send();
}

async function signTransactionMessage(
  message: CompilableTransactionMessage,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  walletAddress: Address | PublicKey
) {
  const address = forceAddress(walletAddress);
  const signer = {
    modifyAndSignTransactions: (transactions: Transaction[]) => {
      return Promise.all(
        transactions.map(async (tx) => {
          const signedTx = await signTransaction(tx);
          return signedTx;
        })
      );
    },
    address,
  } as TransactionSigner;
  assertIsTransactionModifyingSigner(signer);
  const signed = await signTransactionMessageNew(message, [signer]);
  return signed;
}

async function signTransactionMessageNew(
  message: CompilableTransactionMessage,
  signers: readonly (TransactionModifyingSigner | TransactionPartialSigner)[]
) {
  const transaction = compileTransaction(message);
  const { partialSigners, modifyingSigners } = categorizeSigners(signers);
  const modifiedTransaction = await modifyingSigners.reduce(
    async (transaction, modifyingSigner) => {
      const [tx] = await modifyingSigner.modifyAndSignTransactions([
        await transaction,
      ]);
      return Object.freeze(tx);
    },
    Promise.resolve(transaction) as Promise<
      Readonly<Transaction & TransactionWithLifetime>
    >
  );

  const signatureDictionaries = await Promise.all(
    partialSigners.map(async (partialSigner) => {
      const [signatures] = await partialSigner.signTransactions([
        modifiedTransaction,
      ]);
      return signatures;
    })
  );
  const signedTransaction: Readonly<Transaction & TransactionWithLifetime> = {
    ...modifiedTransaction,
    signatures: Object.freeze(
      signatureDictionaries.reduce((signatures, signatureDictionary) => {
        return { ...signatures, ...signatureDictionary };
      }, modifiedTransaction.signatures ?? {})
    ),
  };
  return Object.freeze(signedTransaction);
}

function categorizeSigners(
  signers: readonly (TransactionModifyingSigner | TransactionPartialSigner)[]
) {
  const otherSigners = signers.filter(
    (signer): signer is TransactionModifyingSigner | TransactionPartialSigner =>
      signer !== null &&
      (isTransactionModifyingSigner(signer) ||
        isTransactionPartialSigner(signer))
  );

  // Identify the modifying signers from the other signers.
  const modifyingSigners = identifyTransactionModifyingSigners(otherSigners);

  // Use any remaining signers as partial signers.
  const partialSigners = otherSigners
    .filter(isTransactionPartialSigner)
    .filter(
      (signer) => !(modifyingSigners as typeof otherSigners).includes(signer)
    );

  return { modifyingSigners, partialSigners };
}

function identifyTransactionModifyingSigners(
  signers: readonly (TransactionModifyingSigner | TransactionPartialSigner)[]
): readonly TransactionModifyingSigner[] {
  // Ensure there are any TransactionModifyingSigner in the first place.
  const modifyingSigners = signers.filter(isTransactionModifyingSigner);
  if (modifyingSigners.length === 0) return [];

  // Prefer modifying signers that do not offer partial signing.
  const nonPartialSigners = modifyingSigners.filter(
    (signer) => !isTransactionPartialSigner(signer)
  );
  if (nonPartialSigners.length > 0) return nonPartialSigners;

  // Otherwise, choose only one modifying signer (whichever).
  return [modifyingSigners[0]];
}

export {
  buildAndSendTransaction,
  signTransactionMessage,
  sendSignedTransactionMessage,
};
