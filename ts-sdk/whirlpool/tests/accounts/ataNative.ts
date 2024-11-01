import { AccountState, findAssociatedTokenPda, getTokenEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import signer from "./signer";
import { NATIVE_MINT } from "../../src/token";

const ata = await findAssociatedTokenPda({ owner: signer.address, mint: NATIVE_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });

export default {
  address: ata[0],
  data: getTokenEncoder().encode({
    mint: NATIVE_MINT,
    owner: signer.address,
    amount: 500e9,
    delegate: null,
    state: AccountState.Initialized,
    isNative: 1,
    delegatedAmount: 0,
    closeAuthority: null,
  }),
  owner: TOKEN_PROGRAM_ADDRESS,
};
