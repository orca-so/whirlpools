import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { WhirlpoolContext } from "../../src";
import localnetAdminKeypair0 from "../../../../programs/whirlpool/src/auth/localnet/localnet-admin-keypair-0.json";
import localnetAdminKeypair1 from "../../../../programs/whirlpool/src/auth/localnet/localnet-admin-keypair-1.json";

const LOCALNET_ADMIN_KEYPAIR_0 = Keypair.fromSecretKey(
  Buffer.from(localnetAdminKeypair0 as number[]),
);

const LOCALNET_ADMIN_KEYPAIR_1 = Keypair.fromSecretKey(
  Buffer.from(localnetAdminKeypair1 as number[]),
);

export async function getLocalnetAdminKeypair0(
  ctx: WhirlpoolContext,
): Promise<Keypair> {
  const keypair = LOCALNET_ADMIN_KEYPAIR_0;
  await fundKeypairIfNeeded(ctx, keypair);
  return keypair;
}

export async function getLocalnetAdminKeypair1(
  ctx: WhirlpoolContext,
): Promise<Keypair> {
  const keypair = LOCALNET_ADMIN_KEYPAIR_1;
  await fundKeypairIfNeeded(ctx, keypair);
  return keypair;
}

async function fundKeypairIfNeeded(
  ctx: WhirlpoolContext,
  keypair: Keypair,
  amount: number = 10000 * LAMPORTS_PER_SOL,
): Promise<void> {
  const accountInfo = await ctx.connection.getAccountInfo(keypair.publicKey);
  if (!accountInfo) {
    const signature = await ctx.connection.requestAirdrop(
      keypair.publicKey,
      amount,
    );
    await ctx.connection.confirmTransaction(
      {
        signature,
        ...(await ctx.connection.getLatestBlockhash("finalized")),
      },
      "finalized",
    );
  }
}
