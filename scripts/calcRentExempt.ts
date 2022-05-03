import * as anchor from "@project-serum/anchor";
import { readFile } from "mz/fs";
import Decimal from "decimal.js";
import { Keypair } from "@solana/web3.js";

const toBuffer = (arr: Buffer | Uint8Array | Array<number>): Buffer => {
  if (arr instanceof Buffer) {
    return arr;
  } else if (arr instanceof Uint8Array) {
    return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  } else {
    return Buffer.from(arr);
  }
};

async function getKeyPair(keyPath: string): Promise<Keypair> {
  const buffer = await readFile(keyPath);
  let data = JSON.parse(buffer.toString());
  return Keypair.fromSecretKey(toBuffer(data));
}

async function run() {
  // https://api.mainnet-beta.solana.com
  const wallet = new anchor.Wallet(
    await getKeyPair("/Users/ottocheung/dev/solana/pub.json")
  );
  const connection = new anchor.web3.Connection(
    "https://api.mainnet-beta.solana.com"
  );
  const provider = new anchor.Provider(
    connection,
    wallet,
    anchor.Provider.defaultOptions()
  );

  const sizeInBytes = [
    1024, 5000, 10000, 50000, 1000000, 3000000, 5000000, 10000000,
  ];
  const solPrice = 160;
  sizeInBytes.forEach(async (size) => {
    const result = await provider.connection.getMinimumBalanceForRentExemption(
      size
    );
    const sol = new Decimal(result).mul(0.000000001);
    console.log(
      `size - ${size} lamports - ${result} SOL- ${sol} price - ${sol.mul(
        solPrice
      )}`
    );
  });
}

run();
