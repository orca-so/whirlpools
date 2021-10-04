import { PublicKey } from "@solana/web3.js";

/**
 * This file contains the types that the client exposes to SDK users.
 *
 * TODO: This file may or may not exist pending SDK's approach on parsing
 * the Whirlpool Accounts.
 *
 */
export interface WhirlpoolConfigAccount {
  feeAuthority: PublicKey;
  collectProtocolFeesAuthority: PublicKey;
  rewardEmissionsSuperAuthority: PublicKey;
  defaultFeeRate: number;
  defaultProtocolFeeRate: number;
}
