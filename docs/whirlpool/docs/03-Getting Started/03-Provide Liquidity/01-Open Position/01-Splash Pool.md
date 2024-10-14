---
sidebar_label: Splash Pool
---

# Open a Position in Splash Pools
Opening a position in a Splash Pool allows you to provide liquidity and start earning fees from the trades in the pool. You can think of a position as your investment in the liquidity pool, where you add two tokens to facilitate swaps and earn a share of the fees.

When you open a position using the Whirlpools SDK, you also specify how much liquidity you want to add. Later, you can add and remove liquidity from your position, or close the position altogether.

## Function Overview
**`openSplashPoolPositionInstructions()`**
- **Inputs:**
    - `rpc`: A Solana RPC client used to communicate with the blockchain
    - `poolAddress`: The address of the Splash Pool where you want to open a position.
    - `param`: An object that defines the method of liquidity provision. You can provide liquidity in one of three ways:
        - `liquidity`: Specify the liquidity you want to add in terms of a liquidity value.
        - `tokenA`: Specify how many tokens of tokenA (first token in the pool) to provide.
        - `tokenB`: Specify how many tokens of tokenB (second token in the pool) to provide.
    - `slippageTolerance`: The maximum price slippage you are willing to accept during the liquidity addition process (optional, defaults to 0.01%).
    - `funder`: The account funding the transaction and providing liquidity.
    
- **Outputs:** The function returns a promise resolving to an object containing:
    - `quote`: A breakdown of the liquidity and tokens you are adding
    - `instructions`: A list of instructions to initialize the position.
    - `initializationCost`: The minimum balance required for [rent](https://solana.com/docs/core/fees#rent) exemption, in lamports.

## Basic Usage

In this example, you will open a position in a Splash Pool by specifying how many tokens of token A you want to provide for liquidity. The function `openSplashPoolPositionInstructions()` used in the code below will automatically calculate how many tokens B will be needed and will use that. If it's a new pool that you created, you probably already know by heart what the amounts are. A simple example:
- You set the price of Token A to 0.0001 SOL
- You want to provide 1,000,000 Token A in the pool
- You will need 100 SOL as Token B

If you want to know for sure you can request a quote first by using the `getIncreaseLiquidityQuote()` function.

```tsx title="main.ts"
import { openSplashPoolPositionInstructions } from '@orca-so/whirlpools-sdk';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { getWallet } from './wallet';
import { airdropSolIfNeeded } from './airdrop';

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'));
  const wallet = getWallet();
  await airdropSolIfNeeded(connection, wallet);

  const poolAddress = "POOL_ADDRESS";
  
  const param = { tokenA: 1_000_000 }; 
  
  const { quote, instructions, initializationCost } = await openSplashPoolPositionInstructions(
    connection,
    poolAddress,
    param, 
    0.01,
    wallet
  );

  console.log("Position Quote:", quote);
  console.log("Position Instructions:", instructions);
  console.log("Rent (lamports):", initializationCost);
}

main();
```