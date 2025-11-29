import { PublicKey } from "@solana/web3.js";
import { IGNORE_CACHE, PDAUtil, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";

console.info("set AdaptiveFeeConstants...");

// prompt
const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");
const feeTierIndexStr = await promptText("feeTierIndex");

const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigPubkeyStr);
const feeTierIndex = Number.parseInt(feeTierIndexStr);

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

const adaptiveFeeTier = await ctx.fetcher.getAdaptiveFeeTier(
  pda.publicKey,
  IGNORE_CACHE,
);
if (!adaptiveFeeTier) {
  throw new Error(
    `adaptiveFeeTier address not initialized(${pda.publicKey.toBase58()})`,
  );
}

// dump current constants
console.info(
  "current setting",
  "\n\tfilterPeriod",
  adaptiveFeeTier.filterPeriod,
  "\n\tdecayPeriod",
  adaptiveFeeTier.decayPeriod,
  "\n\treductionFactorPer10000",
  adaptiveFeeTier.reductionFactor,
  "\n\tadaptiveFeeControlFactorPer100000",
  adaptiveFeeTier.adaptiveFeeControlFactor,
  "\n\tmaxVolatilityAccumulator",
  adaptiveFeeTier.maxVolatilityAccumulator,
  "\n\ttickGroupSize",
  adaptiveFeeTier.tickGroupSize,
  "\n\tmajorSwapThresholdTicks",
  adaptiveFeeTier.majorSwapThresholdTicks,
);

// prompt for new parameters
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
  adaptiveFeeTier.tickSpacing,
  "\n\tdefaultBaseFeeRatePer1000000",
  adaptiveFeeTier.defaultBaseFeeRate,
  "\n\tinitializePoolAuthority",
  adaptiveFeeTier.initializePoolAuthority.toBase58(),
  "\n\tdelegatedFeeAuthority",
  adaptiveFeeTier.delegatedFeeAuthority.toBase58(),
  "\n\tfilterPeriod",
  adaptiveFeeTier.filterPeriod,
  " -> ",
  filterPeriod,
  "\n\tdecayPeriod",
  adaptiveFeeTier.decayPeriod,
  " -> ",
  decayPeriod,
  "\n\treductionFactorPer10000",
  adaptiveFeeTier.reductionFactor,
  " -> ",
  reductionFactorPer10000,
  "\n\tadaptiveFeeControlFactorPer100000",
  adaptiveFeeTier.adaptiveFeeControlFactor,
  " -> ",
  adaptiveFeeControlFactorPer100000,
  "\n\tmaxVolatilityAccumulator",
  adaptiveFeeTier.maxVolatilityAccumulator,
  " -> ",
  maxVolatilityAccumulator,
  "\n\ttickGroupSize",
  adaptiveFeeTier.tickGroupSize,
  " -> ",
  tickGroupSize,
  "\n\tmajorSwapThresholdTicks",
  adaptiveFeeTier.majorSwapThresholdTicks,
  " -> ",
  majorSwapThresholdTicks,
);
const yesno = await promptConfirm("if the above is OK, enter YES");
if (!yesno) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.setPresetAdaptiveFeeConstantsIx(ctx.program, {
    adaptiveFeeTier: pda.publicKey,
    whirlpoolsConfig: whirlpoolsConfigPubkey,
    feeAuthority: whirlpoolsConfig.feeAuthority,
    presetFilterPeriod: filterPeriod,
    presetDecayPeriod: decayPeriod,
    presetReductionFactor: reductionFactorPer10000,
    presetAdaptiveFeeControlFactor: adaptiveFeeControlFactorPer100000,
    presetMaxVolatilityAccumulator: maxVolatilityAccumulator,
    presetTickGroupSize: tickGroupSize,
    presetMajorSwapThresholdTicks: majorSwapThresholdTicks,
  }),
);

await processTransaction(builder);

/*

SAMPLE EXECUTION LOG

set AdaptiveFeeConstants...
✔ whirlpoolsConfigPubkey … FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR
✔ feeTierIndex … 1025
current setting
        filterPeriod 30
        decayPeriod 600
        reductionFactorPer10000 5000
        adaptiveFeeControlFactorPer100000 40000
        maxVolatilityAccumulator 100000
        tickGroupSize 64
        majorSwapThresholdTicks 64
adaptive fee constants...
✔ filterPeriod … 60
✔ decayPeriod … 1200
✔ reductionFactorPer10000 … 6000
✔ adaptiveFeeControlFactorPer100000 … 41000
✔ maxVolatilityAccumulator … 110000
✔ tickGroupSize … 32
✔ majorSwapThresholdTicks … 128
setting...
        whirlpoolsConfig FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR
        feeTierIndex 1025
        tickSpacing 64
        defaultBaseFeeRatePer1000000 3000
        initializePoolAuthority 11111111111111111111111111111111
        delegatedFeeAuthority 11111111111111111111111111111111
        filterPeriod 30  ->  60
        decayPeriod 600  ->  1200
        reductionFactorPer10000 5000  ->  6000
        adaptiveFeeControlFactorPer100000 40000  ->  41000
        maxVolatilityAccumulator 100000  ->  110000
        tickGroupSize 64  ->  32
        majorSwapThresholdTicks 64  ->  128
✔ if the above is OK, enter YES › Yes
estimatedComputeUnits: 104005
✔ priorityFeeInSOL … 0.000005
Priority fee: 0.000005 SOL
process transaction...
transaction is still valid, 150 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 4dT84V8DkDgm1qaRAwetQxtmfctkXZBjbUD8B9csqfVNBLBBEdtMR11KLst61Gc5Cbj4j3iEBZ1QcZQVnxYYaNwT

*/
