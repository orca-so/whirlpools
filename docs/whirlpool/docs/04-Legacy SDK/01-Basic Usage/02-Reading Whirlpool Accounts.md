# Reading Whirlpool Accounts

The SDK provides the following methods to fetch and parse data from Whirlpool accounts on-chain.

## Fetching Accounts

The Typescript SDK has types setup to help you parse the corresponding accounts on-chain.

### 1. Account Fetcher

Use the [AccountFetcher](https://dev.orca.so/legacy/classes/WhirlpoolAccountFetcher.html) class's get functions to fetch and parse the Whirlpool account that you need. Note that this class also provides caching options.

```tsx
const fetcher = new WhirlpoolAccountFetcher(connection);
const config: WhirlpoolsConfigData = await fetcher.getConfig(CONFIG_PUBLIC_KEY);

const poolAddress = PDAUtil.getPool(...);
const pool: WhirlpoolData = await fetcher.getPool(poolAddress);
```

### 2. Parsing fetched AccountInfo data
If you already have the Buffer from fetching the AccountInfo, use the Parsables classes (eg. [ParsableWhirlpool](https://dev.orca.so/legacy/classes/ParsableWhirlpool.html)) in the SDK to parse account buffer data into readable types.

```tsx
const whirlpoolAccountInfo: Buffer = ...
const whirlpool: WhirlpoolData = ParsableWhirlpool.parse(accountInfoData)
```

## Whirlpool Client
If you are already using [WhirlpoolClient](https://dev.orca.so/legacy/interfaces/WhirlpoolClient.html), you can fetch the data from the `Whirlpool` or `Position` class directly.

```tsx
const context = new WhirlpoolContext(...);
const fetcher = new AccountFetcher(context.provider.connection);
const client = buildWhirlpoolClient(context, fetcher);
const pool = await client.getPool(poolAddress);
const position = await client.getPosition(positionAddress);

const poolData: WhirlpoolData = pool.getData();
const positionData: PositionData = position.getData();

// Perform Action...

const newestData = pool.refreshData();
```

## Deriving Account Addresses
Almost all Whirlpools accounts are Program Derived Addresses. Use the [PDAUtil](https://dev.orca.so/legacy/classes/PDAUtil.html) class to derive the required addresses to access on-chain accounts.
