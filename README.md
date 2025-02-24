# Whirlpools

Whirpools is an open-source concentrated liquidity AMM contract on the Solana blockchain.
This repository contains the Rust smart contract and SDKs to interact with a deployed program.

The official deployment of the whilrpool contract can be found at the `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` address on:
- [Solana Mainnet](https://solscan.io/account/whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc)
- [Solana Devnet](https://solscan.io/account/whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc?cluster=devnet)

The contract is deployed using verifiable build, so that you can ensure that the hash of the on-chain program matches the hash of the program in this codebase.
- [Solana Verify CLI](https://github.com/Ellipsis-Labs/solana-verifiable-build)
- [Verification result on Osec API](https://verify.osec.io/status/whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc)

The program has been audited several times by different security firms.
* Jan 28th, 2022 - [Kudelski Security](/.audits/2022-01-28.pdf)
* May 5th, 2022 - [Neodyme](/.audits/2022-05-05.pdf)
* Aug 21st, 2024 - [OtterSec](/.audits/2024-08-21.pdf)

## Usage

This repository contains several libraries that can be used to interact with the Whirlpools contract. For most purposes you can use our high-level SDKs, `@orca-so/whirlpools` for Typescript projects, and `orca_whirlpools` for Rust projects.

For specific use-cases you can opt for integrating with lower level packages such as:
* `@orca-so/whirlpools-client` & `orca_whirlpools_client` - auto-generated client for the Whirlpools program that contains account, instruction and error parsing.
* `@orca-so/whirlpools-core` & `orca_whirlpools_core` - utility, math and quoting functions used by other packages.

The legacy Typescript SDK (`@orca-so/whirlpools-sdk`) remains a solid choice, and it’s currently the only option if your project uses Solana Web3.js versions below v2.

For a more detailed overview of our SDK suite and usage examples, visit our [developer documentation](https://dev.orca.so/) site.

## Local Development

This monorepo contains all the code needed to build, deploy and interact with the Whirlpools contract.

### Requirements

- Anchor v0.29.0
- Solana v1.17.22

### Getting Started

These instructions are for setting up a development environment on a Mac. If you are using a different operating system, you will need to adjust the instructions accordingly.

* Install NodeJS and gcc-12 using `brew install node gcc@12`.
* Add gcc-12 headers to your cpath using `export CPATH="/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include"`.
* Install Rust lang using `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`.
* Install the Solana CLI using `curl -sSfL https://release.solana.com/v1.17.22/install | sh`.
* Add the Solana CLI to your path using `export PATH="/Users/$(whoami)/.local/share/solana/install/active_release/bin:$PATH"`.
* Install Anchor version manager using `cargo install --git https://github.com/coral-xyz/anchor avm --locked --force`.
* Install the latest Anchor version using `avm install 0.29.0 && avm use 0.29.0`.
* Clone this repository using `git clone https://github.com/orca-so/whirlpools`.
* Install the dependencies using `yarn`.
* Set up a Solana wallet if you don't have one already (see below).
* Run one of the commands below to get started such as `yarn build`.

#### Setting up a Solana wallet

* Create a new keypair using `solana-keygen new`.
* Check if you have a valid wallet address using `solana address`.
* Set your local config to the Solana devnet env using `solana config set --url https://api.devnet.solana.com`.
* Give yourself some devnet SOL (for transaction fees) using `solana airdrop 1`.
* Check if you have a positive balance using `solana balance`.

### Components

This repository uses NX to manage the Rust and Typescript codebases. This allows us to have a monorepo with multiple packages and share code between them. Dependencies between packages are automatically resolved by NX, so you don't have to worry about managing that yourself.

This repository is split up into sevaral parts. The following is a (non-exhaustive) list of the components and their purpose.

* **`/programs/*`** - Rust programs that are deployed on Solana.
* **`/ts-sdk/*`** - Typescript SDKs for interacting with the programs.
* **`/rust-sdk/*`** - Rust SDKs for interacting with the programs.
* **`/docs/*`** - Documentation for the programs and SDKs.
* **`/legacy-sdk/*`** - Legacy Typescript SDKs and integration tests.

### Commands

All commands should be run from the root of the repository. NX will try to run a command with the same name for each individual component, skipping the component if that specific command does not exist.

Below is a (non-exhaustive) list of available commands:
* **`yarn build`** - compile the components for deployment or serving.
* **`yarn clean`** - clean up all local build products, useful for when builds are failing.
* **`yarn test`** - run the tests for all components.
* **`yarn format`** - run formatter to format code.

If you look closely, the commands just call individual commands specified in the component's `package.json` file. These commands should not be run by themselves as it will not resolve the right dependencies and will not execute the prerequisites. Instead you can specify which package to run with `yarn build programs/whirlpool`, `yarn test legacy-sdk/whirlpool`, etc.

If you want to stream the logs of a specific command you can add the `--output-style stream` flag to the command. This allows you to view the logs of the command as they are being produced which can be useful for longer running tasks like integration tests.

### Changesets

When contributing to this repository, please include a changeset with your changes. You can create a changeset by running `yarn changeset`. If your changes are not related to any of the packages, you can create an empty changeset by running `yarn changeset --empty`. In your pull request, you do not have to manually update the version numbers.

To publish packages to npm and cargo, you can run run the `publish` gh action. This will update the versions of the packages and publish them to npm and cargo.

# Support

Have problems integrating with the SDK? Pop by over to the Orca [Discord](https://discord.gg/nSwGWn5KSG) #dev-questions channel and chat with one of our engineers.

### Feedback

Got ideas on how to improve the system? Open up an issue on github and let's brainstorm more about it together!

