# Account Architecture

## Overview
![Account Architecture](./img/architecture-overview.png)

## WhirlpoolsConfig
The owner of a Config account has the authority to define the many authorities over the pools that it owns (ex. default fees, collect protocol fees etc) . Whirlpools visible on the ORCA UI are all derived and controlled by a WhirlpoolsConfig account owned by the ORCA foundation. To learn more about managing pools, start [here](../03-Whirlpools%20SDK/02-Whirlpool%20Management/01-Create%20Pool.md).

Users and other protocols are free to deploy their own WhirlpoolsConfig account on our Whirlpool program to spawn their own set of liquidity pools.

## WhirlpoolConfigExtension

WhirlpoolsConfig account may have WhirlpoolsConfigExtension account. WhirlpoolsConfigExtension account holds some additional authorities to manage TokenExtensions, especially TokenBadge accounts.

## FeeTier
FeeTier is an account that defines the fee rate, defined per WhirlpoolsConfig and tick spacing.

## Whirlpool
![Whirlpool Overview](./img/whirlpool-overview.png)
A Whirlpool is a concentrated liquidity pool between a token pair (A & B).

Each Whirlpool account hosts the necessary information to deal with the accounting of the pool. It also hosts the PDAs to the vaults. Only the Whirlpool program has authority to withdraw from the vault. No one, not even the program owner or WhirlpoolsConfig owner, has the authority to withdraw. 

A Whirlpool account is hashed by the Config, Token pair mints and tick spacing, so there can be many pools for the same trading pair but with a different tick-spacing. 

Users are able to perform position management and fee/reward collection operations against the Whirlpool.

## TickArray
To learn about TickArry, read [Understanding Tick Arrays](./03-Understanding%20Tick%20Arrays.md)

## Position
Positions represents a set of liquidity distributed on a price range within a single Whirlpool. To learn more, read [Tokenized Positions](./04-Tokenized%20Positions.md)

## PositionBundle
By creating a PositionBundle, up to 256 positions can be managed by a single NFT. Also, by closing a position, a new position can be created on the same PositionBundle account, so there is no rent overhead when rebalancing.

If you manage many positions and open and close them frequently, there is no reason not to use PositionBundle.

## TokenBadge
This account was introduced to support TokenExtensions.

While TokenExtensions provides useful extensions, there are extensions that pose a risk to the pool and pool users.

Therefore, tokens with some extensions can only be used for pool initialization if TokenBadge authority has issued a TokenBadge for that token.

## How are Whirlpool Accounts stored
Whirlpool program accounts are all [Program Derived Addresses](https://solana.com/docs/core/pda) (PDA) derivable from another Whirlpool account up the hierarchy.