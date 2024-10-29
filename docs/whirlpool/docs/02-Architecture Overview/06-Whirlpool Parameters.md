---
sidebar_label: Whirlpools Parameters
---

# Orca Whirlpool Parameters
Orca Whirlpools uses the Whirlpools smart-contract to host liquidity for token pairs. Below are the set of constants Orca used to host their program.

## Whirlpool Program ID
| Cluster       | Address                                          |
|---------------|--------------------------------------------------|
| Mainnet-Beta  | whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc      |
| Devnet        | whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc      |

## WhirlpoolConfig Address
| Cluster       | Address                                         |
|---------------|-------------------------------------------------|
| Mainnet-Beta  | 2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ    |
| Devnet        | FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR    |

## WhirlpoolConfigExtension Address
| Cluster       | Address                                         |
|---------------|-------------------------------------------------|
| Mainnet-Beta  | 777H5H3Tp9U11uRVRzFwM8BinfiakbaLT8vQpeuhvEiH    |
| Devnet        | 475EJ7JqnRpVLoFVzp2ruEYvWWMCf6Z8KMWRujtXXNSU    |

## Initialized FeeTier and TickSpacing

### Trading Fees
Pools with a fee tier of  ≥0.3% have the trading fee divided as follows: 
- 87% to the maker (Liquidity Provider)
- 12% to the DAO treasury
- 1% to the Climate Fund

For pools with a fee tier of lower than 0.3% all fees are paid to the maker (Liquidity provider).

**Fee Rate**: When creating a new pool, users can select the fee rate paid by traders - a fee rate on a CLAMM is the same as a spread on an order-book.

The table, below, shows the fees paid by the taker (trader) and how the total value of the trade is shared as fees between the maker (liquidity provider), Orca DAO treasury, and Climate Fund. 

| Pool Fee Tier | Taker Fee | Maker Fee | DAO Treasury | Climate Fund |
|---------------|-----------|-----------|--------------|--------------|
| 2% pool       | 2%        | 1.74%     | 0.24%        | 0.02%        |
| 1% pool       | 1%        | 0.87%     | 0.12%        | 0.01%        |
| 0.65% pool    | 0.65%     | 0.5655%   | 0.0078%      | 0.0065%      |
| 0.3% pool     | 0.3%      | 0.261%    | 0.036%       | 0.003%       |
| 0.16% pool    | 0.16%     | 0.1392%   | 0.0192%      | 0.0016%      |
| 0.05% pool    | 0.05%     | 0.05%     | -            | -            |
| 0.01% pool    | 0.01%     | 0.01%     | -            | -            |

### Mainnet-Beta
| TickSpacing | Fee Rate | Address                                      |
|-------------|----------|----------------------------------------------|
| 1           | 0.01%    | 62dSkn5ktwY1PoKPNMArZA4bZsvyemuknWUnnQ2ATTuN |
| 2           | 0.02%    | BH9LXGqLhZV3hdvShYZhgQQEjPVKhHPyHwjnsxjETFRr |
| 4           | 0.04%    | 9zfDkPMnx9ei8mZVfCsLjkBzXob7H3PuAhabmUVAiuJF |
| 8           | 0.05%    | GBtp54LJqqDSWonLT878KWerkJAYqYq4jasZ1UYs8wfD |
| 16          | 0.16%    | 87u3YRwJDNR2wozMTF3umYRgny8UMZ2mHN3UBTSXm8Ho |
| 64          | 0.30%    | HT55NVGVTjWmWLjV7BrSMPVZ7ppU8T2xE5nCAZ6YaGad |
| 96          | 0.65%    | FapWifnwxWnXQggHBk5XR9bfqAo7H53Gm3ph9Rnb8UTy |
| 128         | 1.00%    | BGnhGXT9CCt5WYS23zg9sqsAT2MGXkq7VSwch9pML82W |
| 256         | 2.00%    | 72NKr3dFXyYWKkgF814hRrdpLjXHJ6F3DwUXxFmAYmp4 |
| 32896       | 1.00%    | zVmMsL5qGh7txhTHFgGZcFQpSsxSx6DBLJ3u113PBer  |

### Devnet
| TickSpacing | Fee Rate | Address                                      |
|-------------|----------|----------------------------------------------|
| 1           | 0.01%    | CtfHwxDmdYtoWyeSyh3NUWk43FnehVhhtwuYdWwZcVyt |
| 2           | 0.02%    | HgiLjqu6BW5fa9hBgK9GJ8WoTpY4cjWq47RjazbfzbSH |
| 4           | 0.04%    | 2PdLb9QP1NJUbv8iLx4YycbGHep9NvATpqbt7A7BvFEp |
| 8           | 0.05%    | DV9sQ4gQTYeEodFap6xiiJkcmYYr94EPFmu7gWXaQTym |
| 16          | 0.10%    | 8tXXA2fUehmJtBZuAiCR3rzP7UGUCM9DCVyM4G8PL1R9 |
| 32          | 0.20%    | Gyk4CgZDzYv7YvsG4ELLgR12vVuDrghb6EFhSM1gerRj |
| 64          | 0.20%    | nhg1SS1hNFnJKZrJ9FBf3L6SxTjwEnkehN7dmAbg25t  |
| 128         | 0.40%    | G319n1BPjeXjAfheDxYe8KWZM7FQhQCJerWRK2nZYtiJ |
| 256         | 1.00%    | 6b8hEAH62GoPqbmgsR3DTFFoBefbZU7hE24uNXHPHR7i |
| 32896       | 1.00%    | 8EHtyN3DBseSZzHYkxXuT2GDoPmqmKEtbbaNrabFZhdL |
