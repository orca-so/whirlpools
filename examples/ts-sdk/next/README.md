# Orca Whirlpools Next.js Example

A modern Next.js example demonstrating how to integrate Orca Whirlpools SDK for decentralized token swaps on Solana.

## Overview

This example showcases a complete token swap application built with:

- **Next.js 15** - React framework for production
- **Orca Whirlpools SDK** - Decentralized liquidity pools on Solana
- **Solana Web3.js Kit** - Modern Solana development tools
- **Wallet Standard** - Universal wallet connection interface
- **TypeScript** - Type-safe development

## Features

- **Wallet Connection**: Support for multiple Solana wallets through Wallet Standard
- **Token Swaps**: SOL ↔ USDC swaps using Orca's concentrated liquidity pools
- **Real-time Quotes**: Live pricing with 500ms debouncing for optimal UX
- **Balance Display**: Real-time wallet balance updates
- **Transaction Status**: Clear feedback on swap progress and completion
- **Responsive UI**: Modern, accessible interface with dark mode support

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn package manager
- A Solana wallet (Phantom, Solflare, etc.)

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd examples/ts-sdk/next
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

```bash
# Create .env.local file
NEXT_PUBLIC_RPC_URL=https://api.mainnet-beta.solana.com
```

4. Start the development server:

```bash
npm run start
```

5. Open [http://localhost:3000/swap](http://localhost:3000/swap) in your browser

## Architecture

### Core Components

- **`app/swap/page.tsx`** - Main swap interface component
- **`app/contexts/WalletContext.tsx`** - Wallet state management
- **`app/components/ui/`** - Reusable UI components (Button, Dialog)
- **`next.config.js`** - Webpack configuration for WASM support

### Key Features

#### Wallet Integration

```typescript
// Centralized wallet state with transaction signer
const { account, signer } = useWallet();
```

#### Swap Execution

```typescript
// Get swap instructions from Orca SDK
const quote = await swapInstructions(
  rpc,
  {
    inputAmount: amount,
    mint: tokenMint,
  },
  poolAddress,
  slippageBps,
  signer,
);

// Execute transaction
const signature = await signAndSendTransactionMessageWithSigners(transaction);
```

#### Real-time Balance Updates

```typescript
// Automatic balance refresh after successful swaps
const fetchBalances = useCallback(async () => {
  const solBalance = await rpc.getBalance(walletAddress).send();
  const usdcBalance = await fetchToken(rpc, usdcTokenAccount);
}, [account, rpc]);
```

## Configuration

### WASM File Handling

The application automatically detects WASM file locations:

```javascript
// next.config.js - Smart path resolution
const wasmPath = fs.existsSync(
  "node_modules/@orca-so/whirlpools-core/dist/nodejs/...",
)
  ? "node_modules/..." // Production deployment
  : "../../../ts-sdk/core/dist/nodejs/..."; // Monorepo development
```

### Supported Networks

- **Mainnet** - Production swaps with real tokens
- **Devnet** - Testing with devnet tokens (modify `setWhirlpoolsConfig`)

## Development

### Project Structure

```
├── app/
│   ├── swap/
│   │   └── page.tsx          # Main swap interface
│   ├── components/
│   │   ├── ui/              # Reusable UI components
│   │   ├── ConnectWalletButton.tsx
│   │   └── WalletListModal.tsx
│   ├── contexts/
│   │   └── WalletContext.tsx # Wallet state management
│   └── lib/
│       └── utils.ts         # Utility functions
├── next.config.js           # Next.js configuration
└── package.json            # Dependencies
```

### Key Dependencies

```json
{
  "@orca-so/whirlpools": "*",
  "@solana/kit": "^3.0.3",
  "@solana/react": "^3.0.3",
  "@wallet-standard/react": "^1.0.1",
  "next": "^15.2.4"
}
```

### Building for Production

```bash
npm run build
```

## Usage Examples

### Basic Swap Flow

1. **Connect Wallet**: Click "Connect Wallet" and select your preferred wallet
2. **Enter Amount**: Input the amount of SOL or USDC to swap
3. **Get Quote**: Real-time pricing updates automatically
4. **Execute Swap**: Click swap button to sign and submit transaction
5. **Confirm**: Transaction signature and updated balances display

### Customization

#### Adding New Token Pairs

```typescript
// Add new mint addresses
const NEW_TOKEN_MINT = address("YourTokenMintAddress");

// Update swap interface
const pools = await fetchWhirlpoolsByTokenPair(rpc, SOL_MINT, NEW_TOKEN_MINT);
```

#### Modifying Slippage

```typescript
// Adjust slippage tolerance (in basis points)
const quote = await swapInstructions(
  rpc,
  swapParams,
  poolAddress,
  200, // 2% slippage instead of default 1%
  signer,
);
```

## Troubleshooting

### Common Issues

**WASM File Not Found**

- Ensure `@orca-so/whirlpools-core` is installed
- Check Next.js build output for WASM copying errors

**Wallet Connection Fails**

- Verify wallet extension is installed and unlocked
- Check browser console for connection errors

**Transaction Failures**

- Confirm sufficient SOL balance for transaction fees
- Verify slippage tolerance for volatile markets
- Check RPC endpoint connectivity

### Performance Optimization

- **Quote Debouncing**: 500ms delay prevents excessive API calls
- **Balance Caching**: Balances update only after successful transactions
- **Selective Re-renders**: Optimized state updates with useCallback/useMemo

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This example is part of the Orca Whirlpools SDK and follows the same licensing terms.

## Resources

- [Orca Whirlpools SDK Documentation](https://orca-so.github.io/whirlpools/)
- [Solana Web3.js Kit](https://solana.com/docs/clients/javascript)
- [Wallet Standard](https://github.com/wallet-standard/wallet-standard)
- [Next.js Documentation](https://nextjs.org/docs)

## Support

For technical questions and support:

- GitHub Issues: Report bugs and feature requests
- Discord: Join the Orca community
- Documentation: Comprehensive guides and API reference
