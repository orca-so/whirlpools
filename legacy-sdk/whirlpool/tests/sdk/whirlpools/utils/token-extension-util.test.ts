import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { MathUtil, MintWithTokenProgram } from "@orca-so/common-sdk";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  IGNORE_CACHE,
  TokenExtensionUtil,
  WhirlpoolContext,
} from "../../../../src";
import {
  TickSpacing,
} from "../../../utils";
import { defaultConfirmOptions } from "../../../utils/const";
import { WhirlpoolTestFixtureV2 } from "../../../utils/v2/fixture-v2";

describe("TokenExtensionUtil tests", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);

  let fixture: WhirlpoolTestFixtureV2;

  function partialEqualsTokenMintWithPrograml(
    a: MintWithTokenProgram,
    b: MintWithTokenProgram,
  ): boolean {
    if (!a.address.equals(b.address)) return false;
    if (!a.tokenProgram.equals(b.tokenProgram)) return false;
    if (a.decimals !== b.decimals) return false;
    if (!a.tlvData.equals(b.tlvData)) return false;
    return true;
  }

  before(async () => {
    const vaultStartBalance = 1_000_000;
    const lowerTickIndex = -1280,
      upperTickIndex = 1280,
      tickSpacing = TickSpacing.Standard;
    fixture = await new WhirlpoolTestFixtureV2(ctx).init({
      tokenTraitA: { isToken2022: true },
      tokenTraitB: { isToken2022: false },
      tickSpacing: tickSpacing,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [
        {
          tickLowerIndex: lowerTickIndex,
          tickUpperIndex: upperTickIndex,
          liquidityAmount: new anchor.BN(1_000_000),
        },
      ],
      rewards: [
        {
          rewardTokenTrait: { isToken2022: true, hasConfidentialTransferExtension: true },
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
          vaultAmount: new BN(vaultStartBalance),
        },
        {
          rewardTokenTrait: { isToken2022: true, hasConfidentialTransferExtension: true },
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
          vaultAmount: new BN(vaultStartBalance),
        },
        {
          rewardTokenTrait: { isToken2022: true, hasConfidentialTransferExtension: true },
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
          vaultAmount: new BN(vaultStartBalance),
        },
      ],
    });
  });

  it("buildTokenExtensionContextForPool", async () => {
    const poolInitInfo = fixture.getInfos().poolInitInfo;
    const { tokenMintA, tokenMintB } = poolInitInfo;

    const whirlpoolData = await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey);

    const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(
      fetcher,
      whirlpoolData!,
      IGNORE_CACHE,
    )
    const tokenExtensionCtxForPool = await TokenExtensionUtil.buildTokenExtensionContextForPool(
      fetcher,
      tokenMintA,
      tokenMintB,
      IGNORE_CACHE,
    );

    assert.ok(partialEqualsTokenMintWithPrograml(
      tokenExtensionCtx.tokenMintWithProgramA,
      tokenExtensionCtxForPool.tokenMintWithProgramA,
    ));
    assert.ok(partialEqualsTokenMintWithPrograml(
      tokenExtensionCtx.tokenMintWithProgramB,
      tokenExtensionCtxForPool.tokenMintWithProgramB,
    ));
  });

});
