import type {
  CollectFeesQuote,
  CollectRewardsQuote,
} from "@orca-so/whirlpools-core";
import {
  collectFeesQuote,
  collectRewardsQuote,
  getTickArrayStartTickIndex,
  getTickIndexInArray,
} from "@orca-so/whirlpools-core";
import type {
  Rpc,
  GetAccountInfoApi,
  Address,
  IInstruction,
  TransactionSigner,
  GetMultipleAccountsApi,
  GetMinimumBalanceForRentExemptionApi,
  GetEpochInfoApi,
} from "@solana/web3.js";
import { DEFAULT_ADDRESS, FUNDER } from "./config";
import {
  fetchAllTickArray,
  fetchPosition,
  fetchWhirlpool,
  getCollectFeesV2Instruction,
  getCollectRewardV2Instruction,
  getPositionAddress,
  getTickArrayAddress,
  getUpdateFeesAndRewardsInstruction,
} from "@orca-so/whirlpools-client";
import { findAssociatedTokenPda } from "@solana-program/token";
import {
  getCurrentTransferFee,
  prepareTokenAccountsInstructions,
} from "./token";
import { fetchAllMaybeMint } from "@solana-program/token-2022";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import assert from "assert";

// TODO: Transfer hook

/**
 * Represents the instructions and quotes for harvesting a position.
 */
export type HarvestPositionInstructions = {
  /** A breakdown of the fees owed to the position owner, detailing the amounts for token A (`fee_owed_a`) and token B (`fee_owed_b`). */
  feesQuote: CollectFeesQuote;

  /** A breakdown of the rewards owed, detailing up to three reward tokens (`reward_owed_1`, `reward_owed_2`, and `reward_owed_3`). */
  rewardsQuote: CollectRewardsQuote;

  /** A list of instructions required to harvest the position. */
  instructions: IInstruction[];
};

/**
 * This function creates a set of instructions that collect any accumulated fees and rewards from a position.
 * The liquidity remains in place, and the position stays open.
 *
 * @param {SolanaRpc} rpc
 *    A Solana RPC client used to interact with the blockchain.
 * @param {Address} positionMintAddress
 *    The position mint address you want to harvest fees and rewards from.
 * @param {TransactionSigner} [authority=FUNDER]
 *    The account that authorizes the transaction. Defaults to a predefined funder.
 *
 * @returns {Promise<HarvestPositionInstructions>}
 *    A promise that resolves to an object containing the instructions, fees, and rewards quotes.
 * @example
 * import { harvestPositionInstructions } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet } from '@solana/web3.js';
 *
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner();
 * await devnetRpc.requestAirdrop(wallet.address, lamports(1000000000n)).send();
 *
 * const positionMint = "POSITION_MINT";
 *
 * const { feesQuote, rewardsQuote, instructions } = await harvestPositionInstructions(
 *   devnetRpc,
 *   positionMint,
 *   wallet
 * );
 */
