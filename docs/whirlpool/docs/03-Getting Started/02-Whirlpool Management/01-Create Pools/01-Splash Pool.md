---
sidebar_label: Splash Pool
---

# Create Splash Pools

Creating a Splash Pool is the easiest way to launch your token on Orca. You only need to provide the mint addresses of 2 tokens and the initial price. It's that simple.

## Function overview
**`createSplashPoolInstructions()`**
- **Inputs**:

    - `rpc`: A Solana RPC client used to communicate with the blockchain.
    - `tokenMintOne` and `tokenMintTwo`: Addresses of the two token mints that will make up the liquidity pool. Selecting which of the two tokens will be token 1 and token 2 matters for the price you are going to set. In most cases, you select your token as token 1 and select SOL/USDC/USDT as token 2.
    - `initialPrice`: The initial price between the two tokens. You express the value of token 1 in terms of token 2.
    - `funder`: The account funding the initialization process.

- **Outputs**: The function returns a promise resolving to an object containing:

    - `instructions`: A list of instructions required to initialize the pool.
    - `initializationCost`: The minimum balance required for [rent](https://solana.com/docs/core/fees#rent) exemption, in lamports.
    - `poolAddress`: The address of the created pool.

## Basic usage

```tsx
import { createSplashPoolInstructions } from '@orca-so/whirlpools'
import { generateKeyPair, createSolanaRpc, devnet, getAddressFromPublicKey } from '@solana/web3.js';

const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
const wallet = await generateKeyPairSigner();
devnetRpc.requestAirdrop(
  wallet.address,
  lamports(1000000000n)
).send()

const tokenMintOne = "TOKEN_MINT_ADDRESS_1"; 
const tokenMintTwo = "TOKEN_MINT_ADDRESS_2"; 
const initialPrice = 0.01;  

const { poolAddress, instructions, initializationCost } = await createSplashPoolInstructions(
  devnetRpc,
  tokenMintOne,
  tokenMintTwo,
  initialPrice,
  wallet
);

console.log("Pool Address:", poolAddress);
console.log("Initialization Instructions:", instructions);
console.log("Rent (lamports):", initializationCost);
```

## Next Steps

After creating a Splash Pool, the pool is still empty and requires liquidity for people to trade against.

To do this, you’ll need to open a position and deposit both tokens into the pool at a ratio that is equal to the current price. Luckily, our SDK takes care of that in one simple step: [Open a Position](../../03-Position%20Management/01-Open%20Position/01-Splash%20Pool.md). By providing liquidity, you enable trades between the two tokens and start earning fees.