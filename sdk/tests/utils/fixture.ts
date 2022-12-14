import { PublicKey, Keypair } from "@solana/web3.js";
import { u64 } from "@solana/spl-token";
import { InitConfigParams, InitPoolParams, TickUtil, WhirlpoolContext } from "../../src";
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
  tokenAIsNative?: boolean;
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
  private ctx: WhirlpoolContext;
  private poolInitInfo: InitPoolParams = defaultPoolInitInfo;
  private configInitInfo: InitConfigParams = defaultConfigInitInfo;
  private configKeypairs = defaultConfigKeypairs;
  private positions: FundedPositionInfo[] = [];
  private rewards: InitializedRewardInfo[] = [];
  private tokenAccountA = PublicKey.default;
  private tokenAccountB = PublicKey.default;
  private initialized = false;

  constructor(ctx: WhirlpoolContext) {
    this.ctx = ctx;
  }

  async init(params: InitFixtureParams): Promise<WhirlpoolTestFixture> {
    const { tickSpacing, initialSqrtPrice, positions, rewards, tokenAIsNative } = params;

    const { poolInitInfo, configInitInfo, configKeypairs, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(
        this.ctx,
        tickSpacing,
        initialSqrtPrice,
        undefined,
        tokenAIsNative
      );

    this.poolInitInfo = poolInitInfo;
    this.configInitInfo = configInitInfo;
    this.configKeypairs = configKeypairs;
    this.tokenAccountA = tokenAccountA;
    this.tokenAccountB = tokenAccountB;

    if (positions) {
      await initTickArrays(this.ctx, poolInitInfo, positions);

      this.positions = await fundPositions(
        this.ctx,
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
            this.ctx,
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
  ctx: WhirlpoolContext,
  poolInitInfo: InitPoolParams,
  positions: FundedPositionParams[]
) {
  const startTickSet = new Set<number>();
  positions.forEach((p) => {
    startTickSet.add(TickUtil.getStartTickIndex(p.tickLowerIndex, poolInitInfo.tickSpacing));
    startTickSet.add(TickUtil.getStartTickIndex(p.tickUpperIndex, poolInitInfo.tickSpacing));
  });

  return Promise.all(
    Array.from(startTickSet).map((startTick) =>
      initTickArray(ctx, poolInitInfo.whirlpoolPda.publicKey, startTick)
    )
  );
}

const defaultPoolInitInfo: InitPoolParams = {
  initSqrtPrice: ZERO_BN,
  whirlpoolsConfig: PublicKey.default,
  tokenMintA: PublicKey.default,
  tokenMintB: PublicKey.default,
  whirlpoolPda: { publicKey: PublicKey.default, bump: 0 },
  tokenVaultAKeypair: Keypair.generate(),
  tokenVaultBKeypair: Keypair.generate(),
  tickSpacing: TickSpacing.Standard,
  feeTierKey: PublicKey.default,
  funder: PublicKey.default,
};

const defaultConfigInitInfo = {
  whirlpoolsConfigKeypair: Keypair.generate(),
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
