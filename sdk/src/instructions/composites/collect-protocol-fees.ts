import { Address } from "@coral-xyz/anchor";
import { AddressUtil, Instruction, TokenUtil, TransactionBuilder } from "@orca-so/common-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { PACKET_DATA_SIZE } from "@solana/web3.js";
import { WhirlpoolContext } from "../..";
import { AVOID_REFRESH } from "../../network/public/account-cache";
import {
  TokenMintTypes,
  addNativeMintHandlingIx,
  getTokenMintsFromWhirlpools,
  resolveAtaForMints,
} from "../../utils/whirlpool-ata-utils";
import { collectProtocolFeesIx } from "../collect-protocol-fees-ix";

export async function collectProtocolFees(
  ctx: WhirlpoolContext,
  poolAddresses: Address[]
): Promise<TransactionBuilder> {
  const receiverKey = ctx.wallet.publicKey;
  const payerKey = ctx.wallet.publicKey;

  const whirlpoolDatas = Array.from((await ctx.fetcher.getPools(poolAddresses, AVOID_REFRESH)).values());

  const accountExemption = await ctx.fetcher.getAccountRentExempt();
  const { ataTokenAddresses, resolveAtaIxs } = await resolveAtaForMints(ctx, {
    mints: getTokenMintsFromWhirlpools(whirlpoolDatas, TokenMintTypes.POOL_ONLY).mintMap,
    accountExemption,
    receiver: receiverKey,
    payer: payerKey,
  });

  const latestBlockhash = await ctx.connection.getLatestBlockhash();
  let txBuilder = new TransactionBuilder(
    ctx.connection,
    ctx.wallet,
    ctx.txBuilderOpts
  ).addInstructions(resolveAtaIxs);

  const instructions: Instruction[] = [];

  for (const poolAddress of poolAddresses) {
    const pool = await ctx.fetcher.getPool(poolAddress);
    if (!pool) {
      throw new Error(`Pool not found: ${poolAddress}`);
    }

    const poolConfig = await ctx.fetcher.getConfig(pool.whirlpoolsConfig);
    if (!poolConfig) {
      throw new Error(`Config not found: ${pool.whirlpoolsConfig}`);
    }

    if (poolConfig.collectProtocolFeesAuthority.toBase58() !== ctx.wallet.publicKey.toBase58()) {
      throw new Error(`Wallet is not the collectProtocolFeesAuthority`);
    }

    const poolHandlesNativeMint =
      TokenUtil.isNativeMint(pool.tokenMintA) || TokenUtil.isNativeMint(pool.tokenMintB);
    const txBuilderHasNativeMint = !!ataTokenAddresses[NATIVE_MINT.toBase58()];

    if (poolHandlesNativeMint && !txBuilderHasNativeMint) {
      addNativeMintHandlingIx(txBuilder, ataTokenAddresses, receiverKey, accountExemption);
    }

    // add collect ixn
    instructions.push(
      collectProtocolFeesIx(ctx.program, {
        whirlpoolsConfig: pool.whirlpoolsConfig,
        whirlpool: AddressUtil.toPubKey(poolAddress),
        tokenVaultA: pool.tokenVaultA,
        tokenVaultB: pool.tokenVaultB,
        tokenOwnerAccountA: ataTokenAddresses[pool.tokenMintA.toBase58()],
        tokenOwnerAccountB: ataTokenAddresses[pool.tokenMintB.toBase58()],
        collectProtocolFeesAuthority: poolConfig.collectProtocolFeesAuthority,
      })
    );
  }

  txBuilder.addInstructions(instructions);
  const txSize = await txBuilder.txnSize({ latestBlockhash });
  if (txSize > PACKET_DATA_SIZE) {
    throw new Error(`Transaction size is too large: ${txSize}`);
  }

  return txBuilder;
}
