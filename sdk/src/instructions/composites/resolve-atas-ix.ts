import { Instruction, TokenUtil } from "@orca-so/common-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { WhirlpoolContext } from "../..";
import { WhirlpoolData } from "../../types/public";
import { getAssociatedTokenAddressSync } from "../../utils/spl-token-utils";
import { convertListToMap } from "../../utils/txn-utils";

/**
 * Parameters to resolve ATAs for affliated tokens in a list of Whirlpools
 *
 * @category Instruction Types
 * @param whirlpools - The list of WhirlpoolData to generate affliated tokens for.
 * @param destinationWallet - the wallet to generate ATAs against
 * @param payer - The payer address that would pay for the creation of ATA addresses
 */
export type ResolveAtaInstructionParams = {
  whirlpools: (WhirlpoolData | null)[];
  receiver?: PublicKey;
  payer?: PublicKey;
};

/**
 * An interface of mapping between tokenMint & ATA & the instruction set to initialize them.
 *
 * @category Instruction Types
 * @param ataTokenAddresses - A record between the token mint & generated ATA addresses
 * @param resolveAtaIxs - An array of instructions to initialize all uninitialized ATA token accounts for the list above.
 */
export type ResolvedATAInstructionSet = {
  ataTokenAddresses: Record<string, PublicKey>;
  resolveAtaIxs: Instruction[];
};

/**
 * Build instructions to resolve ATAs (Associated Tokens Addresses) for affliated tokens in a list of Whirlpools.
 * Affliated tokens are tokens that are part of the trade pair or reward in a Whirlpool.
 *
 * SOL tokens does not use the ATA program and therefore not handled.
 *
 * @param ctx - WhirlpoolContext object for the current environment.

 * @returns a ResolvedTokenAddressesIxSet containing the derived ATA addresses & ix set to initialize the accounts.
 */
export async function resolveAtaForWhirlpoolsIxs(
  ctx: WhirlpoolContext,
  params: ResolveAtaInstructionParams
): Promise<ResolvedATAInstructionSet> {
  const { whirlpools, receiver, payer } = params;
  const receiverKey = receiver ?? ctx.wallet.publicKey;
  const payerKey = payer ?? ctx.wallet.publicKey;
  const { affliatedTokenAtaMap, affliatedTokensInfoMap } = await getAffliatedTokenAtas(
    ctx,
    whirlpools,
    receiverKey
  );

  const tokensRequiringAtaResolve = Object.fromEntries(
    Object.entries(affliatedTokensInfoMap)
      .filter(([, account]) => !account)
      .map(([mint]) => [mint, affliatedTokenAtaMap[mint]])
  );

  const resolveAtaIxs: Instruction[] = [];

  Object.entries(tokensRequiringAtaResolve).forEach(([mint, ataKey]) => {
    const createAtaInstruction = Token.createAssociatedTokenAccountInstruction(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      new PublicKey(mint),
      ataKey,
      receiverKey,
      payerKey
    );
    resolveAtaIxs.push({
      instructions: [createAtaInstruction],
      cleanupInstructions: [],
      signers: [],
    });
  });

  return {
    ataTokenAddresses: affliatedTokenAtaMap,
    resolveAtaIxs,
  };
}

async function getAffliatedTokenAtas(
  ctx: WhirlpoolContext,
  whirlpoolDatas: (WhirlpoolData | null)[],
  wallet: PublicKey
) {
  const affliatedTokens = Array.from(
    whirlpoolDatas.reduce<Set<string>>((accu, whirlpoolData) => {
      if (whirlpoolData) {
        const { tokenMintA, tokenMintB } = whirlpoolData;
        if (!TokenUtil.isNativeMint(tokenMintA)) {
          accu.add(tokenMintA.toBase58());
        }

        if (!TokenUtil.isNativeMint(tokenMintB)) {
          accu.add(tokenMintB.toBase58());
        }

        const rewardInfos = whirlpoolData.rewardInfos;
        rewardInfos.forEach((reward) => {
          if (!reward.mint.equals(PublicKey.default)) {
            accu.add(reward.mint.toBase58());
          }
        });
      }
      return accu;
    }, new Set<string>())
  );

  const tokenMintInfoMap = convertListToMap(
    await ctx.fetcher.listMintInfos(affliatedTokens, false),
    affliatedTokens
  );

  // Derive associated addresses for all affliated spl-tokens
  const affliatedTokenAtaMap = Object.fromEntries(
    Object.keys(tokenMintInfoMap).map((addr) => [
      addr,
      getAssociatedTokenAddressSync(addr, wallet.toBase58()),
    ])
  );

  return {
    affliatedTokenAtaMap: affliatedTokenAtaMap,
    affliatedTokensInfoMap: convertListToMap(
      await ctx.fetcher.listTokenInfos(Object.values(affliatedTokenAtaMap), false),
      Object.keys(affliatedTokenAtaMap)
    ),
  };
}