export async function harvestPositionInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi &
      GetEpochInfoApi
  >,
  positionMintAddress: Address,
  authority: TransactionSigner = FUNDER,
): Promise<HarvestPositionInstructions> {
  assert(
    authority.address !== DEFAULT_ADDRESS,
    "Either supply an authority or set the default funder",
  );

  const currentEpoch = await rpc.getEpochInfo().send();
  const positionAddress = await getPositionAddress(positionMintAddress);
  const position = await fetchPosition(rpc, positionAddress[0]);
  const whirlpool = await fetchWhirlpool(rpc, position.data.whirlpool);
  const [mintA, mintB, positionMint, ...rewardMints] = await fetchAllMaybeMint(
    rpc,
    [
      whirlpool.data.tokenMintA,
      whirlpool.data.tokenMintB,
      positionMintAddress,
      ...whirlpool.data.rewardInfos
        .map((x) => x.mint)
        .filter((x) => x !== DEFAULT_ADDRESS),
    ],
  );

  assert(mintA.exists, "Token A not found");
  assert(mintB.exists, "Token B not found");
  assert(positionMint.exists, "Position mint not found");

  const lowerTickArrayStartIndex = getTickArrayStartTickIndex(
    position.data.tickLowerIndex,
    whirlpool.data.tickSpacing,
  );
  const upperTickArrayStartIndex = getTickArrayStartTickIndex(
    position.data.tickUpperIndex,
    whirlpool.data.tickSpacing,
  );

  const [positionTokenAccount, lowerTickArrayAddress, upperTickArrayAddress] =
    await Promise.all([
      findAssociatedTokenPda({
        owner: authority.address,
        mint: positionMintAddress,
        tokenProgram: positionMint.programAddress,
      }).then((x) => x[0]),
      getTickArrayAddress(whirlpool.address, lowerTickArrayStartIndex).then(
        (x) => x[0],
      ),
      getTickArrayAddress(whirlpool.address, upperTickArrayStartIndex).then(
        (x) => x[0],
      ),
    ]);

  const [lowerTickArray, upperTickArray] = await fetchAllTickArray(rpc, [
    lowerTickArrayAddress,
    upperTickArrayAddress,
  ]);

  const lowerTick =
    lowerTickArray.data.ticks[
      getTickIndexInArray(
        position.data.tickLowerIndex,
        lowerTickArrayStartIndex,
        whirlpool.data.tickSpacing,
      )
    ];
  const upperTick =
    upperTickArray.data.ticks[
      getTickIndexInArray(
        position.data.tickUpperIndex,
        upperTickArrayStartIndex,
        whirlpool.data.tickSpacing,
      )
    ];

  const feesQuote = collectFeesQuote(
    whirlpool.data,
    position.data,
    lowerTick,
    upperTick,
    getCurrentTransferFee(mintA, currentEpoch.epoch),
    getCurrentTransferFee(mintB, currentEpoch.epoch),
  );
  const currentUnixTimestamp = BigInt(Math.floor(Date.now() / 1000));
  const rewardsQuote = collectRewardsQuote(
    whirlpool.data,
    position.data,
    lowerTick,
    upperTick,
    currentUnixTimestamp,
    getCurrentTransferFee(rewardMints[0], currentEpoch.epoch),
    getCurrentTransferFee(rewardMints[1], currentEpoch.epoch),
    getCurrentTransferFee(rewardMints[2], currentEpoch.epoch),
  );

  const requiredMints: Address[] = [];
  if (feesQuote.feeOwedA > 0n || feesQuote.feeOwedB > 0n) {
    requiredMints.push(whirlpool.data.tokenMintA);
    requiredMints.push(whirlpool.data.tokenMintB);
  }
  if (rewardsQuote.rewards[0].rewardsOwed > 0n) {
    requiredMints.push(whirlpool.data.rewardInfos[0].mint);
  }
  if (rewardsQuote.rewards[1].rewardsOwed > 0n) {
    requiredMints.push(whirlpool.data.rewardInfos[1].mint);
  }
  if (rewardsQuote.rewards[2].rewardsOwed > 0n) {
    requiredMints.push(whirlpool.data.rewardInfos[2].mint);
  }

  const { createInstructions, cleanupInstructions, tokenAccountAddresses } =
    await prepareTokenAccountsInstructions(rpc, authority, requiredMints);

  const instructions: IInstruction[] = [];
  instructions.push(...createInstructions);

  if (position.data.liquidity > 0n) {
    instructions.push(
      getUpdateFeesAndRewardsInstruction({
        whirlpool: whirlpool.address,
        position: positionAddress[0],
        tickArrayLower: lowerTickArrayAddress,
        tickArrayUpper: upperTickArrayAddress,
      }),
    );
  }

  if (feesQuote.feeOwedA > 0n || feesQuote.feeOwedB > 0n) {
    instructions.push(
      getCollectFeesV2Instruction({
        whirlpool: whirlpool.address,
        positionAuthority: authority,
        position: positionAddress[0],
        positionTokenAccount,
        tokenOwnerAccountA: tokenAccountAddresses[whirlpool.data.tokenMintA],
        tokenOwnerAccountB: tokenAccountAddresses[whirlpool.data.tokenMintB],
        tokenVaultA: whirlpool.data.tokenVaultA,
        tokenVaultB: whirlpool.data.tokenVaultB,
        tokenMintA: whirlpool.data.tokenMintA,
        tokenMintB: whirlpool.data.tokenMintB,
        tokenProgramA: mintA.programAddress,
        tokenProgramB: mintB.programAddress,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        remainingAccountsInfo: null,
      }),
    );
  }

  for (let i = 0; i < rewardsQuote.rewards.length; i++) {
    if (rewardsQuote.rewards[i].rewardsOwed === 0n) {
      continue;
    }
    const rewardMint = rewardMints[i];
    assert(rewardMint.exists, `Reward mint ${i} not found`);
    instructions.push(
      getCollectRewardV2Instruction({
        whirlpool: whirlpool.address,
        positionAuthority: authority,
        position: positionAddress[0],
        positionTokenAccount,
        rewardOwnerAccount: tokenAccountAddresses[rewardMint.address],
        rewardVault: whirlpool.data.rewardInfos[i].vault,
        rewardIndex: i,
        rewardMint: rewardMint.address,
        rewardTokenProgram: rewardMint.programAddress,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        remainingAccountsInfo: null,
      }),
    );
  }

  instructions.push(...cleanupInstructions);

  return {
    feesQuote,
    rewardsQuote,
    instructions,
  };
}
