import { createKeyPairSignerFromBytes } from "@solana/kit";
import localnetAdminKeypair0 from "../../../../programs/whirlpool/src/auth/localnet/localnet-admin-keypair-0.json";
import localnetAdminKeypair1 from "../../../../programs/whirlpool/src/auth/localnet/localnet-admin-keypair-1.json";

export const LOCALNET_ADMIN_KEYPAIR_0 = await createKeyPairSignerFromBytes(
  new Uint8Array(localnetAdminKeypair0 as number[]),
);
export const LOCALNET_ADMIN_KEYPAIR_1 = await createKeyPairSignerFromBytes(
  new Uint8Array(localnetAdminKeypair1 as number[]),
);
