# Understanding Whirlpool Fees

When a user performs a swap on a Whirlpool, a percentage of the swap input amount may be taken as a fee. This fee can be structured in two main ways: Fixed Fees or Adaptive Fees, depending on the pool's configuration. The fee collected is allocated between liquidity providers and a protocol fee.

## Fixed Fees

Standard Whirlpools utilize a fixed fee structure.

### Total Swap Fee

For pools with fixed fees, the total fee collected from the user is referred to as the `fee_rate`. It is stored as a hundredths of a basis point on the [Whirlpool](https://github.com/orca-so/whirlpools/blob/2c9366a74edc9fefd10caa3de28ba8a06d03fc1e/programs/whirlpool/src/state/whirlpool.rs) account.

A 0.01% (1bps) swap fee would equate to a `fee_rate` value of 100.

$$
\text{swap\_fee} = \frac{\text{input\_amount} \times \text{fee\_rate}}{1000000}
$$

### Fee Breakdown

#### Protocol Fee

The `protocol_fee` is the portion of the swap fee diverted to a wallet controlled by the WhirlpoolConfig's `collectProtocolFeesAuthority`. This often serves as the treasury for the protocol hosting the Whirlpools program.

The `protocol_fee_rate` determines the proportion of the total swap fee allocated to the protocol. It is stored as a basis point on the Whirlpool account. For example, if 3% of the total swap fee is diverted to the protocol, the `protocol_fee_rate` would be 300.

$$
\text{protocol\_fee} = \frac{\text{swap\_fee} \times \text{protocol\_fee\_rate}}{10000}
$$

#### Liquidity Provider Fee

Liquidity providers receive the remaining portion of the swap fee after the protocol fee has been subtracted.

$$
\text{LP\_fee} = \text{swap\_fee} - \text{protocol\_fee}
$$

## Adaptive Fees

Orca introduces Adaptive Fees as an alternative fee structure for specific Whirlpools, designed to respond dynamically to market volatility.

### The Mathematics Behind Orca's Adaptive Fees

Orca's implementation of adaptive fees draws inspiration from dynamic fee mechanisms found in various Liquidity Book designs. However, since Orca is based on a CLMM model, the adaptive fee system has been specifically tailored for CLMMs, with additional enhancements for security and performance.

The fee system consists of two components:

- **Base Fee $f_b$**: A static minimum fee that applies to all swaps. This corresponds to the fixed `fee_rate` described earlier.
- **Variable Fee $f_v$**: A dynamic component that responds to market volatility.

The total swap fee $f_s$ is the sum of these components: $f_s = f_b + f_v$. Orca enforces a hard limit of 10% on the total swap fee.

The variable (adaptive) fee component is calculated as:

$$ f_v = A \times (v_a \times s)^2 $$

Where:

- $A$: The `variableFeeControl` parameter set in the config of the Adaptive Fee Tier account.
- $v_a$: The volatility accumulator.
- $s$: The tick group size.

The squaring effect creates a non-linear relationship between volatility and fees, making fees increase more dramatically during high volatility.

### Volatility Measurement

#### Tick Groups

Volatility for Orca's Adaptive Fee system is described in terms of "Tick Group crossings" within a single transaction:

- **Tick Groups**: Segments of the price range that bundle multiple ticks together.
- **Fee Adjustment Mechanism**: As the price moves across tick groups during a swap transaction, the protocol recognizes this as volatility.

The system uses different tick group sizes based on pool type:

- For standard concentrated liquidity pools: Tick Group Size = Tick Spacing
- For Splash Pools (full-range only pools): Tick Group Size = 128

This ensures that the volatility measurement is appropriately scaled for different pool types. Since Splash Pools have a very large tick spacing, a tick spacing of 128 is used, corresponding to the tick spacing of the 1% fee tier.

#### The Volatility Accumulator

The core of the system is the volatility accumulator $v_a$, which captures recent market turbulence. It is defined as a function of a reference volatility value $v_r$, a reference tick group index $i_r$, the active tick group index at the beginning of the transaction $i_s$, and the crossed tick groups $k$:

$$ v_a = v_r + |i_r - (i_s \pm k)| $$

The reference values $v_r$ and $i_r$ are calculated at the beginning of each transaction and depend on the time elapsed $t$ since the last transaction. The calculation is defined by constants set in the config of the Adaptive Fee Tier account: `filterPeriod` $t_f$, `decayPeriod` $t_d$, and the `reductionFactor` $R$:

$$ v_r = \begin{cases} v_r & \text{if } t < t_f \\ R \times v_a & \text{if } t_f \le t < t_d \\ 0 & \text{if } t_d \le t \end{cases} $$

$$ i_r = \begin{cases} i_r & \text{if } t < t_f \\ i_s & \text{if } t_f \le t \end{cases} $$

#### Volatility Accumulator Example

Let's work through an example calculation for the volatility accumulator using simple values:

##### Constants:

- Filter period $$t_f$$ = 1
- Decay period $$t_d$$ = 10
- Reduction factor $$R$$ = 0.5
- Initial reference tick group index $$i_r$$ = 1000

##### Swap 1:

Tick groups crossed: 2

$$
v_r = 0
$$

$$
i_r = 1000
$$

$$
v_a = 0 + |1000 - (1000 + 2)| = 2
$$

##### Swap 2:

Tick groups crossed: +4, t = 5

$$
v_r = 0.5 \times 2 = 1
$$

$$
i_r = 1002
$$

$$
v_a =  1 + |1002 - (1002 + 4)| = 1 + 4 = 5
$$

##### Swap 3:

Tick groups crossed: -6, t = 0.5

$$
v_r = 1
$$

$$
i_r = 1002
$$

$$
v_a = 1 + |1002 - (1006 - 6)| = 3
$$

This example demonstrates how the volatility accumulator measures price movement across tick groups and decays over time, allowing fees to respond dynamically to market conditions.

### Security Enhancements

To prevent manipulation of the volatility accumulator through many small swaps, the system introduces the concept of a "major swap threshold". References $v_r$, $i_r$ are only updated based on transactions where the number of ticks crossed (i.e., price movement) is greater than this threshold (`majorSwapThresholdTicks`). This threshold is set in the config of the Adaptive Fee Tier account.

The time elapsed since the last reference update is calculated as:

$$
\text{elapsed\_time} = \text{current\_time} - \max(t_{ref}, t_{maj})
$$

Where:

- $t_{ref}$: The timestamp of the last reference update
- $t_{maj}$: The timestamp of the last major swap

If the `elapsed_time` reaches `MAX_REFERENCE_AGE` (1 hour), it implies that major swaps might have been occurring continuously. This situation suggests a potential orchestrated pattern rather than natural market behavior. The system addresses this with a forced reset mechanism that unconditionally returns fees to their base levels, regardless of recent trading activity.

### The Skip Feature

The Skip feature optimizes calculations by identifying scenarios where calculating an Adaptive Fee for each tick group is unnecessary, allowing the process to "skip" directly to the next relevant position. The protocol bypasses Adaptive Fee calculations in three specific scenarios:

1.  **Zero Liquidity Areas**: When current pool liquidity is zero, the swap can jump directly to the next position where liquidity becomes available. Since zero liquidity means zero trade output, no fee calculations are needed in the empty range.
2.  **When Adaptive Fee Control Factor is Zero**: If pools use an Adaptive Fee tier but have set their `adaptiveFeeControlFactor` to zero (effectively disabling the variable fee component), the system recognizes this and skips the unnecessary variable fee calculations.
3.  **Beyond Maximum Volatility Range**: The protocol defines a "core range" around the reference tick $i_r$. When prices move beyond this range, the volatility accumulator $v_a$ reaches its maximum value (`maxVolatilityAccumulator`), and the Adaptive Fee stops increasing. The system recognizes when a swap moves outside this core range and skips redundant calculations within that extended movement.

After skipping, the system recalculates:

- The correct tick group index based on the new price position.
- The appropriate volatility accumulator value.

### New Accounts In Orca's Whirlpools

To accommodate Adaptive Fees, two new account types are added to the Whirlpools program:

#### Adaptive Fee Tier Account

This account contains the configuration parameters that govern adaptive fee behavior for pools referencing it. Multiple pools can share the same Adaptive Fee Tier Account.

- `filter_period`: The minimum time between volatility reference updates (defines high-frequency trading window).
- `decay_period`: Time threshold after which volatility fully resets if no major swaps occur.
- `reduction_factor`: Rate at which volatility decays during updates (represented as a fraction of 10,000).
- `adaptive_fee_control_factor`: Controls how aggressively fees respond to volatility $A$.
- `max_volatility_accumulator`: Upper limit for the volatility measurement $v_a$.
- `major_swap_threshold_ticks`: Minimum price movement (in ticks) required to be considered a significant swap for reference updates.

#### Oracle Account

This account stores the dynamic state and cloned configuration constants for adaptive fee behavior specific to a single pool. Each pool initialized with adaptive fees enabled has its own Oracle account. The constants are copied from the referenced Adaptive Fee Tier Account during pool initialization.

- `last_reference_update_timestamp`: When volatility references $v_r$, $i_r$ were last updated.
- `last_major_swap_timestamp`: When the last major swap (exceeding the threshold) occurred.
- `volatility_reference`: The decayed volatility value $v_r$ used as the baseline for the current period.
- `tick_group_index_reference`: The reference tick group $i_r$ against which movement is measured.
- `volatility_accumulator`: The current accumulated measure of market volatility $v_a$ for the pool.
