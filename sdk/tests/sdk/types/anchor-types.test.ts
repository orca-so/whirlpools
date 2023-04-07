import * as assert from "assert";
import { AccountName, getAccountSize } from "../../../src";

describe("anchor-types", () => {
  it("all whirlpool account names exist in IDL", async () => {
    try {
      for (const name of Object.values(AccountName)) {
        getAccountSize(name);
      }
    } catch (e) {
      assert.fail(`Account name ${e} does not exist in IDL`);
    }
  });
});
