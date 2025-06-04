import { describe, it } from "vitest";
import type { FixedTickArrayArgs } from "../src/generated/accounts/fixedTickArray";
import {
  getFixedTickArrayEncoder,
  FIXED_TICK_ARRAY_DISCRIMINATOR,
} from "../src/generated/accounts/fixedTickArray";
import { decodeTickArray } from "../src/state/tickArray";
import { address, lamports } from "@solana/kit";
import assert from "assert";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../src/generated/programs";
import type { DynamicTickArrayArgs } from "../src/generated/accounts/dynamicTickArray";
import {
  DYNAMIC_TICK_ARRAY_DISCRIMINATOR,
  getDynamicTickArrayEncoder,
} from "../src/generated/accounts/dynamicTickArray";

const TEST_WHIRLPOOL_ADDRESS = address(
  "2kJmUjxWBwL2NGPBV2PiA5hWtmLCqcKY6reQgkrPtaeS",
);

const TEST_TICK_ARRAY_ADDRESS = address(
  "8PhPzk7n4wU98Z6XCbVtPai2LtXSxYnfjkmgWuoAU8Zy",
);

describe("Tick Array ", () => {
  it("Load TickArray", () => {
    const tickArray: FixedTickArrayArgs = {
      startTickIndex: 100,
      whirlpool: TEST_WHIRLPOOL_ADDRESS,
      ticks: Array(88).fill({
        initialized: false,
        liquidityGross: 0n,
        liquidityNet: 0n,
        feeGrowthOutsideA: 0n,
        feeGrowthOutsideB: 0n,
        rewardGrowthsOutside: [0n, 0n, 0n],
      }),
    };
    tickArray.ticks[12] = {
      initialized: true,
      liquidityGross: 1298412n,
      liquidityNet: 12489412n,
      feeGrowthOutsideA: 1298412n,
      feeGrowthOutsideB: 12489412n,
      rewardGrowthsOutside: [1298412n, 12489412n, 1298412n],
    };
    const data = getFixedTickArrayEncoder().encode(tickArray);

    const decoded = decodeTickArray({
      data: new Uint8Array(data),
      address: TEST_TICK_ARRAY_ADDRESS,
      executable: true,
      space: 0n,
      lamports: lamports(0n),
      programAddress: WHIRLPOOL_PROGRAM_ADDRESS,
    });

    assert.deepStrictEqual(
      decoded.data.discriminator,
      FIXED_TICK_ARRAY_DISCRIMINATOR,
    );
    assert.strictEqual(decoded.data.startTickIndex, tickArray.startTickIndex);
    assert.strictEqual(decoded.data.whirlpool, tickArray.whirlpool);
    assert.deepStrictEqual(decoded.data.ticks, tickArray.ticks);
  });

  it("Load DynamicTickArray", () => {
    const tickArray: DynamicTickArrayArgs = {
      startTickIndex: 100,
      whirlpool: TEST_WHIRLPOOL_ADDRESS,
      tickBitmap: 0n,
      ticks: Array(88).fill({
        __kind: "Uninitialized",
      }),
    };

    tickArray.ticks[12] = {
      __kind: "Initialized",
      fields: [
        {
          liquidityGross: 1298412n,
          liquidityNet: 12489412n,
          feeGrowthOutsideA: 1298412n,
          feeGrowthOutsideB: 12489412n,
          rewardGrowthsOutside: [1298412n, 12489412n, 1298412n],
        },
      ],
    };
    tickArray.tickBitmap = 1n << 12n;

    const data = getDynamicTickArrayEncoder().encode(tickArray);

    const decoded = decodeTickArray({
      data: new Uint8Array(data),
      address: TEST_TICK_ARRAY_ADDRESS,
      executable: true,
      space: 0n,
      lamports: lamports(0n),
      programAddress: WHIRLPOOL_PROGRAM_ADDRESS,
    });

    assert.deepStrictEqual(
      decoded.data.discriminator,
      DYNAMIC_TICK_ARRAY_DISCRIMINATOR,
    );
    assert.strictEqual(decoded.data.startTickIndex, tickArray.startTickIndex);
    assert.strictEqual(decoded.data.whirlpool, tickArray.whirlpool);
    tickArray.ticks.forEach((tick, index) => {
      if (tick.__kind === "Uninitialized") {
        assert.deepStrictEqual(decoded.data.ticks[index], {
          initialized: false,
          liquidityGross: 0n,
          liquidityNet: 0n,
          feeGrowthOutsideA: 0n,
          feeGrowthOutsideB: 0n,
          rewardGrowthsOutside: [0n, 0n, 0n],
        });
      } else {
        assert.deepStrictEqual(decoded.data.ticks[index], {
          initialized: true,
          liquidityGross: tick.fields[0].liquidityGross,
          liquidityNet: tick.fields[0].liquidityNet,
          feeGrowthOutsideA: tick.fields[0].feeGrowthOutsideA,
          feeGrowthOutsideB: tick.fields[0].feeGrowthOutsideB,
          rewardGrowthsOutside: tick.fields[0].rewardGrowthsOutside,
        });
      }
    });
  });
});
