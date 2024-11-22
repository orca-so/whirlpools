import { describe, it, beforeAll } from "vitest";
import {
  increaseLiquidityInstructions,
  openPositionInstructions,
  openFullRangePositionInstructions,
} from "../src/increaseLiquidity";
import { rpc, signer, sendTransaction } from "./utils/mockRpc";
import { setupMint, setupAta } from "./utils/token";
import {
  fetchMaybePosition,
  fetchPosition,
  getPositionAddress,
} from "@orca-so/whirlpools-client";
import { fetchToken } from "@solana-program/token-2022";
import { address, assertAccountExists, type Address } from "@solana/web3.js";
import assert from "assert";
import {
  setupPosition,
  setupTEPosition,
  setupWhirlpool,
} from "./utils/program";
import {
  DEFAULT_FUNDER,
  setDefaultFunder,
  SPLASH_POOL_TICK_SPACING,
} from "../src/config";
import {
  setupAtaTE,
  setupMintTE,
  setupMintTEFee,
} from "./utils/tokenExtensions";

describe("Increase Liquidity Instructions", () => {
  const tickSpacing = 64;
  const tokenBalance = 1_000_000n;
  let mintA: Address;
  let mintB: Address;
  let mintTEA: Address;
  let mintTEB: Address;
  let mintTEFee: Address;
  let ataMap: Record<string, Address> = {};
  let whirlpools: Record<string, Address> = {};
  let positions: Record<string, Address[]> = {};

  beforeAll(async () => {
    mintA = await setupMint();
    mintB = await setupMint();
    mintTEA = await setupMintTE();
    mintTEB = await setupMintTE();
    mintTEFee = await setupMintTEFee();

    ataMap[mintA] = await setupAta(mintA, { amount: tokenBalance });
    ataMap[mintB] = await setupAta(mintB, { amount: tokenBalance });
    ataMap[mintTEA] = await setupAtaTE(mintTEA, { amount: tokenBalance });
    ataMap[mintTEB] = await setupAtaTE(mintTEB, { amount: tokenBalance });
    ataMap[mintTEFee] = await setupAtaTE(mintTEFee, { amount: tokenBalance });

    whirlpools["Token-Token"] = await setupWhirlpool(mintA, mintB, tickSpacing);
    whirlpools["Token-TE Token"] = await setupWhirlpool(
      mintA,
      mintTEA,
      tickSpacing,
    );
    whirlpools["TE Token-TE Token"] = await setupWhirlpool(
      mintTEA,
      mintTEB,
      tickSpacing,
    );
    whirlpools["Token-TE Token with Transfer Fee extension"] =
      await setupWhirlpool(mintA, mintTEFee, tickSpacing);

    positions["Token-Token"] = [
      await setupPosition(whirlpools["Token-Token"]),
      await setupPosition(whirlpools["Token-Token"], {
        tickLower: 100,
        tickUpper: 200,
      }),
      await setupTEPosition(whirlpools["Token-Token"]),
      await setupTEPosition(whirlpools["Token-Token"], {
        tickLower: 100,
        tickUpper: 200,
      }),
    ];

    positions["Token-TE Token"] = [
      await setupPosition(whirlpools["Token-TE Token"]),
      await setupPosition(whirlpools["Token-TE Token"], {
        tickLower: 100,
        tickUpper: 200,
      }),
      await setupTEPosition(whirlpools["Token-TE Token"]),
      await setupTEPosition(whirlpools["Token-TE Token"], {
        tickLower: 100,
        tickUpper: 200,
      }),
    ];

    positions["TE Token-TE Token"] = [
      await setupPosition(whirlpools["TE Token-TE Token"]),
      await setupPosition(whirlpools["TE Token-TE Token"], {
        tickLower: 100,
        tickUpper: 200,
      }),
      await setupTEPosition(whirlpools["TE Token-TE Token"]),
      await setupTEPosition(whirlpools["TE Token-TE Token"], {
        tickLower: 100,
        tickUpper: 200,
      }),
    ];

    positions["Token-TE Token with Transfer Fee extension"] = [
      await setupPosition(
        whirlpools["Token-TE Token with Transfer Fee extension"],
      ),
      await setupPosition(
        whirlpools["Token-TE Token with Transfer Fee extension"],
        {
          tickLower: 100,
          tickUpper: 200,
        },
      ),
      await setupTEPosition(
        whirlpools["Token-TE Token with Transfer Fee extension"],
      ),
      await setupTEPosition(
        whirlpools["Token-TE Token with Transfer Fee extension"],
        {
          tickLower: 100,
          tickUpper: 200,
        },
      ),
    ];
  });

  const testLiquidityIncrease = async (
    positionMint: Address,
    tokenA: Address,
    tokenB: Address,
  ) => {
    const amount = 10_000n;

    const { quote, instructions } = await increaseLiquidityInstructions(
      rpc,
      positionMint,
      { tokenA: amount },
    );

    const tokenBeforeA = await fetchToken(rpc, ataMap[tokenA]);
    const tokenBeforeB = await fetchToken(rpc, ataMap[tokenB]);
    await sendTransaction(instructions);
    const positionAddress = await getPositionAddress(positionMint);
    const position = await fetchPosition(rpc, positionAddress[0]);
    const tokenAfterA = await fetchToken(rpc, ataMap[tokenA]);
    const tokenAfterB = await fetchToken(rpc, ataMap[tokenB]);
    const balanceChangeTokenA =
      tokenBeforeA.data.amount - tokenAfterA.data.amount;
    const balanceChangeTokenB =
      tokenBeforeB.data.amount - tokenAfterB.data.amount;

    assert.strictEqual(quote.tokenEstA, balanceChangeTokenA);
    assert.strictEqual(quote.tokenEstB, balanceChangeTokenB);
    assert.strictEqual(quote.liquidityDelta, position.data.liquidity);
  };

  it("Should handle liquidity increase for whirlpool with tokenA=Token and tokenB=Token, and Centered Position", async () => {
    await testLiquidityIncrease(
      positions["Token-Token"][0],
      address(mintA),
      address(mintB),
    );
  });

  it("Should handle liquidity increase for whirlpool with tokenA=Token and tokenB=Token, and Single-Sided Position", async () => {
    await testLiquidityIncrease(
      positions["Token-Token"][1],
      address(mintA),
      address(mintB),
    );
  });

  it("Should handle liquidity increase for whirlpool with tokenA=Token and tokenB=Token, and Centered TE Position", async () => {
    await testLiquidityIncrease(
      positions["Token-Token"][2],
      address(mintA),
      address(mintB),
    );
  });

  it("Should handle liquidity increase for whirlpool with tokenA=Token and tokenB=Token, and Single-Sided TE Position", async () => {
    await testLiquidityIncrease(
      positions["Token-Token"][3],
      address(mintA),
      address(mintB),
    );
  });

  it("Should handle liquidity increase for whirlpool with tokenA=Token and tokenB=TE Token, and Centered Position", async () => {
    await testLiquidityIncrease(
      positions["Token-TE Token"][0],
      address(mintA),
      address(mintTEA),
    );
  });

  it("Should handle liquidity increase for whirlpool with tokenA=Token and tokenB=TE Token, and Single-Sided Position", async () => {
    await testLiquidityIncrease(
      positions["Token-TE Token"][1],
      address(mintA),
      address(mintTEA),
    );
  });

  it("Should handle liquidity increase for whirlpool with tokenA=Token and tokenB=TE Token, and Centered TE Position", async () => {
    await testLiquidityIncrease(
      positions["Token-TE Token"][2],
      address(mintA),
      address(mintTEA),
    );
  });

  it("Should handle liquidity increase for whirlpool with tokenA=Token and tokenB=TE Token, and Single-Sided TE Position", async () => {
    await testLiquidityIncrease(
      positions["Token-TE Token"][3],
      address(mintA),
      address(mintTEA),
    );
  });

  it("Should handle liquidity increase for whirlpool with tokenA=TE Token and tokenB=TE Token, and Centered Position", async () => {
    await testLiquidityIncrease(
      positions["TE Token-TE Token"][0],
      address(mintTEA),
      address(mintTEB),
    );
  });

  it("Should handle liquidity increase for whirlpool with tokenA=TE Token and tokenB=TE Token, and Single-Sided Position", async () => {
    await testLiquidityIncrease(
      positions["TE Token-TE Token"][1],
      address(mintTEA),
      address(mintTEB),
    );
  });

  it("Should handle liquidity increase for whirlpool with tokenA=TE Token and tokenB=TE Token, and Centered TE Position", async () => {
    await testLiquidityIncrease(
      positions["TE Token-TE Token"][2],
      address(mintTEA),
      address(mintTEB),
    );
  });

  it("Should handle liquidity increase for whirlpool with tokenA=TE Token and tokenB=TE Token, and Single-Sided TE Position", async () => {
    await testLiquidityIncrease(
      positions["TE Token-TE Token"][3],
      address(mintTEA),
      address(mintTEB),
    );
  });

  it("Should handle liquidity increase for whirlpool with tokenA=Token and tokenB=TE Token with Transfer Fee extension, and Centered Position", async () => {
    await testLiquidityIncrease(
      positions["Token-TE Token with Transfer Fee extension"][0],
      address(mintA),
      address(mintTEFee),
    );
  });

  it("Should handle liquidity increase for whirlpool with tokenA=Token and tokenB=TE Token with Transfer Fee extension, and Single-Sided Position", async () => {
    await testLiquidityIncrease(
      positions["Token-TE Token with Transfer Fee extension"][1],
      address(mintA),
      address(mintTEFee),
    );
  });

  it("Should handle liquidity increase for whirlpool with tokenA=Token and tokenB=TE Token with Transfer Fee extension, and Centered TE Position", async () => {
    await testLiquidityIncrease(
      positions["Token-TE Token with Transfer Fee extension"][2],
      address(mintA),
      address(mintTEFee),
    );
  });

  it("Should handle liquidity increase for whirlpool with tokenA=Token and tokenB=TE Token with Transfer Fee extension, and Single-Sided TE Position", async () => {
    await testLiquidityIncrease(
      positions["Token-TE Token with Transfer Fee extension"][3],
      address(mintA),
      address(mintTEFee),
    );
  });

  it("Should throw error if authority is default address", async () => {
    const tokenAAmount = 100_000n;
    const firstWhirlpoolKey = Object.keys(positions)[0];
    const positionMint = positions[firstWhirlpoolKey][0];
    setDefaultFunder(DEFAULT_FUNDER);
    await assert.rejects(
      increaseLiquidityInstructions(rpc, positionMint, {
        tokenA: tokenAAmount,
      }),
    );
    setDefaultFunder(signer);
  });

  it("Should throw error increase liquidity amount by token is equal or greater than the token balance", async () => {
    const tokenAAmount = 1_000_000n;
    const firstWhirlpoolKey = Object.keys(positions)[0];
    const positionMint = positions[firstWhirlpoolKey][0];
    setDefaultFunder(DEFAULT_FUNDER);
    await assert.rejects(
      increaseLiquidityInstructions(rpc, positionMint, {
        tokenA: tokenAAmount,
      }),
    );
    setDefaultFunder(signer);
  });
});

