# Whirlpools

Whirpools is an open-source concentrated liquidity AMM contract on the Solana blockchain.
The Whirlpools Typescript SDK (`@orca-so/whirlpools-sdk`) allows for easy interaction with a deployed Whirlpools program.

The contract has been audited by Kudelski and Neodyme.

# Whirlpool SDK

Use the SDK to interact with a deployed Whirlpools program via Typescript.

## Installation

In your package, run:

```
yarn add @orca-so/whirlpools-sdk
yarn add @project-serum/anchor@0.20.1
yarn add decimal.js
```

## Usage

Read instructions on how to use the SDK on the [Orca Developer Portal](https://orca-so.gitbook.io/orca-developer-portal/orca/welcome).

## Sample Code

```typescript
import {
    AccountFetcher,
    buildWhirlpoolClient,
    increaseLiquidityQuoteByInputToken,
    PDAUtil,
    PriceMath,
    ORCA_WHIRLPOOL_PROGRAM_ID,
    ORCA_WHIRLPOOLS_CONFIG,
    swapQuoteByInputToken,
    WhirlpoolContext,
} from "@orca-so/whirlpools-sdk";

import {Percentage} from "@orca-so/common-sdk";
import {clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import BN from 'bn.js';
import Decimal from "decimal.js";


// NOTE: The following code will work currently but the API will change in upcoming releases.

// You can use Anchor.Provider.env() and use env vars or pass in a custom Wallet implementation to do signing
const ctx = WhirlpoolContext.from(connection, wallet, ORCA_WHIRLPOOL_PROGRAM_ID);
const fetcher = new AccountFetcher(connection);
const orca = buildWhirlpoolClient(ctx, fetcher);

// Derive the Whirlpool address from token mints
const poolAddress = PDAUtil.getWhirlpool(
    ORCA_WHIRLPOOL_PROGRAM_ID,
    ORCA_WHIRLPOOLS_CONFIG,
    new PublicKey(ORCA_MINT),
    new PublicKey(USDC_MINT), 64);

// Fetch an instance of the pool
const pool = await orca.getPool(poolAddress.publicKey);
if (!pool) {
    return;
}

const poolData = pool.getData();
console.log('Pool liquidity',poolData.liquidity.toNumber());
console.log('Orca price per USDC', PriceMath.sqrtPriceX64ToPrice(poolData.sqrtPrice, 6, 6));

// Open a position
const upperLimitTick = PriceMath.priceToInitializableTickIndex(new Decimal(2),6,6, 64);
const lowerLimitTick = PriceMath.priceToInitializableTickIndex(new Decimal(.1),6,6, 64);
const positionQuote = increaseLiquidityQuoteByInputToken(
    ORCA_MINT,
    new Decimal(100),
    lowerLimitTick,
    upperLimitTick,
    Percentage.fromFraction(1,100),
    pool);

const decDivider = Math.pow(10, 6);
console.log('ORCA (Estimate) = ', (positionQuote.tokenEstA as BN).toNumber() / decDivider);
console.log('ORCA (Max) = ', (positionQuote.tokenMaxA as BN).toNumber() / decDivider);
console.log('USDC (Max) = ', (positionQuote.tokenMaxB as BN).toNumber() / decDivider);
console.log('Liquidity = ', (positionQuote.liquidityAmount as BN).toNumber() / decDivider);

const {positionMint, tx: positionTx} = await pool.openPosition(
    lowerLimitTick,
    upperLimitTick,
    {
        tokenMaxA: positionQuote.tokenMaxA,
        tokenMaxB: positionQuote.tokenMaxB,
        liquidityAmount: positionQuote.liquidityAmount
    });
const positionTxId = positionTx.buildAndExecute();
console.log('Position tx id', positionTxId);

// Construct a swap instruction on this pool and execute.
const swapQuote = await swapQuoteByInputToken(
    pool,
    ORCA_MINT,
    new BN(100).mul(new BN(decDivider)),
    Percentage.fromFraction(1,100),
    ORCA_WHIRLPOOL_PROGRAM_ID,
    fetcher,
    false);
console.log('ORCA in Amount estimate', (swapQuote.estimatedAmountIn as BN).toNumber() / decDivider);
console.log('USDC out Amount estimate', (swapQuote.estimatedAmountOut as BN).toNumber() / decDivider);

const swapTx = await pool.swap(swapQuote);
const swapTxId = await swapTx.buildAndExecute();
console.log('Swap tx id', swapTxId);
```

# License

[Apache 2.0](https://choosealicense.com/licenses/apache-2.0/)
