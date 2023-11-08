# Whirlpools

Whirpools is an open-source concentrated liquidity AMM contract on the Solana blockchain.
This repository contains the Rust smart contract as well as the Typescript SDK (`@orca-so/whirlpools-sdk`) to interact with a deployed program.

The contract has been audited by [Kudelski and Neodyme](https://orca-so.gitbook.io/orca-developer-portal/whirlpools/overview#security-audits).

The contract has been deployed using verifiable build, so that you can ensure that the hash of the on-chain program matches the hash of the program of the given codebase.
- [Solana Verify CLI](https://github.com/Ellipsis-Labs/solana-verifiable-build)
- [Verification result on Osec API](https://verify.osec.io/status/whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc)

## Requirements

- Anchor 0.26.0
- Solana 1.14.12
- Rust 1.60.0

## Setup

Install Anchor using instructions found [here](https://book.anchor-lang.com/getting_started/installation.html#anchor).

Set up a valid Solana keypair at the path specified in the `wallet` in `Anchor.toml` to do local testing with `anchor test` flows.

`$NODE_PATH` must be set to the `node_modules` directory of your global installs.
For example, using Node 16.10.0 installed through `nvm`, the $NODE_PATH is the following:

```
$ echo $NODE_PATH
/Users/<home_dir>/.nvm/versions/node/v16.10.0/lib/node_modules
```

## Usage

Instructions on how to interact with the Whirlpools contract is documented in the [Orca Developer Portal](https://orca-so.gitbook.io/orca-developer-portal/orca/welcome).

## Tests

- Run "cargo test --lib" to run Rust unit tests

---

# Whirlpool SDK

Use the SDK to interact with a deployed Whirlpools program via Typescript.

## Installation

In your package, run:

```
yarn add "@orca-so/whirlpools-sdk"
yarn add "@coral-xyz/anchor"
yarn add "decimal.js"
```

## Usage

Read instructions on how to use the SDK on the [Orca Developer Portal](https://orca-so.gitbook.io/orca-developer-portal/orca/welcome).

## Run Typescript tests via local validator

In the whirlpools/sdk folder, run:

```
anchor test
```

## Generate TypeDoc

In the `sdk` folder, run `yarn run docs`

You can also see the generated [TypeDoc](https://orca-so.github.io/whirlpools/).

## Sample Codes

You can find sample code covering basic operations [here](https://github.com/everlastingsong/tour-de-whirlpool/tree/main/src/EN).

---

# Support

**Questions**

Have problems integrating with the SDK? Pop by over to the Orca [Discord](https://discord.gg/nSwGWn5KSG) #dev-questions channel and chat with one of our engineers.

**Feedback**

Got ideas on how to improve the system? Open up an issue on github with the prefix [FEEDBACK] and let's brainstorm more about it together!

# License

[Apache 2.0](https://choosealicense.com/licenses/apache-2.0/)
