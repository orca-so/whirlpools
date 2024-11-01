# Understanding Whirlpool Fees

When a user performs a swap on a Whirlpool, a percentage of the swap input amount may be taken as a fee, allocated between liquidity providers and a protocol fee.

## Total Fee

On the protocol, the total fee collected from the user is referred as the fee-rate. It is stored as a hundredths of a basis point on the [Whirlpool](https://github.com/orca-so/whirlpools/blob/2c9366a74edc9fefd10caa3de28ba8a06d03fc1e/programs/whirlpool/src/state/whirlpool.rs) account.

A 0.01% (1bps) swap fee would equate to a fee_rate value of 100.

$$
\text{swap\_fee} = \frac{\text{input\_amount} \times \text{fee\_rate}}{1000000}
$$

## Fee Breakdown
### ProtocolFee
The `protocol_fee` is the fee diverted to a wallet that only the WhirlpoolConfig's `collectProtocolFeesAuthority` can collect. Often, this is used as the treasury of the protocol hosting the Whirlpools program.

It is stored as a basis point of the total fees collected on the Whirlpool account. For example, 3% of the total swap fee is diverted to the protocol would have a protocol_fee value of 300.

$$
\text{protocol\_fee} = \frac{\text{swap\_fee} \times \text{protocol\_fee\_rate}}{10000}
$$

### Liquidity Provider Fee
The liquidity providers get all of the remaining fees once the protocol fee is subtracted.

$$
\text{LP\_fee} = \text{swap\_fee} - \text{protocol\_fee}
$$
