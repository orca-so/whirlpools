import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TickSpacing, ZERO_BN } from "..";
import { InitConfigParams, InitPoolV2Params, TickUtil, WhirlpoolContext } from "../../../src";
import {
  initTickArray,
} from "../init-utils";
import {
  initRewardAndSetEmissionsV2,
  initTestPoolWithTokensV2,
  FundedPositionV2Info,
  FundedPositionV2Params,
  fundPositionsV2,
  TokenTrait,
} from "./init-utils-v2";


interface InitFixtureV2Params {
  tokenTraitA: TokenTrait;
  tokenTraitB: TokenTrait;
  tickSpacing: number;
  initialSqrtPrice?: BN;
  mintAmount?: BN;
  positions?: FundedPositionV2Params[];
  rewards?: RewardV2Param[];
}

interface RewardV2Param {
  rewardTokenTrait: TokenTrait;
  emissionsPerSecondX64: BN;
  vaultAmount: BN;
}

interface InitializedRewardV2Info {
  rewardMint: PublicKey;
  rewardVaultKeypair: Keypair;
  tokenProgram: PublicKey;
}

export class WhirlpoolTestFixtureV2 {
  private ctx: WhirlpoolContext;
  private poolInitInfo: InitPoolV2Params = defaultPoolInitInfoV2;
  private configInitInfo: InitConfigParams = defaultConfigInitInfoV2;
  private configKeypairs = defaultConfigKeypairsV2;
  private positions: FundedPositionV2Info[] = [];
  private rewards: InitializedRewardV2Info[] = [];
  private tokenAccountA = PublicKey.default;
  private tokenAccountB = PublicKey.default;
  private initialized = false;

  constructor(ctx: WhirlpoolContext) {
    this.ctx = ctx;
  }

  async init(params: InitFixtureV2Params): Promise<WhirlpoolTestFixtureV2> {
    const { tickSpacing, initialSqrtPrice, positions, rewards, tokenTraitA, tokenTraitB, mintAmount } = params;

    const { poolInitInfo, configInitInfo, configKeypairs, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokensV2(
        this.ctx,
        tokenTraitA,
        tokenTraitB,
        tickSpacing,
        initialSqrtPrice,
        mintAmount,
      );

    this.poolInitInfo = poolInitInfo;
    this.configInitInfo = configInitInfo;
    this.configKeypairs = configKeypairs;
    this.tokenAccountA = tokenAccountA;
    this.tokenAccountB = tokenAccountB;

    if (positions) {
      await initTickArraysV2(this.ctx, poolInitInfo, positions);

      this.positions = await fundPositionsV2(
        this.ctx,
        poolInitInfo,
        tokenAccountA,
        tokenAccountB,
        positions
      );
    }

    if (rewards) {
      const initRewards: InitializedRewardV2Info[] = [];
      for (let i = 0; i < rewards.length; i++) {
        // Iterate because we enforce sequential initialization on the smart contract
        initRewards.push(
          await initRewardAndSetEmissionsV2(
            this.ctx,
            rewards[i].rewardTokenTrait,
            configKeypairs.rewardEmissionsSuperAuthorityKeypair,
            poolInitInfo.whirlpoolsConfig,
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

async function initTickArraysV2(
  ctx: WhirlpoolContext,
  poolInitInfo: InitPoolV2Params,
  positions: FundedPositionV2Params[]
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

const defaultPoolInitInfoV2: InitPoolV2Params = {
  initSqrtPrice: ZERO_BN,
  whirlpoolsConfig: PublicKey.default,
  tokenProgramA: PublicKey.default,
  tokenProgramB: PublicKey.default,
  tokenMintA: PublicKey.default,
  tokenMintB: PublicKey.default,
  tokenBadgeA: PublicKey.default,
  tokenBadgeB: PublicKey.default,
  whirlpoolPda: { publicKey: PublicKey.default, bump: 0 },
  tokenVaultAKeypair: Keypair.generate(),
  tokenVaultBKeypair: Keypair.generate(),
  tickSpacing: TickSpacing.Standard,
  feeTierKey: PublicKey.default,
  funder: PublicKey.default,
};

const defaultConfigInitInfoV2 = {
  whirlpoolsConfigKeypair: Keypair.generate(),
  feeAuthority: PublicKey.default,
  collectProtocolFeesAuthority: PublicKey.default,
  rewardEmissionsSuperAuthority: PublicKey.default,
  defaultProtocolFeeRate: 0,
  funder: PublicKey.default,
};

const defaultConfigKeypairsV2 = {
  feeAuthorityKeypair: Keypair.generate(),
  collectProtocolFeesAuthorityKeypair: Keypair.generate(),
  rewardEmissionsSuperAuthorityKeypair: Keypair.generate(),
};
