import {
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
  decompileTransactionMessageFetchingLookupTables,
  ReadonlyUint8Array,
  FullySignedTransaction,
  TransactionWithBlockhashLifetime,
  TransactionSigner,
  getCompiledTransactionMessageEncoder,
  IInstruction,
  compileTransactionMessage,
  TransactionMessageBytes,
} from "@solana/web3.js";
import { rpcFromUrl } from "../src/compatibility";
import { generateTransactionMessage } from "../src/buildTransaction";

export async function decodeTransaction(transactionBytes: ReadonlyUint8Array) {
  const transactionDecoder = getTransactionDecoder();
  const decodedTransaction = transactionDecoder.decode(transactionBytes);

  const compiledMessageDecoder = getCompiledTransactionMessageDecoder();
  const compiledMessage = compiledMessageDecoder.decode(
    decodedTransaction.messageBytes
  );

  const rpc = rpcFromUrl("https://api.mainnet-beta.solana.com");
  const decompiledMessage =
    await decompileTransactionMessageFetchingLookupTables(compiledMessage, rpc);

  const instructionsProgramIds = decompiledMessage.instructions.map(
    (instruction) => instruction.programAddress
  );

  return instructionsProgramIds;
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
    signatures: {},
    lifetimeConstraint: message.lifetimeConstraint,
  };
}
