import type {
  Address,
  IInstruction,
  VariableSizeDecoder,
} from "@solana/web3.js";
import {
  appendTransactionMessageInstructions,
  assertIsAddress,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/web3.js";
import assert from "assert";
import type { ProgramTestContext } from "solana-bankrun/dist/internal";
import { Account, startAnchor } from "solana-bankrun/dist/internal";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "@orca-so/whirlpools-client";
import { setDefaultFunder, setWhirlpoolsConfig } from "../../src/config";
import { setupConfigAndFeeTiers } from "./program";
import { getAddMemoInstruction } from "@solana-program/memo";
import { randomUUID } from "crypto";

export const signer = await generateKeyPairSigner();
setDefaultFunder(signer);

function toBytes(address: Address): Uint8Array {
  return new Uint8Array(getAddressEncoder().encode(address));
}

let _testContext: ProgramTestContext | null = null;
export async function getTestContext(): Promise<ProgramTestContext> {
  if (_testContext == null) {
    _testContext = await startAnchor(
      "../../",
      [["whirlpool", toBytes(WHIRLPOOL_PROGRAM_ADDRESS)]],
      [
        [
          toBytes(signer.address),
          new Account(
            BigInt(100e9),
            new Uint8Array(),
            toBytes(SYSTEM_PROGRAM_ADDRESS),
            false,
            0n,
          ),
        ]
      ],
    );

    const configAddress = await setupConfigAndFeeTiers();
    setWhirlpoolsConfig(configAddress);
  }
  return _testContext;
}

export async function deleteAccount(address: Address) {
  const testContext = await getTestContext();
  testContext.setAccount(
    toBytes(address),
    new Account(
      BigInt(0),
      new Uint8Array(),
      toBytes(SYSTEM_PROGRAM_ADDRESS),
      false,
      0n,
    ),
  );
}

export async function sendTransaction(ixs: IInstruction[]) {
  const blockhash = await rpc.getLatestBlockhash().send();
  // Sine blockhash is not guaranteed to be unique, we need to add a random memo to the tx
  // so that we can fire two seemingly identical transactions in a row.
  const memo = getAddMemoInstruction({
    memo: randomUUID().toString(),
  });
  const transaction = await pipe(
    createTransactionMessage({ version: 0 }),
    (x) => appendTransactionMessageInstructions([memo, ...ixs], x),
    (x) => setTransactionMessageFeePayerSigner(signer, x),
    (x) => setTransactionMessageLifetimeUsingBlockhash(blockhash.value, x),
    (x) => signTransactionMessageWithSigners(x),
  );
  const serialized = getBase64EncodedWireTransaction(transaction);
  const signature = await rpc.sendTransaction(serialized).send();
  return signature;
}

const decoders: Record<string, VariableSizeDecoder<string>> = {
  base58: getBase58Decoder(),
  base64: getBase64Decoder(),
};

async function getAccountData<T>(address: unknown, opts: unknown): Promise<T> {
  assert(typeof opts === "object");
  assert(opts != null);

  let encoding: string;
  if ("encoding" in opts) {
    assert(typeof opts.encoding === "string");
    encoding = opts.encoding;
  } else {
    encoding = "base58";
  }

  const decoder = decoders[encoding];
  if (decoder == null) {
    throw new Error(`No decoder found for ${encoding}`);
  }

  assert(typeof address === "string");
  assertIsAddress(address);
  const testContext = await getTestContext();
  const account = await testContext.banksClient.getAccount(toBytes(address));

  if (account == null || account.lamports === 0n) {
    return null as T;
  }

  return {
    data: [decoder.decode(account.data), encoding],
    executable: false,
    lamports: lamports(account.lamports),
    owner: getAddressDecoder().decode(account.owner),
    rentEpoch: 0n,
    space: account.data.length,
  } as T;
}

function getResponseWithContext<T>(value: unknown): T {
  return {
    jsonrpc: "2.0",
    result: {
      context: {
        slot: 1,
      },
      value,
    },
  } as T;
}

function getResponse<T>(value: unknown): T {
  return {
    jsonrpc: "2.0",
    result: value,
  } as T;
}

async function mockTransport<T>(
  config: Readonly<{
    payload: unknown;
    signal?: AbortSignal;
  }>,
): Promise<T> {
  assert(typeof config.payload === "object");
  assert(config.payload != null);
  assert("method" in config.payload);
  assert(typeof config.payload.method === "string");
  assert("params" in config.payload);
  assert(Array.isArray(config.payload.params));

  const testContext = await getTestContext();

  switch (config.payload.method) {
    case "getAccountInfo":
      const address = config.payload.params[0];
      assert(typeof address === "string");
      const accountData = await getAccountData(
        address,
        config.payload.params[1],
      );
      return getResponseWithContext<T>(accountData);
    case "getMultipleAccounts":
      const addresses = config.payload.params[0];
      const opts = config.payload.params[1];
      assert(Array.isArray(addresses));
      const accountsData = await Promise.all(
        addresses.map((x) => getAccountData(x, opts)),
      );
      return getResponseWithContext<T>(accountsData);
    case "getProgramAccounts":
      throw new Error("gpa is not yet exposed through solana-bankrun");
    case "getTokenAccountsByOwner":
      throw new Error(
        "getTokenAccountsByOwner is not yet exposed through solana-bankrun",
      );
    case "getMinimumBalanceForRentExemption":
      const space = config.payload.params[0];
      assert(typeof space === "number");
      const rent = await testContext.banksClient.getRent();
      const exemptAmount = rent.minimumBalance(BigInt(space));
      return getResponse<T>(exemptAmount);
    case "getLatestBlockhash":
      const blockhash = await testContext.banksClient.getLatestBlockhash();
      assert(blockhash != null);
      return getResponseWithContext<T>({
        blockhash: blockhash.blockhash,
        lastValidBlockHeight: blockhash.lastValidBlockHeight,
      });
    case "sendTransaction":
      const serialized = config.payload.params[0];
      assert(typeof serialized === "string");
      const wireTransaction = new Uint8Array(
        getBase64Encoder().encode(serialized),
      );
      const transaction = getTransactionDecoder().decode(wireTransaction);
      const signatureBytes = Object.values(transaction.signatures)[0];
      const signature = getBase58Decoder().decode(
        signatureBytes ?? new Uint8Array(),
      );
      const { result } =
        await testContext.banksClient.tryProcessVersionedTransaction(
          wireTransaction,
        );
      assert(result == null, result ?? "");
      return getResponse<T>(signature);
    case "getEpochInfo":
      const slot = await testContext.banksClient.getSlot();
      return getResponse<T>({
        epoch: slot / 32n,
        absoluteSlot: slot,
        blockheight: slot,
        slotIndex: slot % 32n,
        slotsInEpoch: 32n,
        transactionCount: 0n,
      });
  }
  return Promise.reject(
    `Method ${config.payload.method} not supported in mock transport`,
  );
}

export const rpc = createSolanaRpcFromTransport(mockTransport);
