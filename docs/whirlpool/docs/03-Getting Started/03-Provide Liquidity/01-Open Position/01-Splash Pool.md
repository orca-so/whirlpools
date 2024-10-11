# Splash Pool
Opening a position in a Splash Pool allows you to provide liquidity and start earning fees from the trades in the pool. You can think of a position as your investment in the liquidity pool, where you add two tokens to facilitate swaps and earn a share of the fees.

## Function Overview
- **Inputs:**
    - `rpc`: A Solana RPC client used to communicate with the blockchain
    - `poolAddress`: The address of the Splash Pool where you want to open a position.
    - `param`: An object that defines the method of liquidity provision. You can provide liquidity in one of three ways:
        - `liquidity`: Specify the liquidity you want to add in terms of a liquidity value.
        - `tokenA`: Specify how many tokens of tokenA (first token in the pool) to provide.
        - `tokenB`: Specify how many tokens of tokenB (second token in the pool) to provide.
    - `slippageTolerance`: The maximum price slippage you are willing to accept during the liquidity addition process (optional, defaults to 1%).
    - `funder`: The account funding the transaction and providing liquidity (optional, defaults to your funder wallet).
    
- **Outputs:** The function returns a promise resolving to an object containing:
    - `instructions`: A list of instructions to initialize the position.
    - `quote`: A breakdown of the liquidity and tokens you are adding
    - `initializationCost`: The minimum balance required for rent exemption, in lamports.

## Basic Usage

In this example, you will open a position in a Splash Pool by specifying how many tokens A of you want to provide for liquidity. In the example, the SDK will automatically calcultate how many tokens B will be needed and will use that. If it's a new pool that you created, you probably already know by heart what the amounts are. A simple example:
- You set the price of Token A to 0.0001 SOL
- You want to provide 1,000,000 Token A in the pool
- You will need 100 SOL as Token B

If you want to know for sure you can request a quote using the `getIncreaseLiquidityQuote()` function.

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
  
  const positionInstructions = await openSplashPoolPositionInstructions(
    connection,
    poolAddress,
    param, 
    0.01,
    wallet
  );

  // Log position details
  console.log("Position Quote:", positionInstructions.quote);
  console.log("Position Instructions:", positionInstructions.instructions);
  console.log("Initialization Cost (lamports):", positionInstructions.initializationCost);
}

main();
```