describe("Open Position Instructions", () => {
  const tickSpacing = 64;
  const tokenBalance = 1_000_000n;
  let mintA: Address;
  let mintB: Address;
  let ataMap: Record<string, Address> = {};
  let whirlpools: Record<string, Address> = {};

  beforeAll(async () => {
    mintA = await setupMint();
    mintB = await setupMint();
    const mintTEA = await setupMintTE();
    const mintTEB = await setupMintTE();
    const mintTEFee = await setupMintTEFee();

    ataMap[mintA] = await setupAta(mintA, { amount: tokenBalance });
    ataMap[mintB] = await setupAta(mintB, { amount: tokenBalance });
    ataMap[mintTEA] = await setupAtaTE(mintTEA, { amount: tokenBalance });
    ataMap[mintTEB] = await setupAtaTE(mintTEB, { amount: tokenBalance });
    ataMap[mintTEFee] = await setupAtaTE(mintTEFee, { amount: tokenBalance });

    whirlpools["Token-Token"] = await setupWhirlpool(mintA, mintB, tickSpacing);
    whirlpools["Token-TE Token"] = await setupWhirlpool(
      mintA,
      mintTEA,
      tickSpacing,
    );
    whirlpools["TE Token-TE Token"] = await setupWhirlpool(
      mintTEA,
      mintTEB,
      tickSpacing,
    );
    whirlpools["Token-TE Token with Transfer Fee extension"] =
      await setupWhirlpool(mintA, mintTEFee, tickSpacing);
  });

  const testOpenPosition = async (
    whirlpool: Address,
    lowerPrice?: number,
    upperPrice?: number,
  ) => {
    const param = { tokenA: 10_000n };

    const { instructions, positionMint } =
      lowerPrice === undefined || upperPrice === undefined
        ? await openFullRangePositionInstructions(rpc, whirlpool, param)
        : await openPositionInstructions(
            rpc,
            whirlpool,
            param,
            lowerPrice,
            upperPrice,
          );
    const positionAddress = await getPositionAddress(positionMint);
    const positionBefore = await fetchMaybePosition(rpc, positionAddress[0]);

    await sendTransaction(instructions);

    const positionAfter = await fetchMaybePosition(rpc, positionMint);
    assert.strictEqual(positionBefore.exists, false);
    assertAccountExists(positionAfter);
  };

  it("Should open a full-range position for whirlpool with tokenA=Token and tokenB=Token", async () => {
    await testOpenPosition(whirlpools["Token-Token"]);
  });

  it("Should open a full-range position for whirlpool with tokenA=Token and tokenB=TE Token", async () => {
    await testOpenPosition(whirlpools["Token-TE Token"]);
  });

  it("Should open a full-range position for whirlpool with tokenA=TE Token and tokenB=TE Token", async () => {
    await testOpenPosition(whirlpools["TE Token-TE Token"]);
  });

  it("Should open a full-range position for whirlpool with tokenA=Token and tokenB=TE Token with Transfer Fee extension", async () => {
    await testOpenPosition(
      whirlpools["Token-TE Token with Transfer Fee extension"],
    );
  });

  it("Should open a position with a specific price range for whirlpool with tokenA=Token and tokenB=Token", async () => {
    await testOpenPosition(whirlpools["Token-Token"], 0.95, 1.05);
  });

  it("Should open a position with a specific price range for whirlpool with tokenA=Token and tokenB=TE Token", async () => {
    await testOpenPosition(whirlpools["Token-TE Token"], 0.95, 1.05);
  });

  it("Should open a position with a specific price range for whirlpool with tokenA=TE Token and tokenB=TE Token", async () => {
    await testOpenPosition(whirlpools["TE Token-TE Token"], 0.95, 1.05);
  });

  it("Should open a position with a specific price range for whirlpool with tokenA=Token and tokenB=TE Token with Transfer Fee extension", async () => {
    await testOpenPosition(
      whirlpools["Token-TE Token with Transfer Fee extension"],
      0.95,
      1.05,
    );
  });

  it("Should compute correct initialization costs if both tick arrays are already initialized", async () => {
    const param = { tokenA: 10_000n };

    const { instructions, initializationCost } = await openPositionInstructions(
      rpc,
      whirlpools["Token-Token"],
      param,
      0.95,
      1.05,
    );

    await sendTransaction(instructions);

    assert.strictEqual(initializationCost, 0n);
  });

  it("Should compute correct initialization costs if 1 tick array is already initialized", async () => {
    const param = { tokenA: 10_000n };

    const { instructions, initializationCost } = await openPositionInstructions(
      rpc,
      whirlpools["Token-Token"],
      param,
      0.05,
      1.05,
    );

    await sendTransaction(instructions);

    assert.strictEqual(initializationCost, 70407360n);
  });

  it("Should compute correct initialization costs if no tick arrays are already initialized", async () => {
    const param = { tokenA: 10_000n };

    const { instructions, initializationCost } = await openPositionInstructions(
      rpc,
      whirlpools["Token-Token"],
      param,
      0.01,
      5,
    );

    await sendTransaction(instructions);

    assert.strictEqual(initializationCost, 140814720n);
  });

  it("Should throw an error if openPositionInstructions is called on a splash pool", async () => {
    const param = { tokenA: 10_000n };
    const splashPool = await setupWhirlpool(
      mintA,
      mintB,
      SPLASH_POOL_TICK_SPACING,
    );
    await assert.rejects(
      openPositionInstructions(rpc, splashPool, param, 0.01, 5),
    );
  });
});
