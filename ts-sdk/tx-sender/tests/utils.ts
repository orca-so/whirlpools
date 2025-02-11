import {
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
  decompileTransactionMessageFetchingLookupTables,
  FullySignedTransaction,
  TransactionWithBlockhashLifetime,
  TransactionSigner,
  getCompiledTransactionMessageEncoder,
  IInstruction,
  compileTransactionMessage,
  TransactionMessageBytes,
  getBase64Encoder,
  SignatureBytes,
} from "@solana/web3.js";
import { rpcFromUrl } from "../src/compatibility";
import { generateTransactionMessage } from "../src/buildTransaction";

export async function decodeTransaction(base64EncodedTransaction: string) {
  const base64Encoder = getBase64Encoder();
  const transactionBytes = base64Encoder.encode(base64EncodedTransaction);
  const transactionDecoder = getTransactionDecoder();
  const decodedTransaction = transactionDecoder.decode(transactionBytes);
  console.log({ decodedTransaction, transactionBytes });

  const compiledMessageDecoder = getCompiledTransactionMessageDecoder();
  const compiledMessage = compiledMessageDecoder.decode(
    decodedTransaction.messageBytes
  );

  const rpc = rpcFromUrl("https://api.mainnet-beta.solana.com");
  const decompiledMessage =
    await decompileTransactionMessageFetchingLookupTables(compiledMessage, rpc);

  const instructions = decompiledMessage.instructions.map((instruction) => ({
    programAddress: instruction.programAddress,
    data: instruction.data,
    accounts: instruction.accounts,
  }));

  return instructions;
}

export async function encodeTransaction(
  instructions: IInstruction[],
  feePayer: TransactionSigner
): Promise<
  Readonly<FullySignedTransaction & TransactionWithBlockhashLifetime>
> {
  const rpc = rpcFromUrl("https://");
  const message = await generateTransactionMessage(instructions, rpc, feePayer);
  const compiledMessage = compileTransactionMessage(message);
  const messageBytes = getCompiledTransactionMessageEncoder().encode(
    compiledMessage
  ) as TransactionMessageBytes;

  // @ts-ignore
  return {
    messageBytes,
    signatures: { [feePayer.address]: new Uint8Array() as SignatureBytes },
    lifetimeConstraint: message.lifetimeConstraint,
  };
}
