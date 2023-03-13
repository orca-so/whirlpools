import { Address } from "@project-serum/anchor";

/**
 * An enum for the direction of a swap.
 * @category Whirlpool Utils
 */
export enum SwapDirection {
  AtoB = "aToB",
  BtoA = "bToA",
}

/**
 * An enum for the token type in a Whirlpool.
 * @category Whirlpool Utils
 */
export enum TokenType {
  TokenA = 1,
  TokenB,
}

/**
 * An object containing the token pairs of a Whirlpool.
 */
export interface PoolTokenPair {
  address: Address;
  tokenMintA: Address;
  tokenMintB: Address;
}
