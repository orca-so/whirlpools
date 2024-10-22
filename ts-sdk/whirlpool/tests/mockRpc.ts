import { getMintEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import type {
  Address,
  IInstruction,
  ReadonlyUint8Array,
  TransactionSigner,
  VariableSizeDecoder,
} from "@solana/web3.js";
import {
  address,
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
import {
  DEFAULT_ADDRESS,
  SPLASH_POOL_TICK_SPACING,
  WHIRLPOOLS_CONFIG_ADDRESS,
} from "../src/config";
import { NATIVE_MINT } from "../src/token";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  getFeeTierEncoder,
  getWhirlpoolsConfigEncoder,
  WHIRLPOOL_PROGRAM_ADDRESS,
} from "@orca-so/whirlpools-client";

export const [
  TOKEN_MINT_1,
  TOKEN_MINT_2,
  TOKEN_2022_MINT,
  TOKEN_2022_MINT_TRANSFER_FEE,
  TOKEN_2022_MINT_TRANSFER_HOOK,
] = [...Array(25).keys()].map((i) => {
  const bytes = Array.from({ length: 32 }, () => i + 1);
  return getAddressDecoder().decode(new Uint8Array(bytes));
});

export const CONCENTRATED_POOL_FEE_TIER = address(
  "BGnhGXT9CCt5WYS23zg9sqsAT2MGXkq7VSwch9pML82W",
);
export const SPLASH_POOL_FEE_TIER = address(
  "zVmMsL5qGh7txhTHFgGZcFQpSsxSx6DBLJ3u113PBer",
);

function toBytes(address: Address): Uint8Array {
  return new Uint8Array(getAddressEncoder().encode(address));
}

function systemAccount(): Account {
  return new Account(
    BigInt(1e9),
    new Uint8Array(),
    toBytes(SYSTEM_PROGRAM_ADDRESS),
    false,
    0n,
  );
}

function toAccount(data: ReadonlyUint8Array | null, owner?: Address): Account {
  const bytes = data ?? new Uint8Array();
  return new Account(
    BigInt(bytes.length ?? 0) * 10n,
    new Uint8Array(bytes),
    toBytes(owner ?? SYSTEM_PROGRAM_ADDRESS),
    false,
    0n,
  );
}

const initialAccounts: [Uint8Array, Account][] = [
  [
    toBytes(TOKEN_MINT_1),
    toAccount(
      getMintEncoder().encode({
        mintAuthority: DEFAULT_ADDRESS,
        supply: 1000000000,
        decimals: 6,
        isInitialized: true,
        freezeAuthority: null,
      }),
      TOKEN_PROGRAM_ADDRESS,
    ),
  ],
  [
    toBytes(TOKEN_MINT_2),
    toAccount(
      getMintEncoder().encode({
        mintAuthority: DEFAULT_ADDRESS,
        supply: 1000000000,
        decimals: 9,
        isInitialized: true,
        freezeAuthority: null,
      }),
      TOKEN_PROGRAM_ADDRESS,
    ),
  ],
  [
    toBytes(NATIVE_MINT),
    toAccount(
      getMintEncoder().encode({
        mintAuthority: DEFAULT_ADDRESS,
        supply: 1000000000,
        decimals: 9,
        isInitialized: true,
        freezeAuthority: null,
      }),
      TOKEN_PROGRAM_ADDRESS,
    ),
  ],
  [
    toBytes(TOKEN_2022_MINT),
    toAccount(
      getMintEncoder().encode({
        mintAuthority: DEFAULT_ADDRESS,
        supply: 1000000000,
        decimals: 9,
        isInitialized: true,
        freezeAuthority: null,
      }),
      TOKEN_2022_PROGRAM_ADDRESS,
    ),
  ],
  [
    toBytes(TOKEN_2022_MINT_TRANSFER_FEE),
    toAccount(
      getMintEncoder().encode({
        mintAuthority: DEFAULT_ADDRESS,
        supply: 1000000000,
        decimals: 9,
        isInitialized: true,
        freezeAuthority: null,
        // TODO: <- transfer fee config
      }),
      TOKEN_2022_PROGRAM_ADDRESS,
    ),
  ],
  [
    toBytes(TOKEN_2022_MINT_TRANSFER_HOOK),
    toAccount(
      getMintEncoder().encode({
        mintAuthority: DEFAULT_ADDRESS,
        supply: 1000000000,
        decimals: 9,
        isInitialized: true,
        freezeAuthority: null,
        // TODO: <- transfer hook config
      }),
      TOKEN_2022_PROGRAM_ADDRESS,
    ),
  ],
  [
    toBytes(WHIRLPOOLS_CONFIG_ADDRESS),
    toAccount(
      getWhirlpoolsConfigEncoder().encode({
        feeAuthority: DEFAULT_ADDRESS,
        collectProtocolFeesAuthority: DEFAULT_ADDRESS,
        rewardEmissionsSuperAuthority: DEFAULT_ADDRESS,
        defaultProtocolFeeRate: 100,
      }),
      WHIRLPOOL_PROGRAM_ADDRESS,
    ),
  ],
  [
    toBytes(CONCENTRATED_POOL_FEE_TIER),
    toAccount(
      getFeeTierEncoder().encode({
        whirlpoolsConfig: WHIRLPOOLS_CONFIG_ADDRESS,
        tickSpacing: 128,
        defaultFeeRate: 10000,
      }),
      WHIRLPOOL_PROGRAM_ADDRESS,
    ),
  ],
  [
    toBytes(SPLASH_POOL_FEE_TIER),
    toAccount(
      getFeeTierEncoder().encode({
        whirlpoolsConfig: WHIRLPOOLS_CONFIG_ADDRESS,
        tickSpacing: SPLASH_POOL_TICK_SPACING,
        defaultFeeRate: 10000,
      }),
      WHIRLPOOL_PROGRAM_ADDRESS,
    ),
  ],
];

let _testContext: ProgramTestContext | null = null;
export async function getTestContext(): Promise<ProgramTestContext> {
  if (_testContext == null) {
    _testContext = await startAnchor(
      "../../",
      [["whirlpool", toBytes(WHIRLPOOL_PROGRAM_ADDRESS)]],
      initialAccounts,
    );
  }
  return _testContext;
}

export async function setAccount(
  address: Address,
  data: ReadonlyUint8Array | null,
  owner?: Address,
) {
  const testContext = await getTestContext();
  testContext.setAccount(toBytes(address), toAccount(data, owner));
}

export async function initPayer(): Promise<TransactionSigner> {
  const payer = await generateKeyPairSigner();
  const testContext = await getTestContext();
  testContext.setAccount(toBytes(payer.address), systemAccount());
  return payer;
}

export async function sendTransaction(
  ixs: IInstruction[],
  payer: TransactionSigner,
) {
  const blockhash = await rpc.getLatestBlockhash().send();
  const transaction = await pipe(
    createTransactionMessage({ version: 0 }),
    (x) => appendTransactionMessageInstructions(ixs, x),
    (x) => setTransactionMessageFeePayerSigner(payer, x),
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
    case "getMinimumBalanceForRentExemption":
      const space = config.payload.params[0];
      assert(typeof space === "number");
      return getResponse<T>(space * 10);
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
