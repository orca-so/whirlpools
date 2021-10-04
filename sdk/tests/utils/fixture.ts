import { PublicKey, Keypair } from "@solana/web3.js";
import { u64 } from "@solana/spl-token";
import { getStartTickIndex, InitPoolParams, WhirlpoolClient } from "../../src";
import {
  FundedPositionInfo,
  FundedPositionParams,
  fundPositions,
  initRewardAndSetEmissions,
  initTestPoolWithTokens,
  initTickArray,
} from "./init-utils";
import { BN } from "@project-serum/anchor";
import { TickSpacing, ZERO_BN } from ".";

interface InitFixtureParams {
  tickSpacing: number;
  initialSqrtPrice?: BN;
  positions?: FundedPositionParams[];
  rewards?: RewardParam[];
}

interface RewardParam {
  emissionsPerSecondX64: BN;
  vaultAmount: u64;
}

interface InitializedRewardInfo {
  rewardMint: PublicKey;
  rewardVaultKeypair: Keypair;
}

export class WhirlpoolTestFixture {
  private client: WhirlpoolClient;
  private poolInitInfo = defaultPoolInitInfo;
  private configInitInfo = defaultConfigInitInfo;
  private configKeypairs = defaultConfigKeypairs;
  private positions: FundedPositionInfo[] = [];
  private rewards: InitializedRewardInfo[] = [];
  private tokenAccountA = PublicKey.default;
  private tokenAccountB = PublicKey.default;
  private initialized = false;

  constructor(client: WhirlpoolClient) {
    this.client = client;
  }

  async init(params: InitFixtureParams): Promise<WhirlpoolTestFixture> {
    const { tickSpacing, initialSqrtPrice, positions, rewards } = params;

    const { poolInitInfo, configInitInfo, configKeypairs, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(this.client, tickSpacing, initialSqrtPrice);

    this.poolInitInfo = poolInitInfo;
    this.configInitInfo = configInitInfo;
    this.configKeypairs = configKeypairs;
    this.tokenAccountA = tokenAccountA;
    this.tokenAccountB = tokenAccountB;

    if (positions) {
      await initTickArrays(this.client, poolInitInfo, positions);

      this.positions = await fundPositions(
        this.client,
        poolInitInfo,
        tokenAccountA,
        tokenAccountB,
        positions
      );
    }

    if (rewards) {
      const initRewards: InitializedRewardInfo[] = [];
      for (let i = 0; i < rewards.length; i++) {
        // Iterate because we enforce sequential initialization on the smart contract
        initRewards.push(
          await initRewardAndSetEmissions(
            this.client,
            configKeypairs.rewardEmissionsSuperAuthorityKeypair,
            poolInitInfo.whirlpoolPda.publicKey,
            i,
            rewards[i].vaultAmount,
            rewards[i].emissionsPerSecondX64
          )
        );
      }
      this.rewards = initRewards;
    }
    this.initialized = true;
    return this;
  }

  getInfos() {
    if (!this.initialized) {
      throw new Error("Test fixture is not initialized");
    }
    return {
      poolInitInfo: this.poolInitInfo,
      configInitInfo: this.configInitInfo,
      configKeypairs: this.configKeypairs,
      tokenAccountA: this.tokenAccountA,
      tokenAccountB: this.tokenAccountB,
      positions: this.positions,
      rewards: this.rewards,
    };
  }
}

async function initTickArrays(
  client: WhirlpoolClient,
  poolInitInfo: InitPoolParams,
  positions: FundedPositionParams[]
) {
  const startTickSet = new Set<number>();
  positions.forEach((p) => {
    startTickSet.add(getStartTickIndex(p.tickLowerIndex, poolInitInfo.tickSpacing));
    startTickSet.add(getStartTickIndex(p.tickUpperIndex, poolInitInfo.tickSpacing));
  });

  return Promise.all(
    Array.from(startTickSet).map((startTick) =>
      initTickArray(client, poolInitInfo.whirlpoolPda.publicKey, startTick)
    )
  );
}

const defaultPoolInitInfo = {
  initSqrtPrice: ZERO_BN,
  whirlpoolConfigKey: PublicKey.default,
  tokenMintA: PublicKey.default,
  tokenMintB: PublicKey.default,
  whirlpoolPda: { publicKey: PublicKey.default, bump: 0 },
  tokenVaultAKeypair: Keypair.generate(),
  tokenVaultBKeypair: Keypair.generate(),
  tickSpacing: TickSpacing.Standard,
  funder: PublicKey.default,
};

const defaultConfigInitInfo = {
  whirlpoolConfigKeypair: Keypair.generate(),
  feeAuthority: PublicKey.default,
  collectProtocolFeesAuthority: PublicKey.default,
  rewardEmissionsSuperAuthority: PublicKey.default,
  defaultProtocolFeeRate: 0,
  funder: PublicKey.default,
};

const defaultConfigKeypairs = {
  feeAuthorityKeypair: Keypair.generate(),
  collectProtocolFeesAuthorityKeypair: Keypair.generate(),
  rewardEmissionsSuperAuthorityKeypair: Keypair.generate(),
};
