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
Swap users will have to provide the series of tick-arrays that the swap will traverse across.

The first tick-array in the sequence typically houses the Whirlpool's current tick index, though this is not always required. 

The second and third tick arrays are the next tick-arrays in the swap direction. If the user knows the swap will not traverse to the next tick-array, or it's simply not possible at both ends of the price range, they can just put in any tick-array public key.

In some cases, such as with the new swap instruction, users can pass in up to six tick-arrays, with only three arrays being crossed during a swap. For example, the Whirlpools SDK preemptively provides the tick-array containing the current price, along with two arrays below and two above it, ensuring adequate coverage for different price ranges.