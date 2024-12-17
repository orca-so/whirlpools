import { PACKET_DATA_SIZE } from "@solana/web3.js";

// The hard-coded limit of a transaction size in bytes
export const TX_SIZE_LIMIT = PACKET_DATA_SIZE; // 1232

// The hard-coded limit of an encoded transaction size in bytes
export const TX_BASE64_ENCODED_SIZE_LIMIT = Math.ceil(TX_SIZE_LIMIT / 3) * 4; // 1644

// A dummy blockhash to use for measuring transaction sizes
export const MEASUREMENT_BLOCKHASH = {
  blockhash: "65FJ2gp6jC2x87bycfdZpxDyjiodcAoymxR6PMZzfavY",
  lastValidBlockHeight: 160381350,
};
