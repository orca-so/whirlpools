import type {
  CollectFeesQuote,
  CollectRewardsQuote,
  WhirlpoolFacade,
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
  TransactionPartialSigner,
  GetMultipleAccountsApi,
  GetMinimumBalanceForRentExemptionApi,
  GetEpochInfoApi,
} from "@solana/web3.js";
import invariant from "tiny-invariant";
import { DEFAULT_ADDRESS, DEFAULT_FUNDER } from "./config";
import type {
  Whirlpool} from "@orca-so/whirlpools-client";
import {
  fetchAllTickArray,
  fetchPosition,
  fetchWhirlpool,
  getCollectFeesInstruction,
  getCollectFeesV2Instruction,
  getCollectRewardInstruction,
  getCollectRewardV2Instruction,
  getPositionAddress,
  getTickArrayAddress,
  getUpdateFeesAndRewardsInstruction
} from "@orca-so/whirlpools-client";
import {
  fetchAllMint,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { getCurrentTransferFee, prepareTokenAccountsInstructions } from "./token";
import { fetchAllMaybeMint } from "@solana-program/token-2022";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";

// TODO: Transfer hook

type HarvestPositionInstructions = {
  feesQuote: CollectFeesQuote;
  rewardsQuote: CollectRewardsQuote;
  instructions: IInstruction[];
};

async function getTransferFeeConfigs(rpc: Rpc<GetMultipleAccountsApi & GetEpochInfoApi>, whirlpool: Whirlpool) {
  const currentEpoch = await rpc.getEpochInfo().send();
  const mintAddresses = [
    whirlpool.tokenMintA,
    whirlpool.tokenMintB,
    whirlpool.rewardInfos[0].mint,
    whirlpool.rewardInfos[1].mint,
    whirlpool.rewardInfos[2].mint,
  ];

  const mints = await fetchAllMaybeMint(rpc, mintAddresses);
  const [tokenA, tokenB, reward1, reward2, reward3] = mints.map((x) => x.exists ? getCurrentTransferFee(x.data, currentEpoch.epoch) : undefined);
  return {
    tokenA,
    tokenB,
    reward1,
    reward2,
    reward3,
  };
}

export async function harvestPositionInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  positionMintAddress: Address,
  authority: TransactionPartialSigner = DEFAULT_FUNDER,
): Promise<HarvestPositionInstructions> {
  invariant(
    authority.address !== DEFAULT_ADDRESS,
    "Either supply an authority or set the default funder",
  );
  const instructions: IInstruction[] = [];

  const positionAddress = await getPositionAddress(positionMintAddress);
  const position = await fetchPosition(rpc, positionAddress[0]);
  const whirlpool = await fetchWhirlpool(rpc, position.data.whirlpool);
  const [mintA, mintB, positionMint] = await fetchAllMint(rpc, [
    whirlpool.data.tokenMintA,
    whirlpool.data.tokenMintB,
    positionMintAddress,
  ]);

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

  const lowerTick = lowerTickArray.data.ticks[getTickIndexInArray(position.data.tickLowerIndex, lowerTickArrayStartIndex, whirlpool.data.tickSpacing)];
  const upperTick = upperTickArray.data.ticks[getTickIndexInArray(position.data.tickUpperIndex, upperTickArrayStartIndex, whirlpool.data.tickSpacing)];

  const transferFees = await getTransferFeeConfigs(rpc, whirlpool.data);

  const feesQuote = collectFeesQuote(
    whirlpool.data,
    position.data,
    lowerTick,
    upperTick,
    transferFees.tokenA,
    transferFees.tokenB,
  );
  const currentUnixTimestamp = BigInt(Math.floor(Date.now() / 1000));
  const rewardsQuote = collectRewardsQuote(
    whirlpool.data,
    position.data,
    lowerTick,
    upperTick,
    currentUnixTimestamp,
    transferFees.reward1,
    transferFees.reward2,
    transferFees.reward3,
  );

  // FIXME: this creates the accounts even if they are not actually needed
  // (no rewards, fees, to decrease liquidity, etc.)
  const { createInstructions, cleanupInstructions, tokenAccountAddresses } =
    await prepareTokenAccountsInstructions(rpc, authority, [
      whirlpool.data.tokenMintA,
      whirlpool.data.tokenMintB,
      whirlpool.data.rewardInfos[0].mint,
      whirlpool.data.rewardInfos[1].mint,
      whirlpool.data.rewardInfos[2].mint,
    ].filter(x => x !== DEFAULT_ADDRESS));

  instructions.push(...createInstructions);

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

  if (rewardsQuote.rewardOwed1 > 0) {
    instructions.push(
      getCollectRewardV2Instruction({
        whirlpool: whirlpool.address,
        positionAuthority: authority,
        position: positionAddress[0],
        positionTokenAccount,
        rewardOwnerAccount:
          tokenAccountAddresses[whirlpool.data.rewardInfos[0].mint],
        rewardVault: whirlpool.data.rewardInfos[0].vault,
        rewardIndex: 0,
        rewardMint: whirlpool.data.rewardInfos[0].mint,
        rewardTokenProgram: whirlpool.data.rewardInfos[0].programAddress,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        remainingAccountsInfo: null,
      }),
    );
  }

  if (rewardsQuote.rewardOwed2 > 0) {
    instructions.push(
      getCollectRewardV2Instruction({
        whirlpool: whirlpool.address,
        positionAuthority: authority,
        position: positionAddress[0],
        positionTokenAccount,
        rewardOwnerAccount:
          tokenAccountAddresses[whirlpool.data.rewardInfos[1].mint],
        rewardVault: whirlpool.data.rewardInfos[1].vault,
        rewardIndex: 1,
        rewardMint: whirlpool.data.rewardInfos[1].mint,
        rewardTokenProgram: whirlpool.data.rewardInfos[1].programAddress,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        remainingAccountsInfo: null,
      }),
    );
  }

  if (rewardsQuote.rewardOwed3 > 0) {
    instructions.push(
      getCollectRewardV2Instruction({
        whirlpool: whirlpool.address,
        positionAuthority: authority,
        position: positionAddress[0],
        positionTokenAccount,
        rewardOwnerAccount:
          tokenAccountAddresses[whirlpool.data.rewardInfos[2].mint],
        rewardVault: whirlpool.data.rewardInfos[2].vault,
        rewardIndex: 2,
        rewardMint: whirlpool.data.rewardInfos[2].mint,
        rewardTokenProgram: whirlpool.data.rewardInfos[2].programAddress,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        remainingAccountsInfo: null,
      }),
    );
  }

  instructions.push(
    getUpdateFeesAndRewardsInstruction({
      whirlpool: whirlpool.address,
      position: positionAddress[0],
      tickArrayLower: lowerTickArrayAddress,
      tickArrayUpper: upperTickArrayAddress,
    })
  )

  instructions.push(...cleanupInstructions);

  return {
    feesQuote,
    rewardsQuote,
    instructions,
  };
}
