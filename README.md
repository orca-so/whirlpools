# Whirlpools

Whirpools is an open-source concentrated liquidity AMM contract on the Solana blockchain.
This repository contains the Rust smart contract as well as the Typescript SDK (`@orca-so/whirlpool-sdk`) to interact with a deployed program.

The contract has been audited by Kudelski and Neodyme.

## Requirements

- Anchor 0.20.1
- Solana 1.9.3
- Rust 1.59.0

## Setup

Install Anchor using instructions found [here](https://project-serum.github.io/anchor/getting-started/installation.html#install-rust).

Set up a valid Solana keypair at the path specified in the `wallet` in `Anchor.toml` to do local testing with `anchor test` flows.

`$NODE_PATH` must be set to the `node_modules` directory of your global installs.
For example, using Node 16.10.0 installed through `nvm`, the $NODE_PATH is the following:

```
$ echo $NODE_PATH
/Users/<home_dir>/.nvm/versions/node/v16.10.0/lib/node_modules
```

## Usage

Instructions on how to interact with the Whirlpools contract is documented in the Orca Developer Portal.

## Tests

- Run "cargo test --lib" to run Rust unit tests
- Run "anchor test" to run integration tests

---

# Whirlpool SDK

Use the SDK to interact with a deployed Whirlpools program via Typescript.

## Installation

In your package, run:

```
yarn add `@orca-so/whirlpool-sdk`
```

## Usage

Read instructions on how to use the SDK on the Orca Developer Portal.

## Run Typescript tests via local validator

In the whirlpools/sdk folder, run:

```
anchor test
```

## Generate TypeDoc

In the `sdk` folder, run `yarn run docs`

---

# Support

**Integration Questions**

Have problems integrating with the SDK? Pop by over to the Orca [Discord](https://discord.gg/nSwGWn5KSG) #integrations channel and chat with one of our engineers.

**Feedback**

Got ideas on how to improve the system? Open up an issue on github with the prefix [FEEDBACK] and let's brainstorm more about it together!

# License

[MIT](https://choosealicense.com/licenses/mit/)
