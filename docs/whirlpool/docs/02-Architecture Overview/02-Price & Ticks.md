# Price & Ticks

## Tracking Price
Whirlpool tracks price using **square-root price**. Each pool supports a sqrt-price range between $\left[ 2^{-64}, 2^{64} \right]$.

## Tick
Users can deposit liquidity on a custom price range in a Whirlpool. The smallest unit of price measurement (**tick**) is 1bps. Whirlpool represents the price range as a sequence of ticks and stores accounting information in each initialized tick that hosts liquidity.

Sqrt-price maps to a tick with the formula below. Each tick represents 1 basis point of change from the neighboring tick.
$$
\sqrt{p}(i) = \sqrt{1.0001}^{i}\\
$$
Given the supported price-range of $\left[ 2^{-64}, 2^{64} \right]$, the tick range for a Whirlpool is $\left[ -443636, 443636 \right]$.

The Whirlpool account tracks both the current sqrt-price and the current tick-index.

## Understanding Tick Spacing
Due to compute cost and rent constraints, it is often not economical for a Whirlpool to allow users to deposit liquidity into every single tick. Whirlpools requires pool owners to define an additional "Tick-Spacing" parameter. This allows them to define the space between "initializable ticks", where liquidity information can be stored.

A tick-spacing of 5 means that liquidity can be deposited into tick-index that are a multiple of 5. (ex. [...-10, -5, 0, 5, 10...]).

As a general rule, the smaller the expected volatility of a pool is, the smaller tick-spacing should be. To help you decide on the best tick-spacing for your whirlpool, consider the following attributes.

### 1. Granularity of user definable price ranges
The smaller your tick-spacing, the more granular the price users can deposit their liquidity in. For more stable pools, a more granular tick-spacing would let users define a tighter range to maximize their leverage.

**Tick Spacing = 1**
| **Price** | **Initializable Tick Index** |
|---|---|
| 1.0001^{-2} = \frac{1}{1.00020001} | -2 |
| 1.0001^{-1} = \frac{1}{1.0001} | -1 |
| 1.0001^0 = 1 | 0 |
| 1.0001^1 = 1.0001 | 1 |
| 1.0001^2 = 1.00020001 | 2 |

**Tick Spacing = 100**
| Price | **Initializable Tick Index** |
|---|---|
| 1.0001^{-200} = \frac{1}{1.0202003198939318} | -200 |
| 1.0001^{-100} = \frac{1}{1.0100496620928754} | -100 |
| 1.0001^0 = 1 | 0 |
| 1.0001^{100} = 1.0100496620928754 | 100 |
| 1.0001^{200} = 1.0202003198939318 | 200 |

### 2. Maximum price movement per swap
The size of the tick-spacing defines the maximum price movement a single swap can move the price by for a Whirlpool. 

Whirlpool's swap operates by iterating through each ticks with initialized liquidity. The larger the gap between initialized ticks are, the more it can theoretically traverse the price range.

A low tick-spacing pool undergoing a massive price movement may require multiple swap instructions to complete the price movement. Therefore, more volatile pairs that often has large price swings should look at higher tick-spacing to mitigate this pain point for their pool users.

### 3. Account rent cost for users
On-chain storage requires account space, and the more data a program needs to store, the higher the rent required. With larger tick-spacing, fewer ticks are needed to manage liquidity across a set price range, reducing the storage cost for users.