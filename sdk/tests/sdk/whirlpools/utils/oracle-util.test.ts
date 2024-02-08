import * as assert from "assert";
import { OracleUtil, OracleData, WhirlpoolData, OracleObservationData, NUM_ORACLE_OBSERVATIONS } from "../../../../src";
import { PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import invariant from "tiny-invariant";

class OracleDataBuilder {
  private whirlpool: PublicKey;
  private observationIndex: number;
  private observations: OracleObservationData[];

  constructor(whirlpool: PublicKey, timestamp: number) {
    this.whirlpool = whirlpool;
    this.observationIndex = 0;
    this.observations = new Array(NUM_ORACLE_OBSERVATIONS).fill({
      timestamp: 0,
      tickCumulative: new BN(0),
    });
    this.observations[0] = { timestamp, tickCumulative: new BN(0) };
  }

  public addObservation(timestamp: number, tickCurrentIndex: number): OracleDataBuilder {
    const latest = this.observations[this.observationIndex];
    this.observationIndex = (this.observationIndex + 1) % NUM_ORACLE_OBSERVATIONS;

    const delta = timestamp - latest.timestamp;
    invariant(delta > 0, "timestamps must be strictly increasing");
    this.observations[this.observationIndex] = {
      timestamp,
      tickCumulative: new BN(tickCurrentIndex).muln(delta).add(latest.tickCumulative),
    };
    return this;
  }

  public build(): OracleData {
    return {
      whirlpool: this.whirlpool,
      observationIndex: this.observationIndex,
      observations: this.observations.slice(),
    };
  }
}

describe("OracleUtil tests", () => {

  describe("getTickIndex", () => {
    it("exact(init) - exact", async () => {
      const now = Math.floor(Date.now() / 1000);
  
      const oracleData: OracleData = new OracleDataBuilder(PublicKey.default, now - 100)
        .addObservation(now, 99)
        .build();
  
      // OracleUtil will references tickCurrentIndex only.
      const whirlpoolData = {
        tickCurrentIndex: 99,
      } as WhirlpoolData;
  
      const tickIndex = OracleUtil.getTickIndex(
        whirlpoolData,
        oracleData,
        100, // now - 100
        now
      );
  
      const pastCumulative = oracleData.observations[0].tickCumulative;
      assert.equal(pastCumulative.toNumber(), 0);
  
      const last = oracleData.observations[oracleData.observationIndex];
      const currentCumulative = last.tickCumulative;
      assert.equal(currentCumulative.toNumber(), 99 * 100);
  
      const expected = Math.floor((currentCumulative.sub(pastCumulative)).divn(100).toNumber());
  
      assert.equal(tickIndex, expected);      
    });

    it("exact(init) - extrapolate", async () => {
      const now = Math.floor(Date.now() / 1000);
  
      const oracleData: OracleData = new OracleDataBuilder(PublicKey.default, now - 100)
        .build();
  
      // OracleUtil will references tickCurrentIndex only.
      const whirlpoolData = {
        tickCurrentIndex: 99,
      } as WhirlpoolData;
  
      const tickIndex = OracleUtil.getTickIndex(
        whirlpoolData,
        oracleData,
        100, // now - 100
        now
      );
  
      const pastCumulative = oracleData.observations[0].tickCumulative;
      assert.equal(pastCumulative.toNumber(), 0);
  
      const last = oracleData.observations[oracleData.observationIndex];
      const currentCumulative = last.tickCumulative.add(new BN(whirlpoolData.tickCurrentIndex * (now - last.timestamp)));
      assert.equal(currentCumulative.toNumber(), 99 * 100);
  
      const expected = Math.floor((currentCumulative.sub(pastCumulative)).divn(100).toNumber());
  
      assert.equal(tickIndex, expected);      
    });

    it("exact(init) - interpolate", async () => {
      const now = Math.floor(Date.now() / 1000);
  
      const oracleData: OracleData = new OracleDataBuilder(PublicKey.default, now - 100)
        .addObservation(now - 50, 90)
        .addObservation(now, 100)
        .build();
  
      // OracleUtil will references tickCurrentIndex only.
      const whirlpoolData = {
        tickCurrentIndex: 100,
      } as WhirlpoolData;
  
      const tickIndex = OracleUtil.getTickIndex(
        whirlpoolData,
        oracleData,
        80, // now - 20 - 80 = now - 100
        now - 20
      );
  
      const pastCumulative = oracleData.observations[0].tickCumulative;
      assert.equal(pastCumulative.toNumber(), 0);
  
      const currentCumulative = oracleData.observations[1]
        .tickCumulative
        .add(
          oracleData.observations[2].tickCumulative.sub(oracleData.observations[1].tickCumulative)
          .muln(now - 20 - oracleData.observations[1].timestamp)
          .divn(oracleData.observations[2].timestamp - oracleData.observations[1].timestamp)
        );
      assert.equal(currentCumulative.toNumber(), 90 * 50 + 100 * 30);
  
      const expected = Math.floor((currentCumulative.sub(pastCumulative)).divn(80).toNumber());
  
      assert.equal(tickIndex, expected);      
    });
    
    it("exact - exact", async () => {
      const now = Math.floor(Date.now() / 1000);

      const oracleData: OracleData = new OracleDataBuilder(PublicKey.default, now - 100)
        .addObservation(now - 90, 90)
        .addObservation(now - 80, 91)
        .addObservation(now - 70, 92)
        .addObservation(now - 60, 93)
        .addObservation(now - 50, 94)
        .addObservation(now - 40, 95)
        .addObservation(now - 30, 96)
        .addObservation(now - 20, 97)
        .addObservation(now - 10, 98)
        .build();

      // OracleUtil will references tickCurrentIndex only.
      const whirlpoolData = {
        tickCurrentIndex: 99,
      } as WhirlpoolData;

      const tickIndex = OracleUtil.getTickIndex(
        whirlpoolData,
        oracleData,
        80, // now - 10 - 80 = now - 90
        now - 10
      );

      const pastCumulative = oracleData.observations[1].tickCumulative;
      assert.equal(pastCumulative.toNumber(), 90 * 10);

      const currentCumulative = oracleData.observations[oracleData.observationIndex].tickCumulative;
      assert.equal(currentCumulative.toNumber(), (90+91+92+93+94+95+96+97+98) * 10);

      const expected = Math.floor((currentCumulative.sub(pastCumulative)).divn(80).toNumber());

      assert.equal(tickIndex, expected);      
    });

    it("exact - extrapolate", async () => {
      const now = Math.floor(Date.now() / 1000);

      const oracleData: OracleData = new OracleDataBuilder(PublicKey.default, now - 100)
        .addObservation(now - 90, 90)
        .addObservation(now - 80, 91)
        .addObservation(now - 70, 92)
        .addObservation(now - 60, 93)
        .addObservation(now - 50, 94)
        .addObservation(now - 40, 95)
        .addObservation(now - 30, 96)
        .addObservation(now - 20, 97)
        .addObservation(now - 10, 98)
        .build();

      // OracleUtil will references tickCurrentIndex only.
      const whirlpoolData = {
        tickCurrentIndex: 99,
      } as WhirlpoolData;

      const tickIndex = OracleUtil.getTickIndex(
        whirlpoolData,
        oracleData,
        90, // now - 90
        now
      );

      const pastCumulative = oracleData.observations[1].tickCumulative;
      assert.equal(pastCumulative.toNumber(), 90 * 10);

      const last = oracleData.observations[oracleData.observationIndex];
      const currentCumulative = last.tickCumulative.add(new BN(whirlpoolData.tickCurrentIndex * (now - last.timestamp)));
      assert.equal(currentCumulative.toNumber(), (90+91+92+93+94+95+96+97+98+99) * 10);

      const expected = Math.floor((currentCumulative.sub(pastCumulative)).divn(90).toNumber());

      assert.equal(tickIndex, expected);      
    });

    it("exact - interpolate", async () => {
      const now = Math.floor(Date.now() / 1000);

      const oracleData: OracleData = new OracleDataBuilder(PublicKey.default, now - 100)
        .addObservation(now - 90, 90)
        .addObservation(now - 80, 91)
        .addObservation(now - 70, 92)
        .addObservation(now - 60, 93)
        .addObservation(now - 50, 94)
        .addObservation(now - 40, 95)
        .addObservation(now - 30, 96)
        .addObservation(now - 20, 97)
        .addObservation(now - 10, 98)
        .build();

      // OracleUtil will references tickCurrentIndex only.
      const whirlpoolData = {
        tickCurrentIndex: 99,
      } as WhirlpoolData;

      const tickIndex = OracleUtil.getTickIndex(
        whirlpoolData,
        oracleData,
        75, // now - 15 - 75 = now - 90
        now - 15
      );

      const pastCumulative = oracleData.observations[1].tickCumulative;
      assert.equal(pastCumulative.toNumber(), 90 * 10);

      const currentCumulative = oracleData.observations[8]
        .tickCumulative
        .add(
          oracleData.observations[9].tickCumulative.sub(oracleData.observations[8].tickCumulative)
          .muln(now - 15 - oracleData.observations[8].timestamp)
          .divn(oracleData.observations[9].timestamp - oracleData.observations[8].timestamp)
        );
      assert.equal(currentCumulative.toNumber(), (90+91+92+93+94+95+96+97) * 10 + 98 * 5);

      const expected = Math.floor((currentCumulative.sub(pastCumulative)).divn(75).toNumber());

      assert.equal(tickIndex, expected);      
    });

    it("interpolate - exact", async () => {
      const now = Math.floor(Date.now() / 1000);

      const oracleData: OracleData = new OracleDataBuilder(PublicKey.default, now - 100)
        .addObservation(now - 90, 90)
        .addObservation(now - 80, 91)
        .addObservation(now - 70, 92)
        .addObservation(now - 60, 93)
        .addObservation(now - 50, 94)
        .addObservation(now - 40, 95)
        .addObservation(now - 30, 96)
        .addObservation(now - 20, 97)
        .addObservation(now - 10, 98)
        .build();

      // OracleUtil will references tickCurrentIndex only.
      const whirlpoolData = {
        tickCurrentIndex: 99,
      } as WhirlpoolData;

      const tickIndex = OracleUtil.getTickIndex(
        whirlpoolData,
        oracleData,
        75, // now - 10 - 75 = now - 85
        now - 10
      );

      const pastCumulative = oracleData.observations[1]
        .tickCumulative
        .add(
          oracleData.observations[2].tickCumulative.sub(oracleData.observations[1].tickCumulative)
          .muln(now - 85 - oracleData.observations[1].timestamp)
          .divn(oracleData.observations[2].timestamp - oracleData.observations[1].timestamp)
        );
      assert.equal(pastCumulative.toNumber(), 90 * 10 + 91 * 5);

      const currentCumulative = oracleData.observations[9].tickCumulative;
      assert.equal(currentCumulative.toNumber(), (90+91+92+93+94+95+96+97+98) * 10);

      const expected = Math.floor((currentCumulative.sub(pastCumulative)).divn(75).toNumber());

      assert.equal(tickIndex, expected);      
    });

    it("interpolate - extrapolate", async () => {
      const now = Math.floor(Date.now() / 1000);

      const oracleData: OracleData = new OracleDataBuilder(PublicKey.default, now - 100)
        .addObservation(now - 90, 90)
        .addObservation(now - 80, 91)
        .addObservation(now - 70, 92)
        .addObservation(now - 60, 93)
        .addObservation(now - 50, 94)
        .addObservation(now - 40, 95)
        .addObservation(now - 30, 96)
        .addObservation(now - 20, 97)
        .addObservation(now - 10, 98)
        .build();

      // OracleUtil will references tickCurrentIndex only.
      const whirlpoolData = {
        tickCurrentIndex: 99,
      } as WhirlpoolData;

      const tickIndex = OracleUtil.getTickIndex(
        whirlpoolData,
        oracleData,
        85, // now - 85
        now
      );

      const pastCumulative = oracleData.observations[1]
        .tickCumulative
        .add(
          oracleData.observations[2].tickCumulative.sub(oracleData.observations[1].tickCumulative)
          .muln(now - 85 - oracleData.observations[1].timestamp)
          .divn(oracleData.observations[2].timestamp - oracleData.observations[1].timestamp)
        );
      assert.equal(pastCumulative.toNumber(), 90 * 10 + 91 * 5);

      const last = oracleData.observations[oracleData.observationIndex];
      const currentCumulative = last.tickCumulative.add(new BN(whirlpoolData.tickCurrentIndex * (now - last.timestamp)));
      assert.equal(currentCumulative.toNumber(), (90+91+92+93+94+95+96+97+98+99) * 10);

      const expected = Math.floor((currentCumulative.sub(pastCumulative)).divn(85).toNumber());

      assert.equal(tickIndex, expected);      
    });

    it("interpolate - interpolate", async () => {
      const now = Math.floor(Date.now() / 1000);

      const oracleData: OracleData = new OracleDataBuilder(PublicKey.default, now - 100)
        .addObservation(now - 90, 90)
        .addObservation(now - 80, 91)
        .addObservation(now - 70, 92)
        .addObservation(now - 60, 93)
        .addObservation(now - 50, 94)
        .addObservation(now - 40, 95)
        .addObservation(now - 30, 96)
        .addObservation(now - 20, 97)
        .addObservation(now - 10, 98)
        .build();

      // OracleUtil will references tickCurrentIndex only.
      const whirlpoolData = {
        tickCurrentIndex: 99,
      } as WhirlpoolData;

      const tickIndex = OracleUtil.getTickIndex(
        whirlpoolData,
        oracleData,
        70, // now - 15 - 70 = now - 85
        now - 15
      );

      const pastCumulative = oracleData.observations[1]
        .tickCumulative
        .add(
          oracleData.observations[2].tickCumulative.sub(oracleData.observations[1].tickCumulative)
          .muln(now - 85 - oracleData.observations[1].timestamp)
          .divn(oracleData.observations[2].timestamp - oracleData.observations[1].timestamp)
        );
      assert.equal(pastCumulative.toNumber(), 90 * 10 + 91 * 5);

      const currentCumulative = oracleData.observations[8]
        .tickCumulative
        .add(
          oracleData.observations[9].tickCumulative.sub(oracleData.observations[8].tickCumulative)
          .muln(now - 15 - oracleData.observations[8].timestamp)
          .divn(oracleData.observations[9].timestamp - oracleData.observations[8].timestamp)
        );
      assert.equal(currentCumulative.toNumber(), (90+91+92+93+94+95+96+97) * 10 + 98 * 5);

      const expected = Math.floor((currentCumulative.sub(pastCumulative)).divn(70).toNumber());

      assert.equal(tickIndex, expected);      
    });

    it("extrapolate - extrapolate", async () => {
      const now = Math.floor(Date.now() / 1000);

      const oracleData: OracleData = new OracleDataBuilder(PublicKey.default, now - 100)
        .addObservation(now - 90, 90)
        .addObservation(now - 80, 91)
        .addObservation(now - 70, 92)
        .addObservation(now - 60, 93)
        .addObservation(now - 50, 94)
        .build();

      // OracleUtil will references tickCurrentIndex only.
      const whirlpoolData = {
        tickCurrentIndex: 99,
      } as WhirlpoolData;

      const tickIndex = OracleUtil.getTickIndex(
        whirlpoolData,
        oracleData,
        30, // now - 30
        now
      );

      const last = oracleData.observations[oracleData.observationIndex];
      const pastCumulative = last.tickCumulative
        .add(
          new BN(whirlpoolData.tickCurrentIndex * (now - 30 - last.timestamp))
        );
      assert.equal(pastCumulative.toNumber(), (90+91+92+93+94) * 10 + 99 * 20);

      const currentCumulative = last.tickCumulative
        .add(
          new BN(whirlpoolData.tickCurrentIndex * (now - last.timestamp))
        );
      assert.equal(currentCumulative.toNumber(), (90+91+92+93+94) * 10 + 99 * 50);

      const expected = Math.floor((currentCumulative.sub(pastCumulative)).divn(30).toNumber());

      assert.equal(tickIndex, expected);      
    });

    it("including negative tick indexes", async () => {
      const now = Math.floor(Date.now() / 1000);

      const oracleData: OracleData = new OracleDataBuilder(PublicKey.default, now - 100)
        .addObservation(now - 90, -10)
        .addObservation(now - 80, +10)
        .addObservation(now - 70, -10)
        .addObservation(now - 60, +10)
        .addObservation(now - 50, -10)
        .build();

      // OracleUtil will references tickCurrentIndex only.
      const whirlpoolData = {
        tickCurrentIndex: 10,
      } as WhirlpoolData;

      assert.equal(OracleUtil.getTickIndex(
        whirlpoolData,
        oracleData,
        10, // now - 90 - 10 = now - 100
        now - 90
      ), -10);

      assert.equal(OracleUtil.getTickIndex(
        whirlpoolData,
        oracleData,
        20, // now - 80 - 20 = now - 100
        now - 80
      ), 0);

      assert.equal(OracleUtil.getTickIndex(
        whirlpoolData,
        oracleData,
        80,
        now
      ), ((-10 * 10 + 10 * 50) - (0))/80);

      assert.equal(OracleUtil.getTickIndex(
        whirlpoolData,
        oracleData,
        50,
        now
      ), ((-10 * 10 + 10 * 50) - (-10 * 10))/50);
    });

    it("exact - exact (wrap)", async () => {
      const now = Math.floor(Date.now() / 1000);

      const numUpdate = NUM_ORACLE_OBSERVATIONS + 5;
      const initialTimestamp = now - 10 * numUpdate;
      const initialTickIndex = -20;
      const builder = new OracleDataBuilder(PublicKey.default, initialTimestamp);
      for (let i = 1; i <= numUpdate; i++) {
        builder.addObservation(initialTimestamp + 10 * i, initialTickIndex + i);
      }
      const oracleData = builder.build();

      // OracleUtil will references tickCurrentIndex only.
      const whirlpoolData = {
        tickCurrentIndex: initialTickIndex + numUpdate,
      } as WhirlpoolData;

      // NUM_ORACLE_OBSERVATIONS th update will overwrite observations[0]
      // (NUM_ORACLE_OBSERVATIONS + 5) th update will overrite observations[5]
      assert.equal(oracleData.observationIndex, 5);
      assert.equal(oracleData.observations[5].timestamp, now);
      assert.equal(OracleUtil.getOldestObservation(oracleData).timestamp, now - 10 * (NUM_ORACLE_OBSERVATIONS - 1));
      assert.equal(OracleUtil.getOldestObservation(oracleData).tickCumulative.toNumber(), oracleData.observations[6].tickCumulative.toNumber());

      const tickIndex = OracleUtil.getTickIndex(
        whirlpoolData,
        oracleData,
        10 * (NUM_ORACLE_OBSERVATIONS - 1),
        now
      );

      const pastCumulative = oracleData.observations[6].tickCumulative;
      const currentCumulative = oracleData.observations[5].tickCumulative;
      const timeDelta = oracleData.observations[5].timestamp - oracleData.observations[6].timestamp;

      const expected = Math.floor((currentCumulative.sub(pastCumulative)).divn(timeDelta).toNumber());

      assert.equal(tickIndex, expected);      
    });

  });
});
