import * as assert from "assert";
import { AccountName, getAccountSize } from "../../../src";

describe("anchor-types", () => {
  it("all whirlpool account names exist in IDL", async () => {
    type ExpectedSize = { [a in AccountName]: number };
    const expectedSizes: ExpectedSize = {
      [AccountName.WhirlpoolsConfig]: 108,
      [AccountName.Position]: 216,
      [AccountName.TickArray]: 9988,
      [AccountName.Whirlpool]: 653,
      [AccountName.FeeTier]: 44,
      [AccountName.PositionBundle]: 136,
      [AccountName.WhirlpoolsConfigExtension]: 616,
      [AccountName.TokenBadge]: 200,
      [AccountName.AdaptiveFeeTier]: 382,
      [AccountName.Oracle]: 340,
    };
    Object.values(AccountName).forEach((name) => {
      try {
        const actualSize = getAccountSize(name);
        assert.equal(
          actualSize,
          expectedSizes[name],
          `For ${name} expected ${expectedSizes[name]} but got ${actualSize}`,
        );
      } catch (e) {
        assert.fail(`Error fetching size for ${name}: ${e}`);
      }
    });
  });
});
