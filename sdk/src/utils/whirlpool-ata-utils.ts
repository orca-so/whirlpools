import { Instruction, resolveOrCreateATAs, TokenUtil } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { WhirlpoolContext } from "..";
import { WhirlpoolData } from "../types/public";
import { convertListToMap } from "./txn-utils";

/**
 * Fetch a list of affliated tokens from a list of whirlpools
 *
 * SOL tokens does not use the ATA program and therefore not handled.
 * @param whirlpoolDatas An array of whirlpoolData (from fetcher.listPools)
 * @returns All the whirlpool, reward token mints in the given set of whirlpools
 */
export function getTokenMintsFromWhirlpools(whirlpoolDatas: (WhirlpoolData | null)[]) {
  return Array.from(
    whirlpoolDatas.reduce<Set<PublicKey>>((accu, whirlpoolData) => {
      if (whirlpoolData) {
        const { tokenMintA, tokenMintB } = whirlpoolData;
        if (!TokenUtil.isNativeMint(tokenMintA)) {
          accu.add(tokenMintA);
        }

        if (!TokenUtil.isNativeMint(tokenMintB)) {
          accu.add(tokenMintB);
        }

        const rewardInfos = whirlpoolData.rewardInfos;
        rewardInfos.forEach((reward) => {
          if (!reward.mint.equals(PublicKey.default)) {
            accu.add(reward.mint);
          }
        });
      }
      return accu;
    }, new Set<PublicKey>())
  );
}

/**
 * Parameters to resolve ATAs for affliated tokens in a list of Whirlpools
 *
 * @category Instruction Types
 * @param mints - The list of mints to generate affliated tokens for.
 * @param accountExemption - The value from the most recent getMinimumBalanceForRentExemption().
 * @param destinationWallet - the wallet to generate ATAs against
 * @param payer - The payer address that would pay for the creation of ATA addresses
 */
export type ResolveAtaInstructionParams = {
  mints: PublicKey[];
  accountExemption: number;
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
 * @param ctx - WhirlpoolContext object for the current environment.
 * @param params - ResolveAtaInstructionParams
 * @returns a ResolvedTokenAddressesIxSet containing the derived ATA addresses & ix set to initialize the accounts.
 */
export async function resolveAtaForMints(
  ctx: WhirlpoolContext,
  params: ResolveAtaInstructionParams
): Promise<ResolvedATAInstructionSet> {
  const { mints, receiver, payer, accountExemption } = params;
  const receiverKey = receiver ?? ctx.wallet.publicKey;
  const payerKey = payer ?? ctx.wallet.publicKey;

  const resolvedAtaResults = await resolveOrCreateATAs(
    ctx.connection,
    receiverKey,
    mints.map((tokenMint) => {
      return { tokenMint };
    }),
    async () => accountExemption,
    payerKey
  );

  // Convert the results back into the specified format
  const { resolveAtaIxs, resolvedAtas } = resolvedAtaResults.reduce<{
    resolvedAtas: PublicKey[];
    resolveAtaIxs: Instruction[];
  }>(
    (accu, curr) => {
      const { address, ...ix } = curr;
      accu.resolvedAtas.push(address);

      // TODO: common-sdk needs to have an easier way to check for empty instruction
      if (ix.instructions.length) {
        accu.resolveAtaIxs.push(ix);
      }
      return accu;
    },
    { resolvedAtas: [], resolveAtaIxs: [] }
  );

  const affliatedTokenAtaMap = convertListToMap(
    resolvedAtas,
    mints.map((mint) => mint.toBase58())
  );
  return {
    ataTokenAddresses: affliatedTokenAtaMap,
    resolveAtaIxs,
  };
}
