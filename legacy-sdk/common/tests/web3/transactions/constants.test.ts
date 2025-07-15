import { PACKET_DATA_SIZE } from "@solana/web3.js";
import { TX_SIZE_LIMIT, TX_BASE64_ENCODED_SIZE_LIMIT } from "../../../src/web3";

describe("transactions-constants", () => {
  it("TX_SIZE_LIMIT", async () => {
    expect(TX_SIZE_LIMIT).toEqual(1232);
    expect(TX_SIZE_LIMIT).toEqual(PACKET_DATA_SIZE);
  });

  it("TX_BASE64_ENCODED_SIZE_LIMIT", async () => {
    expect(TX_BASE64_ENCODED_SIZE_LIMIT).toEqual(1644);
  });
});
