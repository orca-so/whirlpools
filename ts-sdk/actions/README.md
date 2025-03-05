# Orca Actions SDK

The Orca Actions SDK provides a set of utilities for executing common actions with Orca Whirlpools on Solana and Eclipse blockchains. This package simplifies the process of creating and managing transactions for Whirlpool operations.

## Installation

```bash
npm install @orca-so/actions
```

## Usage

### Config

Before using the SDK, you need to configure the payer and RPC settings (and optionally priority fee and jito tip settings).

```ts
import { setPayerFromBytes, setRpc, setPriorityFeeSetting, setJitoTipSetting, setDefaultSlippageToleranceBps } from "@orca-so/actions";

await setPayerFromBytes(
  new Uint8Array(Buffer.from(process.env.PAYER_PRIVATE_KEY, "base64"))
);

await setRpc(process.env.RPC_URL);

// optional
await setPriorityFeeSetting({
    type: "dynamic";
    maxCapLamports: BigInt(5_000_000), // 0.005 SOL
    priorityFeePercentile: "75",
});

// optional
await setJitoTipSetting({
    type: "dynamic",
    maxCapLamports: BigInt(2_000_000), // 0.002 SOL
    priorityFeePercentile: "50ema",
});

// you can optionally set a default slippage tolerance; that will be used for all transactions if not overridden
setDefaultSlippageToleranceBps(100)


```

### Harvest Fees

```ts
import { harvestAllPositionFees } from "@orca-so/actions";

const txs = await harvestAllPositionFees();
```

### Create a Splash Liquidity Pool

```ts
import { createSplashPool } from "@orca-so/actions";

const { callback, initializationCost, poolAddress } = await createSplashPool(
  tokenMintA,
  tokenMintB,
  initialPrice
);
// you can check initialization cost of the pool before sending the transaction

await callback();
```

### Open a Concentrated Liquidity Position

```ts
import { openConcentratedPosition } from "@orca-so/actions";

const { callback, quote, initializationCost, positionMint } =
  await openConcentratedPosition(
    poolAddress,
    tokenAmount,
    lowerPrice,
    upperPrice
  );
// you can check quote and initialization cost of the position before sending the transaction

// callback builds and sends the transaction and returns the transaction signature
await callback();
```

### Open a Full Range Liquidity Position

```ts
import { openFullRangePosition } from "@orca-so/actions";

const { callback, quote, initializationCost } = await openFullRangePosition(
  poolAddress,
  tokenAmount
);
// you can check quote and initialization cost of the position before sending the transaction

// callback builds and sends the transaction and returns the transaction signature
await callback();
```

### Close a Liquidity Position

```ts
import { closePositionAndCollectFees } from "@orca-so/actions";

const { callback, quote, feesQuote, rewardsQuote } =
  await closePositionAndCollectFees(positionMintAddress);
// you can check quote, feesQuote, and rewardsQuote of the position before sending the transaction

// callback builds and sends the transaction and returns the transaction signature
await callback();
```

### Increase Liquidity

```ts
import { increasePosLiquidity } from "@orca-so/actions";

const { callback, quote } = await increasePosLiquidity(
  positionMintAddress,
  tokenAmount
);
// you can check quote of the position before sending the transaction

// callback builds and sends the transaction and returns the transaction signature
await callback();
```

### Decrease Liquidity

```ts
import { decreasePosLiquidity } from "@orca-so/actions";

const { callback, quote } = await decreasePosLiquidity(
  positionMintAddress,
  tokenAmount
);

await callback();
```

### Swap

```ts
import { swap } from "@orca-so/actions";

const { callback, quote } = await swap(
  poolAddress,
  swapParams,
  slippageToleranceBps // optional
);

await callback();
```
