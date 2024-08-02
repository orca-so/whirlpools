# Whirlpools

Whirpools is an open-source concentrated liquidity AMM contract on the Solana blockchain.
This repository contains the Rust smart contract as well as the Typescript SDK (`@orca-so/whirlpools-sdk`) to interact with a deployed program.

The contract has been audited by [Kudelski and Neodyme](https://orca-so.gitbook.io/orca-developer-portal/whirlpools/overview#security-audits).

The contract has been deployed using verifiable build, so that you can ensure that the hash of the on-chain program matches the hash of the program of the given codebase.
- [Solana Verify CLI](https://github.com/Ellipsis-Labs/solana-verifiable-build)
- [Verification result on Osec API](https://verify.osec.io/status/whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc)

## Requirements

- Anchor 0.29.0
- Solana 1.17.22
- Rust 1.68.0

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

## Local Development

This repository uses NX to manage the Rust and Typescript codebases. This allows us to have a monorepo with multiple packages and share code between them. Dependencies between packages are automatically resolved by NX, so you don't have to worry about managing that yourself.

### Commands

All commands should be run from the root of the repository. The commands will try to run a command with the same name for each individual component, skipping the component if that specific command does not exist.

Below is a (non-exhaustive) list of available commands:
* **`yarn build`** - compile the components for deployment or serving.
* **`yarn clean`** - clean up all local build products, useful for when builds are failing.
* **`yarn test`** - run the tests for all components.
* **`yarn format`** - run formatter to format code.

If you look closely, the commands just call individual commands specified in the component's `package.json` file. These commands should not be run by themselves as it will not resolve the right dependencies and will not execute the prerequisites. Instead you can specify which package to run with `yarn build program`, `yarn test integration`, etc.

If you want to stream the logs of a specific command you can add the `--output-style stream` flag to the command. This allows you to view the logs of the command as they are being produced which can be useful for longer running tasks like tests.

---

# Support

**Questions**

Have problems integrating with the SDK? Pop by over to the Orca [Discord](https://discord.gg/nSwGWn5KSG) #dev-questions channel and chat with one of our engineers.

**Feedback**

Got ideas on how to improve the system? Open up an issue on github with the prefix [FEEDBACK] and let's brainstorm more about it together!

# License

[Apache 2.0](https://choosealicense.com/licenses/apache-2.0/)
