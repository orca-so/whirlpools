# Understanding Tick Arrays
![TickArray Account Architecture](../../static/img/02-Architecture%20Overview/tickarray-overview.png)

A sequence of ticks are stored in individual **tick-array** accounts on chain. Each whirlpool has a sequence of tick-array accounts to host the entire tick range. 

A tick-array is keyed by the start-index of its hosted ticks and can hold 88 physical ticks in an array. It only hosts the tick objects for the initializable tick indices based on the Whirlpool's tick-spacing. The total range for a tick-array is therefore 88 * tick-spacing.

**Tick Array Account Info**
- Number of physical tick slots - 88
- Account Size - 10kb

## Usage in Whirlpool Program Instructions
When you interact with ticks on Whirlpool instructions, often you will need to derive the correct tick-array so the program can get access to the designated tick object. This tick-array is a PDA derived using the Whirlpool pool’s public key and the start tick index of the tick array, which defines the beginning of a specific range of ticks.

For example, if the current tick is 200, the tick spacing is 2, and each tick-array contains 88 ticks, you can compute the start tick index by first finding the closest multiple of tick_spacing * ticks_per_array that is less than or equal to the current tick. Here, the start tick index would be 176, calculated as (200 // (2 * 88)) * (2 * 88).

### Open Position
When a position opens up in a new tick or price range, the tick-array must be initialized before the position can be created. This means the user invoking the position will need to cover the rent-exempt cost for the tick-array account, which is 10 KB in size.

Once a tick-array account is set up, it cannot be closed and will never need to be reinitialized. For this reason, Whirlpool owners may consider preemptively initializing tick-array ranges to prevent unexpected costs for users.

### Adjust Liquidity (increase / decrease liquidity)
Users of these instructions must provide the tick-arrays that contain the specified tick indexes. For each instruction, two tick-arrays need to be passed in—these may be the same array if the range is small. The instruction requires access to these accounts to read the appropriate Tick objects effectively.

### Swap
Swap users must specify a series of tick arrays across which the swap will traverse.

The first tick array in the sequence typically contains the Whirlpool’s current tick index, though this is not strictly required. Before processing the swap, the Whirlpool program will order the tick arrays automatically.

The second and third tick arrays are those immediately following in the swap direction. If the user knows the swap will not move into the next tick array, or if it's not possible at either end of the price range, they can provide any tick array public key instead.

#### Supply additional tick arrays with `swapV2`
With the new `swapV2` instruction, users can include an additional three tick arrays in the `remaining_accounts` field of the instruction data. This allows up to six tick arrays to be submitted in total for `swapV2`.

This feature is particularly useful if the current tick is near the edge of the tick array during quote generation but then moves outside of it by the time the transaction executes (see the diagram below). To avoid errors in such scenarios, users can pass the tick array account with a start index of -88 in the `remaining_accounts` field.
 
If you're using the Typescript Whirlpools SDK [`@orca-so/whirlpools`](https://www.npmjs.com/package/@orca-so/whirlpools) or the Rust Whirlpools SDK [`orca_whirlpools`](https://crates.io/crates/orca_whirlpools) to generate the swap instructions, this is automatically handled.

> NOTE: even though you can submit up to 6 tick arrays to the swap instruction, the program will consider only up to three tick arrays for the swap. If the price moves beyond the third tick array, the program will throw an error and the swap will not go through.

![Sparse Swap Overview 1](../../static/img/02-Architecture%20Overview/sparseswap-1.png)

#### SparseSwap: crossing unitialized tick arrays during swap
For both the `swap` and `swapV2` instructions, it is not necessary for all tick array accounts to be initialized. As long as there is sufficient active liquidity at the current tick (a property defined in the Whirlpool state), the Whirlpool program can execute a swap. The diagram below illustrates this.

![Sparse Swap Overview 2](../../static/img/02-Architecture%20Overview/sparseswap-2.png)

#### SparseSwap: generating quotes
Our SDKs account for the possibility of uninitialized tick arrays and can reliably generate valid swap quotes. We highly encourage you to use one of our official SDKs:
- TS Whirlpools SDK
- Rust Whirlpools SDK
- TS Legacy SDK (version > 0.13.4)

If you are building custom integrations, be aware of this feature. To generate a quote, you must fetch the tick array accounts and parse the ticks to identify any liquidity changes that may occur during the swap. If you encounter an uninitialized tick array, you might incorrectly assume there is no remaining liquidity and erroneously inform users that swapping is not possible. To avoid this, review our SDK internals on quote generation, particularly these functions:
- [`fetch_tick_arrays_or_default`](https://github.com/orca-so/whirlpools/blob/4c75c2f0bbc9fa8ad850a49ddf2ed37e527901f8/rust-sdk/whirlpool/src/swap.rs#L70-L112)
- [`swap_quote_by_input_token` and `swap_quote_by_output_token`](https://github.com/orca-so/whirlpools/blob/4c75c2f0bbc9fa8ad850a49ddf2ed37e527901f8/rust-sdk/core/src/quote/swap.rs#L29-L149)
- [`compute_swap`](https://github.com/orca-so/whirlpools/blob/4c75c2f0bbc9fa8ad850a49ddf2ed37e527901f8/rust-sdk/core/src/quote/swap.rs#L178-L295)
- [`compute_swap_step`](https://github.com/orca-so/whirlpools/blob/4c75c2f0bbc9fa8ad850a49ddf2ed37e527901f8/rust-sdk/core/src/quote/swap.rs#L326-L412)