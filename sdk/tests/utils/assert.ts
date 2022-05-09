import * as assert from "assert";
import { Program, web3, Coder, BN } from "@project-serum/anchor";
import { AccountLayout } from "@solana/spl-token";
import { TEST_TOKEN_PROGRAM_ID } from "./test-consts";
import { Whirlpool } from "../../src/artifacts/whirlpool";
import { TickData } from "../../src/types/public";

// Helper for token vault assertion checks.
export async function asyncAssertTokenVault(
  program: Program<Whirlpool>,
  tokenVaultPublicKey: web3.PublicKey,
  expectedValues: {
    expectedOwner: web3.PublicKey;
    expectedMint: web3.PublicKey;
  }
) {
  const tokenVault: web3.AccountInfo<Buffer> | null =
    await program.provider.connection.getAccountInfo(tokenVaultPublicKey);
  if (!tokenVault) {
    assert.fail(`token vault does not exist at ${tokenVaultPublicKey.toBase58()}`);
  }
  const tokenVaultAData = AccountLayout.decode(tokenVault.data);
  assert.ok(tokenVault.owner.equals(TEST_TOKEN_PROGRAM_ID));
  assert.ok(expectedValues.expectedOwner.equals(new web3.PublicKey(tokenVaultAData.owner)));
  assert.ok(expectedValues.expectedMint.equals(new web3.PublicKey(tokenVaultAData.mint)));
}

export function assertTick(
  tick: TickData,
  initialized: boolean,
  liquidityGross: BN,
  liquidityNet: BN
) {
  assert.ok(tick.initialized == initialized);
  assert.ok(tick.liquidityNet.eq(liquidityNet));
  assert.ok(tick.liquidityGross.eq(liquidityGross));
}
