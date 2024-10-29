# Opening a Position

Positions in Whirlpools are tracked with a minted NFT in the user's wallet.

The usual action of opening a position consists of two instruction calls
- `initializeTickArray` to initialize the tick arrays that would host your desired ticks for your position if they do not exist yet.
- `Whirlpool.openPosition` or `Whirlpool.openPositionWithMetadata` to mint the position and define the tick range
- `increaseLiquidity` to transfer tokens from your wallet into a position.

The `Whirlpool.openPosition` function now supports both traditional and Token2022-based position NFTs. To utilize Token2022, provide the Token2022 ProgramId as the `tokenProgramId` parameter when calling `openPosition`. This will mint the NFT using Token2022, which leverages the MetadataPointer and TokenMetadata extensions, eliminating the need for Metaplex metadata accounts.

## Opening Position with Metadata
By using `Whirlpool.openPositionWithMetadata`, users have the option of appending [Metaplex metadata](https://www.metaplex.com/learn-developers) onto the Token Program position NFT. Doing so will allow the token to be identifiable in tracking websites or wallets as a Whirlpool NFT. The drawback is it will require more compute-budget and will incurr Metaplex fees of 0.01 SOL.

## Initialize Tick Array accounts if needed

For liquidity to exist in the Whirlpool, the tick-array that contains that particular tick must be initialized. Calculate the start_index of the required tick array and use the `initialize_tick_array` instruction to initialize it.

More often than not, tick-arrays are already created. But if you want your code to be defensive, you should do a check prior to invoking `open_position`. To understand more on how Tick-Arrays work in Whirlpools, read here.

```tsx
const tickArrayPda = PDAUtil.getTickArray(
  this.ctx.program.programId,
  this.address,
  startTick
);

// Check if tick array exists
const fetcher = new AccountFetcher(...);
const ta = await fetcher.getTickArray(tickArrayPda.publicKey, true);
// Exit if it exists
if (!!ta) {
  return;
}

// Construct Init Tick Array Ix
const tx = toTx(ctx, WhirlpoolIx.initTickArrayIx(this.ctx.program, {
  startTick,
  tickArrayPda,
  whirlpool: this.address,
  funder: !!funder ? AddressUtil.toPubKey(funder) : this.ctx.wallet.publicKey,
}));
await tx.buildAndExecute();
```

## Open Position with WhirlpoolClient
WhirlpoolClient's `openPosition` method bundles the open and increase liquidity instructions into a single transaction for you. Below is a code sample to create a position for the SOL/USDC pool at the price between $98 - $150, with the intention to deposit 50 SOL into the position.

```tsx
// Derive the Whirlpool address
const poolAddress = PDAUtil.getWhirlpool(
    WHIRLPOOL_PROGRAM_ID,
    ORCA_WHIRLPOOLS_CONFIG,
    SOL_MINT,
    USDC_MINT,
    64
  );

// Load everything that you need
const client = buildWhirlpoolClient(context, fetcher);
const pool = await client.getPool(poolAddress.publicKey);
const poolData = pool.getData();
const poolTokenAInfo = pool.getTokenAInfo();
const poolTokenBInfo = pool.getTokenBInfo();

// Derive the tick-indices based on a human-readable price
const tokenADecimal = poolTokenAInfo.decimals;
const tokenBDecimal = poolTokenBInfo.decimals;
const tickLower = TickUtil.getInitializableTickIndex(
  PriceMath.priceToTickIndex(new Decimal(98), tokenADecimal, tokenBDecimal),
  poolData.tickSpacing
);
const tickUpper = TickUtil.getInitializableTickIndex(
  PriceMath.priceToTickIndex(new Decimal(150), tokenADecimal, tokenBDecimal),
  poolData.tickSpacing
);

// Get a quote on the estimated liquidity and tokenIn (50 tokenA)
const quote = increaseLiquidityQuoteByInputToken(
  poolTokenAInfo.mint,
  new Decimal(50),
  tickLower,
  tickUpper,
  Percentage.fromFraction(1, 100),
  pool
);

// Evaluate the quote if you need
const {tokenMaxA, tokenMaxB} = quote

// Construct the open position & increase_liquidity ix and execute the transaction.
const { positionMint, tx } = await pool.openPosition(
  lowerTick,
  upperTick,
  quote
);
const txId = await tx.buildAndExecute();

// Fetch the newly created position with liquidity
const position = await client.getPosition(
  PDAUtil.getPosition(WHIRLPOOL_PROGRAM_ID, positionMint).publicKey
)
```

## The Manual way
Follow the instructions below if you would like to have more control over your instruction building process. Note that `open_position` does not add liquidity to a position. Follow the next article "Modify Liquidity" to add liquidity.

## Determine position parameters
To open a position against a Whirlpool, you must first define certain parameters of your position to invoke the `open_position` instruction.

- `WhirlpoolKey` - The public key for the Whirlpool that the position will host liquidity in.
- `tickLowerIndex`, `tickUpperIndex` - The tick index bounds for the position. Must be an initializable index.
- `positionMintAddress` - A generated empty Keypair that will be initialized to a token mint.
- `positionPda` -  Derived address of the position account via `getPositionPda`
- `positionTokenAccountAddress` - This is the account that will hold the minted position token. It is the associated token address of the position-mint.

```tsx
    const positionMintKeypair = Keypair.generate();
    const positionPda = getPositionPda(programId, positionMintKeypair.publicKey);
    const metadataPda = getPositionMetadataPda(positionMintKeypair.publicKey);
    const positionTokenAccountAddress = await deriveATA(
      provider.wallet.publicKey,
      positionMintKeypair.publicKey
    );

    const positionIx = toTx(ctx, WhirlpoolIx.openPositionWithMetadataIx(ctx.program, {
        funder: provider.wallet.publicKey,
        ownerKey: provider.wallet.publicKey,
        positionPda,
        metadataPda,
        positionMintAddress: positionMintKeypair.publicKey,
        positionTokenAccountAddress,
        whirlpoolKey: toPubKey(poolAddress),
        tickLowerIndex,
        tickUpperIndex,
      })).addSigner(positionMintKeypair).buildAndExecute();
```

Once your position is open, proceed to the next section to add liquidity.

## Common Errors
- `InvalidTickIndex` (0x177a) 
    - tickLowerIndex is higher than upper tickUpperIndex
    - Some tick indices is not an initializable index (not a multiple of tickSpacing). Use `TickUtil.getInitializableTickIndex` to get the closest initializable tick to your index.
    - Some tick indices is out of bounds
- `NotRentExempt` (0x0)
    - Usually, the TickArray that houses your tickLowerIndex or tickUpperIndex has not been initialized. Use the `WhirlpoolClient.initTickArrayForTicks` or `WhirlpoolIx.initTickArrayIx` to initialize the array at the derived startTickIndex.
    - Alternatively, if this failure is from `init_tick_array`, the tick array has already been initialized.