import type { ConfirmOptions } from "@solana/web3.js";

export const defaultConfirmOptions: ConfirmOptions = {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
};

export const TICK_RENT_AMOUNT = 779520;
export const TICK_INIT_SIZE = 112;

export const SENTINEL_MIN = -2147483648; // i32::MIN
export const SENTINEL_MAX = 2147483647; // i32::MAX
