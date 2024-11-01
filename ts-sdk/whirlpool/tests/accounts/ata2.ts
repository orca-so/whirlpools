import { AccountState, findAssociatedTokenPda, getTokenEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import tokenMint2 from "./tokenMint2";
import signer from "./signer";

const ata = await findAssociatedTokenPda({ owner: signer.address, mint: tokenMint2.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });

export default {
  address: ata[0],
  data: getTokenEncoder().encode({
    mint: tokenMint2.address,
    owner: signer.address,
    amount: 500e9,
    delegate: null,
    state: AccountState.Initialized,
    isNative: null,
    delegatedAmount: 0,
    closeAuthority: null,
  }),
  owner: TOKEN_PROGRAM_ADDRESS,
};
