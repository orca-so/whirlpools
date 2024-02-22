import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import { toTx, WhirlpoolContext, WhirlpoolData, WhirlpoolIx } from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { ONE_SOL, systemTransferTx, TickSpacing } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { TokenTrait } from "../../utils/v2/init-utils-v2";
import { initTestPoolV2, initializeRewardV2 } from "../../utils/v2/init-utils-v2";
import { asyncAssertOwnerProgram, createMintV2 } from "../../utils/v2/token-2022";
import { TEST_TOKEN_2022_PROGRAM_ID, TEST_TOKEN_PROGRAM_ID } from "../../utils";

describe("initialize_reward_v2", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  const tokenTraitVariations: {tokenTraitAB: TokenTrait, tokenTraitR: TokenTrait}[] = [
    {tokenTraitAB: {isToken2022: false}, tokenTraitR: {isToken2022: false} },
    {tokenTraitAB: {isToken2022: true}, tokenTraitR: {isToken2022: false} },
    {tokenTraitAB: {isToken2022: false}, tokenTraitR: {isToken2022: true} },
    {tokenTraitAB: {isToken2022: true}, tokenTraitR: {isToken2022: true} },
  ];
  tokenTraitVariations.forEach((tokenTraits) => {
    describe(`tokenTraitA/B: ${tokenTraits.tokenTraitAB.isToken2022 ? "Token2022" : "Token"}, tokenTraitReward: ${tokenTraits.tokenTraitR.isToken2022 ? "Token2022" : "Token"}`, () => {

  it("successfully initializes reward at index 0", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPoolV2(
      ctx,
      tokenTraits.tokenTraitAB,
      tokenTraits.tokenTraitAB,
      TickSpacing.Standard
    );

    const { params } = await initializeRewardV2(
      ctx,
      tokenTraits.tokenTraitR,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      0
    );

    const whirlpool = (await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
      IGNORE_CACHE
    )) as WhirlpoolData;

    assert.ok(whirlpool.rewardInfos[0].mint.equals(params.rewardMint));
    assert.ok(whirlpool.rewardInfos[0].vault.equals(params.rewardVaultKeypair.publicKey));

    await assert.rejects(
      initializeRewardV2(
        ctx,
        tokenTraits.tokenTraitR,
        configKeypairs.rewardEmissionsSuperAuthorityKeypair,
        poolInitInfo.whirlpoolPda.publicKey,
        0
      ),
      /custom program error: 0x178a/ // InvalidRewardIndex
    );

    const { params: params2 } = await initializeRewardV2(
      ctx,
      tokenTraits.tokenTraitR,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      1
    );

    const whirlpool2 = (await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
      IGNORE_CACHE
    )) as WhirlpoolData;

    assert.ok(whirlpool2.rewardInfos[0].mint.equals(params.rewardMint));
    assert.ok(whirlpool2.rewardInfos[0].vault.equals(params.rewardVaultKeypair.publicKey));
    await asyncAssertOwnerProgram(provider, whirlpool2.rewardInfos[0].vault, tokenTraits.tokenTraitR.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID);
    assert.ok(whirlpool2.rewardInfos[1].mint.equals(params2.rewardMint));
    assert.ok(whirlpool2.rewardInfos[1].vault.equals(params2.rewardVaultKeypair.publicKey));
    await asyncAssertOwnerProgram(provider, whirlpool2.rewardInfos[1].vault, tokenTraits.tokenTraitR.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID);
    assert.ok(whirlpool2.rewardInfos[2].mint.equals(anchor.web3.PublicKey.default));
    assert.ok(whirlpool2.rewardInfos[2].vault.equals(anchor.web3.PublicKey.default));
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPoolV2(
      ctx,
      tokenTraits.tokenTraitAB,
      tokenTraits.tokenTraitAB,
      TickSpacing.Standard
    );
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();
    await initializeRewardV2(
      ctx,
      tokenTraits.tokenTraitR,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      funderKeypair
    );
  });

  it("fails to initialize reward at index 1", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPoolV2(
      ctx,
      tokenTraits.tokenTraitAB,
      tokenTraits.tokenTraitAB,
      TickSpacing.Standard
    );

    await assert.rejects(
      initializeRewardV2(
        ctx,
        tokenTraits.tokenTraitR,
        configKeypairs.rewardEmissionsSuperAuthorityKeypair,
        poolInitInfo.whirlpoolPda.publicKey,
        1
      ),
      /custom program error: 0x178a/ // InvalidRewardIndex
    );
  });

  it("fails to initialize reward at out-of-bound index", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPoolV2(
      ctx,
      tokenTraits.tokenTraitAB,
      tokenTraits.tokenTraitAB,
      TickSpacing.Standard
    );

    await assert.rejects(
      initializeRewardV2(
        ctx,
        tokenTraits.tokenTraitR,
        configKeypairs.rewardEmissionsSuperAuthorityKeypair,
        poolInitInfo.whirlpoolPda.publicKey,
        3
      )
    );
  });

  it("fails to initialize if authority signature is missing", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPoolV2(
      ctx,
      tokenTraits.tokenTraitAB,
      tokenTraits.tokenTraitAB,
      TickSpacing.Standard
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.initializeRewardV2Ix(ctx.program, {
          rewardAuthority: configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          funder: provider.wallet.publicKey,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardMint: await createMintV2(provider, tokenTraits.tokenTraitR),
          tokenProgram: tokenTraits.tokenTraitR.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID,
          rewardVaultKeypair: anchor.web3.Keypair.generate(),
          rewardIndex: 0,
        })
      ).buildAndExecute()
    );
  });

});
  });

});
