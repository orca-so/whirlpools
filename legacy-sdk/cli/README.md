# Setting up your script environment
```bash
yarn
```

# Set your RPC and wallet
```bash
export ANCHOR_PROVIDER_URL=<RPC URL>
export ANCHOR_WALLET=<WALLET JSON PATH>
```

Example:
```bash
export ANCHOR_PROVIDER_URL=http://localhost:8899
export ANCHOR_WALLET=~/.config/solana/id.json
```

# Supported commands
Token-2022 tokens are acceptable 👍

## Config & FeeTier
### initialize
- `yarn start initializeConfig`: initialize new WhirlpoolsConfig account
- `yarn start initializeConfigExtension`: initialize new WhirlpoolsConfigExtension account
- `yarn start initializeFeeTier`: initialize new FeeTier account

### update
- `yarn start setTokenBadgeAuthority`: set new TokenBadge authority on WhirlpoolsConfigExtension
- `yarn start setDefaultProtocolFeeRate`: set new default protocol fee rate on WhirlpoolsConfig
- `yarn start setFeeAuthority`: set new fee authority on WhirlpoolsConfig
- `yarn start setCollectProtocolFeesAuthority`: set new collect protocol fees authority on WhirlpoolsConfig
- `yarn start setRewardEmissionsSuperAuthority`: set new reward emissions super authority on WhirlpoolsConfig
- TODO: set config extension authority

## Whirlpool & TickArray
- `yarn start initializeWhirlpool`: initialize new Whirlpool account
- `yarn start initializeTickArray`: initialize new TickArray account

## TokenBadge
- `yarn start initializeTokenBadge`: initialize new TokenBadge account
- `yarn start deleteTokenBadge`: delete TokenBadge account

## Reward
- `yarn start setRewardAuthority`: set new reward authority of rewards on a whirlpool
- `yarn start initializeReward`: initialize new reward for a whirlpool
- TODO: set reward emission

## Position
- `yarn start openPosition`: open a new position
- `yarn start increaseLiquidity`: deposit to a position
- `yarn start decreaseLiquidity`: withdraw from a position
- `yarn start collectFees`: collect fees from a position
- `yarn start collectRewards`: collect rewards from a position
- `yarn start closePosition`: close an empty position

## Swap
- `yarn start pushPrice`: adjust pool price (possible if pool liquidity is zero or very small)

## WSOL and ATA creation
TODO: WSOL handling & create ATA if needed (workaround exists, please see the following)

### workaround for WSOL
`whirlpool-mgmt-tools` works well with ATA, so using WSOL on ATA is workaround.

- wrap 1 SOL: `spl-token wrap 1` (ATA for WSOL will be initialized with 1 SOL)
- unwrap: `spl-token unwrap` (ATA for WSOL will be closed)
- add 1 WSOL: `solana transfer <WSOL ATA address> 1` then `spl-token sync-native` (transfer & sync are needed)

### workaround for ATA
We can easily initialize ATA with spl-token CLI.

```
spl-token create-account <mint address>
```
