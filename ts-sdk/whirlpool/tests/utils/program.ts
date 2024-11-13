import {
  getFeeTierAddress,
  getInitializeConfigInstruction,
  getInitializeFeeTierInstruction,
  getInitializePoolInstruction,
  getInitializePoolV2Instruction,
  getTokenBadgeAddress,
  getWhirlpoolAddress,
} from "@orca-so/whirlpools-client";
import type { Address, IInstruction } from "@solana/web3.js";
import { generateKeyPairSigner } from "@solana/web3.js";
import { rpc, sendTransaction, signer } from "./mockRpc";
import {
  SPLASH_POOL_TICK_SPACING,
  WHIRLPOOLS_CONFIG_ADDRESS,
} from "../../src/config";
import { tickIndexToSqrtPrice } from "@orca-so/whirlpools-core";
import { fetchMint } from "@solana-program/token";

export async function setupConfigAndFeeTiers(): Promise<Address> {
  const keypair = await generateKeyPairSigner();
  const instructions: IInstruction[] = [];

  instructions.push(
    getInitializeConfigInstruction({
      config: keypair,
      funder: signer,
      feeAuthority: signer.address,
      collectProtocolFeesAuthority: signer.address,
      rewardEmissionsSuperAuthority: signer.address,
      defaultProtocolFeeRate: 100,
    }),
  );

  const defaultFeeTierPda = await getFeeTierAddress(keypair.address, 128);
  instructions.push(
    getInitializeFeeTierInstruction({
      config: keypair.address,
      feeTier: defaultFeeTierPda[0],
      funder: signer,
      feeAuthority: signer,
      tickSpacing: 128,
      defaultFeeRate: 1000,
    }),
  );

  const concentratedFeeTierPda = await getFeeTierAddress(keypair.address, 64);
  instructions.push(
    getInitializeFeeTierInstruction({
      config: keypair.address,
      feeTier: concentratedFeeTierPda[0],
      funder: signer,
      feeAuthority: signer,
      tickSpacing: 64,
      defaultFeeRate: 300,
    }),
  );

  const splashFeeTierPda = await getFeeTierAddress(
    keypair.address,
    SPLASH_POOL_TICK_SPACING,
  );
  instructions.push(
    getInitializeFeeTierInstruction({
      config: keypair.address,
      feeTier: splashFeeTierPda[0],
      funder: signer,
      feeAuthority: signer,
      tickSpacing: SPLASH_POOL_TICK_SPACING,
      defaultFeeRate: 1000,
    }),
  );

  await sendTransaction(instructions);
  return keypair.address;
}

export async function setupWhirlpool(
  tokenA: Address,
  tokenB: Address,
  tickSpacing: number,
  config: { initialSqrtPrice?: bigint } = {},
): Promise<Address> {
  const feeTierAddress = await getFeeTierAddress(
    WHIRLPOOLS_CONFIG_ADDRESS,
    tickSpacing,
  );
  const whirlpoolAddress = await getWhirlpoolAddress(
    WHIRLPOOLS_CONFIG_ADDRESS,
    tokenA,
    tokenB,
    tickSpacing,
  );
  const vaultA = await generateKeyPairSigner();
  const vaultB = await generateKeyPairSigner();
  const badgeA = await getTokenBadgeAddress(WHIRLPOOLS_CONFIG_ADDRESS, tokenA);
  const badgeB = await getTokenBadgeAddress(WHIRLPOOLS_CONFIG_ADDRESS, tokenB);
  const mintA = await fetchMint(rpc, tokenA)
  const mintB = await fetchMint(rpc, tokenB)
  const programA = mintA.programAddress
  const programB = mintB.programAddress

  const sqrtPrice = config.initialSqrtPrice ?? tickIndexToSqrtPrice(0);

  const instructions: IInstruction[] = [];

  instructions.push(
    getInitializePoolV2Instruction({
      whirlpool: whirlpoolAddress[0],
      feeTier: feeTierAddress[0],
      tokenMintA: tokenA,
      tokenMintB: tokenB,
      tickSpacing,
      whirlpoolsConfig: WHIRLPOOLS_CONFIG_ADDRESS,
      funder: signer,
      tokenVaultA: vaultA,
      tokenVaultB: vaultB,
      tokenBadgeA: badgeA[0],
      tokenBadgeB: badgeB[0],
      tokenProgramA: programA,
      tokenProgramB: programB,
      initialSqrtPrice: sqrtPrice,
    }),
  );

  await sendTransaction(instructions);
  return whirlpoolAddress[0];
}

export async function setupPosition(
  whirlpool: Address,
  config: { tickLower?: number; tickUpper?: number; liquidity?: bigint } = {},
): Promise<Address> {
  // TODO: implement when solana-bankrun supports gpa
  const _ = config;
  return whirlpool;
}

export async function setupTEPosition(
  whirlpool: Address,
  config: { tickLower?: number; tickUpper?: number; liquidity?: bigint } = {},
): Promise<Address> {
  // TODO: implement when solana-bankrun supports gpa
  const _ = config;
  return whirlpool;
}

export async function setupPositionBundle(
  whirlpool: Address,
  config: { tickLower?: number; tickUpper?: number; liquidity?: bigint }[] = [],
): Promise<Address> {
  // TODO: implement when solana-bankrun supports gpa
  const _ = config;
  return whirlpool;
}
