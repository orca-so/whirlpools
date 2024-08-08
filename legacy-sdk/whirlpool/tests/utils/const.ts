import type { ConfirmOptions } from "@solana/web3.js";

export const defaultConfirmOptions: ConfirmOptions = {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
};
