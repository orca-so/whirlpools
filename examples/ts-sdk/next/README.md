# Whirlpools Next.js Example

This example demonstrates how to use the Orca Whirlpools SDK in a Next.js application to build a token swap interface with wallet integration.

## Features

- Wallet connection using Wallet Standard
- Token swaps (SOL ↔ USDC) with Orca's concentrated liquidity pools
- Real-time transaction status tracking

## Getting Started

After [building the repository](../../../README.md#getting-started), start the development server:

```bash
yarn workspace @orca-so/whirlpools-example-ts-next start
```

Navigate to [http://localhost:3000](http://localhost:3000).

## Using as a Standalone Project

This example references the local version of the Whirlpools SDK via the monorepo workspace (`"@orca-so/whirlpools": "*"`). 

To use this as a standalone project outside the monorepo:

1. Copy this directory to your desired location
2. Update `package.json` to use the published package version:
   ```json
   "@orca-so/whirlpools": "^{current version}"
   ```
3. Run `npm install` or `yarn install`
4. Start the development server with `npm run start` or `yarn start`

## WebAssembly Configuration

The Orca SDK uses WebAssembly for performance-critical operations. See `next.config.js` for the required webpack configuration that enables `experiments.asyncWebAssembly` and adds `@orca-so/whirlpools-core` to `serverExternalPackages`.
