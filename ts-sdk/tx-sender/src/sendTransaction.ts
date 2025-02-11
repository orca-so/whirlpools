import {
  ConnectionContext,
  DEFAULT_PRIORITIZATION,
  getConnectionContext,
  getPriorityConfig,
  TransactionConfig,
} from "./config";
import {
  Address,
  assertTransactionIsFullySigned,
  getBase64EncodedWireTransaction,
  IInstruction,
  KeyPairSigner,
  Transaction,
  CompilableTransactionMessage,
  TransactionModifyingSigner,
  TransactionPartialSigner,
  compileTransaction,
  isTransactionModifyingSigner,
  isTransactionPartialSigner,
  TransactionWithLifetime,
  FullySignedTransaction,
  Signature,
  getBase58Decoder,
  TransactionSigner,
} from "@solana/web3.js";
import { rpcFromUrl, subscriptionsFromWsUrl } from "./compatibility";
import { buildTransaction } from "./buildTransaction";
import {
  createRecentSignatureConfirmationPromiseFactory,
  getTimeoutPromise,
  waitForRecentTransactionConfirmationUntilTimeout,
} from "@solana/transaction-confirmation";

/**
 * Builds and sends a transaction with the given instructions and signers.
 *
 * @param {IInstruction[]} instructions - Array of instructions to include in the transaction
 * @param {KeyPairSigner} payer - The fee payer for the transaction
 * @param {TransactionConfig} [transactionConfig=DEFAULT_PRIORITIZATION] - Optional transaction configuration for priority fees
 * @param {(Address | string)[]} [lookupTableAddresses] - Optional array of address lookup table addresses to use
 * @param {KeyPairSigner[]} [signers] - Optional additional signers for the transaction
 * @param {{rpcUrlString?: string, isTritonRpc?: boolean, wsUrlString?: string}} [connectionConfig]
 * - Optional connection configuration (required if init hasn't been called)
 *
 * @returns {Promise<string>} A promise that resolves to the transaction signature
 *
 * @throws {Error} If transaction building or sending fails
 *
 * @example
 * await buildAndSendTransaction(
 *   instructions,
 *   wallet,
 *   {
 *     priorityFee: { type: "dynamic", maxCapLamports: 5_000_000 },
 *     jito: { type: "dynamic" },
 *     chainId: "solana"
 *   },
 *   lookupTables,
 *   [additionalSigner1, additionalSigner2],
 *   {
 *     rpcUrl: "https://api.mainnet-beta.solana.com",
 *     isTriton: false
 *   }
 * );
 */

async function buildAndSendTransaction(
  instructions: IInstruction[],
  payer: KeyPairSigner,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION,
  lookupTableAddresses?: (Address | string)[],
  signers?: KeyPairSigner[],
  connectionConfig?: ConnectionContext
) {
  const { rpcUrl, isTriton, wsUrl } = getConnectionContext(
    connectionConfig?.rpcUrl,
    connectionConfig?.isTriton,
    connectionConfig?.wsUrl
  );

  const transactionSettings = getPriorityConfig(transactionConfig);

  const tx = await buildTransaction(
    instructions,
    payer,
    transactionSettings,
    lookupTableAddresses,
    signers,
    rpcUrl,
    isTriton
  );

  assertTransactionIsFullySigned(tx);

  return sendSignedTransaction(tx, rpcUrl, wsUrl);
}

/**
 * Sends a signed transaction message to the Solana network.
 * If wsUrl is provided, it will use an RPC subscription to wait for confirmation
 *
 * @param {FullySignedTransaction} transaction - The fully signed transaction to send
 * @param {string} [rpcUrl] - Optional RPC URL. If not provided, it must have been passed in a call to {@link init}
 * @param {string} [wsUrl] - Optional WebSocket URL for transaction confirmation. If provided, will use RPC subscription to wait for confirmation
 *  (will also use RPC subscription if init has been called with wsUrl previously)
 *
 * @returns {Promise<string>} A promise that resolves to the transaction signature
 *
 * @throws {Error} If transaction sending fails or RPC connection fails
 *
 * @example
 * assertTransactionIsFullySigned(signedTransaction);
 *
 * const signature = await sendSignedTransaction(
 *   signedTransaction,
 *   "https://api.mainnet-beta.solana.com",
 *   "wss://api.mainnet-beta.solana.com"
 * );
 */
async function sendSignedTransaction(
  transaction: FullySignedTransaction,
  rpcUrlString?: string,
  wsUrlString?: string
) {
  const { rpcUrl, wsUrl } = getConnectionContext(
    rpcUrlString,
    undefined,
    wsUrlString
  );
  const rpc = rpcFromUrl(rpcUrl);
  const txHash = getTxHash(transaction);
  const encodedTransaction = getBase64EncodedWireTransaction(transaction);

  if (wsUrl) {
    const rpcSubscriptions = subscriptionsFromWsUrl(wsUrl);
    const getRecentSignatureConfirmationPromise =
      createRecentSignatureConfirmationPromiseFactory({
        rpc,
        rpcSubscriptions,
      });

    rpc.sendTransaction(encodedTransaction, { encoding: "base64" }).send();
    await waitForRecentTransactionConfirmationUntilTimeout({
      commitment: "confirmed",
      getRecentSignatureConfirmationPromise,
      signature: txHash,
      getTimeoutPromise,
    });
    return txHash;
  }

  await rpc
    .sendTransaction(encodedTransaction, {
      encoding: "base64",
    })
    .send();
  return txHash;
}

/**
 * Signs a compilable transaction message with the provided signers.
 *
 * @param {CompilableTransactionMessage} message - The transaction message to sign
 * @param {readonly TransactionSigner[]} signers - Array of signers to sign the transaction with
 *
 * @returns {Promise<Readonly<Transaction & TransactionWithLifetime>>} A promise that resolves to the signed transaction
 *
 * @throws {Error} If signing fails
 *
 * @example
 * const signedTx = await signTransactionMessage(
 *   transactionMessage,
 *   [signer1, signer2]
 * );
 */

async function signTransactionMessage(
  message: CompilableTransactionMessage,
  signers: readonly TransactionSigner[]
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

function categorizeSigners(signers: readonly TransactionSigner[]) {
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

function getTxHash(transaction: FullySignedTransaction) {
  const [signature] = Object.values(transaction.signatures);
  const txHash = getBase58Decoder().decode(signature!) as Signature;
  return txHash;
}

export {
  buildAndSendTransaction,
  signTransactionMessage,
  sendSignedTransaction,
};
