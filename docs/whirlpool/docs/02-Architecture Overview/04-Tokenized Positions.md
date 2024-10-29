## Tokenized Positions
Whirlpool Position ownership is represented by a single non-fungible token in the owner's wallet.

## Anatomy of a Position

There are 3 main accounts used to represent a Tokenized Position on Whirlpool.

1. **Postion Account** - The actual [account](https://github.com/orca-so/whirlpools/blob/2c9366a74edc9fefd10caa3de28ba8a06d03fc1e/programs/whirlpool/src/state/position.rs#L20) hosting the position's information. The PDA is derived from Whirlpool Program Id and Position Mint.
2. **Position Mint Account** - The mint of the NFT minted to represent this position.
3. **Position Associated Token Account** - The [ATA](https://spl.solana.com/associated-token-account) of the mint-token that will house the minted token in the user's wallet.

The program will verify that a user owns a position by checking whether the wallet provided has the correct position token in it.

### Creating a Position
Positions are created using the [open_position_with_token_extensions](https://github.com/orca-so/whirlpools/blob/main/programs/whirlpool/src/instructions/open_position_with_token_extensions.rs) instruction and it does the following:
1. Caller will provide a brand new token mint and the PDA of the [Position](https://github.com/orca-so/whirlpools/blob/2c9366a74edc9fefd10caa3de28ba8a06d03fc1e/programs/whirlpool/src/state/position.rs) account derived from the Whirlpool.
2. `open_position` will initialize the mint, mint 1 token to the `position_token_account` and immediately burn the mint authority of this mint. 
3. The position account is initialized with the set tick range and is ready to receive new liquidity via the [increase_liquidity](https://github.com/orca-so/whirlpools/blob/2c9366a74edc9fefd10caa3de28ba8a06d03fc1e/programs/whirlpool/src/instructions/increase_liquidity.rs) instruction.

## Traits of a Whirlpool Position
- The tick range cannot be adjusted. To re-balance, users would need to close their account and open a new one.
- Position tokens can be freely transferred. Whoever holds the token in their wallet can modify the Position account.

## NFT Metadata
When creating a tokenized position on Whirlpools, you now have the option to use the Token2022 program for position NFTs. This program leverages the MetadataPointer and TokenMetadata extensions, eliminating the need for Metaplex metadata accounts and associated costs. By using the Token2022 metadata account, the process becomes more efficient and fully refundable. This allows your position tokens to be recognized as NFTs in Solana wallets (e.g., Phantom) without incurring additional compute-budget costs, providing a streamlined and cost-effective solution.