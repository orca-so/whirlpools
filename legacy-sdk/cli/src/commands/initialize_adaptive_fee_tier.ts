import { PublicKey } from "@solana/web3.js";
import { PDAUtil, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";

console.info("initialize AdaptiveFeeTier...");

// prompt
const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");
const feeTierIndexStr = await promptText("feeTierIndex");
const tickSpacingStr = await promptText("tickSpacing");
const defaultBaseFeeRatePer1000000Str = await promptText(
  "defaultBaseFeeRatePer1000000",
);

const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigPubkeyStr);
const feeTierIndex = Number.parseInt(feeTierIndexStr);
const tickSpacing = Number.parseInt(tickSpacingStr);
const defaultBaseFeeRate = Number.parseInt(defaultBaseFeeRatePer1000000Str);

// This is not contract restriction, just to reserve spaces.
if (feeTierIndex <= 1024 || feeTierIndex >= 32768) {
  throw new Error("feeTierIndex must be in the range of [1025, 32767]");
}

const pda = PDAUtil.getFeeTier(
  ctx.program.programId,
  whirlpoolsConfigPubkey,
  feeTierIndex,
);
const whirlpoolsConfig = await ctx.fetcher.getConfig(whirlpoolsConfigPubkey);

if (!whirlpoolsConfig) {
  throw new Error("whirlpoolsConfig not found");
}

if (!whirlpoolsConfig.feeAuthority.equals(ctx.wallet.publicKey)) {
  throw new Error(
    `the current wallet must be the fee authority(${whirlpoolsConfig.feeAuthority.toBase58()})`,
  );
}
const feeTier = await ctx.connection.getAccountInfo(pda.publicKey);
if (feeTier) {
  throw new Error(
    `feeTier address already initialized(${pda.publicKey.toBase58()})`,
  );
}

// prompt for other parameters
console.info("authority...");
const initializePoolAuthorityStr = await promptText("initializePoolAuthority");
const delegatedFeeAuthorityStr = await promptText("delegatedFeeAuthority");
const initializePoolAuthority = new PublicKey(initializePoolAuthorityStr);
const delegatedFeeAuthority = new PublicKey(delegatedFeeAuthorityStr);

console.info("adaptive fee constants...");
const filterPeriodStr = await promptText("filterPeriod");
const decayPeriodStr = await promptText("decayPeriod");
const reductionFactorPer10000Str = await promptText("reductionFactorPer10000");
const adaptiveFeeControlFactorPer100000Str = await promptText(
  "adaptiveFeeControlFactorPer100000",
);
const maxVolatilityAccumulatorStr = await promptText(
  "maxVolatilityAccumulator",
);
const tickGroupSizeStr = await promptText("tickGroupSize");
const majorSwapThresholdTicksStr = await promptText("majorSwapThresholdTicks");

const filterPeriod = Number.parseInt(filterPeriodStr);
const decayPeriod = Number.parseInt(decayPeriodStr);
const reductionFactorPer10000 = Number.parseInt(reductionFactorPer10000Str);
const adaptiveFeeControlFactorPer100000 = Number.parseInt(
  adaptiveFeeControlFactorPer100000Str,
);
const maxVolatilityAccumulator = Number.parseInt(maxVolatilityAccumulatorStr);
const tickGroupSize = Number.parseInt(tickGroupSizeStr);
const majorSwapThresholdTicks = Number.parseInt(majorSwapThresholdTicksStr);

console.info(
  "setting...",
  "\n\twhirlpoolsConfig",
  whirlpoolsConfigPubkey.toBase58(),
  "\n\tfeeTierIndex",
  feeTierIndex,
  "\n\ttickSpacing",
  tickSpacing,
  "\n\tdefaultBaseFeeRatePer1000000",
  defaultBaseFeeRate,
  "\n\tinitializePoolAuthority",
  initializePoolAuthority.toBase58(),
  "\n\tdelegatedFeeAuthority",
  delegatedFeeAuthority.toBase58(),
  "\n\tfilterPeriod",
  filterPeriod,
  "\n\tdecayPeriod",
  decayPeriod,
  "\n\treductionFactorPer10000",
  reductionFactorPer10000,
  "\n\tadaptiveFeeControlFactorPer100000",
  adaptiveFeeControlFactorPer100000,
  "\n\tmaxVolatilityAccumulator",
  maxVolatilityAccumulator,
  "\n\ttickGroupSize",
  tickGroupSize,
  "\n\tmajorSwapThresholdTicks",
  majorSwapThresholdTicks,
);
const yesno = await promptConfirm("if the above is OK, enter YES");
if (!yesno) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.initializeAdaptiveFeeTierIx(ctx.program, {
    feeTierIndex,
    feeTierPda: pda,
    funder: ctx.wallet.publicKey,
    whirlpoolsConfig: whirlpoolsConfigPubkey,
    feeAuthority: whirlpoolsConfig.feeAuthority,
    tickSpacing,
    defaultBaseFeeRate,
    initializePoolAuthority,
    delegatedFeeAuthority,
    presetFilterPeriod: filterPeriod,
    presetDecayPeriod: decayPeriod,
    presetReductionFactor: reductionFactorPer10000,
    presetAdaptiveFeeControlFactor: adaptiveFeeControlFactorPer100000,
    presetMaxVolatilityAccumulator: maxVolatilityAccumulator,
    presetTickGroupSize: tickGroupSize,
    presetMajorSwapThresholdTicks: majorSwapThresholdTicks,
  }),
);

const landed = await processTransaction(builder);
if (landed) {
  console.info("adaptiveFeeTier address:", pda.publicKey.toBase58());
}

/*

SAMPLE EXECUTION LOG

initialize AdaptiveFeeTier...
✔ whirlpoolsConfigPubkey … GZm8MpN6HdxjfNJsojW2vYhrYHKxBA83GNmhnq1wb2QS
✔ feeTierIndex … 1025
✔ tickSpacing … 64
✔ defaultBaseFeeRatePer1000000 … 3000
authority...
✔ initializePoolAuthority … 11111111111111111111111111111111
✔ delegatedFeeAuthority … 11111111111111111111111111111111
adaptive fee constants...
✔ filterPeriod … 30
✔ decayPeriod … 600
✔ reductionFactorPer10000 … 5000
✔ adaptiveFeeControlFactorPer100000 … 40000
✔ maxVolatilityAccumulator … 100000
✔ tickGroupSize … 64
✔ majorSwapThresholdTicks … 64
setting...
        whirlpoolsConfig GZm8MpN6HdxjfNJsojW2vYhrYHKxBA83GNmhnq1wb2QS
        feeTierIndex 1025
        tickSpacing 64
        defaultBaseFeeRatePer1000000 3000
        initializePoolAuthority 11111111111111111111111111111111
        delegatedFeeAuthority 11111111111111111111111111111111
        filterPeriod 30
        decayPeriod 600
        reductionFactorPer10000 5000
        adaptiveFeeControlFactorPer100000 40000
        maxVolatilityAccumulator 100000
        tickGroupSize 64
        majorSwapThresholdTicks 64
✔ if the above is OK, enter YES › Yes
estimatedComputeUnits: 112542
✔ priorityFeeInSOL … 0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 151 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 4LQNPsfdB8CTNo55vvcyPGa677gxbQqevxadr8t3MxLMDR8fghSZQ7mNK1VMT15Q2JwjTnBxfWskgbLgwxVWjioy
adaptiveFeeTier address: BV7Rg1VXnMZphbjNqVt8apxFMHvsGRJVCfDL92mTK7oX

*/
