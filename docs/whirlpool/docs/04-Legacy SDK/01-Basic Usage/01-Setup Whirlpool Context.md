# Setup Whirlpool Context

The [WhirlpoolContext](https://dev.orca.so/legacy/classes/WhirlpoolContext.html) object provides the necessary env information to build and send transactions and is core to running many functions in the SDK. (ex. Connection, Wallet, WhirlpoolProgramId etc).

## Setup your context object with one of the following methods:

```tsx
const provider = Provider.env()
const ctx = WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID);
```

You can feed in the env variables like so in bash:

```bash
ANCHOR_PROVIDER_URL=<CLUSTER URL> ANCHOR_WALLET=<WALLET PATH> ts-node index.ts
```

## Setup for browser applications

The context relies on Anchor's Wallet interface. Implement your own wallet interface or find one of the sample implementations in the community and feed it into the context object.

```tsx
// Anchor Wallet Definition
export interface Wallet {
  signTransaction(tx: Transaction): Promise<Transaction>;
  signAllTransactions(txs: Transaction[]): Promise<Transaction[]>;
  publicKey: PublicKey;
}
```

```tsx
const connection = new Connection(url, "confirmed"};
const wallet = new Wallet()
const ctx = WhirlpoolContext.from(connection, wallet, whirlpoolProgramId);
```

## Setup with Whirlpool Anchor test environment

Provided you have set up the anchor environment, you can reference the program directly and build from there.

```tsx
const provider = anchor.Provider.local();
anchor.setProvider(anchor.Provider.env());
const program = anchor.workspace.Whirlpool;
const ctx = WhirlpoolContext.fromWorkspace(provider, program);
```
