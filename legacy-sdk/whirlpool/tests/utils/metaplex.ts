// To eliminate deps on @metaplex-foundation/mpl-token-metadata
// Copied from https://github.com/orca-so/orca-sdks/blob/main/packages/token-sdk/src/metadata/client/metaplex-client.ts

import { PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";

const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

// Metadata should be a just tiny JSON file, 2000ms should be sufficient for most cases
const DEFAULT_GET_OFF_CHAIN_METADATA_TIMEOUT_MS = 2000;

interface Creator {
  address: PublicKey;
  verified: boolean;
  share: number;
}

interface Collection {
  verified: boolean;
  key: PublicKey;
}

interface Uses {
  useMethod: number;
  remaining: bigint;
  total: bigint;
}

interface OnChainMetadataPrefix {
  key: number;
  updateAuthority: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  sellerFeeBasisPoints: number;
}

interface OnChainMetadataCreators {
  creators: Creator[];
}

interface OnChainMetadataSuffix {
  primarySaleHappened: boolean;
  isMutable: boolean;
  editionNonce: number | null;
  tokenStandard: number | null;
  collection: Collection | null;
  uses: Uses | null;
}

export type OnChainMetadata = OnChainMetadataPrefix &
  OnChainMetadataCreators &
  OnChainMetadataSuffix;

export interface OffChainMetadata {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
}

export interface MetaplexClient {
  getMetadataAddress(mint: PublicKey): PublicKey;
  parseOnChainMetadata(
    mint: PublicKey,
    buffer: Buffer | Uint8Array,
  ): OnChainMetadata | null;
  getOffChainMetadata(
    metadata: OnChainMetadata,
    timeoutMs?: number,
  ): Promise<OffChainMetadata | null>;
}

export class MetaplexHttpClient implements MetaplexClient {
  getMetadataAddress(mint: PublicKey): PublicKey {
    const seeds = [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ];
    return PublicKey.findProgramAddressSync(seeds, METADATA_PROGRAM_ID)[0];
  }

  parseOnChainMetadata(
    mint: PublicKey,
    data: Uint8Array | Buffer,
  ): OnChainMetadata | null {
    try {
      const buffer = Buffer.from(data);
      const [prefix, creatorsOffset] = parseOnChainMetadataPrefix(buffer, 0);
      const [creators, suffixOffset] = parseOnChainMetadataCreators(
        buffer,
        creatorsOffset,
      );
      const [suffix] = parseOnChainMetadataSuffix(buffer, suffixOffset);
      return { ...prefix, ...creators, ...suffix };
    } catch {
      console.error(`Failed to parse onchain metadata for ${mint}`);
      return null;
    }
  }

  async getOffChainMetadata(
    metadata: OnChainMetadata,
    timeoutMs: number = DEFAULT_GET_OFF_CHAIN_METADATA_TIMEOUT_MS,
  ): Promise<OffChainMetadata | null> {
    try {
      if (metadata.uri === "") {
        return null;
      }
      const response = await fetch(metadata.uri, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 404) {
        return null;
      }
      invariant(
        response.ok,
        `Unexpected status code fetching ${metadata.uri}: ${response.status}`,
      );
      const json = await response.json();
      invariant(
        isMetadataResponse(json),
        "Unexpected offchain metadata response type",
      );
      return json;
    } catch {
      console.error(`Failed to fetch offchain metadata for ${metadata.mint}`);
      return null;
    }
  }
}

function readString(buffer: Buffer, offset: number): string {
  const readLength = buffer.readUInt32LE(offset);
  const bytes = buffer.subarray(offset + 4, offset + 4 + readLength);
  const nullIndex = bytes.indexOf(0);
  return new TextDecoder().decode(
    bytes.subarray(0, nullIndex === -1 ? undefined : nullIndex),
  );
}

function parseOnChainMetadataPrefix(
  buffer: Buffer,
  offset: number,
): [OnChainMetadataPrefix, number] {
  const key = buffer.readUInt8(offset);
  offset += 1;
  const updateAuthority = new PublicKey(buffer.subarray(offset, offset + 32));
  offset += 32;
  const mint = new PublicKey(buffer.subarray(offset, offset + 32));
  offset += 32;
  const name = readString(buffer, offset);
  offset += 36;
  const symbol = readString(buffer, offset);
  offset += 14;
  const uri = readString(buffer, offset);
  offset += 204;
  const sellerFeeBasisPoints = buffer.readUInt16LE(offset);
  offset += 2;
  return [
    { key, updateAuthority, mint, name, symbol, uri, sellerFeeBasisPoints },
    offset,
  ];
}

function parseOnChainMetadataCreators(
  buffer: Buffer,
  offset: number,
): [OnChainMetadataCreators, number] {
  const creatorsPresent = !!buffer.readUInt8(offset);
  offset += 1;
  if (!creatorsPresent) {
    return [{ creators: [] }, offset];
  }
  const creatorCount = buffer.readUInt16LE(offset);
  offset += 4;
  let creators: Creator[] = [];
  for (let i = 0; i < creatorCount; i++) {
    const address = new PublicKey(buffer.subarray(offset, offset + 32));
    offset += 32;
    const verified = !!buffer.readUInt8(offset);
    offset += 1;
    const share = buffer.readUInt8(offset);
    offset += 1;
    creators.push({ address, verified, share });
  }
  return [{ creators }, offset];
}

function parseOnChainMetadataSuffix(
  buffer: Buffer,
  offset: number,
): [OnChainMetadataSuffix, number] {
  const primarySaleHappened = !!buffer.readUInt8(offset);
  offset += 1;
  const isMutable = !!buffer.readUInt8(offset);
  offset += 1;
  const editionNoncePresent = !!buffer.readUInt8(offset);
  offset += 1;
  let editionNonce: number | null = null;
  if (editionNoncePresent) {
    editionNonce = editionNoncePresent ? buffer.readUInt8(offset) : null;
    offset += 1;
  }
  const tokenStandardPresent = !!buffer.readUInt8(offset);
  offset += 1;
  let tokenStandard: number | null = null;
  if (tokenStandardPresent) {
    tokenStandard = tokenStandardPresent ? buffer.readUInt8(offset) : null;
    offset += 1;
  }
  const collectionPresent = !!buffer.readUInt8(offset);
  offset += 1;
  let collection: Collection | null = null;
  if (collectionPresent) {
    const collectionVerified = !!buffer.readUInt8(offset);
    offset += 1;
    const collectionKey = new PublicKey(buffer.subarray(offset, offset + 32));
    offset += 32;
    collection = collectionPresent
      ? { verified: collectionVerified, key: collectionKey }
      : null;
  }
  const usesPresent = !!buffer.readUInt8(offset);
  offset += 1;
  let uses: Uses | null = null;
  if (usesPresent) {
    const useMethod = buffer.readUInt8(offset);
    offset += 1;
    const remaining = buffer.readBigUInt64LE(offset);
    offset += 8;
    const total = buffer.readBigUInt64LE(offset);
    offset += 8;
    uses = usesPresent ? { useMethod, remaining, total } : null;
  }
  return [
    {
      primarySaleHappened,
      isMutable,
      editionNonce,
      tokenStandard,
      collection,
      uses,
    },
    offset,
  ];
}

function isMetadataResponse(value: unknown): value is OffChainMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }
  if ("name" in value && typeof value.name !== "string") {
    return false;
  }
  if ("image" in value && typeof value.image !== "string") {
    return false;
  }
  if ("description" in value && typeof value.description !== "string") {
    return false;
  }
  if ("symbol" in value && typeof value.symbol !== "string") {
    return false;
  }
  return true;
}
