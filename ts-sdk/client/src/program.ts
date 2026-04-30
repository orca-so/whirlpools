import type { Address } from "@solana/kit";
import { address } from "@solana/kit";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "./generated/programs/whirlpool";

/**
 * The canonical (upgradable) Whirlpool program address.
 *
 * Re-exported here so callers don't need to import from the generated tree.
 */
export const WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS = WHIRLPOOL_PROGRAM_ADDRESS;

/**
 * The immutable Whirlpool program address. Bytecode-identical to
 * `WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS`, deployed as a non-upgradable program.
 */
export const WHIRLPOOL_IMMUTABLE_PROGRAM_ADDRESS = address(
  "iwhrLHdsgrvmnwU8GF2FSmyabSMjfHwFGJAX2ufJ3ZN",
);

/**
 * Selector for which Whirlpool program the SDK should target at runtime.
 */
export type WhirlpoolProgram = "mutable" | "immutable" | Address;

let CURRENT_WHIRLPOOL_PROGRAM_ADDRESS: Address =
  WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS;

/**
 * Returns the currently selected Whirlpool program address.
 *
 * Generated instruction builders accept a `{ programAddress }` config and PDA
 * helpers default to this value, so callers can target both deployments by
 * switching the global selector with {@link setWhirlpoolProgram}.
 */
export function getWhirlpoolProgramAddress(): Address {
  return CURRENT_WHIRLPOOL_PROGRAM_ADDRESS;
}

/**
 * Sets the currently selected Whirlpool program address.
 *
 * Pass `"mutable"` (default) for the canonical upgradable program,
 * `"immutable"` for the immutable deployment, or an arbitrary address for
 * forks / localnet builds.
 *
 * @returns the previously selected program address.
 */
export function setWhirlpoolProgram(program: WhirlpoolProgram): Address {
  const previous = CURRENT_WHIRLPOOL_PROGRAM_ADDRESS;
  if (program === "mutable") {
    CURRENT_WHIRLPOOL_PROGRAM_ADDRESS = WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS;
  } else if (program === "immutable") {
    CURRENT_WHIRLPOOL_PROGRAM_ADDRESS = WHIRLPOOL_IMMUTABLE_PROGRAM_ADDRESS;
  } else {
    CURRENT_WHIRLPOOL_PROGRAM_ADDRESS = program;
  }
  return previous;
}

/**
 * Resets the program selector to the default (canonical mutable program).
 */
export function resetWhirlpoolProgram(): void {
  CURRENT_WHIRLPOOL_PROGRAM_ADDRESS = WHIRLPOOL_MUTABLE_PROGRAM_ADDRESS;
}
