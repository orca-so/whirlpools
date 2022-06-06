import { PublicKey } from "@solana/web3.js";
import { PoolUtil } from "../../src/utils/public/pool-utils";
import * as assert from "assert";

const MINTS: { [symbol: string]: PublicKey } = {
  FTM: new PublicKey("EsPKhGTMf3bGoy4Qm7pCv3UCcWqAmbC1UGHBTDxRjjD4"),
  SOL: new PublicKey("So11111111111111111111111111111111111111112"),
  mSOL: new PublicKey("mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"),
  USDH: new PublicKey("USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX"),
  stSOL: new PublicKey("7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj"),
  BTC: new PublicKey("9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E"),
  whETH: new PublicKey("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"),
  USDC: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  USDT: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
  ORCA: new PublicKey("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE"),
};

describe("determine base quote token ordering", () => {
  it("USD stables", async () => {
    // USDC/FTM => FTM/USDC
    let pair = PoolUtil.toBaseQuoteOrder(MINTS.USDC, MINTS.FTM);
    assert.equal(MINTS.FTM, pair[0]);
    assert.equal(MINTS.USDC, pair[1]);

    // USDT/USDC => USDC/USDT
    pair = PoolUtil.toBaseQuoteOrder(MINTS.USDT, MINTS.USDC);
    assert.equal(MINTS.USDC, pair[0]);
    assert.equal(MINTS.USDT, pair[1]);

    // USDH/stSOL => stSOL/USDH
    pair = PoolUtil.toBaseQuoteOrder(MINTS.USDH, MINTS.stSOL);
    assert.equal(MINTS.stSOL, pair[0]);
    assert.equal(MINTS.USDH, pair[1]);
  });

  it("SOL variants", async () => {
    // SOL/mSOL => mSOL/SOL
    let pair = PoolUtil.toBaseQuoteOrder(MINTS.SOL, MINTS.mSOL);
    assert.equal(MINTS.mSOL, pair[0]);
    assert.equal(MINTS.SOL, pair[1]);

    // mSOL/BTC => BTC/mSOL
    pair = PoolUtil.toBaseQuoteOrder(MINTS.mSOL, MINTS.BTC);
    assert.equal(MINTS.BTC, pair[0]);
    assert.equal(MINTS.mSOL, pair[1]);

    // mSOL/whETH => whETH/mSOL
    pair = PoolUtil.toBaseQuoteOrder(MINTS.mSOL, MINTS.whETH);
    assert.equal(MINTS.whETH, pair[0]);
    assert.equal(MINTS.mSOL, pair[1]);
  });

  it("Order remains unchanged for exotic pairs", async () => {
    // FTM/ORCA => FTM/ORCA (unchanged)
    const pair = PoolUtil.toBaseQuoteOrder(MINTS.FTM, MINTS.ORCA);
    assert.equal(MINTS.FTM, pair[0]);
    assert.equal(MINTS.ORCA, pair[1]);
  });
});
