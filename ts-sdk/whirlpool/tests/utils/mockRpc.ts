import { getAddMemoInstruction } from "@solana-program/memo";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import type { Address, Instruction, VariableSizeDecoder } from "@solana/kit";
import {
  address,
  appendTransactionMessageInstructions,
  assertIsAddress,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  lamports,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import assert from "assert";
import { randomUUID } from "crypto";
import { FailedTransactionMetadata, FeatureSet, LiteSVM } from "litesvm";
import { setDefaultFunder, setWhirlpoolsConfig } from "../../src/config";
import { LOCALNET_ADMIN_KEYPAIR_0, LOCALNET_ADMIN_KEYPAIR_1 } from "./admin";
import { getNextKeypair } from "./keypair";
import { setupConfigAndFeeTiers } from "./program";
import { getTokenSize } from "@solana-program/token-2022";

export const signer = getNextKeypair();
setDefaultFunder(signer);

function toPublicKey(address: Address): PublicKey {
  return new PublicKey(address);
}

// Track all accounts for getProgramAccounts and getTokenAccountsByOwner
const accountsCache = new Map<
  string,
  { owner: Address; data: Uint8Array; lamports: bigint }
>();

let _testContext: LiteSVM | null = null;
export async function getTestContext(): Promise<LiteSVM> {
  if (_testContext == null) {
    _testContext = new LiteSVM()
      .withFeatureSet(FeatureSet.allEnabled())
      .withDefaultPrograms();

    // Airdrop SOL to test accounts
    _testContext.airdrop(toPublicKey(signer.address), BigInt(100e9));
    _testContext.airdrop(
      toPublicKey(LOCALNET_ADMIN_KEYPAIR_0.address),
      BigInt(100e9),
    );
    _testContext.airdrop(
      toPublicKey(LOCALNET_ADMIN_KEYPAIR_1.address),
      BigInt(100e9),
    );

    // Load programs
    const fs = await import("fs");
    const path = await import("path");

    // Load whirlpool program
    const whirlpoolProgram = fs.readFileSync(
      path.join(process.cwd(), "../../target/deploy/whirlpool.so"),
    );
    _testContext.addProgram(
      toPublicKey(address("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc")),
      whirlpoolProgram,
    );

    // Create native SOL mint account
    // This is the well-known native mint for wrapped SOL
    const nativeMintAddress = address(
      "So11111111111111111111111111111111111111112",
    );
    const TOKEN_PROGRAM_ID = address(
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    );

    // Create a minimal Mint account for native SOL
    // Layout: mint_authority (36 bytes), supply (8 bytes), decimals (1 byte),
    //         is_initialized (1 byte), freeze_authority (36 bytes)
    const mintData = new Uint8Array(82);
    // Set mint_authority to None (0 followed by 32 zero bytes)
    mintData[0] = 0;
    // supply = 0 (8 bytes, already zero)
    // decimals = 9 (for SOL)
    mintData[44] = 9;
    // is_initialized = true
    mintData[45] = 1;
    // freeze_authority = None (0 followed by 32 zero bytes)
    mintData[46] = 0;

    const rentExemptBalance = _testContext.minimumBalanceForRentExemption(
      BigInt(mintData.length),
    );

    _testContext.setAccount(toPublicKey(nativeMintAddress), {
      lamports: Number(rentExemptBalance),
      data: mintData,
      owner: toPublicKey(TOKEN_PROGRAM_ID),
      executable: false,
      rentEpoch: 0,
    });

    const configAddress = await setupConfigAndFeeTiers();
    setWhirlpoolsConfig(configAddress);
  }
  return _testContext;
}

export async function deleteAccount(address: Address) {
  const testContext = await getTestContext();
  testContext.setAccount(toPublicKey(address), {
    lamports: 0,
    data: new Uint8Array(),
    owner: toPublicKey(SYSTEM_PROGRAM_ADDRESS),
    executable: false,
    rentEpoch: 0,
  });
  accountsCache.delete(address);
}

function extractAccountAddresses(ixs: Instruction[]): Address[] {
  return Array.from(
    new Set(
      ixs.flatMap((ix) => [
        ...(ix.accounts?.map((account) => account.address) ?? []),
        ...(ix.programAddress ? [ix.programAddress] : []),
      ]),
    ),
  );
}

export async function sendTransaction(ixs: Instruction[]) {
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
    (x) => partiallySignTransactionMessageWithSigners(x),
  );
  const serialized = getBase64EncodedWireTransaction(transaction);
  const signature = await rpc.sendTransaction(serialized).send();

  // Auto-populate cache for accounts so that getProgramAccounts and getTokenAccountsByOwner
  // can find them on-demand without additional timeouts or RPC calls
  const accountAddresses = extractAccountAddresses(ixs);
  await Promise.all(
    accountAddresses.map(
      (addr) =>
        rpc
          .getAccountInfo(addr, { encoding: "base64" })
          .send()
          .catch(() => {}), // Ignore errors for accounts that don't exist
    ),
  );

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
  const account = testContext.getAccount(toPublicKey(address));

  if (account == null || account.lamports === 0) {
    return null as T;
  }

  // Cache account for getProgramAccounts
  const ownerAddress = account.owner.toBase58() as Address;
  accountsCache.set(address, {
    owner: ownerAddress,
    data: account.data,
    lamports: BigInt(account.lamports),
  });

  return {
    data: [decoder.decode(account.data), encoding],
    executable: false,
    lamports: lamports(BigInt(account.lamports)),
    owner: ownerAddress,
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
      // https://solana.com/docs/rpc/http/getprogramaccounts
      // Params per RPC spec:
      // [0] programId (base-58 pubkey string)
      // [1] optional config object (filters, encoding, context, etc.)
      const programIdStr = config.payload.params[0];
      assert(typeof programIdStr === "string");
      const programId = programIdStr as Address;
      const gpaConfig = config.payload.params[1];

      let gpaEncoding = "base58";
      if (
        gpaConfig &&
        typeof gpaConfig === "object" &&
        "encoding" in gpaConfig
      ) {
        assert(typeof gpaConfig.encoding === "string");
        gpaEncoding = gpaConfig.encoding;
      }

      const gpaDecoder = decoders[gpaEncoding];
      if (gpaDecoder == null) {
        throw new Error(`No decoder found for ${gpaEncoding}`);
      }

      let withContext = false;
      if (
        gpaConfig &&
        typeof gpaConfig === "object" &&
        "withContext" in gpaConfig &&
        typeof gpaConfig.withContext === "boolean"
      ) {
        withContext = gpaConfig.withContext;
      }

      const filters =
        gpaConfig &&
        typeof gpaConfig === "object" &&
        "filters" in gpaConfig &&
        Array.isArray(gpaConfig.filters)
          ? gpaConfig.filters
          : [];

      const matchingAccounts: unknown[] = [];
      for (const [accountAddress, cachedAccount] of accountsCache.entries()) {
        if (cachedAccount.owner !== programId) continue;

        let passesFilters = true;
        for (const filter of filters) {
          if (filter && typeof filter === "object") {
            // Handle memcmp filter
            if ("memcmp" in filter && filter.memcmp) {
              const memcmp = filter.memcmp as {
                offset?: number;
                bytes?: string | number[];
              };
              const offset = memcmp.offset ?? 0;
              const bytesValue = memcmp.bytes;

              let filterBytes: Uint8Array;
              if (typeof bytesValue === "string") {
                // Convert base58 string to bytes
                filterBytes = new Uint8Array(
                  getBase58Encoder().encode(bytesValue),
                );
              } else if (Array.isArray(bytesValue)) {
                filterBytes = new Uint8Array(bytesValue);
              } else {
                passesFilters = false;
                break;
              }

              if (
                cachedAccount.data.length < offset + filterBytes.length ||
                !cachedAccount.data
                  .slice(offset, offset + filterBytes.length)
                  .every((byte, i) => byte === filterBytes[i])
              ) {
                passesFilters = false;
                break;
              }
            }

            // Handle dataSize filter
            if ("dataSize" in filter && typeof filter.dataSize === "number") {
              if (cachedAccount.data.length !== filter.dataSize) {
                passesFilters = false;
                break;
              }
            }
          }
        }

        if (passesFilters) {
          matchingAccounts.push({
            pubkey: accountAddress,
            account: {
              data: [gpaDecoder.decode(cachedAccount.data), gpaEncoding],
              executable: false,
              lamports: lamports(cachedAccount.lamports),
              owner: cachedAccount.owner,
              rentEpoch: 0n,
              space: cachedAccount.data.length,
            },
          });
        }
      }

      return withContext
        ? getResponseWithContext<T>(matchingAccounts)
        : getResponse<T>(matchingAccounts);
    case "getTokenAccountsByOwner":
      // https://solana.com/docs/rpc/http/gettokenaccountsbyowner
      // Params per RPC spec:
      // [0] owner (base-58 pubkey string)
      // [1] filter config (object with either `mint` or `programId`)
      // [2] optional config object (encoding, commitment, etc.)
      const ownerString = config.payload.params[0];
      assert(typeof ownerString === "string");
      const owner = toPublicKey(ownerString as Address);
      const filterConfig = config.payload.params[1];
      const encodingConfig = config.payload.params[2];

      let tokenEncoding = "base58";
      if (
        encodingConfig &&
        typeof encodingConfig === "object" &&
        "encoding" in encodingConfig
      ) {
        assert(typeof encodingConfig.encoding === "string");
        tokenEncoding = encodingConfig.encoding;
      }

      const tokenDecoder = decoders[tokenEncoding];
      if (tokenDecoder == null) {
        throw new Error(`No decoder found for ${tokenEncoding}`);
      }

      let programIdFilter: Address | null = null;
      let mintFilter: Address | null = null;

      const parsedFilterConfig =
        filterConfig != null && typeof filterConfig === "object"
          ? (filterConfig as { programId?: unknown; mint?: unknown })
          : null;

      if (parsedFilterConfig == null) {
        throw new Error(
          "getTokenAccountsByOwner requires a filter object with 'programId' or 'mint'",
        );
      }

      const { programId: rawProgramId, mint: rawMint } = parsedFilterConfig;

      if (rawProgramId != null) {
        assert(typeof rawProgramId === "string");
        programIdFilter = rawProgramId as Address;
      }

      if (rawMint != null) {
        assert(typeof rawMint === "string");
        mintFilter = rawMint as Address;
      }

      if (programIdFilter == null && mintFilter == null) {
        throw new Error(
          "getTokenAccountsByOwner requires either 'programId' or 'mint' filter",
        );
      }

      if (programIdFilter != null && mintFilter != null) {
        throw new Error(
          "getTokenAccountsByOwner accepts only one of 'programId' or 'mint', not both",
        );
      }

      const TOKEN_ACCOUNT_MINT_OFFSET = 0;
      const TOKEN_ACCOUNT_OWNER_OFFSET = 32;
      const programIdPubkey = programIdFilter
        ? toPublicKey(programIdFilter)
        : null;
      const mintPubkey = mintFilter ? toPublicKey(mintFilter) : null;
      const tokenAccounts: unknown[] = [];

      for (const [accountAddress, cachedAccount] of accountsCache.entries()) {
        if (cachedAccount.data.length < getTokenSize()) {
          continue;
        }

        if (
          programIdPubkey &&
          !toPublicKey(cachedAccount.owner).equals(programIdPubkey)
        ) {
          continue;
        }

        // Check mint field at offset 0 if mint filter is specified
        const accountMint = new PublicKey(
          cachedAccount.data.slice(
            TOKEN_ACCOUNT_MINT_OFFSET,
            TOKEN_ACCOUNT_MINT_OFFSET + 32,
          ),
        );

        if (mintPubkey && !accountMint.equals(mintPubkey)) {
          continue;
        }

        // Check owner field at offset 32
        const accountOwner = new PublicKey(
          cachedAccount.data.slice(
            TOKEN_ACCOUNT_OWNER_OFFSET,
            TOKEN_ACCOUNT_OWNER_OFFSET + 32,
          ),
        );

        if (!accountOwner.equals(owner)) {
          continue;
        }

        tokenAccounts.push({
          pubkey: accountAddress,
          account: {
            data: [tokenDecoder.decode(cachedAccount.data), tokenEncoding],
            executable: false,
            lamports: lamports(cachedAccount.lamports),
            owner: cachedAccount.owner,
            rentEpoch: 0n,
            space: cachedAccount.data.length,
          },
        });
      }

      return getResponseWithContext<T>(tokenAccounts);
    case "getMinimumBalanceForRentExemption":
      const space = config.payload.params[0];
      assert(typeof space === "number");
      const exemptAmount = testContext.minimumBalanceForRentExemption(
        BigInt(space),
      );
      return getResponse<T>(exemptAmount);
    case "getLatestBlockhash":
      const blockhash = testContext.latestBlockhash();
      return getResponseWithContext<T>({
        blockhash: blockhash,
        lastValidBlockHeight: BigInt(1000000),
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
      const versionedTx = VersionedTransaction.deserialize(wireTransaction);
      const result = testContext.sendTransaction(versionedTx);
      if (result instanceof FailedTransactionMetadata) {
        assert.fail(result.toString());
      }
      return getResponse<T>(signature);
    case "getEpochInfo":
      const slot = testContext.getClock().slot;
      return getResponse<T>({
        epoch: slot / 32n,
        absoluteSlot: slot,
        blockheight: slot,
        slotIndex: slot % 32n,
        slotsInEpoch: 32n,
        transactionCount: 0n,
      });
    case "getBalance":
      const addressForBalance = config.payload.params[0];
      assert(typeof addressForBalance === "string");
      const accountDataForBalance = await getAccountData(
        addressForBalance,
        config.payload.params[1],
      );
      assert(accountDataForBalance !== null);
      assert(typeof accountDataForBalance === "object");
      assert("lamports" in accountDataForBalance);
      const balance = accountDataForBalance.lamports;
      return getResponseWithContext<T>(balance);
  }
  return Promise.reject(
    `Method ${config.payload.method} not supported in mock transport`,
  );
}

export const rpc = createSolanaRpcFromTransport(mockTransport);
