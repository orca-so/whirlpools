---
sidebar_label: CLMM Pool
---

# Open a Position in Concentrated Liquidity Pools
Opening a position in a Concentrated Liquidity Pool allows you to provide liquidity within a price range and start earning fees from the trades in the pool. The tighter the price range, the more efficient your liquidity is used, and the more rewards you earn.

When you open a position using the Whirlpools SDK, you also specify how much liquidity you want to add. Later, you can add and remove liquidity from your position, or close the position altogether.

Note that you cannot change the price range of an existing position. If you want to update the price range, you need to close the position and open a new one.

> ⚠️ The ratio of token A and token B that you deposit as liquidity in the pool, reflects the current price by definition. Vice versa, when the price starts to move in either direction, the amount of token A and token B that you deposited, also changes. This can work to your advantage, but it can also happen that the value of the two tokens combined (+ earned rewards) is less than the value of those tokens before you deposited liquidity. This is often referred to as **impermanent loss**.

## Function Overview
**`openPositionInstructions()`**
- **Inputs:**
    - `rpc`: A Solana RPC client used to communicate with the blockchain
    - `poolAddress`: The address of the Whirlpool where you want to open a position.
    - `param`: An object that defines the method of liquidity provision. You can provide liquidity in one of three ways:
        - `liquidity`: Specify the liquidity you want to add in terms of a liquidity value.
        - `tokenA`: Specify how many tokens of tokenA (first token in the pool) to provide.
        - `tokenB`: Specify how many tokens of tokenB (second token in the pool) to provide.
    -  `lowerPrice`: The lower bound of the price range in which your liquidity will be active.
    - `upperPrice`: The upper bound of the price range in which your liquidity will be active.
    - `slippageTolerance`: The maximum price slippage you are willing to accept during the liquidity addition process (optional, defaults to 0.01%).
    - `funder`: The account funding the transaction and providing liquidity.
    
- **Outputs:** The function returns a promise resolving to an object containing:
    - `quote`: A breakdown of the liquidity and tokens you are adding
    - `instructions`: A list of instructions to initialize the position.
    - `initializationCost`: The minimum balance required for [rent](https://solana.com/docs/core/fees#rent) exemption, in lamports.

## Basic Usage

In this example, you will open a position in a Concentrated Liquidity Pool by specifying how many tokens A you want to provide for liquidity. The function `openPositionInstructions()` used in the code below will automatically calculate how many tokens B will be needed and will use that. If it's a new pool that you created, you probably already know by heart what the amounts are. A simple example:
- You set the price of Token A to 0.0001 SOL
- You want to provide 1,000,000 Token A in the pool
- You will need 100 SOL as Token B

If you want to know for sure you can check the first `quote` object that is being returned, before adding the instructions to a transaction. This was, you can double check if you have enough balance of both tokens in your wallet.

If you want to provide liquidity over the entire price range of the liquidity pool, you can use `openFullRangePositionInstructions()`, which does not require the `lowerPrice` and `upperPrice` parameter.

```tsx title="main.ts"
import { openPositionInstructions } from '@orca-so/whirlpools-sdk';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { getWallet } from './wallet';
import { airdropSolIfNeeded } from './airdrop';

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'));
  const wallet = getWallet();
  await airdropSolIfNeeded(connection, wallet);

  const poolAddress = "POOL_ADDRESS";
  
  const param = { tokenA: 1_000_000 };
  const lowerPrice = 0.00005
  const upperPrice = 0.00015
  
  const { quote, instructions, initializationCost } = await openPositionInstructions(
    connection,
    poolAddress,
    param,
    lowerPrice,
    upperPrice, 
    0.01,
    wallet
  );

  console.log("Position Quote:", quote);
  console.log("Position Instructions:", instructions);
  console.log("Rent (lamports):", initializationCost);
}

main();
```