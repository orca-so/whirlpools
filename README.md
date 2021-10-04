# Whirlpool

## Required Setup

- Go through [Anchor install guide](https://project-serum.github.io/anchor/getting-started/installation.html#install-rust)
- Need to have a valid Solana keypair at `~/.config/solana/id.json` to do local testing with `anchor test` flows.

## Required npm globally installed packages

- mocha (I think? Could try just ts-mocha first)
- ts-mocha
- typescript

Also your $NODE_PATH must be set to the `node_modules` directory of your global installs.
For me since I am using Node 16.10.0 installed through `nvm`, my $NODE_PATH is the following:

```
$ echo $NODE_PATH
/Users/<home_dir>/.nvm/versions/node/v16.10.0/lib/node_modules
```

## Minimum Requirements

- Node 16.4 (Anchor)
- Anchor 0.20.1 
- Solana 1.9.3
- Rust 1.59.0

## Unit Tests

- Run "cargo test --lib" to run unit tests
- Run "anchor test" to run integration tests
