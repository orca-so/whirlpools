# Understanding Tick Arrays
![TickArray Account Architecture](../../static/img/02-Architecture%20Overview/tickarray-overview.png)

A sequence of ticks are stored in individual **tick-array** accounts on chain. Each whirlpool has a sequence of tick-array accounts to host the entire tick range. 

A tick-array is keyed by the start-index of its hosted ticks and can hold 88 physical ticks in an array. It only hosts the tick objects for the initializable tick indices based on the Whirlpool's tick-spacing. The total range for a tick-array is therefore 88 * tick-spacing.

**Tick Array Account Info**
- Number of physical tick slots - 88
- Account Size - 10kb

## Usage in Whirlpool Program Instructions
When you interact with ticks on Whirlpool instructions, often you will need to derive the correct tick-array so the program can get access to the designated tick object.

### Open Position
A position opening up in a brand new tick/price area would need to initialize the tick-array prior to creating the position. This means the user who invoke that position would have to pay for the rent-exempt cost (tick-array accounts are 10kb).

Whirlpool owners can consider preemptively initializing tick-array ranges to avoid user surprises. Once the tick-array account is setup, it will never have to be reinitialized.

### Adjust Liquidity (increase / decrease liquidity)
Users of these instructions would need to pass in the tick-array that houses the tick-index that are passed in. The instruction would need access to these accounts to read the appropriate Tick object.

### Swap
Swap users will have to provide the series of tick-arrays that the swap will traverse across.

The first tick-array in the sequence is the tick-array that houses the Whirlpool's current tick index.

The second and third tick arrays are the next tick-arrays in the swap direction. If the user knows the swap will not traverse to the next tick-array, or it's simply not possible at both ends of the price range, they can just put in any tick-array public key.