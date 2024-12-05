import type { PublicKey } from "@solana/web3.js";

export class PublicKeyUtils {
  /**
   * Check whether a string is a Base58 string.
   * @param value
   * @returns Whether the string is a Base58 string.
   */
  public static isBase58(value: string) {
    return /^[A-HJ-NP-Za-km-z1-9]*$/.test(value);
  }

  /**
   * Order a list of public keys by bytes.
   * @param keys a list of public keys to order
   * @returns an ordered array of public keys
   */
  public static orderKeys(...keys: PublicKey[]): PublicKey[] {
    return keys.sort(comparePublicKeys);
  }
}

function comparePublicKeys(key1: PublicKey, key2: PublicKey): number {
  const bytes1 = key1.toBytes();
  const bytes2 = key2.toBytes();

  // PublicKeys should be zero-padded 32 byte length
  if (bytes1.byteLength !== bytes2.byteLength) {
    return bytes1.byteLength - bytes2.byteLength;
  }

  for (let i = 0; i < bytes1.byteLength; i++) {
    let byte1 = bytes1[i];
    let byte2 = bytes2[i];
    if (byte1 !== byte2) {
      return byte1 - byte2;
    }
  }

  return 0;
}
