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
  sendTransactionWithoutConfirmingFactory,
  signTransaction,
} from "@solana/web3.js";
import { rpcFromUrl, PublicKey, TransactionInstruction } from "./compatibility";
import { buildTransaction } from "./buildTransaction";

async function buildAndSendTransaction(
  instructions: (IInstruction | TransactionInstruction)[],
  signer: KeyPairSigner,
  lookupTableAddresses?: (Address | PublicKey)[],
  rpcUrlString?: string,
  isTritonRpc?: boolean,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION
) {
  const { rpcUrl, isTriton } = getConnectionContext(rpcUrlString, isTritonRpc);
  const transactionSettings = getPriorityConfig(transactionConfig);

  const tx = await buildTransaction(
    instructions,
    signer.address as Address,
    lookupTableAddresses,
    rpcUrl,
    isTriton,
    transactionSettings
  );

  assertIsTransactionMessageWithBlockhashLifetime(tx);

  const withSigners = addSignersToTransactionMessage([signer], tx);
  const signed = await signTransactionMessageWithSigners(withSigners);

  assertTransactionIsFullySigned(signed);

  const rpc = rpcFromUrl(rpcUrl);
  const encodedTransaction = getBase64EncodedWireTransaction(signed);

  return rpc.sendTransaction(encodedTransaction).send();
}

async function signAndSendTransaction(
  transaction: Transaction,
  signer: KeyPairSigner,
  rpcUrl: string = getConnectionContext().rpcUrl
) {
  const signed = await signTransaction([signer.keyPair], transaction);
  const rpc = rpcFromUrl(rpcUrl);
  const sendTransaction = sendTransactionWithoutConfirmingFactory({ rpc });
  assertTransactionIsFullySigned(signed);
  await sendTransaction(signed, { commitment: "confirmed" });
  // todo confirming factory
}

// TODO create flow for ui signing
// import {
//   useWalletAccountMessageSigner,
//   useSignAndSendTransaction,
// } from "@solana/react";

export { signAndSendTransaction, buildAndSendTransaction };
