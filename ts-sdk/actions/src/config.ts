import type {
  KeyPairSigner} from "@solana/kit";
import {
  createKeyPairFromBytes,
  createSignerFromKeyPair
} from "@solana/kit";
export {
  setComputeUnitMarginMultiplier,
  setJitoBlockEngineUrl,
  setJitoTipSetting,
  setPriorityFeeSetting,
  setRpc,
  setJitoFeePercentile,
  setPriorityFeePercentile,
  getRpcConfig,
} from "@orca-so/tx-sender";

let _payer: KeyPairSigner | undefined;

export async function setPayerFromBytes(pkBytes: Uint8Array<ArrayBuffer>) {
  const kp = await createKeyPairFromBytes(pkBytes);
  const signer = await createSignerFromKeyPair(kp);
  _payer = signer;
  return signer;
}

export function getPayer(): KeyPairSigner {
  if (!_payer) {
    throw new Error("Payer not set. Call setPayer() first.");
  }
  return _payer;
}
