# Whirlpools SDK Examples

This directory contains example projects showcasing how to use the Whirlpools SDK suite in different environments. Each project demonstrates specific functionalities, providing a starting point for developers.

## Building the Examples
To build the examples, run the following commands from the root of the monorepo:

```bash
yarn install
yarn build
```

### General Note on Dependencies
All examples in this directory use local versions of the Orca SDK dependencies from this monorepo. If you plan to move an example project outside of the monorepo, you must update the dependencies to ensure compatibility.

## Available Examples
### Rust
#### 1. Whirlpool Repositioning Bot
- Path: examples/rust-sdk/whirlpools-repositioning-bot
- Description: A CLI tool to automatically reposition positions based on configurable thresholds.
- Highlights:
  - Utilizes the Whirlpools Rust SDKs.
  - Dynamically fetches on-chain data to manage LP positions.

### Typescript
#### 2. Next.js Integration
- Path: examples/ts-sdk/whirlpools-next
- Description: Demonstrates how to integrate the Whirlpools TS SDK `@orca-so/whirlpools` with a Next.js application.
- Highlights:
  - Configures WebAssembly (`asyncWebAssembly`) support in Next.js.
  - Provides a working setup to query and interact with Orca's whirlpools.