# Orca Whirlpools Core SDK (WebAssembly)
This package provides developers with advanced functionalities for interacting with the Whirlpool Program on Solana. Originally written in Rust, it has been compiled to WebAssembly (Wasm). This compilation makes the SDK accessible in JavaScript/TypeScript environments, offering developers the same core features and calculations for their Typescript projects. The SDK exposes convenient methods for math calculations, quotes, and other utilities, enabling seamless integration within web-based projects.

## Key Features
- **Math Library**: Contains a variety of functions for math operations related to bundles, positions, prices, ticks, and tokens, including calculations such as determining position status or price conversions.
- **Quote Library**: Provides utility functions for generating quotes, such as increasing liquidity, collecting fees or rewards, and swapping, to help developers make informed decisions regarding liquidity management.

## Installation
You can install the package via npm:
```bash
npm install @orca-so/whirlpools-core
```

## Usage
Here are some basic examples of how to use the package:

### Math Example
The following example demonstrates how to use the `isPositionInRange` function to determine whether a position is currently in range.

```tsx
import { isPositionInRange } from "@orca-so/whirlpools-core";

const currentSqrtPrice = 7448043534253661173n;
const tickIndex1 = -18304;
const tickIndex2 = -17956;

const inRange = isPositionInRange(currentSqrtPrice, tickIndex1, tickIndex2);
console.log("Position in range:", inRange);
```

Expected output:
```
Position in range? true
```

### Adjust Liquidity Quote Example
The following example demonstrates how to use the `increaseLiquidityQuoteA` function to calculate a quote for increasing liquidity given a token A amount.

```tsx
import { increaseLiquidityQuoteA } from "@orca-so/whirlpools-core";

const tokenAmountA = 1000000000n;
const slippageToleranceBps = 100;
const currentSqrtPrice = 7437568627975669726n;
const tickIndex1 = -18568;
const tickIndex2 = -17668;
const transferFeeA = { feeBps: 200, maxFee: 1000000000n };

const quote = increaseLiquidityQuoteA(
  tokenAmountA,
  slippageToleranceBps,
  currentSqrtPrice,
  tickIndex1,
  tickIndex2,
  transferFeeA,
);

console.log(quote);
```

Expected output:
```
{
  liquidityDelta: 16011047470n,
  tokenEstA: 1000000000n,
  tokenEstB: 127889169n,
  tokenMaxA: 1010000000n,
  tokenMaxB: 129168061n
}
```