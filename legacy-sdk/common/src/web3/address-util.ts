import { PublicKey } from "@solana/web3.js";

export declare type Address = PublicKey | string;

/**
 * @category Util
 */
export type PDA = { publicKey: PublicKey; bump: number };

/**
 * @category Util
 */
export class AddressUtil {
  public static toPubKey(address: Address): PublicKey {
    return address instanceof PublicKey ? address : new PublicKey(address);
  }

  public static toPubKeys(addresses: Address[]): PublicKey[] {
    return addresses.map((address) => AddressUtil.toPubKey(address));
  }

  public static toString(address: Address): string {
    if (typeof address === "string") {
      return address;
    }
    return AddressUtil.toPubKey(address).toBase58();
  }

  public static toStrings(addresses: Address[]): string[] {
    return addresses.map((address) => AddressUtil.toString(address));
  }

  public static findProgramAddress(
    seeds: (Uint8Array | Buffer)[],
    programId: PublicKey,
  ): PDA {
    const [publicKey, bump] = PublicKey.findProgramAddressSync(
      seeds,
      programId,
    );
    return { publicKey, bump };
  }
}
