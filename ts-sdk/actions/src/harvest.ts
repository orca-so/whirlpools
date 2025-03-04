import {
  getRpcConfig,
  rpcFromUrl,
  buildAndSendTransaction,
} from "@orca-so/tx-sender";
import {
  fetchPositionsForOwner,
  harvestPositionInstructions,
} from "@orca-so/whirlpools";
import { Address, IInstruction } from "@solana/kit";
import { getPayer } from "./config";
import {
  executeWhirlpoolInstruction,
  wouldExceedTransactionSize,
} from "./helpers";

// Harvest fees from all positions owned by an address
export async function harvestAllPositionFees(): Promise<string[]> {
  const { rpcUrl } = getRpcConfig();
  const rpc = rpcFromUrl(rpcUrl);
  const owner = getPayer();

  const positions = await fetchPositionsForOwner(rpc, owner.address);
  const instructionSets: IInstruction[][] = [];
  let currentInstructions: IInstruction[] = [];
  for (const position of positions) {
    if ("positionMint" in position.data) {
      const { instructions } = await harvestPositionInstructions(
        rpc,
        position.data.positionMint,
        owner
      );
      if (wouldExceedTransactionSize(currentInstructions, instructions)) {
        instructionSets.push(currentInstructions);
        currentInstructions = [...instructions];
      } else {
        currentInstructions.push(...instructions);
      }
    }
  }
  return Promise.all(
    instructionSets.map(async (instructions) => {
      let txHash = await buildAndSendTransaction(instructions, owner);
      return String(txHash);
    })
  );
}

export async function harvestPositionFees(
  positionMint: Address
): Promise<string> {
  return (
    await executeWhirlpoolInstruction(harvestPositionInstructions, positionMint)
  ).callback();
}
