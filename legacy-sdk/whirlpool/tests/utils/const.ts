import type { ConfirmOptions } from "@solana/web3.js";

export const defaultConfirmOptions: ConfirmOptions = {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
};

export const TICK_RENT_AMOUNT = 779520;
export const TICK_INIT_SIZE = 112;
