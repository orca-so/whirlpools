## Tokenized Positions
Whirlpool Position ownership is represented by a non-fungible token in the owner's wallet.

## Anatomy of a Position

There are 3 main accounts used to represent a Tokenized Position on Whirlpool.

1. **Postion Account** - The actual [account](https://github.com/orca-so/whirlpools/blob/2c9366a74edc9fefd10caa3de28ba8a06d03fc1e/programs/whirlpool/src/state/position.rs#L20) hosting the position's information. The PDA is derived from Whirlpool Program Id and Position Mint.
2. **Position Mint Account** - The spl-token mint of the NFT minted to represent this position.
3. **Position Associated Token Account** - The [ATA](https://spl.solana.com/associated-token-account) of the mint-token that will house the minted token in the user's wallet.

The program will verify that a user owns a position by checking whether the wallet provided has the correct position token in it.

### Creating a Position
Positions are created using the [open_position_with_token_extensions](https://github.com/orca-so/whirlpools/blob/main/programs/whirlpool/src/instructions/open_position_with_token_extensions.rs) instruction and it does the following:
1. The caller will provide a brand new token mint and the PDA of the [Position](https://github.com/orca-so/whirlpools/blob/2c9366a74edc9fefd10caa3de28ba8a06d03fc1e/programs/whirlpool/src/state/position.rs) account derived from the Whirlpool.
2. `open_position_with_token_extensions` will initialize the mint, mint 1 token to the `position_token_account` and immediately burn the mint authority of this mint. 
3. The position account is initialized with the set tick range and is ready to receive new liquidity via the [increase_liquidity](https://github.com/orca-so/whirlpools/blob/2c9366a74edc9fefd10caa3de28ba8a06d03fc1e/programs/whirlpool/src/instructions/increase_liquidity.rs) instruction.

## Traits of a Whirlpool Position
- The tick range is fixed upon creation and cannot be adjusted afterward. To re-balance, users need to close their position and open a new one with the desired tick range.
- Position tokens can be freely transferred. Whoever holds the token in their wallet has the authority to manage the position account, allowing them to increase or decrease liquidity, harvest fees, and close the position.

## NFT Metadata
Whirlpools utilizes the Token2022 program for position NFTs, leveraging the MetadataPointer and TokenMetadata extensions to make all rent refundable and eliminate Metaplex creation fees. Advanced users can also choose to exclude metadata entirely.