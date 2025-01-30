import type { Mint } from "@solana/spl-token";

export function expectMintEquals(actual: Mint, expected: Mint) {
  expect(actual.decimals).toEqual(expected.decimals);
  expect(actual.isInitialized).toEqual(expected.isInitialized);
  expect(actual.mintAuthority!.equals(expected.mintAuthority!)).toBeTruthy();
  expect(
    actual.freezeAuthority!.equals(expected.freezeAuthority!),
  ).toBeTruthy();
  expect(actual.supply === expected.supply).toBeTruthy();
}
