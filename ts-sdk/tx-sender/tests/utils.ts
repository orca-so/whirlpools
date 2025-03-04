import type {
  FullySignedTransaction,
  TransactionWithBlockhashLifetime,
  TransactionSigner,
  IInstruction,
  TransactionMessageBytes,
  SignatureBytes,
  Rpc,
  SolanaRpcApi,
} from "@solana/kit";
import {
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
  decompileTransactionMessageFetchingLookupTables,
  getCompiledTransactionMessageEncoder,
  compileTransactionMessage,
  getBase64Encoder,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { rpcFromUrl } from "../src/compatibility";

export async function decodeTransaction(base64EncodedTransaction: string) {
  const base64Encoder = getBase64Encoder();
  const transactionBytes = base64Encoder.encode(base64EncodedTransaction);
  const transactionDecoder = getTransactionDecoder();
  const decodedTransaction = transactionDecoder.decode(transactionBytes);

  const compiledMessageDecoder = getCompiledTransactionMessageDecoder();
  const compiledMessage = compiledMessageDecoder.decode(
    decodedTransaction.messageBytes,
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

// this is a copy of the function in buildTransaction.ts (allowing us to avoid exporting it)
async function prepareTransactionMessage(
  instructions: IInstruction[],
  rpc: Rpc<SolanaRpcApi>,
  signer: TransactionSigner,
) {
  const { value: blockhash } = await rpc
    .getLatestBlockhash({
      commitment: "confirmed",
    })
    .send();
  return pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
  );
}

export async function encodeTransaction(
  instructions: IInstruction[],
  feePayer: TransactionSigner,
): Promise<
  Readonly<FullySignedTransaction & TransactionWithBlockhashLifetime>
> {
  const rpc = rpcFromUrl("https://");
  const message = await prepareTransactionMessage(instructions, rpc, feePayer);
  const compiledMessage = compileTransactionMessage(message);
  const messageBytes = getCompiledTransactionMessageEncoder().encode(
    compiledMessage,
  ) as TransactionMessageBytes;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const __brand = "" as any;

  return {
    messageBytes,
    signatures: { [feePayer.address]: new Uint8Array() as SignatureBytes },
    lifetimeConstraint: message.lifetimeConstraint,
    __brand,
  };
}
