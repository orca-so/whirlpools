import type {
  Address,
  ReadonlyUint8Array,
  VariableSizeDecoder,
} from "@solana/web3.js";
import {
  createSolanaRpcFromTransport,
  getAddressDecoder,
  getBase58Decoder,
  getBase64Decoder,
} from "@solana/web3.js";
import assert from "assert";
import { DEFAULT_ADDRESS } from "../src/config";
import { getMintEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { NATIVE_MINT } from "../src/token";

export const [
  TOKEN_MINT_1,
  TOKEN_MINT_2,
  TOKEN_2022_MINT,
  TOKEN_2022_MINT_TRANSFER_FEE,
  TOKEN_2022_MINT_TRANSFER_HOOK,
] = [...Array(25).keys()].map((i) => {
  const bytes = Array.from({ length: 32 }, () => i);
  return getAddressDecoder().decode(new Uint8Array(bytes));
});

type AccountData = {
  bytes: ReadonlyUint8Array;
  owner?: Address;
};

export const mockAccounts: Record<Address, AccountData> = {
  [TOKEN_MINT_1]: {
    bytes: getMintEncoder().encode({
      mintAuthority: DEFAULT_ADDRESS,
      supply: 1000000000,
      decimals: 6,
      isInitialized: true,
      freezeAuthority: null,
    }),
    owner: TOKEN_PROGRAM_ADDRESS,
  },
  [TOKEN_MINT_2]: {
    bytes: getMintEncoder().encode({
      mintAuthority: DEFAULT_ADDRESS,
      supply: 1000000000,
      decimals: 9,
      isInitialized: true,
      freezeAuthority: null,
    }),
    owner: TOKEN_PROGRAM_ADDRESS,
  },
  [NATIVE_MINT]: {
    bytes: getMintEncoder().encode({
      mintAuthority: DEFAULT_ADDRESS,
      supply: 1000000000,
      decimals: 9,
      isInitialized: true,
      freezeAuthority: null,
    }),
    owner: TOKEN_PROGRAM_ADDRESS,
  },
  [TOKEN_2022_MINT]: {
    bytes: getMintEncoder().encode({
      mintAuthority: DEFAULT_ADDRESS,
      supply: 1000000000,
      decimals: 9,
      isInitialized: true,
      freezeAuthority: null,
    }),
    owner: TOKEN_2022_PROGRAM_ADDRESS,
  },
  [TOKEN_2022_MINT_TRANSFER_FEE]: {
    bytes: getMintEncoder().encode({
      mintAuthority: DEFAULT_ADDRESS,
      supply: 1000000000,
      decimals: 9,
      isInitialized: true,
      freezeAuthority: null,
      // TODO: <- transfer fee config
    }),
    owner: TOKEN_2022_PROGRAM_ADDRESS,
  },
  [TOKEN_2022_MINT_TRANSFER_HOOK]: {
    bytes: getMintEncoder().encode({
      mintAuthority: DEFAULT_ADDRESS,
      supply: 1000000000,
      decimals: 9,
      isInitialized: true,
      freezeAuthority: null,
      // TODO: <- transfer hook config
    }),
    owner: TOKEN_2022_PROGRAM_ADDRESS,
  },
};

const decoders: Record<string, VariableSizeDecoder<string>> = {
  base58: getBase58Decoder(),
  base64: getBase64Decoder(),
};

function getAccountData<T>(address: unknown, opts: unknown): unknown {
  assert(typeof opts === "object");
  assert(opts != null);
  assert("encoding" in opts);
  assert(typeof opts.encoding === "string");

  const decoder = decoders[opts.encoding];
  if (decoder == null) {
    throw new Error(`No decoder found for ${opts}`);
  }

  assert(typeof address === "string");
  const data = mockAccounts[address];
  if (data == null) {
    throw new Error(`No mock account found for ${address}`);
  }
  return {
    data: [decoder.decode(data.bytes), opts.encoding],
    executable: false,
    lamports: data.length * 10,
    owner: data.owner ?? DEFAULT_ADDRESS,
    rentEpoch: 0,
    space: data.length,
  } as T;
}

function getResponse<T>(value: unknown): T {
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

function mockTransport<T>(
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

  switch (config.payload.method) {
    case "getAccountInfo":
      const address = config.payload.params[0];
      assert(typeof address === "string");
      const accountData = getAccountData(address, config.payload.params[1]);
      return Promise.resolve(getResponse<T>(accountData));
    case "getMultipleAccounts":
      const addresses = config.payload.params[0];
      const opts = config.payload.params[1];
      assert(Array.isArray(addresses));
      const accountsData = addresses.map((x) => getAccountData(x, opts));
      return Promise.resolve(getResponse<T>(accountsData));
    case "getMinimumBalanceForRentExemption":
      const space = config.payload.params[0];
      assert(typeof space === "number");
      return Promise.resolve(getResponse<T>(space * 10));
  }
  return Promise.reject(
    `Method ${config.payload.method} not supported in mock transport`,
  );
}

export const rpc = createSolanaRpcFromTransport(mockTransport);
