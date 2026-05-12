import type { WhirlpoolDeployment } from "@orca-so/whirlpools-client";
import {
  DEFAULT_WHIRLPOOL_DEPLOYMENT,
  fetchPosition,
  fetchWhirlpool,
  getPositionAddress,
  getResetPositionRangeInstruction,
} from "@orca-so/whirlpools-client";
import type {
  Address,
  GetAccountInfoApi,
  Rpc,
  Instruction,
  TransactionSigner,
  GetMultipleAccountsApi,
} from "@solana/kit";
import { DEFAULT_ADDRESS, FUNDER } from "./config";
import {
  fetchAllMint,
  fetchMaybeMint,
  findAssociatedTokenPda,
} from "@solana-program/token-2022";
import assert from "assert";
import {
  getInitializableTickIndex,
  priceToTickIndex,
} from "@orca-so/whirlpools-core";

/**
 * Represents the instructions for resetting a position range.
 */
export type ResetPositionRangeInstructions = {
  instructions: Instruction[];
};

/** @deprecated Use {@link ResetPositionRangeInstructions} instead. */
export type ResetPositionRageInstructions = ResetPositionRangeInstructions;

/**
 * Options for {@link resetPositionRangeInstructions}.
 */
export type ResetPositionRangeConfig = {
  authority?: TransactionSigner<string>;
  whirlpoolDeployment?: WhirlpoolDeployment;
};

/**
 * Generates instructions to reset a position range.
 */
export async function resetPositionRangeInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>,
  positionMintAddress: Address,
  newLowerPrice: number,
  newUpperPrice: number,
  config: ResetPositionRangeConfig = {},
): Promise<ResetPositionRangeInstructions> {
  const authority = config.authority ?? FUNDER;
  const whirlpoolDeployment =
    config.whirlpoolDeployment ?? DEFAULT_WHIRLPOOL_DEPLOYMENT;

  assert(
    authority.address !== DEFAULT_ADDRESS,
    "Either supply an authority or set the default funder",
  );

  const instructions: Instruction[] = [];

  const positionAddress = await getPositionAddress(
    positionMintAddress,
    whirlpoolDeployment.programId,
  );
  const position = await fetchPosition(rpc, positionAddress[0]);
  const positionMint = await fetchMaybeMint(rpc, position.data.positionMint);

  assert(positionMint.exists, "Position mint not found");
  assert(position.data.liquidity === BigInt(0), "Position must be empty");

  const positionTokenAccount = await findAssociatedTokenPda({
    owner: authority.address,
    mint: positionMintAddress,
    tokenProgram: positionMint.programAddress,
  });
  const whirlpool = await fetchWhirlpool(rpc, position.data.whirlpool);
  const tickSpacing = whirlpool.data.tickSpacing;

  const [tokenA, tokenB] = await fetchAllMint(rpc, [
    whirlpool.data.tokenMintA,
    whirlpool.data.tokenMintB,
  ]);

  const newLowerTickIndex = priceToTickIndex(
    newLowerPrice,
    tokenA.data.decimals,
    tokenB.data.decimals,
  );
  const newUpperTickIndex = priceToTickIndex(
    newUpperPrice,
    tokenA.data.decimals,
    tokenB.data.decimals,
  );

  const newInitializableTickLowerIndex = getInitializableTickIndex(
    newLowerTickIndex,
    tickSpacing,
    false,
  );
  const newInitializableTickUpperIndex = getInitializableTickIndex(
    newUpperTickIndex,
    tickSpacing,
    true,
  );

  instructions.push(
    getResetPositionRangeInstruction(
      {
        funder: authority,
        positionAuthority: authority,
        position: position.address,
        positionTokenAccount: positionTokenAccount[0],
        newTickLowerIndex: newInitializableTickLowerIndex,
        newTickUpperIndex: newInitializableTickUpperIndex,
        whirlpool: position.data.whirlpool,
      },
      { programAddress: whirlpoolDeployment.programId },
    ),
  );

  return {
    instructions,
  };
}
