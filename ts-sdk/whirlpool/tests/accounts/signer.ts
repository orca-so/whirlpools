import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { createKeyPairSignerFromBytes } from "@solana/web3.js";

const signer = await createKeyPairSignerFromBytes(
  new Uint8Array([
    30, 87, 82, 53, 139, 246, 108, 153, 174, 6, 18, 150, 78, 225, 87, 71,
    106, 171, 254, 186, 20, 3, 173, 191, 142, 41, 231, 221, 39, 51, 164, 4,
    92, 47, 48, 13, 52, 147, 252, 254, 154, 239, 6, 13, 47, 116, 47, 181, 72,
    219, 79, 88, 121, 230, 200, 9, 137, 37, 217, 201, 115, 194, 248, 232,
  ]),
);

export default {
  address: signer.address,
  keypair: signer,
  data: null,
  owner: SYSTEM_PROGRAM_ADDRESS,
};
