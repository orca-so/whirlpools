import { PublicKey } from "@solana/web3.js";
import { WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";

console.info("set InitializePoolAuthority...");

const adaptiveFeeTierPubkeyStr = await promptText("adaptiveFeeTierPubkey");
const newInitializePoolAuthorityPubkeyStr = await promptText(
  "newInitializePoolAuthorityPubkey",
);

const adaptiveFeeTierPubkey = new PublicKey(adaptiveFeeTierPubkeyStr);
const newInitializePoolAuthorityPubkey = new PublicKey(
  newInitializePoolAuthorityPubkeyStr,
);

const adaptiveFeeTier = await ctx.fetcher.getAdaptiveFeeTier(
  adaptiveFeeTierPubkey,
);
if (!adaptiveFeeTier) {
  throw new Error("adaptiveFeeTier not found");
}
if (
  adaptiveFeeTier.initializePoolAuthority.equals(
    newInitializePoolAuthorityPubkey,
  )
) {
  throw new Error(
    "newInitializePoolAuthority must be different from the current initializePoolAuthority",
  );
}

const whirlpoolsConfigPubkey = adaptiveFeeTier.whirlpoolsConfig;
const whirlpoolsConfig = await ctx.fetcher.getConfig(whirlpoolsConfigPubkey);
if (!whirlpoolsConfig) {
  throw new Error("whirlpoolsConfig not found");
}

if (!whirlpoolsConfig.feeAuthority.equals(ctx.wallet.publicKey)) {
  throw new Error(
    `the current wallet must be the fee authority(${whirlpoolsConfig.feeAuthority.toBase58()})`,
  );
}

console.info(
  "setting...",
  "\n\tadaptiveFeeTier",
  adaptiveFeeTierPubkey.toBase58(),
  "\n\tinitializePoolAuthority",
  adaptiveFeeTier.initializePoolAuthority.toBase58(),
  adaptiveFeeTier.initializePoolAuthority.equals(PublicKey.default)
    ? "(Permission-LESS)"
    : "(Permissioned)",
  "\n\tnewInitializePoolAuthority",
  newInitializePoolAuthorityPubkey.toBase58(),
  newInitializePoolAuthorityPubkey.equals(PublicKey.default)
    ? "(Permission-LESS)"
    : "(Permissioned)",
);
console.info("\nif the above is OK, enter YES");
const yesno = await promptConfirm("yesno");
if (!yesno) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.setInitializePoolAuthorityIx(ctx.program, {
    adaptiveFeeTier: adaptiveFeeTierPubkey,
    whirlpoolsConfig: whirlpoolsConfigPubkey,
    feeAuthority: ctx.wallet.publicKey,
    newInitializePoolAuthority: newInitializePoolAuthorityPubkey,
  }),
);

await processTransaction(builder);

/*

SAMPLE EXECUTION LOG

$ yarn start setInitializePoolAuthority
connection endpoint http://localhost:8899
wallet 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5
set InitializePoolAuthority...
✔ adaptiveFeeTierPubkey … 2hxdzpVtm4ZHr8anmQJ5NsaMMtajXiEGyHy92ubZEfAN
✔ newInitializePoolAuthorityPubkey … 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5
setting...
        adaptiveFeeTier 2hxdzpVtm4ZHr8anmQJ5NsaMMtajXiEGyHy92ubZEfAN
        initializePoolAuthority r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6 (Permissioned)
        newInitializePoolAuthority 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5 (Permissioned)

if the above is OK, enter YES
✔ yesno › Yes
estimatedComputeUnits: 103878
✔ priorityFeeInSOL … 0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 151 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 58PMVGSA1bjtAZsfYUrrVQ46NSr2p7qK9kUg7rMcuDh9cmaHse2y8NCpQBCdUQneGxHBMmN9aEaXmLa7mjYCTZDr

$ yarn start setInitializePoolAuthority
connection endpoint http://localhost:8899
wallet 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5
set InitializePoolAuthority...
✔ adaptiveFeeTierPubkey … 2hxdzpVtm4ZHr8anmQJ5NsaMMtajXiEGyHy92ubZEfAN
✔ newInitializePoolAuthorityPubkey … 11111111111111111111111111111111
setting...
        adaptiveFeeTier 2hxdzpVtm4ZHr8anmQJ5NsaMMtajXiEGyHy92ubZEfAN
        initializePoolAuthority 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5 (Permissioned)
        newInitializePoolAuthority 11111111111111111111111111111111 (Permission-LESS)

if the above is OK, enter YES
✔ yesno › Yes
estimatedComputeUnits: 103971
✔ priorityFeeInSOL … 0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 151 blocks left (at most)
sending...
confirming...
✅successfully landed
signature Zgh8yRKoPQqEEfPFBAjfhYwV5ArfTRwx3Kbf4vJARNMAu7xHmPjtoaKqnbYyWvw9E6Uek9ftrpn5ETR2m1BjbRU

*/
