/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/whirlpool.json`.
 */
export type Whirlpool = {
  "address": "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  "metadata": {
    "name": "whirlpool",
    "version": "0.6.1",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "closeBundledPosition",
      "docs": [
        "Close a bundled position in a Whirlpool.",
        "",
        "### Authority",
        "- `position_bundle_authority` - authority that owns the token corresponding to this desired position bundle.",
        "",
        "### Parameters",
        "- `bundle_index` - The bundle index that we'd like to close.",
        "",
        "#### Special Errors",
        "- `InvalidBundleIndex` - If the provided bundle index is out of bounds.",
        "- `ClosePositionNotEmpty` - The provided position account is not empty."
      ],
      "discriminator": [
        41,
        36,
        216,
        245,
        27,
        85,
        103,
        67
      ],
      "accounts": [
        {
          "name": "bundledPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  110,
                  100,
                  108,
                  101,
                  100,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "position_bundle.position_bundle_mint",
                "account": "positionBundle"
              },
              {
                "kind": "arg",
                "path": "bundleIndex"
              }
            ]
          }
        },
        {
          "name": "positionBundle",
          "writable": true
        },
        {
          "name": "positionBundleTokenAccount"
        },
        {
          "name": "positionBundleAuthority",
          "signer": true
        },
        {
          "name": "receiver",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "bundleIndex",
          "type": "u16"
        }
      ]
    },
    {
      "name": "closePosition",
      "docs": [
        "Close a position in a Whirlpool. Burns the position token in the owner's wallet.",
        "",
        "### Authority",
        "- \"position_authority\" - The authority that owns the position token.",
        "",
        "#### Special Errors",
        "- `ClosePositionNotEmpty` - The provided position account is not empty."
      ],
      "discriminator": [
        123,
        134,
        81,
        0,
        49,
        68,
        98,
        98
      ],
      "accounts": [
        {
          "name": "positionAuthority",
          "signer": true
        },
        {
          "name": "receiver",
          "writable": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ]
          }
        },
        {
          "name": "positionMint",
          "writable": true
        },
        {
          "name": "positionTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "closePositionWithTokenExtensions",
      "docs": [
        "Close a position in a Whirlpool. Burns the position token in the owner's wallet.",
        "Mint and TokenAccount are based on Token-2022. And Mint accout will be also closed.",
        "",
        "### Authority",
        "- \"position_authority\" - The authority that owns the position token.",
        "",
        "#### Special Errors",
        "- `ClosePositionNotEmpty` - The provided position account is not empty."
      ],
      "discriminator": [
        1,
        182,
        135,
        59,
        155,
        25,
        99,
        223
      ],
      "accounts": [
        {
          "name": "positionAuthority",
          "signer": true
        },
        {
          "name": "receiver",
          "writable": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ]
          }
        },
        {
          "name": "positionMint",
          "writable": true
        },
        {
          "name": "positionTokenAccount",
          "writable": true
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        }
      ],
      "args": []
    },
    {
      "name": "collectFees",
      "docs": [
        "Collect fees accrued for this position.",
        "",
        "### Authority",
        "- `position_authority` - authority that owns the token corresponding to this desired position."
      ],
      "discriminator": [
        164,
        152,
        207,
        99,
        30,
        186,
        19,
        182
      ],
      "accounts": [
        {
          "name": "whirlpool",
          "relations": [
            "position"
          ]
        },
        {
          "name": "positionAuthority",
          "signer": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "positionTokenAccount"
        },
        {
          "name": "tokenOwnerAccountA",
          "writable": true
        },
        {
          "name": "tokenVaultA",
          "writable": true
        },
        {
          "name": "tokenOwnerAccountB",
          "writable": true
        },
        {
          "name": "tokenVaultB",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "collectFeesV2",
      "docs": [
        "Collect fees accrued for this position.",
        "This instruction works with both Token and Token-2022.",
        "",
        "### Authority",
        "- `position_authority` - authority that owns the token corresponding to this desired position."
      ],
      "discriminator": [
        207,
        117,
        95,
        191,
        229,
        180,
        226,
        15
      ],
      "accounts": [
        {
          "name": "whirlpool",
          "relations": [
            "position"
          ]
        },
        {
          "name": "positionAuthority",
          "signer": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "positionTokenAccount"
        },
        {
          "name": "tokenMintA"
        },
        {
          "name": "tokenMintB"
        },
        {
          "name": "tokenOwnerAccountA",
          "writable": true
        },
        {
          "name": "tokenVaultA",
          "writable": true
        },
        {
          "name": "tokenOwnerAccountB",
          "writable": true
        },
        {
          "name": "tokenVaultB",
          "writable": true
        },
        {
          "name": "tokenProgramA"
        },
        {
          "name": "tokenProgramB"
        },
        {
          "name": "memoProgram",
          "address": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        }
      ],
      "args": [
        {
          "name": "remainingAccountsInfo",
          "type": {
            "option": {
              "defined": {
                "name": "remainingAccountsInfo"
              }
            }
          }
        }
      ]
    },
    {
      "name": "collectProtocolFees",
      "docs": [
        "Collect the protocol fees accrued in this Whirlpool",
        "",
        "### Authority",
        "- `collect_protocol_fees_authority` - assigned authority in the WhirlpoolConfig that can collect protocol fees"
      ],
      "discriminator": [
        22,
        67,
        23,
        98,
        150,
        178,
        70,
        220
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "whirlpool"
          ]
        },
        {
          "name": "whirlpool",
          "writable": true
        },
        {
          "name": "collectProtocolFeesAuthority",
          "signer": true
        },
        {
          "name": "tokenVaultA",
          "writable": true
        },
        {
          "name": "tokenVaultB",
          "writable": true
        },
        {
          "name": "tokenDestinationA",
          "writable": true
        },
        {
          "name": "tokenDestinationB",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "collectProtocolFeesV2",
      "docs": [
        "Collect the protocol fees accrued in this Whirlpool",
        "This instruction works with both Token and Token-2022.",
        "",
        "### Authority",
        "- `collect_protocol_fees_authority` - assigned authority in the WhirlpoolConfig that can collect protocol fees"
      ],
      "discriminator": [
        103,
        128,
        222,
        134,
        114,
        200,
        22,
        200
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "whirlpool"
          ]
        },
        {
          "name": "whirlpool",
          "writable": true
        },
        {
          "name": "collectProtocolFeesAuthority",
          "signer": true
        },
        {
          "name": "tokenMintA"
        },
        {
          "name": "tokenMintB"
        },
        {
          "name": "tokenVaultA",
          "writable": true
        },
        {
          "name": "tokenVaultB",
          "writable": true
        },
        {
          "name": "tokenDestinationA",
          "writable": true
        },
        {
          "name": "tokenDestinationB",
          "writable": true
        },
        {
          "name": "tokenProgramA"
        },
        {
          "name": "tokenProgramB"
        },
        {
          "name": "memoProgram",
          "address": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        }
      ],
      "args": [
        {
          "name": "remainingAccountsInfo",
          "type": {
            "option": {
              "defined": {
                "name": "remainingAccountsInfo"
              }
            }
          }
        }
      ]
    },
    {
      "name": "collectReward",
      "docs": [
        "Collect rewards accrued for this position.",
        "",
        "### Authority",
        "- `position_authority` - authority that owns the token corresponding to this desired position."
      ],
      "discriminator": [
        70,
        5,
        132,
        87,
        86,
        235,
        177,
        34
      ],
      "accounts": [
        {
          "name": "whirlpool",
          "relations": [
            "position"
          ]
        },
        {
          "name": "positionAuthority",
          "signer": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "positionTokenAccount"
        },
        {
          "name": "rewardOwnerAccount",
          "writable": true
        },
        {
          "name": "rewardVault",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "rewardIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "collectRewardV2",
      "docs": [
        "Collect rewards accrued for this position.",
        "This instruction works with both Token and Token-2022.",
        "",
        "### Authority",
        "- `position_authority` - authority that owns the token corresponding to this desired position."
      ],
      "discriminator": [
        177,
        107,
        37,
        180,
        160,
        19,
        49,
        209
      ],
      "accounts": [
        {
          "name": "whirlpool",
          "relations": [
            "position"
          ]
        },
        {
          "name": "positionAuthority",
          "signer": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "positionTokenAccount"
        },
        {
          "name": "rewardOwnerAccount",
          "writable": true
        },
        {
          "name": "rewardMint"
        },
        {
          "name": "rewardVault",
          "writable": true
        },
        {
          "name": "rewardTokenProgram"
        },
        {
          "name": "memoProgram",
          "address": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        }
      ],
      "args": [
        {
          "name": "rewardIndex",
          "type": "u8"
        },
        {
          "name": "remainingAccountsInfo",
          "type": {
            "option": {
              "defined": {
                "name": "remainingAccountsInfo"
              }
            }
          }
        }
      ]
    },
    {
      "name": "decreaseLiquidity",
      "docs": [
        "Withdraw liquidity from a position in the Whirlpool. This call also updates the position's accrued fees and rewards.",
        "",
        "### Authority",
        "- `position_authority` - authority that owns the token corresponding to this desired position.",
        "",
        "### Parameters",
        "- `liquidity_amount` - The total amount of Liquidity the user desires to withdraw.",
        "- `token_min_a` - The minimum amount of tokenA the user is willing to withdraw.",
        "- `token_min_b` - The minimum amount of tokenB the user is willing to withdraw.",
        "",
        "#### Special Errors",
        "- `LiquidityZero` - Provided liquidity amount is zero.",
        "- `LiquidityTooHigh` - Provided liquidity exceeds u128::max.",
        "- `TokenMinSubceeded` - The required token to perform this operation subceeds the user defined amount."
      ],
      "discriminator": [
        160,
        38,
        208,
        111,
        104,
        91,
        44,
        1
      ],
      "accounts": [
        {
          "name": "whirlpool",
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "positionAuthority",
          "signer": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "positionTokenAccount"
        },
        {
          "name": "tokenOwnerAccountA",
          "writable": true
        },
        {
          "name": "tokenOwnerAccountB",
          "writable": true
        },
        {
          "name": "tokenVaultA",
          "writable": true
        },
        {
          "name": "tokenVaultB",
          "writable": true
        },
        {
          "name": "tickArrayLower",
          "writable": true
        },
        {
          "name": "tickArrayUpper",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "liquidityAmount",
          "type": "u128"
        },
        {
          "name": "tokenMinA",
          "type": "u64"
        },
        {
          "name": "tokenMinB",
          "type": "u64"
        }
      ]
    },
    {
      "name": "decreaseLiquidityV2",
      "docs": [
        "Withdraw liquidity from a position in the Whirlpool. This call also updates the position's accrued fees and rewards.",
        "This instruction works with both Token and Token-2022.",
        "",
        "### Authority",
        "- `position_authority` - authority that owns the token corresponding to this desired position.",
        "",
        "### Parameters",
        "- `liquidity_amount` - The total amount of Liquidity the user desires to withdraw.",
        "- `token_min_a` - The minimum amount of tokenA the user is willing to withdraw.",
        "- `token_min_b` - The minimum amount of tokenB the user is willing to withdraw.",
        "",
        "#### Special Errors",
        "- `LiquidityZero` - Provided liquidity amount is zero.",
        "- `LiquidityTooHigh` - Provided liquidity exceeds u128::max.",
        "- `TokenMinSubceeded` - The required token to perform this operation subceeds the user defined amount."
      ],
      "discriminator": [
        58,
        127,
        188,
        62,
        79,
        82,
        196,
        96
      ],
      "accounts": [
        {
          "name": "whirlpool",
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "tokenProgramA"
        },
        {
          "name": "tokenProgramB"
        },
        {
          "name": "memoProgram",
          "address": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        },
        {
          "name": "positionAuthority",
          "signer": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "positionTokenAccount"
        },
        {
          "name": "tokenMintA"
        },
        {
          "name": "tokenMintB"
        },
        {
          "name": "tokenOwnerAccountA",
          "writable": true
        },
        {
          "name": "tokenOwnerAccountB",
          "writable": true
        },
        {
          "name": "tokenVaultA",
          "writable": true
        },
        {
          "name": "tokenVaultB",
          "writable": true
        },
        {
          "name": "tickArrayLower",
          "writable": true
        },
        {
          "name": "tickArrayUpper",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "liquidityAmount",
          "type": "u128"
        },
        {
          "name": "tokenMinA",
          "type": "u64"
        },
        {
          "name": "tokenMinB",
          "type": "u64"
        },
        {
          "name": "remainingAccountsInfo",
          "type": {
            "option": {
              "defined": {
                "name": "remainingAccountsInfo"
              }
            }
          }
        }
      ]
    },
    {
      "name": "deletePositionBundle",
      "docs": [
        "Delete a PositionBundle account. Burns the position bundle token in the owner's wallet.",
        "",
        "### Authority",
        "- `position_bundle_owner` - The owner that owns the position bundle token.",
        "",
        "### Special Errors",
        "- `PositionBundleNotDeletable` - The provided position bundle has open positions."
      ],
      "discriminator": [
        100,
        25,
        99,
        2,
        217,
        239,
        124,
        173
      ],
      "accounts": [
        {
          "name": "positionBundle",
          "writable": true
        },
        {
          "name": "positionBundleMint",
          "writable": true
        },
        {
          "name": "positionBundleTokenAccount",
          "writable": true
        },
        {
          "name": "positionBundleOwner",
          "signer": true
        },
        {
          "name": "receiver",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "deleteTokenBadge",
      "docs": [
        "Delete a TokenBadge account.",
        "",
        "### Authority",
        "- \"token_badge_authority\" - Set authority in the WhirlpoolConfigExtension",
        "",
        "### Special Errors",
        "- `FeatureIsNotEnabled` - If the feature flag for token badges is not enabled."
      ],
      "discriminator": [
        53,
        146,
        68,
        8,
        18,
        117,
        17,
        185
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "whirlpoolsConfigExtension",
            "tokenBadge"
          ]
        },
        {
          "name": "whirlpoolsConfigExtension"
        },
        {
          "name": "tokenBadgeAuthority",
          "signer": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenBadge",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  98,
                  97,
                  100,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "whirlpoolsConfig"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "receiver",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "idlInclude",
      "discriminator": [
        223,
        253,
        121,
        121,
        60,
        193,
        129,
        31
      ],
      "accounts": [
        {
          "name": "tickArray"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "increaseLiquidity",
      "docs": [
        "Add liquidity to a position in the Whirlpool. This call also updates the position's accrued fees and rewards.",
        "",
        "### Authority",
        "- `position_authority` - authority that owns the token corresponding to this desired position.",
        "",
        "### Parameters",
        "- `liquidity_amount` - The total amount of Liquidity the user is willing to deposit.",
        "- `token_max_a` - The maximum amount of tokenA the user is willing to deposit.",
        "- `token_max_b` - The maximum amount of tokenB the user is willing to deposit.",
        "",
        "#### Special Errors",
        "- `LiquidityZero` - Provided liquidity amount is zero.",
        "- `LiquidityTooHigh` - Provided liquidity exceeds u128::max.",
        "- `TokenMaxExceeded` - The required token to perform this operation exceeds the user defined amount."
      ],
      "discriminator": [
        46,
        156,
        243,
        118,
        13,
        205,
        251,
        178
      ],
      "accounts": [
        {
          "name": "whirlpool",
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "positionAuthority",
          "signer": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "positionTokenAccount"
        },
        {
          "name": "tokenOwnerAccountA",
          "writable": true
        },
        {
          "name": "tokenOwnerAccountB",
          "writable": true
        },
        {
          "name": "tokenVaultA",
          "writable": true
        },
        {
          "name": "tokenVaultB",
          "writable": true
        },
        {
          "name": "tickArrayLower",
          "writable": true
        },
        {
          "name": "tickArrayUpper",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "liquidityAmount",
          "type": "u128"
        },
        {
          "name": "tokenMaxA",
          "type": "u64"
        },
        {
          "name": "tokenMaxB",
          "type": "u64"
        }
      ]
    },
    {
      "name": "increaseLiquidityV2",
      "docs": [
        "Add liquidity to a position in the Whirlpool. This call also updates the position's accrued fees and rewards.",
        "This instruction works with both Token and Token-2022.",
        "",
        "### Authority",
        "- `position_authority` - authority that owns the token corresponding to this desired position.",
        "",
        "### Parameters",
        "- `liquidity_amount` - The total amount of Liquidity the user is willing to deposit.",
        "- `token_max_a` - The maximum amount of tokenA the user is willing to deposit.",
        "- `token_max_b` - The maximum amount of tokenB the user is willing to deposit.",
        "",
        "#### Special Errors",
        "- `LiquidityZero` - Provided liquidity amount is zero.",
        "- `LiquidityTooHigh` - Provided liquidity exceeds u128::max.",
        "- `TokenMaxExceeded` - The required token to perform this operation exceeds the user defined amount."
      ],
      "discriminator": [
        133,
        29,
        89,
        223,
        69,
        238,
        176,
        10
      ],
      "accounts": [
        {
          "name": "whirlpool",
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "tokenProgramA"
        },
        {
          "name": "tokenProgramB"
        },
        {
          "name": "memoProgram",
          "address": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        },
        {
          "name": "positionAuthority",
          "signer": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "positionTokenAccount"
        },
        {
          "name": "tokenMintA"
        },
        {
          "name": "tokenMintB"
        },
        {
          "name": "tokenOwnerAccountA",
          "writable": true
        },
        {
          "name": "tokenOwnerAccountB",
          "writable": true
        },
        {
          "name": "tokenVaultA",
          "writable": true
        },
        {
          "name": "tokenVaultB",
          "writable": true
        },
        {
          "name": "tickArrayLower",
          "writable": true
        },
        {
          "name": "tickArrayUpper",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "liquidityAmount",
          "type": "u128"
        },
        {
          "name": "tokenMaxA",
          "type": "u64"
        },
        {
          "name": "tokenMaxB",
          "type": "u64"
        },
        {
          "name": "remainingAccountsInfo",
          "type": {
            "option": {
              "defined": {
                "name": "remainingAccountsInfo"
              }
            }
          }
        }
      ]
    },
    {
      "name": "initializeAdaptiveFeeTier",
      "docs": [
        "Initializes an adaptive_fee_tier account usable by Whirlpools in a WhirlpoolConfig space.",
        "",
        "### Authority",
        "- \"fee_authority\" - Set authority in the WhirlpoolConfig",
        "",
        "### Parameters",
        "- `fee_tier_index` - The index of the fee-tier that this adaptive fee tier will be initialized.",
        "- `tick_spacing` - The tick-spacing that this fee-tier suggests the default_fee_rate for.",
        "- `initialize_pool_authority` - The authority that can initialize pools with this adaptive fee-tier.",
        "- `delegated_fee_authority` - The authority that can set the base fee rate for pools using this adaptive fee-tier.",
        "- `default_fee_rate` - The default fee rate that a pool will use if the pool uses this",
        "fee tier during initialization.",
        "- `filter_period` - Period determine high frequency trading time window. (seconds)",
        "- `decay_period` - Period determine when the adaptive fee start decrease. (seconds)",
        "- `reduction_factor` - Adaptive fee rate decrement rate.",
        "- `adaptive_fee_control_factor` - Adaptive fee control factor.",
        "- `max_volatility_accumulator` - Max volatility accumulator.",
        "- `tick_group_size` - Tick group size to define tick group index.",
        "- `major_swap_threshold_ticks` - Major swap threshold ticks to define major swap.",
        "",
        "#### Special Errors",
        "- `InvalidTickSpacing` - If the provided tick_spacing is 0.",
        "- `InvalidFeeTierIndex` - If the provided fee_tier_index is same to tick_spacing.",
        "- `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE.",
        "- `InvalidAdaptiveFeeConstants` - If the provided adaptive fee constants are invalid."
      ],
      "discriminator": [
        77,
        99,
        208,
        200,
        141,
        123,
        117,
        48
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig"
        },
        {
          "name": "adaptiveFeeTier",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  116,
                  105,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "whirlpoolsConfig"
              },
              {
                "kind": "arg",
                "path": "feeTierIndex"
              }
            ]
          }
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "feeAuthority",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "feeTierIndex",
          "type": "u16"
        },
        {
          "name": "tickSpacing",
          "type": "u16"
        },
        {
          "name": "initializePoolAuthority",
          "type": "pubkey"
        },
        {
          "name": "delegatedFeeAuthority",
          "type": "pubkey"
        },
        {
          "name": "defaultBaseFeeRate",
          "type": "u16"
        },
        {
          "name": "filterPeriod",
          "type": "u16"
        },
        {
          "name": "decayPeriod",
          "type": "u16"
        },
        {
          "name": "reductionFactor",
          "type": "u16"
        },
        {
          "name": "adaptiveFeeControlFactor",
          "type": "u32"
        },
        {
          "name": "maxVolatilityAccumulator",
          "type": "u32"
        },
        {
          "name": "tickGroupSize",
          "type": "u16"
        },
        {
          "name": "majorSwapThresholdTicks",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initializeConfig",
      "docs": [
        "Initializes a WhirlpoolsConfig account that hosts info & authorities",
        "required to govern a set of Whirlpools.",
        "",
        "### Authority",
        "- \"authority\" - Set authority that is one of ADMINS.",
        "",
        "### Parameters",
        "- `fee_authority` - Authority authorized to initialize fee-tiers and set customs fees.",
        "- `collect_protocol_fees_authority` - Authority authorized to collect protocol fees.",
        "- `reward_emissions_super_authority` - Authority authorized to set reward authorities in pools."
      ],
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "signer": true
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "feeAuthority",
          "type": "pubkey"
        },
        {
          "name": "collectProtocolFeesAuthority",
          "type": "pubkey"
        },
        {
          "name": "rewardEmissionsSuperAuthority",
          "type": "pubkey"
        },
        {
          "name": "defaultProtocolFeeRate",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initializeConfigExtension",
      "docs": [
        "Initializes a WhirlpoolConfigExtension account that hosts info & authorities.",
        "",
        "### Authority",
        "- \"fee_authority\" - Set authority in the WhirlpoolConfig"
      ],
      "discriminator": [
        55,
        9,
        53,
        9,
        114,
        57,
        209,
        52
      ],
      "accounts": [
        {
          "name": "config"
        },
        {
          "name": "configExtension",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  95,
                  101,
                  120,
                  116,
                  101,
                  110,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "feeAuthority",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeDynamicTickArray",
      "docs": [
        "Initialize a variable-length tick array for a Whirlpool.",
        "",
        "### Parameters",
        "- `start_tick_index` - The starting tick index for this tick-array.",
        "Has to be a multiple of TickArray size & the tick spacing of this pool.",
        "- `idempotent` - If true, the instruction will not fail if the tick array already exists.",
        "Note: The idempotent option exits successfully if a FixedTickArray is present as well as a DynamicTickArray.",
        "",
        "#### Special Errors",
        "- `InvalidStartTick` - if the provided start tick is out of bounds or is not a multiple of",
        "TICK_ARRAY_SIZE * tick spacing."
      ],
      "discriminator": [
        41,
        33,
        165,
        200,
        120,
        231,
        142,
        50
      ],
      "accounts": [
        {
          "name": "whirlpool"
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "tickArray",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  99,
                  107,
                  95,
                  97,
                  114,
                  114,
                  97,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "whirlpool"
              },
              {
                "kind": "arg",
                "path": "startTickIndex"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "startTickIndex",
          "type": "i32"
        },
        {
          "name": "idempotent",
          "type": "bool"
        }
      ]
    },
    {
      "name": "initializeFeeTier",
      "docs": [
        "Initializes a fee_tier account usable by Whirlpools in a WhirlpoolConfig space.",
        "",
        "### Authority",
        "- \"fee_authority\" - Set authority in the WhirlpoolConfig",
        "",
        "### Parameters",
        "- `tick_spacing` - The tick-spacing that this fee-tier suggests the default_fee_rate for.",
        "- `default_fee_rate` - The default fee rate that a pool will use if the pool uses this",
        "fee tier during initialization.",
        "",
        "#### Special Errors",
        "- `InvalidTickSpacing` - If the provided tick_spacing is 0.",
        "- `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE."
      ],
      "discriminator": [
        183,
        74,
        156,
        160,
        112,
        2,
        42,
        30
      ],
      "accounts": [
        {
          "name": "config"
        },
        {
          "name": "feeTier",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  116,
                  105,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "arg",
                "path": "tickSpacing"
              }
            ]
          }
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "feeAuthority",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tickSpacing",
          "type": "u16"
        },
        {
          "name": "defaultFeeRate",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initializePool",
      "docs": [
        "Initializes a Whirlpool account.",
        "Fee rate is set to the default values on the config and supplied fee_tier.",
        "",
        "### Parameters",
        "- `bumps` - The bump value when deriving the PDA of the Whirlpool address.",
        "- `tick_spacing` - The desired tick spacing for this pool.",
        "- `initial_sqrt_price` - The desired initial sqrt-price for this pool",
        "",
        "#### Special Errors",
        "`InvalidTokenMintOrder` - The order of mints have to be ordered by",
        "`SqrtPriceOutOfBounds` - provided initial_sqrt_price is not between 2^-64 to 2^64",
        ""
      ],
      "discriminator": [
        95,
        180,
        10,
        172,
        84,
        174,
        232,
        40
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "feeTier"
          ]
        },
        {
          "name": "tokenMintA"
        },
        {
          "name": "tokenMintB"
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "whirlpool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  104,
                  105,
                  114,
                  108,
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "whirlpoolsConfig"
              },
              {
                "kind": "account",
                "path": "tokenMintA"
              },
              {
                "kind": "account",
                "path": "tokenMintB"
              },
              {
                "kind": "arg",
                "path": "tickSpacing"
              }
            ]
          }
        },
        {
          "name": "tokenVaultA",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenVaultB",
          "writable": true,
          "signer": true
        },
        {
          "name": "feeTier"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bumps",
          "type": {
            "defined": {
              "name": "whirlpoolBumps"
            }
          }
        },
        {
          "name": "tickSpacing",
          "type": "u16"
        },
        {
          "name": "initialSqrtPrice",
          "type": "u128"
        }
      ]
    },
    {
      "name": "initializePoolV2",
      "docs": [
        "Initializes a Whirlpool account.",
        "This instruction works with both Token and Token-2022.",
        "Fee rate is set to the default values on the config and supplied fee_tier.",
        "",
        "### Parameters",
        "- `bumps` - The bump value when deriving the PDA of the Whirlpool address.",
        "- `tick_spacing` - The desired tick spacing for this pool.",
        "- `initial_sqrt_price` - The desired initial sqrt-price for this pool",
        "",
        "#### Special Errors",
        "`InvalidTokenMintOrder` - The order of mints have to be ordered by",
        "`SqrtPriceOutOfBounds` - provided initial_sqrt_price is not between 2^-64 to 2^64",
        ""
      ],
      "discriminator": [
        207,
        45,
        87,
        242,
        27,
        63,
        204,
        67
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "feeTier"
          ]
        },
        {
          "name": "tokenMintA"
        },
        {
          "name": "tokenMintB"
        },
        {
          "name": "tokenBadgeA",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  98,
                  97,
                  100,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "whirlpoolsConfig"
              },
              {
                "kind": "account",
                "path": "tokenMintA"
              }
            ]
          }
        },
        {
          "name": "tokenBadgeB",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  98,
                  97,
                  100,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "whirlpoolsConfig"
              },
              {
                "kind": "account",
                "path": "tokenMintB"
              }
            ]
          }
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "whirlpool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  104,
                  105,
                  114,
                  108,
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "whirlpoolsConfig"
              },
              {
                "kind": "account",
                "path": "tokenMintA"
              },
              {
                "kind": "account",
                "path": "tokenMintB"
              },
              {
                "kind": "arg",
                "path": "tickSpacing"
              }
            ]
          }
        },
        {
          "name": "tokenVaultA",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenVaultB",
          "writable": true,
          "signer": true
        },
        {
          "name": "feeTier"
        },
        {
          "name": "tokenProgramA"
        },
        {
          "name": "tokenProgramB"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tickSpacing",
          "type": "u16"
        },
        {
          "name": "initialSqrtPrice",
          "type": "u128"
        }
      ]
    },
    {
      "name": "initializePoolWithAdaptiveFee",
      "docs": [
        "Initializes a Whirlpool account and Oracle account with adaptive fee.",
        "",
        "### Parameters",
        "- `initial_sqrt_price` - The desired initial sqrt-price for this pool",
        "- `trade_enable_timestamp` - The timestamp when trading is enabled for this pool (within 72 hours)",
        "",
        "#### Special Errors",
        "`InvalidTokenMintOrder` - The order of mints have to be ordered by",
        "`SqrtPriceOutOfBounds` - provided initial_sqrt_price is not between 2^-64 to 2^64",
        "`InvalidTradeEnableTimestamp` - provided trade_enable_timestamp is not within 72 hours or the adaptive fee-tier is permission-less",
        "`UnsupportedTokenMint` - The provided token mint is not supported by the program (e.g. it has risky token extensions)",
        ""
      ],
      "discriminator": [
        143,
        94,
        96,
        76,
        172,
        124,
        119,
        199
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "adaptiveFeeTier"
          ]
        },
        {
          "name": "tokenMintA"
        },
        {
          "name": "tokenMintB"
        },
        {
          "name": "tokenBadgeA",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  98,
                  97,
                  100,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "whirlpoolsConfig"
              },
              {
                "kind": "account",
                "path": "tokenMintA"
              }
            ]
          }
        },
        {
          "name": "tokenBadgeB",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  98,
                  97,
                  100,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "whirlpoolsConfig"
              },
              {
                "kind": "account",
                "path": "tokenMintB"
              }
            ]
          }
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "initializePoolAuthority",
          "signer": true
        },
        {
          "name": "whirlpool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  104,
                  105,
                  114,
                  108,
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "whirlpoolsConfig"
              },
              {
                "kind": "account",
                "path": "tokenMintA"
              },
              {
                "kind": "account",
                "path": "tokenMintB"
              },
              {
                "kind": "account",
                "path": "adaptive_fee_tier.fee_tier_index",
                "account": "adaptiveFeeTier"
              }
            ]
          }
        },
        {
          "name": "oracle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "whirlpool"
              }
            ]
          }
        },
        {
          "name": "tokenVaultA",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenVaultB",
          "writable": true,
          "signer": true
        },
        {
          "name": "adaptiveFeeTier"
        },
        {
          "name": "tokenProgramA"
        },
        {
          "name": "tokenProgramB"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "initialSqrtPrice",
          "type": "u128"
        },
        {
          "name": "tradeEnableTimestamp",
          "type": {
            "option": "u64"
          }
        }
      ]
    },
    {
      "name": "initializePositionBundle",
      "docs": [
        "Initializes a PositionBundle account that bundles several positions.",
        "A unique token will be minted to represent the position bundle in the users wallet."
      ],
      "discriminator": [
        117,
        45,
        241,
        149,
        24,
        18,
        194,
        65
      ],
      "accounts": [
        {
          "name": "positionBundle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110,
                  95,
                  98,
                  117,
                  110,
                  100,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "positionBundleMint"
              }
            ]
          }
        },
        {
          "name": "positionBundleMint",
          "writable": true,
          "signer": true
        },
        {
          "name": "positionBundleTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "positionBundleOwner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "positionBundleMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "positionBundleOwner"
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": []
    },
    {
      "name": "initializePositionBundleWithMetadata",
      "docs": [
        "Initializes a PositionBundle account that bundles several positions.",
        "A unique token will be minted to represent the position bundle in the users wallet.",
        "Additional Metaplex metadata is appended to identify the token."
      ],
      "discriminator": [
        93,
        124,
        16,
        179,
        249,
        131,
        115,
        245
      ],
      "accounts": [
        {
          "name": "positionBundle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110,
                  95,
                  98,
                  117,
                  110,
                  100,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "positionBundleMint"
              }
            ]
          }
        },
        {
          "name": "positionBundleMint",
          "writable": true,
          "signer": true
        },
        {
          "name": "positionBundleMetadata",
          "docs": [
            "https://github.com/metaplex-foundation/metaplex-program-library/blob/773a574c4b34e5b9f248a81306ec24db064e255f/token-metadata/program/src/utils/metadata.rs#L100"
          ],
          "writable": true
        },
        {
          "name": "positionBundleTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "positionBundleOwner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "positionBundleMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "positionBundleOwner"
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "metadataUpdateAuth",
          "address": "3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "metadataProgram",
          "address": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        }
      ],
      "args": []
    },
    {
      "name": "initializeReward",
      "docs": [
        "Initialize reward for a Whirlpool. A pool can only support up to a set number of rewards.",
        "",
        "### Authority",
        "- \"reward_authority\" - assigned authority by the reward_super_authority for the specified",
        "reward-index in this Whirlpool",
        "",
        "### Parameters",
        "- `reward_index` - The reward index that we'd like to initialize. (0 <= index <= NUM_REWARDS)",
        "",
        "#### Special Errors",
        "- `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized",
        "index in this pool, or exceeds NUM_REWARDS, or",
        "all reward slots for this pool has been initialized."
      ],
      "discriminator": [
        95,
        135,
        192,
        196,
        242,
        129,
        230,
        68
      ],
      "accounts": [
        {
          "name": "rewardAuthority",
          "signer": true
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "whirlpool",
          "writable": true
        },
        {
          "name": "rewardMint"
        },
        {
          "name": "rewardVault",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "rewardIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "initializeRewardV2",
      "docs": [
        "Initialize reward for a Whirlpool. A pool can only support up to a set number of rewards.",
        "This instruction works with both Token and Token-2022.",
        "",
        "### Authority",
        "- \"reward_authority\" - assigned authority by the reward_super_authority for the specified",
        "reward-index in this Whirlpool",
        "",
        "### Parameters",
        "- `reward_index` - The reward index that we'd like to initialize. (0 <= index <= NUM_REWARDS)",
        "",
        "#### Special Errors",
        "- `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized",
        "index in this pool, or exceeds NUM_REWARDS, or",
        "all reward slots for this pool has been initialized."
      ],
      "discriminator": [
        91,
        1,
        77,
        50,
        235,
        229,
        133,
        49
      ],
      "accounts": [
        {
          "name": "rewardAuthority",
          "signer": true
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "whirlpool",
          "writable": true
        },
        {
          "name": "rewardMint"
        },
        {
          "name": "rewardTokenBadge",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  98,
                  97,
                  100,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "whirlpool.whirlpools_config",
                "account": "whirlpool"
              },
              {
                "kind": "account",
                "path": "rewardMint"
              }
            ]
          }
        },
        {
          "name": "rewardVault",
          "writable": true,
          "signer": true
        },
        {
          "name": "rewardTokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "rewardIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "initializeTickArray",
      "docs": [
        "Initializes a fixed-length tick_array account to represent a tick-range in a Whirlpool.",
        "",
        "### Parameters",
        "- `start_tick_index` - The starting tick index for this tick-array.",
        "Has to be a multiple of TickArray size & the tick spacing of this pool.",
        "",
        "#### Special Errors",
        "- `InvalidStartTick` - if the provided start tick is out of bounds or is not a multiple of",
        "TICK_ARRAY_SIZE * tick spacing."
      ],
      "discriminator": [
        11,
        188,
        193,
        214,
        141,
        91,
        149,
        184
      ],
      "accounts": [
        {
          "name": "whirlpool"
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "tickArray",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  99,
                  107,
                  95,
                  97,
                  114,
                  114,
                  97,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "whirlpool"
              },
              {
                "kind": "arg",
                "path": "startTickIndex"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "startTickIndex",
          "type": "i32"
        }
      ]
    },
    {
      "name": "initializeTokenBadge",
      "docs": [
        "Initialize a TokenBadge account.",
        "",
        "### Authority",
        "- \"token_badge_authority\" - Set authority in the WhirlpoolConfigExtension",
        "",
        "### Special Errors",
        "- `FeatureIsNotEnabled` - If the feature flag for token badges is not enabled."
      ],
      "discriminator": [
        253,
        77,
        205,
        95,
        27,
        224,
        89,
        223
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "whirlpoolsConfigExtension"
          ]
        },
        {
          "name": "whirlpoolsConfigExtension"
        },
        {
          "name": "tokenBadgeAuthority",
          "signer": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenBadge",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  98,
                  97,
                  100,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "whirlpoolsConfig"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "lockPosition",
      "docs": [
        "Lock the position to prevent any liquidity changes.",
        "",
        "### Authority",
        "- `position_authority` - The authority that owns the position token.",
        "",
        "#### Special Errors",
        "- `PositionAlreadyLocked` - The provided position is already locked.",
        "- `PositionNotLockable` - The provided position is not lockable (e.g. An empty position)."
      ],
      "discriminator": [
        227,
        62,
        2,
        252,
        247,
        10,
        171,
        185
      ],
      "accounts": [
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "positionAuthority",
          "signer": true
        },
        {
          "name": "position",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ]
          }
        },
        {
          "name": "positionMint"
        },
        {
          "name": "positionTokenAccount",
          "writable": true
        },
        {
          "name": "lockConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  99,
                  107,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "position"
              }
            ]
          }
        },
        {
          "name": "whirlpool",
          "relations": [
            "position"
          ]
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "lockType",
          "type": {
            "defined": {
              "name": "lockType"
            }
          }
        }
      ]
    },
    {
      "name": "migrateRepurposeRewardAuthoritySpace",
      "docs": [
        "Migration instruction to repurpose the reward authority space in the Whirlpool.",
        "TODO: This instruction should be removed once all pools have been migrated."
      ],
      "discriminator": [
        214,
        161,
        248,
        79,
        152,
        98,
        172,
        231
      ],
      "accounts": [
        {
          "name": "whirlpool",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "openBundledPosition",
      "docs": [
        "Open a bundled position in a Whirlpool. No new tokens are issued",
        "because the owner of the position bundle becomes the owner of the position.",
        "The position will start off with 0 liquidity.",
        "",
        "### Authority",
        "- `position_bundle_authority` - authority that owns the token corresponding to this desired position bundle.",
        "",
        "### Parameters",
        "- `bundle_index` - The bundle index that we'd like to open.",
        "- `tick_lower_index` - The tick specifying the lower end of the position range.",
        "- `tick_upper_index` - The tick specifying the upper end of the position range.",
        "",
        "#### Special Errors",
        "- `InvalidBundleIndex` - If the provided bundle index is out of bounds.",
        "- `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of",
        "the tick-spacing in this pool."
      ],
      "discriminator": [
        169,
        113,
        126,
        171,
        213,
        172,
        212,
        49
      ],
      "accounts": [
        {
          "name": "bundledPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  110,
                  100,
                  108,
                  101,
                  100,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "position_bundle.position_bundle_mint",
                "account": "positionBundle"
              },
              {
                "kind": "arg",
                "path": "bundleIndex"
              }
            ]
          }
        },
        {
          "name": "positionBundle",
          "writable": true
        },
        {
          "name": "positionBundleTokenAccount"
        },
        {
          "name": "positionBundleAuthority",
          "signer": true
        },
        {
          "name": "whirlpool"
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bundleIndex",
          "type": "u16"
        },
        {
          "name": "tickLowerIndex",
          "type": "i32"
        },
        {
          "name": "tickUpperIndex",
          "type": "i32"
        }
      ]
    },
    {
      "name": "openPosition",
      "docs": [
        "Open a position in a Whirlpool. A unique token will be minted to represent the position",
        "in the users wallet. The position will start off with 0 liquidity.",
        "",
        "### Parameters",
        "- `tick_lower_index` - The tick specifying the lower end of the position range.",
        "- `tick_upper_index` - The tick specifying the upper end of the position range.",
        "",
        "#### Special Errors",
        "- `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of",
        "the tick-spacing in this pool."
      ],
      "discriminator": [
        135,
        128,
        47,
        77,
        15,
        152,
        240,
        49
      ],
      "accounts": [
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "owner"
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ]
          }
        },
        {
          "name": "positionMint",
          "writable": true,
          "signer": true
        },
        {
          "name": "positionTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "whirlpool"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "bumps",
          "type": {
            "defined": {
              "name": "openPositionBumps"
            }
          }
        },
        {
          "name": "tickLowerIndex",
          "type": "i32"
        },
        {
          "name": "tickUpperIndex",
          "type": "i32"
        }
      ]
    },
    {
      "name": "openPositionWithMetadata",
      "docs": [
        "Open a position in a Whirlpool. A unique token will be minted to represent the position",
        "in the users wallet. Additional Metaplex metadata is appended to identify the token.",
        "The position will start off with 0 liquidity.",
        "",
        "### Parameters",
        "- `tick_lower_index` - The tick specifying the lower end of the position range.",
        "- `tick_upper_index` - The tick specifying the upper end of the position range.",
        "",
        "#### Special Errors",
        "- `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of",
        "the tick-spacing in this pool."
      ],
      "discriminator": [
        242,
        29,
        134,
        48,
        58,
        110,
        14,
        60
      ],
      "accounts": [
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "owner"
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ]
          }
        },
        {
          "name": "positionMint",
          "writable": true,
          "signer": true
        },
        {
          "name": "positionMetadataAccount",
          "docs": [
            "https://github.com/metaplex-foundation/mpl-token-metadata/blob/master/programs/token-metadata/program/src/utils/metadata.rs#L78"
          ],
          "writable": true
        },
        {
          "name": "positionTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "whirlpool"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "metadataProgram",
          "address": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        },
        {
          "name": "metadataUpdateAuth",
          "address": "3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr"
        }
      ],
      "args": [
        {
          "name": "bumps",
          "type": {
            "defined": {
              "name": "openPositionWithMetadataBumps"
            }
          }
        },
        {
          "name": "tickLowerIndex",
          "type": "i32"
        },
        {
          "name": "tickUpperIndex",
          "type": "i32"
        }
      ]
    },
    {
      "name": "openPositionWithTokenExtensions",
      "docs": [
        "Open a position in a Whirlpool. A unique token will be minted to represent the position",
        "in the users wallet. Additional TokenMetadata extension is initialized to identify the token.",
        "Mint and TokenAccount are based on Token-2022.",
        "The position will start off with 0 liquidity.",
        "",
        "### Parameters",
        "- `tick_lower_index` - The tick specifying the lower end of the position range.",
        "- `tick_upper_index` - The tick specifying the upper end of the position range.",
        "- `with_token_metadata_extension` - If true, the token metadata extension will be initialized.",
        "",
        "#### Special Errors",
        "- `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of",
        "the tick-spacing in this pool."
      ],
      "discriminator": [
        212,
        47,
        95,
        92,
        114,
        102,
        131,
        250
      ],
      "accounts": [
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "owner"
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ]
          }
        },
        {
          "name": "positionMint",
          "writable": true,
          "signer": true
        },
        {
          "name": "positionTokenAccount",
          "writable": true
        },
        {
          "name": "whirlpool"
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "metadataUpdateAuth",
          "address": "3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr"
        }
      ],
      "args": [
        {
          "name": "tickLowerIndex",
          "type": "i32"
        },
        {
          "name": "tickUpperIndex",
          "type": "i32"
        },
        {
          "name": "withTokenMetadataExtension",
          "type": "bool"
        }
      ]
    },
    {
      "name": "resetPositionRange",
      "docs": [
        "Reset the position range to a new range.",
        "",
        "### Authority",
        "- `position_authority` - The authority that owns the position token.",
        "",
        "### Parameters",
        "- `new_tick_lower_index` - The new tick specifying the lower end of the position range.",
        "- `new_tick_upper_index` - The new tick specifying the upper end of the position range.",
        "",
        "#### Special Errors",
        "- `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of",
        "the tick-spacing in this pool.",
        "- `ClosePositionNotEmpty` - The provided position account is not empty.",
        "- `SameTickRangeNotAllowed` - The provided tick range is the same as the current tick range."
      ],
      "discriminator": [
        164,
        123,
        180,
        141,
        194,
        100,
        160,
        175
      ],
      "accounts": [
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "positionAuthority",
          "signer": true
        },
        {
          "name": "whirlpool",
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "positionTokenAccount"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "newTickLowerIndex",
          "type": "i32"
        },
        {
          "name": "newTickUpperIndex",
          "type": "i32"
        }
      ]
    },
    {
      "name": "setCollectProtocolFeesAuthority",
      "docs": [
        "Sets the fee authority to collect protocol fees for a WhirlpoolConfig.",
        "Only the current collect protocol fee authority has permission to invoke this instruction.",
        "",
        "### Authority",
        "- \"fee_authority\" - Set authority that can collect protocol fees in the WhirlpoolConfig"
      ],
      "discriminator": [
        34,
        150,
        93,
        244,
        139,
        225,
        233,
        67
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "writable": true
        },
        {
          "name": "collectProtocolFeesAuthority",
          "signer": true
        },
        {
          "name": "newCollectProtocolFeesAuthority"
        }
      ],
      "args": []
    },
    {
      "name": "setConfigExtensionAuthority",
      "docs": [
        "Sets the config extension authority for a WhirlpoolsConfigExtension.",
        "Only the current config extension authority has permission to invoke this instruction.",
        "",
        "### Authority",
        "- \"config_extension_authority\" - Set authority in the WhirlpoolConfigExtension"
      ],
      "discriminator": [
        44,
        94,
        241,
        116,
        24,
        188,
        60,
        143
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "whirlpoolsConfigExtension"
          ]
        },
        {
          "name": "whirlpoolsConfigExtension",
          "writable": true
        },
        {
          "name": "configExtensionAuthority",
          "signer": true
        },
        {
          "name": "newConfigExtensionAuthority"
        }
      ],
      "args": []
    },
    {
      "name": "setConfigFeatureFlag",
      "docs": [
        "Sets the feature flag for a WhirlpoolConfig.",
        "",
        "### Authority",
        "- \"authority\" - Set authority that is one of ADMINS.",
        "",
        "### Parameters",
        "- `feature_flag` - The feature flag that the WhirlpoolConfig will use."
      ],
      "discriminator": [
        71,
        173,
        228,
        18,
        67,
        247,
        210,
        57
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "featureFlag",
          "type": {
            "defined": {
              "name": "configFeatureFlag"
            }
          }
        }
      ]
    },
    {
      "name": "setDefaultBaseFeeRate",
      "docs": [
        "Set the default_base_fee_rate for an AdaptiveFeeTier",
        "Only the current fee authority in WhirlpoolsConfig has permission to invoke this instruction.",
        "",
        "### Authority",
        "- \"fee_authority\" - Set authority in the WhirlpoolConfig",
        "",
        "### Parameters",
        "- `default_base_fee_rate` - The default base fee rate that a pool will use if the pool uses this",
        "adaptive fee-tier during initialization.",
        "",
        "#### Special Errors",
        "- `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE."
      ],
      "discriminator": [
        229,
        66,
        84,
        251,
        164,
        134,
        183,
        7
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "adaptiveFeeTier"
          ]
        },
        {
          "name": "adaptiveFeeTier",
          "writable": true
        },
        {
          "name": "feeAuthority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "defaultBaseFeeRate",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setDefaultFeeRate",
      "docs": [
        "Set the default_fee_rate for a FeeTier",
        "Only the current fee authority has permission to invoke this instruction.",
        "",
        "### Authority",
        "- \"fee_authority\" - Set authority in the WhirlpoolConfig",
        "",
        "### Parameters",
        "- `default_fee_rate` - The default fee rate that a pool will use if the pool uses this",
        "fee tier during initialization.",
        "",
        "#### Special Errors",
        "- `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE."
      ],
      "discriminator": [
        118,
        215,
        214,
        157,
        182,
        229,
        208,
        228
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "feeTier"
          ]
        },
        {
          "name": "feeTier",
          "writable": true
        },
        {
          "name": "feeAuthority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "defaultFeeRate",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setDefaultProtocolFeeRate",
      "docs": [
        "Sets the default protocol fee rate for a WhirlpoolConfig",
        "Protocol fee rate is represented as a basis point.",
        "Only the current fee authority has permission to invoke this instruction.",
        "",
        "### Authority",
        "- \"fee_authority\" - Set authority that can modify pool fees in the WhirlpoolConfig",
        "",
        "### Parameters",
        "- `default_protocol_fee_rate` - Rate that is referenced during the initialization of a Whirlpool using this config.",
        "",
        "#### Special Errors",
        "- `ProtocolFeeRateMaxExceeded` - If the provided default_protocol_fee_rate exceeds MAX_PROTOCOL_FEE_RATE."
      ],
      "discriminator": [
        107,
        205,
        249,
        226,
        151,
        35,
        86,
        0
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "writable": true
        },
        {
          "name": "feeAuthority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "defaultProtocolFeeRate",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setDelegatedFeeAuthority",
      "docs": [
        "Sets the delegated fee authority for an AdaptiveFeeTier.",
        "The delegated fee authority can set the fee rate for individual pools initialized with the adaptive fee-tier.",
        "Only the current fee authority in WhirlpoolsConfig has permission to invoke this instruction.",
        "",
        "### Authority",
        "- \"fee_authority\" - Set authority in the WhirlpoolConfig"
      ],
      "discriminator": [
        193,
        234,
        231,
        147,
        138,
        57,
        3,
        122
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "adaptiveFeeTier"
          ]
        },
        {
          "name": "adaptiveFeeTier",
          "writable": true
        },
        {
          "name": "feeAuthority",
          "signer": true
        },
        {
          "name": "newDelegatedFeeAuthority"
        }
      ],
      "args": []
    },
    {
      "name": "setFeeAuthority",
      "docs": [
        "Sets the fee authority for a WhirlpoolConfig.",
        "The fee authority can set the fee & protocol fee rate for individual pools or",
        "set the default fee rate for newly minted pools.",
        "Only the current fee authority has permission to invoke this instruction.",
        "",
        "### Authority",
        "- \"fee_authority\" - Set authority that can modify pool fees in the WhirlpoolConfig"
      ],
      "discriminator": [
        31,
        1,
        50,
        87,
        237,
        101,
        97,
        132
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "writable": true
        },
        {
          "name": "feeAuthority",
          "signer": true
        },
        {
          "name": "newFeeAuthority"
        }
      ],
      "args": []
    },
    {
      "name": "setFeeRate",
      "docs": [
        "Sets the fee rate for a Whirlpool.",
        "Fee rate is represented as hundredths of a basis point.",
        "Only the current fee authority has permission to invoke this instruction.",
        "",
        "### Authority",
        "- \"fee_authority\" - Set authority that can modify pool fees in the WhirlpoolConfig",
        "",
        "### Parameters",
        "- `fee_rate` - The rate that the pool will use to calculate fees going onwards.",
        "",
        "#### Special Errors",
        "- `FeeRateMaxExceeded` - If the provided fee_rate exceeds MAX_FEE_RATE."
      ],
      "discriminator": [
        53,
        243,
        137,
        65,
        8,
        140,
        158,
        6
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "whirlpool"
          ]
        },
        {
          "name": "whirlpool",
          "writable": true
        },
        {
          "name": "feeAuthority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "feeRate",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setFeeRateByDelegatedFeeAuthority",
      "docs": [
        "Sets the fee rate for a Whirlpool by the delegated fee authority in AdaptiveFeeTier.",
        "Fee rate is represented as hundredths of a basis point.",
        "",
        "### Authority",
        "- \"delegated_fee_authority\" - Set authority that can modify pool fees in the AdaptiveFeeTier",
        "",
        "### Parameters",
        "- `fee_rate` - The rate that the pool will use to calculate fees going onwards.",
        "",
        "#### Special Errors",
        "- `FeeRateMaxExceeded` - If the provided fee_rate exceeds MAX_FEE_RATE."
      ],
      "discriminator": [
        121,
        121,
        54,
        114,
        131,
        230,
        162,
        104
      ],
      "accounts": [
        {
          "name": "whirlpool",
          "writable": true
        },
        {
          "name": "adaptiveFeeTier"
        },
        {
          "name": "delegatedFeeAuthority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "feeRate",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setInitializePoolAuthority",
      "docs": [
        "Sets the initialize pool authority for an AdaptiveFeeTier.",
        "Only the initialize pool authority can initialize pools with the adaptive fee-tier.",
        "Only the current fee authority in WhirlpoolsConfig has permission to invoke this instruction.",
        "",
        "### Authority",
        "- \"fee_authority\" - Set authority in the WhirlpoolConfig"
      ],
      "discriminator": [
        125,
        43,
        127,
        235,
        149,
        26,
        106,
        236
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "adaptiveFeeTier"
          ]
        },
        {
          "name": "adaptiveFeeTier",
          "writable": true
        },
        {
          "name": "feeAuthority",
          "signer": true
        },
        {
          "name": "newInitializePoolAuthority"
        }
      ],
      "args": []
    },
    {
      "name": "setPresetAdaptiveFeeConstants",
      "docs": [
        "Sets the adaptive fee constants for an AdaptiveFeeTier.",
        "Only the current fee authority in WhirlpoolsConfig has permission to invoke this instruction.",
        "",
        "### Authority",
        "- \"fee_authority\" - Set authority in the WhirlpoolConfig",
        "",
        "### Parameters",
        "- `filter_period` - Period determine high frequency trading time window. (seconds)",
        "- `decay_period` - Period determine when the adaptive fee start decrease. (seconds)",
        "- `reduction_factor` - Adaptive fee rate decrement rate.",
        "- `adaptive_fee_control_factor` - Adaptive fee control factor.",
        "- `max_volatility_accumulator` - Max volatility accumulator.",
        "- `tick_group_size` - Tick group size to define tick group index.",
        "- `major_swap_threshold_ticks` - Major swap threshold ticks to define major swap."
      ],
      "discriminator": [
        132,
        185,
        66,
        148,
        83,
        88,
        134,
        198
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "adaptiveFeeTier"
          ]
        },
        {
          "name": "adaptiveFeeTier",
          "writable": true
        },
        {
          "name": "feeAuthority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "filterPeriod",
          "type": "u16"
        },
        {
          "name": "decayPeriod",
          "type": "u16"
        },
        {
          "name": "reductionFactor",
          "type": "u16"
        },
        {
          "name": "adaptiveFeeControlFactor",
          "type": "u32"
        },
        {
          "name": "maxVolatilityAccumulator",
          "type": "u32"
        },
        {
          "name": "tickGroupSize",
          "type": "u16"
        },
        {
          "name": "majorSwapThresholdTicks",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setProtocolFeeRate",
      "docs": [
        "Sets the protocol fee rate for a Whirlpool.",
        "Protocol fee rate is represented as a basis point.",
        "Only the current fee authority has permission to invoke this instruction.",
        "",
        "### Authority",
        "- \"fee_authority\" - Set authority that can modify pool fees in the WhirlpoolConfig",
        "",
        "### Parameters",
        "- `protocol_fee_rate` - The rate that the pool will use to calculate protocol fees going onwards.",
        "",
        "#### Special Errors",
        "- `ProtocolFeeRateMaxExceeded` - If the provided default_protocol_fee_rate exceeds MAX_PROTOCOL_FEE_RATE."
      ],
      "discriminator": [
        95,
        7,
        4,
        50,
        154,
        79,
        156,
        131
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "whirlpool"
          ]
        },
        {
          "name": "whirlpool",
          "writable": true
        },
        {
          "name": "feeAuthority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "protocolFeeRate",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setRewardAuthority",
      "docs": [
        "Set the whirlpool reward authority at the provided `reward_index`.",
        "Only the current reward authority for this reward index has permission to invoke this instruction.",
        "",
        "### Authority",
        "- \"reward_authority\" - Set authority that can control reward emission for this particular reward.",
        "",
        "#### Special Errors",
        "- `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized",
        "index in this pool, or exceeds NUM_REWARDS, or",
        "all reward slots for this pool has been initialized."
      ],
      "discriminator": [
        34,
        39,
        183,
        252,
        83,
        28,
        85,
        127
      ],
      "accounts": [
        {
          "name": "whirlpool",
          "writable": true
        },
        {
          "name": "rewardAuthority",
          "signer": true
        },
        {
          "name": "newRewardAuthority"
        }
      ],
      "args": [
        {
          "name": "rewardIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setRewardAuthorityBySuperAuthority",
      "docs": [
        "Set the whirlpool reward authority at the provided `reward_index`.",
        "Only the current reward super authority has permission to invoke this instruction.",
        "",
        "### Authority",
        "- \"reward_authority\" - Set authority that can control reward emission for this particular reward.",
        "",
        "#### Special Errors",
        "- `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized",
        "index in this pool, or exceeds NUM_REWARDS, or",
        "all reward slots for this pool has been initialized."
      ],
      "discriminator": [
        240,
        154,
        201,
        198,
        148,
        93,
        56,
        25
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "whirlpool"
          ]
        },
        {
          "name": "whirlpool",
          "writable": true
        },
        {
          "name": "rewardEmissionsSuperAuthority",
          "signer": true
        },
        {
          "name": "newRewardAuthority"
        }
      ],
      "args": [
        {
          "name": "rewardIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setRewardEmissions",
      "docs": [
        "Set the reward emissions for a reward in a Whirlpool.",
        "",
        "### Authority",
        "- \"reward_authority\" - assigned authority by the reward_super_authority for the specified",
        "reward-index in this Whirlpool",
        "",
        "### Parameters",
        "- `reward_index` - The reward index (0 <= index <= NUM_REWARDS) that we'd like to modify.",
        "- `emissions_per_second_x64` - The amount of rewards emitted in this pool.",
        "",
        "#### Special Errors",
        "- `RewardVaultAmountInsufficient` - The amount of rewards in the reward vault cannot emit",
        "more than a day of desired emissions.",
        "- `InvalidTimestamp` - Provided timestamp is not in order with the previous timestamp.",
        "- `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized",
        "index in this pool, or exceeds NUM_REWARDS, or",
        "all reward slots for this pool has been initialized."
      ],
      "discriminator": [
        13,
        197,
        86,
        168,
        109,
        176,
        27,
        244
      ],
      "accounts": [
        {
          "name": "whirlpool",
          "writable": true
        },
        {
          "name": "rewardAuthority",
          "signer": true
        },
        {
          "name": "rewardVault"
        }
      ],
      "args": [
        {
          "name": "rewardIndex",
          "type": "u8"
        },
        {
          "name": "emissionsPerSecondX64",
          "type": "u128"
        }
      ]
    },
    {
      "name": "setRewardEmissionsSuperAuthority",
      "docs": [
        "Set the whirlpool reward super authority for a WhirlpoolConfig",
        "Only the current reward super authority has permission to invoke this instruction.",
        "This instruction will not change the authority on any `WhirlpoolRewardInfo` whirlpool rewards.",
        "",
        "### Authority",
        "- \"reward_emissions_super_authority\" - Set authority that can control reward authorities for all pools in this config space."
      ],
      "discriminator": [
        207,
        5,
        200,
        209,
        122,
        56,
        82,
        183
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "writable": true
        },
        {
          "name": "rewardEmissionsSuperAuthority",
          "signer": true
        },
        {
          "name": "newRewardEmissionsSuperAuthority"
        }
      ],
      "args": []
    },
    {
      "name": "setRewardEmissionsV2",
      "docs": [
        "Set the reward emissions for a reward in a Whirlpool.",
        "This instruction works with both Token and Token-2022.",
        "",
        "### Authority",
        "- \"reward_authority\" - assigned authority by the reward_super_authority for the specified",
        "reward-index in this Whirlpool",
        "",
        "### Parameters",
        "- `reward_index` - The reward index (0 <= index <= NUM_REWARDS) that we'd like to modify.",
        "- `emissions_per_second_x64` - The amount of rewards emitted in this pool.",
        "",
        "#### Special Errors",
        "- `RewardVaultAmountInsufficient` - The amount of rewards in the reward vault cannot emit",
        "more than a day of desired emissions.",
        "- `InvalidTimestamp` - Provided timestamp is not in order with the previous timestamp.",
        "- `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized",
        "index in this pool, or exceeds NUM_REWARDS, or",
        "all reward slots for this pool has been initialized."
      ],
      "discriminator": [
        114,
        228,
        72,
        32,
        193,
        48,
        160,
        102
      ],
      "accounts": [
        {
          "name": "whirlpool",
          "writable": true
        },
        {
          "name": "rewardAuthority",
          "signer": true
        },
        {
          "name": "rewardVault"
        }
      ],
      "args": [
        {
          "name": "rewardIndex",
          "type": "u8"
        },
        {
          "name": "emissionsPerSecondX64",
          "type": "u128"
        }
      ]
    },
    {
      "name": "setTokenBadgeAttribute",
      "docs": [
        "Set an attribute on a TokenBadge account.",
        "",
        "### Authority",
        "- \"token_badge_authority\" - Set authority in the WhirlpoolConfigExtension",
        "",
        "### Parameters",
        "- `attribute` - The attribute to set on the TokenBadge account.",
        "",
        "#### Special Errors",
        "- `FeatureIsNotEnabled` - If the feature flag for token badges is not enabled."
      ],
      "discriminator": [
        224,
        88,
        65,
        33,
        138,
        147,
        246,
        137
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "whirlpoolsConfigExtension",
            "tokenBadge"
          ]
        },
        {
          "name": "whirlpoolsConfigExtension"
        },
        {
          "name": "tokenBadgeAuthority",
          "signer": true
        },
        {
          "name": "tokenMint",
          "relations": [
            "tokenBadge"
          ]
        },
        {
          "name": "tokenBadge",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "attribute",
          "type": {
            "defined": {
              "name": "tokenBadgeAttribute"
            }
          }
        }
      ]
    },
    {
      "name": "setTokenBadgeAuthority",
      "docs": [
        "Sets the token badge authority for a WhirlpoolsConfigExtension.",
        "Only the config extension authority has permission to invoke this instruction.",
        "",
        "### Authority",
        "- \"config_extension_authority\" - Set authority in the WhirlpoolConfigExtension"
      ],
      "discriminator": [
        207,
        202,
        4,
        32,
        205,
        79,
        13,
        178
      ],
      "accounts": [
        {
          "name": "whirlpoolsConfig",
          "relations": [
            "whirlpoolsConfigExtension"
          ]
        },
        {
          "name": "whirlpoolsConfigExtension",
          "writable": true
        },
        {
          "name": "configExtensionAuthority",
          "signer": true
        },
        {
          "name": "newTokenBadgeAuthority"
        }
      ],
      "args": []
    },
    {
      "name": "swap",
      "docs": [
        "Perform a swap in this Whirlpool",
        "",
        "### Authority",
        "- \"token_authority\" - The authority to withdraw tokens from the input token account.",
        "",
        "### Parameters",
        "- `amount` - The amount of input or output token to swap from (depending on amount_specified_is_input).",
        "- `other_amount_threshold` - The maximum/minimum of input/output token to swap into (depending on amount_specified_is_input).",
        "- `sqrt_price_limit` - The maximum/minimum price the swap will swap to.",
        "- `amount_specified_is_input` - Specifies the token the parameter `amount`represents. If true, the amount represents the input token of the swap.",
        "- `a_to_b` - The direction of the swap. True if swapping from A to B. False if swapping from B to A.",
        "",
        "#### Special Errors",
        "- `ZeroTradableAmount` - User provided parameter `amount` is 0.",
        "- `InvalidSqrtPriceLimitDirection` - User provided parameter `sqrt_price_limit` does not match the direction of the trade.",
        "- `SqrtPriceOutOfBounds` - User provided parameter `sqrt_price_limit` is over Whirlppool's max/min bounds for sqrt-price.",
        "- `InvalidTickArraySequence` - User provided tick-arrays are not in sequential order required to proceed in this trade direction.",
        "- `TickArraySequenceInvalidIndex` - The swap loop attempted to access an invalid array index during the query of the next initialized tick.",
        "- `TickArrayIndexOutofBounds` - The swap loop attempted to access an invalid array index during tick crossing.",
        "- `LiquidityOverflow` - Liquidity value overflowed 128bits during tick crossing.",
        "- `InvalidTickSpacing` - The swap pool was initialized with tick-spacing of 0."
      ],
      "discriminator": [
        248,
        198,
        158,
        145,
        225,
        117,
        135,
        200
      ],
      "accounts": [
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "tokenAuthority",
          "signer": true
        },
        {
          "name": "whirlpool",
          "writable": true
        },
        {
          "name": "tokenOwnerAccountA",
          "writable": true
        },
        {
          "name": "tokenVaultA",
          "writable": true
        },
        {
          "name": "tokenOwnerAccountB",
          "writable": true
        },
        {
          "name": "tokenVaultB",
          "writable": true
        },
        {
          "name": "tickArray0",
          "writable": true
        },
        {
          "name": "tickArray1",
          "writable": true
        },
        {
          "name": "tickArray2",
          "writable": true
        },
        {
          "name": "oracle",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "whirlpool"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "otherAmountThreshold",
          "type": "u64"
        },
        {
          "name": "sqrtPriceLimit",
          "type": "u128"
        },
        {
          "name": "amountSpecifiedIsInput",
          "type": "bool"
        },
        {
          "name": "aToB",
          "type": "bool"
        }
      ]
    },
    {
      "name": "swapV2",
      "docs": [
        "Perform a swap in this Whirlpool",
        "This instruction works with both Token and Token-2022.",
        "",
        "### Authority",
        "- \"token_authority\" - The authority to withdraw tokens from the input token account.",
        "",
        "### Parameters",
        "- `amount` - The amount of input or output token to swap from (depending on amount_specified_is_input).",
        "- `other_amount_threshold` - The maximum/minimum of input/output token to swap into (depending on amount_specified_is_input).",
        "- `sqrt_price_limit` - The maximum/minimum price the swap will swap to.",
        "- `amount_specified_is_input` - Specifies the token the parameter `amount`represents. If true, the amount represents the input token of the swap.",
        "- `a_to_b` - The direction of the swap. True if swapping from A to B. False if swapping from B to A.",
        "",
        "#### Special Errors",
        "- `ZeroTradableAmount` - User provided parameter `amount` is 0.",
        "- `InvalidSqrtPriceLimitDirection` - User provided parameter `sqrt_price_limit` does not match the direction of the trade.",
        "- `SqrtPriceOutOfBounds` - User provided parameter `sqrt_price_limit` is over Whirlppool's max/min bounds for sqrt-price.",
        "- `InvalidTickArraySequence` - User provided tick-arrays are not in sequential order required to proceed in this trade direction.",
        "- `TickArraySequenceInvalidIndex` - The swap loop attempted to access an invalid array index during the query of the next initialized tick.",
        "- `TickArrayIndexOutofBounds` - The swap loop attempted to access an invalid array index during tick crossing.",
        "- `LiquidityOverflow` - Liquidity value overflowed 128bits during tick crossing.",
        "- `InvalidTickSpacing` - The swap pool was initialized with tick-spacing of 0."
      ],
      "discriminator": [
        43,
        4,
        237,
        11,
        26,
        201,
        30,
        98
      ],
      "accounts": [
        {
          "name": "tokenProgramA"
        },
        {
          "name": "tokenProgramB"
        },
        {
          "name": "memoProgram",
          "address": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        },
        {
          "name": "tokenAuthority",
          "signer": true
        },
        {
          "name": "whirlpool",
          "writable": true
        },
        {
          "name": "tokenMintA"
        },
        {
          "name": "tokenMintB"
        },
        {
          "name": "tokenOwnerAccountA",
          "writable": true
        },
        {
          "name": "tokenVaultA",
          "writable": true
        },
        {
          "name": "tokenOwnerAccountB",
          "writable": true
        },
        {
          "name": "tokenVaultB",
          "writable": true
        },
        {
          "name": "tickArray0",
          "writable": true
        },
        {
          "name": "tickArray1",
          "writable": true
        },
        {
          "name": "tickArray2",
          "writable": true
        },
        {
          "name": "oracle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "whirlpool"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "otherAmountThreshold",
          "type": "u64"
        },
        {
          "name": "sqrtPriceLimit",
          "type": "u128"
        },
        {
          "name": "amountSpecifiedIsInput",
          "type": "bool"
        },
        {
          "name": "aToB",
          "type": "bool"
        },
        {
          "name": "remainingAccountsInfo",
          "type": {
            "option": {
              "defined": {
                "name": "remainingAccountsInfo"
              }
            }
          }
        }
      ]
    },
    {
      "name": "transferLockedPosition",
      "docs": [
        "Transfer a locked position to a different token account.",
        "",
        "### Authority",
        "- `position_authority` - The authority that owns the position token."
      ],
      "discriminator": [
        179,
        121,
        229,
        46,
        67,
        138,
        194,
        138
      ],
      "accounts": [
        {
          "name": "positionAuthority",
          "signer": true
        },
        {
          "name": "receiver",
          "writable": true
        },
        {
          "name": "position",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ]
          },
          "relations": [
            "lockConfig"
          ]
        },
        {
          "name": "positionMint"
        },
        {
          "name": "positionTokenAccount",
          "writable": true
        },
        {
          "name": "destinationTokenAccount",
          "writable": true
        },
        {
          "name": "lockConfig",
          "writable": true
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        }
      ],
      "args": []
    },
    {
      "name": "twoHopSwap",
      "docs": [
        "Perform a two-hop swap in this Whirlpool",
        "",
        "### Authority",
        "- \"token_authority\" - The authority to withdraw tokens from the input token account.",
        "",
        "### Parameters",
        "- `amount` - The amount of input or output token to swap from (depending on amount_specified_is_input).",
        "- `other_amount_threshold` - The maximum/minimum of input/output token to swap into (depending on amount_specified_is_input).",
        "- `amount_specified_is_input` - Specifies the token the parameter `amount`represents. If true, the amount represents the input token of the swap.",
        "- `a_to_b_one` - The direction of the swap of hop one. True if swapping from A to B. False if swapping from B to A.",
        "- `a_to_b_two` - The direction of the swap of hop two. True if swapping from A to B. False if swapping from B to A.",
        "- `sqrt_price_limit_one` - The maximum/minimum price the swap will swap to in the first hop.",
        "- `sqrt_price_limit_two` - The maximum/minimum price the swap will swap to in the second hop.",
        "",
        "#### Special Errors",
        "- `ZeroTradableAmount` - User provided parameter `amount` is 0.",
        "- `InvalidSqrtPriceLimitDirection` - User provided parameter `sqrt_price_limit` does not match the direction of the trade.",
        "- `SqrtPriceOutOfBounds` - User provided parameter `sqrt_price_limit` is over Whirlppool's max/min bounds for sqrt-price.",
        "- `InvalidTickArraySequence` - User provided tick-arrays are not in sequential order required to proceed in this trade direction.",
        "- `TickArraySequenceInvalidIndex` - The swap loop attempted to access an invalid array index during the query of the next initialized tick.",
        "- `TickArrayIndexOutofBounds` - The swap loop attempted to access an invalid array index during tick crossing.",
        "- `LiquidityOverflow` - Liquidity value overflowed 128bits during tick crossing.",
        "- `InvalidTickSpacing` - The swap pool was initialized with tick-spacing of 0.",
        "- `InvalidIntermediaryMint` - Error if the intermediary mint between hop one and two do not equal.",
        "- `DuplicateTwoHopPool` - Error if whirlpool one & two are the same pool."
      ],
      "discriminator": [
        195,
        96,
        237,
        108,
        68,
        162,
        219,
        230
      ],
      "accounts": [
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "tokenAuthority",
          "signer": true
        },
        {
          "name": "whirlpoolOne",
          "writable": true
        },
        {
          "name": "whirlpoolTwo",
          "writable": true
        },
        {
          "name": "tokenOwnerAccountOneA",
          "writable": true
        },
        {
          "name": "tokenVaultOneA",
          "writable": true
        },
        {
          "name": "tokenOwnerAccountOneB",
          "writable": true
        },
        {
          "name": "tokenVaultOneB",
          "writable": true
        },
        {
          "name": "tokenOwnerAccountTwoA",
          "writable": true
        },
        {
          "name": "tokenVaultTwoA",
          "writable": true
        },
        {
          "name": "tokenOwnerAccountTwoB",
          "writable": true
        },
        {
          "name": "tokenVaultTwoB",
          "writable": true
        },
        {
          "name": "tickArrayOne0",
          "writable": true
        },
        {
          "name": "tickArrayOne1",
          "writable": true
        },
        {
          "name": "tickArrayOne2",
          "writable": true
        },
        {
          "name": "tickArrayTwo0",
          "writable": true
        },
        {
          "name": "tickArrayTwo1",
          "writable": true
        },
        {
          "name": "tickArrayTwo2",
          "writable": true
        },
        {
          "name": "oracleOne",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "whirlpoolOne"
              }
            ]
          }
        },
        {
          "name": "oracleTwo",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "whirlpoolTwo"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "otherAmountThreshold",
          "type": "u64"
        },
        {
          "name": "amountSpecifiedIsInput",
          "type": "bool"
        },
        {
          "name": "aToBOne",
          "type": "bool"
        },
        {
          "name": "aToBTwo",
          "type": "bool"
        },
        {
          "name": "sqrtPriceLimitOne",
          "type": "u128"
        },
        {
          "name": "sqrtPriceLimitTwo",
          "type": "u128"
        }
      ]
    },
    {
      "name": "twoHopSwapV2",
      "docs": [
        "Perform a two-hop swap in this Whirlpool",
        "This instruction works with both Token and Token-2022.",
        "",
        "### Authority",
        "- \"token_authority\" - The authority to withdraw tokens from the input token account.",
        "",
        "### Parameters",
        "- `amount` - The amount of input or output token to swap from (depending on amount_specified_is_input).",
        "- `other_amount_threshold` - The maximum/minimum of input/output token to swap into (depending on amount_specified_is_input).",
        "- `amount_specified_is_input` - Specifies the token the parameter `amount`represents. If true, the amount represents the input token of the swap.",
        "- `a_to_b_one` - The direction of the swap of hop one. True if swapping from A to B. False if swapping from B to A.",
        "- `a_to_b_two` - The direction of the swap of hop two. True if swapping from A to B. False if swapping from B to A.",
        "- `sqrt_price_limit_one` - The maximum/minimum price the swap will swap to in the first hop.",
        "- `sqrt_price_limit_two` - The maximum/minimum price the swap will swap to in the second hop.",
        "",
        "#### Special Errors",
        "- `ZeroTradableAmount` - User provided parameter `amount` is 0.",
        "- `InvalidSqrtPriceLimitDirection` - User provided parameter `sqrt_price_limit` does not match the direction of the trade.",
        "- `SqrtPriceOutOfBounds` - User provided parameter `sqrt_price_limit` is over Whirlppool's max/min bounds for sqrt-price.",
        "- `InvalidTickArraySequence` - User provided tick-arrays are not in sequential order required to proceed in this trade direction.",
        "- `TickArraySequenceInvalidIndex` - The swap loop attempted to access an invalid array index during the query of the next initialized tick.",
        "- `TickArrayIndexOutofBounds` - The swap loop attempted to access an invalid array index during tick crossing.",
        "- `LiquidityOverflow` - Liquidity value overflowed 128bits during tick crossing.",
        "- `InvalidTickSpacing` - The swap pool was initialized with tick-spacing of 0.",
        "- `InvalidIntermediaryMint` - Error if the intermediary mint between hop one and two do not equal.",
        "- `DuplicateTwoHopPool` - Error if whirlpool one & two are the same pool."
      ],
      "discriminator": [
        186,
        143,
        209,
        29,
        254,
        2,
        194,
        117
      ],
      "accounts": [
        {
          "name": "whirlpoolOne",
          "writable": true
        },
        {
          "name": "whirlpoolTwo",
          "writable": true
        },
        {
          "name": "tokenMintInput"
        },
        {
          "name": "tokenMintIntermediate"
        },
        {
          "name": "tokenMintOutput"
        },
        {
          "name": "tokenProgramInput"
        },
        {
          "name": "tokenProgramIntermediate"
        },
        {
          "name": "tokenProgramOutput"
        },
        {
          "name": "tokenOwnerAccountInput",
          "writable": true
        },
        {
          "name": "tokenVaultOneInput",
          "writable": true
        },
        {
          "name": "tokenVaultOneIntermediate",
          "writable": true
        },
        {
          "name": "tokenVaultTwoIntermediate",
          "writable": true
        },
        {
          "name": "tokenVaultTwoOutput",
          "writable": true
        },
        {
          "name": "tokenOwnerAccountOutput",
          "writable": true
        },
        {
          "name": "tokenAuthority",
          "signer": true
        },
        {
          "name": "tickArrayOne0",
          "writable": true
        },
        {
          "name": "tickArrayOne1",
          "writable": true
        },
        {
          "name": "tickArrayOne2",
          "writable": true
        },
        {
          "name": "tickArrayTwo0",
          "writable": true
        },
        {
          "name": "tickArrayTwo1",
          "writable": true
        },
        {
          "name": "tickArrayTwo2",
          "writable": true
        },
        {
          "name": "oracleOne",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "whirlpoolOne"
              }
            ]
          }
        },
        {
          "name": "oracleTwo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "whirlpoolTwo"
              }
            ]
          }
        },
        {
          "name": "memoProgram",
          "address": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "otherAmountThreshold",
          "type": "u64"
        },
        {
          "name": "amountSpecifiedIsInput",
          "type": "bool"
        },
        {
          "name": "aToBOne",
          "type": "bool"
        },
        {
          "name": "aToBTwo",
          "type": "bool"
        },
        {
          "name": "sqrtPriceLimitOne",
          "type": "u128"
        },
        {
          "name": "sqrtPriceLimitTwo",
          "type": "u128"
        },
        {
          "name": "remainingAccountsInfo",
          "type": {
            "option": {
              "defined": {
                "name": "remainingAccountsInfo"
              }
            }
          }
        }
      ]
    },
    {
      "name": "updateFeesAndRewards",
      "docs": [
        "Update the accrued fees and rewards for a position.",
        "",
        "#### Special Errors",
        "- `TickNotFound` - Provided tick array account does not contain the tick for this position.",
        "- `LiquidityZero` - Position has zero liquidity and therefore already has the most updated fees and reward values."
      ],
      "discriminator": [
        154,
        230,
        250,
        13,
        236,
        209,
        75,
        223
      ],
      "accounts": [
        {
          "name": "whirlpool",
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "tickArrayLower"
        },
        {
          "name": "tickArrayUpper"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "adaptiveFeeTier",
      "discriminator": [
        147,
        16,
        144,
        116,
        47,
        146,
        149,
        46
      ]
    },
    {
      "name": "dynamicTickArray",
      "discriminator": [
        17,
        216,
        246,
        142,
        225,
        199,
        218,
        56
      ]
    },
    {
      "name": "feeTier",
      "discriminator": [
        56,
        75,
        159,
        76,
        142,
        68,
        190,
        105
      ]
    },
    {
      "name": "lockConfig",
      "discriminator": [
        106,
        47,
        238,
        159,
        124,
        12,
        160,
        192
      ]
    },
    {
      "name": "oracle",
      "discriminator": [
        139,
        194,
        131,
        179,
        140,
        179,
        229,
        244
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    },
    {
      "name": "positionBundle",
      "discriminator": [
        129,
        169,
        175,
        65,
        185,
        95,
        32,
        100
      ]
    },
    {
      "name": "tickArray",
      "discriminator": [
        69,
        97,
        189,
        190,
        110,
        7,
        66,
        187
      ]
    },
    {
      "name": "tokenBadge",
      "discriminator": [
        116,
        219,
        204,
        229,
        249,
        116,
        255,
        150
      ]
    },
    {
      "name": "whirlpool",
      "discriminator": [
        63,
        149,
        209,
        12,
        225,
        128,
        99,
        9
      ]
    },
    {
      "name": "whirlpoolsConfig",
      "discriminator": [
        157,
        20,
        49,
        224,
        217,
        87,
        193,
        254
      ]
    },
    {
      "name": "whirlpoolsConfigExtension",
      "discriminator": [
        2,
        99,
        215,
        163,
        240,
        26,
        153,
        58
      ]
    }
  ],
  "events": [
    {
      "name": "liquidityDecreased",
      "discriminator": [
        166,
        1,
        36,
        71,
        112,
        202,
        181,
        171
      ]
    },
    {
      "name": "liquidityIncreased",
      "discriminator": [
        30,
        7,
        144,
        181,
        102,
        254,
        155,
        161
      ]
    },
    {
      "name": "poolInitialized",
      "discriminator": [
        100,
        118,
        173,
        87,
        12,
        198,
        254,
        229
      ]
    },
    {
      "name": "traded",
      "discriminator": [
        225,
        202,
        73,
        175,
        147,
        43,
        160,
        150
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidEnum",
      "msg": "Enum value could not be converted"
    },
    {
      "code": 6001,
      "name": "invalidStartTick",
      "msg": "Invalid start tick index provided."
    },
    {
      "code": 6002,
      "name": "tickArrayExistInPool",
      "msg": "Tick-array already exists in this whirlpool"
    },
    {
      "code": 6003,
      "name": "tickArrayIndexOutofBounds",
      "msg": "Attempt to search for a tick-array failed"
    },
    {
      "code": 6004,
      "name": "invalidTickSpacing",
      "msg": "Tick-spacing is not supported"
    },
    {
      "code": 6005,
      "name": "closePositionNotEmpty",
      "msg": "Position is not empty It cannot be closed"
    },
    {
      "code": 6006,
      "name": "divideByZero",
      "msg": "Unable to divide by zero"
    },
    {
      "code": 6007,
      "name": "numberCastError",
      "msg": "Unable to cast number into BigInt"
    },
    {
      "code": 6008,
      "name": "numberDownCastError",
      "msg": "Unable to down cast number"
    },
    {
      "code": 6009,
      "name": "tickNotFound",
      "msg": "Tick not found within tick array"
    },
    {
      "code": 6010,
      "name": "invalidTickIndex",
      "msg": "Provided tick index is either out of bounds or uninitializable"
    },
    {
      "code": 6011,
      "name": "sqrtPriceOutOfBounds",
      "msg": "Provided sqrt price out of bounds"
    },
    {
      "code": 6012,
      "name": "liquidityZero",
      "msg": "Liquidity amount must be greater than zero"
    },
    {
      "code": 6013,
      "name": "liquidityTooHigh",
      "msg": "Liquidity amount must be less than i64::MAX"
    },
    {
      "code": 6014,
      "name": "liquidityOverflow",
      "msg": "Liquidity overflow"
    },
    {
      "code": 6015,
      "name": "liquidityUnderflow",
      "msg": "Liquidity underflow"
    },
    {
      "code": 6016,
      "name": "liquidityNetError",
      "msg": "Tick liquidity net underflowed or overflowed"
    },
    {
      "code": 6017,
      "name": "tokenMaxExceeded",
      "msg": "Exceeded token max"
    },
    {
      "code": 6018,
      "name": "tokenMinSubceeded",
      "msg": "Did not meet token min"
    },
    {
      "code": 6019,
      "name": "missingOrInvalidDelegate",
      "msg": "Position token account has a missing or invalid delegate"
    },
    {
      "code": 6020,
      "name": "invalidPositionTokenAmount",
      "msg": "Position token amount must be 1"
    },
    {
      "code": 6021,
      "name": "invalidTimestampConversion",
      "msg": "Timestamp should be convertible from i64 to u64"
    },
    {
      "code": 6022,
      "name": "invalidTimestamp",
      "msg": "Timestamp should be greater than the last updated timestamp"
    },
    {
      "code": 6023,
      "name": "invalidTickArraySequence",
      "msg": "Invalid tick array sequence provided for instruction."
    },
    {
      "code": 6024,
      "name": "invalidTokenMintOrder",
      "msg": "Token Mint in wrong order"
    },
    {
      "code": 6025,
      "name": "rewardNotInitialized",
      "msg": "Reward not initialized"
    },
    {
      "code": 6026,
      "name": "invalidRewardIndex",
      "msg": "Invalid reward index"
    },
    {
      "code": 6027,
      "name": "rewardVaultAmountInsufficient",
      "msg": "Reward vault requires amount to support emissions for at least one day"
    },
    {
      "code": 6028,
      "name": "feeRateMaxExceeded",
      "msg": "Exceeded max fee rate"
    },
    {
      "code": 6029,
      "name": "protocolFeeRateMaxExceeded",
      "msg": "Exceeded max protocol fee rate"
    },
    {
      "code": 6030,
      "name": "multiplicationShiftRightOverflow",
      "msg": "Multiplication with shift right overflow"
    },
    {
      "code": 6031,
      "name": "mulDivOverflow",
      "msg": "Muldiv overflow"
    },
    {
      "code": 6032,
      "name": "mulDivInvalidInput",
      "msg": "Invalid div_u256 input"
    },
    {
      "code": 6033,
      "name": "multiplicationOverflow",
      "msg": "Multiplication overflow"
    },
    {
      "code": 6034,
      "name": "invalidSqrtPriceLimitDirection",
      "msg": "Provided SqrtPriceLimit not in the same direction as the swap."
    },
    {
      "code": 6035,
      "name": "zeroTradableAmount",
      "msg": "There are no tradable amount to swap."
    },
    {
      "code": 6036,
      "name": "amountOutBelowMinimum",
      "msg": "Amount out below minimum threshold"
    },
    {
      "code": 6037,
      "name": "amountInAboveMaximum",
      "msg": "Amount in above maximum threshold"
    },
    {
      "code": 6038,
      "name": "tickArraySequenceInvalidIndex",
      "msg": "Invalid index for tick array sequence"
    },
    {
      "code": 6039,
      "name": "amountCalcOverflow",
      "msg": "Amount calculated overflows"
    },
    {
      "code": 6040,
      "name": "amountRemainingOverflow",
      "msg": "Amount remaining overflows"
    },
    {
      "code": 6041,
      "name": "invalidIntermediaryMint",
      "msg": "Invalid intermediary mint"
    },
    {
      "code": 6042,
      "name": "duplicateTwoHopPool",
      "msg": "Duplicate two hop pool"
    },
    {
      "code": 6043,
      "name": "invalidBundleIndex",
      "msg": "Bundle index is out of bounds"
    },
    {
      "code": 6044,
      "name": "bundledPositionAlreadyOpened",
      "msg": "Position has already been opened"
    },
    {
      "code": 6045,
      "name": "bundledPositionAlreadyClosed",
      "msg": "Position has already been closed"
    },
    {
      "code": 6046,
      "name": "positionBundleNotDeletable",
      "msg": "Unable to delete PositionBundle with open positions"
    },
    {
      "code": 6047,
      "name": "unsupportedTokenMint",
      "msg": "Token mint has unsupported attributes"
    },
    {
      "code": 6048,
      "name": "remainingAccountsInvalidSlice",
      "msg": "Invalid remaining accounts"
    },
    {
      "code": 6049,
      "name": "remainingAccountsInsufficient",
      "msg": "Insufficient remaining accounts"
    },
    {
      "code": 6050,
      "name": "noExtraAccountsForTransferHook",
      "msg": "Unable to call transfer hook without extra accounts"
    },
    {
      "code": 6051,
      "name": "intermediateTokenAmountMismatch",
      "msg": "Output and input amount mismatch"
    },
    {
      "code": 6052,
      "name": "transferFeeCalculationError",
      "msg": "Transfer fee calculation failed"
    },
    {
      "code": 6053,
      "name": "remainingAccountsDuplicatedAccountsType",
      "msg": "Same accounts type is provided more than once"
    },
    {
      "code": 6054,
      "name": "fullRangeOnlyPool",
      "msg": "This whirlpool only supports full-range positions"
    },
    {
      "code": 6055,
      "name": "tooManySupplementalTickArrays",
      "msg": "Too many supplemental tick arrays provided"
    },
    {
      "code": 6056,
      "name": "differentWhirlpoolTickArrayAccount",
      "msg": "TickArray account for different whirlpool provided"
    },
    {
      "code": 6057,
      "name": "partialFillError",
      "msg": "Trade resulted in partial fill"
    },
    {
      "code": 6058,
      "name": "positionNotLockable",
      "msg": "Position is not lockable"
    },
    {
      "code": 6059,
      "name": "operationNotAllowedOnLockedPosition",
      "msg": "Operation not allowed on locked position"
    },
    {
      "code": 6060,
      "name": "sameTickRangeNotAllowed",
      "msg": "Cannot reset position range with same tick range"
    },
    {
      "code": 6061,
      "name": "invalidAdaptiveFeeConstants",
      "msg": "Invalid adaptive fee constants"
    },
    {
      "code": 6062,
      "name": "invalidFeeTierIndex",
      "msg": "Invalid fee tier index"
    },
    {
      "code": 6063,
      "name": "invalidTradeEnableTimestamp",
      "msg": "Invalid trade enable timestamp"
    },
    {
      "code": 6064,
      "name": "tradeIsNotEnabled",
      "msg": "Trade is not enabled yet"
    },
    {
      "code": 6065,
      "name": "rentCalculationError",
      "msg": "Rent calculation error"
    },
    {
      "code": 6066,
      "name": "featureIsNotEnabled",
      "msg": "Feature is not enabled"
    },
    {
      "code": 6067,
      "name": "positionWithTokenExtensionsRequired",
      "msg": "This whirlpool only supports open_position_with_token_extensions instruction"
    }
  ],
  "types": [
    {
      "name": "accountsType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "transferHookA"
          },
          {
            "name": "transferHookB"
          },
          {
            "name": "transferHookReward"
          },
          {
            "name": "transferHookInput"
          },
          {
            "name": "transferHookIntermediate"
          },
          {
            "name": "transferHookOutput"
          },
          {
            "name": "supplementalTickArrays"
          },
          {
            "name": "supplementalTickArraysOne"
          },
          {
            "name": "supplementalTickArraysTwo"
          }
        ]
      }
    },
    {
      "name": "adaptiveFeeConstants",
      "serialization": "bytemuckunsafe",
      "repr": {
        "kind": "c",
        "packed": true
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "filterPeriod",
            "type": "u16"
          },
          {
            "name": "decayPeriod",
            "type": "u16"
          },
          {
            "name": "reductionFactor",
            "type": "u16"
          },
          {
            "name": "adaptiveFeeControlFactor",
            "type": "u32"
          },
          {
            "name": "maxVolatilityAccumulator",
            "type": "u32"
          },
          {
            "name": "tickGroupSize",
            "type": "u16"
          },
          {
            "name": "majorSwapThresholdTicks",
            "type": "u16"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "adaptiveFeeTier",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "whirlpoolsConfig",
            "type": "pubkey"
          },
          {
            "name": "feeTierIndex",
            "type": "u16"
          },
          {
            "name": "tickSpacing",
            "type": "u16"
          },
          {
            "name": "initializePoolAuthority",
            "type": "pubkey"
          },
          {
            "name": "delegatedFeeAuthority",
            "type": "pubkey"
          },
          {
            "name": "defaultBaseFeeRate",
            "type": "u16"
          },
          {
            "name": "filterPeriod",
            "type": "u16"
          },
          {
            "name": "decayPeriod",
            "type": "u16"
          },
          {
            "name": "reductionFactor",
            "type": "u16"
          },
          {
            "name": "adaptiveFeeControlFactor",
            "type": "u32"
          },
          {
            "name": "maxVolatilityAccumulator",
            "type": "u32"
          },
          {
            "name": "tickGroupSize",
            "type": "u16"
          },
          {
            "name": "majorSwapThresholdTicks",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "adaptiveFeeVariables",
      "serialization": "bytemuckunsafe",
      "repr": {
        "kind": "c",
        "packed": true
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lastReferenceUpdateTimestamp",
            "type": "u64"
          },
          {
            "name": "lastMajorSwapTimestamp",
            "type": "u64"
          },
          {
            "name": "volatilityReference",
            "type": "u32"
          },
          {
            "name": "tickGroupIndexReference",
            "type": "i32"
          },
          {
            "name": "volatilityAccumulator",
            "type": "u32"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "configFeatureFlag",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "tokenBadge",
            "fields": [
              "bool"
            ]
          }
        ]
      }
    },
    {
      "name": "dynamicTick",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "uninitialized"
          },
          {
            "name": "initialized",
            "fields": [
              {
                "defined": {
                  "name": "dynamicTickData"
                }
              }
            ]
          }
        ]
      }
    },
    {
      "name": "dynamicTickArray",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "startTickIndex",
            "type": "i32"
          },
          {
            "name": "whirlpool",
            "type": "pubkey"
          },
          {
            "name": "tickBitmap",
            "type": "u128"
          },
          {
            "name": "ticks",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "dynamicTick"
                  }
                },
                88
              ]
            }
          }
        ]
      }
    },
    {
      "name": "dynamicTickData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "liquidityNet",
            "type": "i128"
          },
          {
            "name": "liquidityGross",
            "type": "u128"
          },
          {
            "name": "feeGrowthOutsideA",
            "type": "u128"
          },
          {
            "name": "feeGrowthOutsideB",
            "type": "u128"
          },
          {
            "name": "rewardGrowthsOutside",
            "type": {
              "array": [
                "u128",
                3
              ]
            }
          }
        ]
      }
    },
    {
      "name": "feeTier",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "whirlpoolsConfig",
            "type": "pubkey"
          },
          {
            "name": "tickSpacing",
            "type": "u16"
          },
          {
            "name": "defaultFeeRate",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "liquidityDecreased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "whirlpool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "tickLowerIndex",
            "type": "i32"
          },
          {
            "name": "tickUpperIndex",
            "type": "i32"
          },
          {
            "name": "liquidity",
            "type": "u128"
          },
          {
            "name": "tokenAAmount",
            "type": "u64"
          },
          {
            "name": "tokenBAmount",
            "type": "u64"
          },
          {
            "name": "tokenATransferFee",
            "type": "u64"
          },
          {
            "name": "tokenBTransferFee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "liquidityIncreased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "whirlpool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "tickLowerIndex",
            "type": "i32"
          },
          {
            "name": "tickUpperIndex",
            "type": "i32"
          },
          {
            "name": "liquidity",
            "type": "u128"
          },
          {
            "name": "tokenAAmount",
            "type": "u64"
          },
          {
            "name": "tokenBAmount",
            "type": "u64"
          },
          {
            "name": "tokenATransferFee",
            "type": "u64"
          },
          {
            "name": "tokenBTransferFee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lockConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "positionOwner",
            "type": "pubkey"
          },
          {
            "name": "whirlpool",
            "type": "pubkey"
          },
          {
            "name": "lockedTimestamp",
            "type": "u64"
          },
          {
            "name": "lockType",
            "type": {
              "defined": {
                "name": "lockTypeLabel"
              }
            }
          }
        ]
      }
    },
    {
      "name": "lockType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "permanent"
          }
        ]
      }
    },
    {
      "name": "lockTypeLabel",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "permanent"
          }
        ]
      }
    },
    {
      "name": "openPositionBumps",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "positionBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "openPositionWithMetadataBumps",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "positionBump",
            "type": "u8"
          },
          {
            "name": "metadataBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "oracle",
      "serialization": "bytemuckunsafe",
      "repr": {
        "kind": "c",
        "packed": true
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "whirlpool",
            "type": "pubkey"
          },
          {
            "name": "tradeEnableTimestamp",
            "type": "u64"
          },
          {
            "name": "adaptiveFeeConstants",
            "type": {
              "defined": {
                "name": "adaptiveFeeConstants"
              }
            }
          },
          {
            "name": "adaptiveFeeVariables",
            "type": {
              "defined": {
                "name": "adaptiveFeeVariables"
              }
            }
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          }
        ]
      }
    },
    {
      "name": "poolInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "whirlpool",
            "type": "pubkey"
          },
          {
            "name": "whirlpoolsConfig",
            "type": "pubkey"
          },
          {
            "name": "tokenMintA",
            "type": "pubkey"
          },
          {
            "name": "tokenMintB",
            "type": "pubkey"
          },
          {
            "name": "tickSpacing",
            "type": "u16"
          },
          {
            "name": "tokenProgramA",
            "type": "pubkey"
          },
          {
            "name": "tokenProgramB",
            "type": "pubkey"
          },
          {
            "name": "decimalsA",
            "type": "u8"
          },
          {
            "name": "decimalsB",
            "type": "u8"
          },
          {
            "name": "initialSqrtPrice",
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "position",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "whirlpool",
            "type": "pubkey"
          },
          {
            "name": "positionMint",
            "type": "pubkey"
          },
          {
            "name": "liquidity",
            "type": "u128"
          },
          {
            "name": "tickLowerIndex",
            "type": "i32"
          },
          {
            "name": "tickUpperIndex",
            "type": "i32"
          },
          {
            "name": "feeGrowthCheckpointA",
            "type": "u128"
          },
          {
            "name": "feeOwedA",
            "type": "u64"
          },
          {
            "name": "feeGrowthCheckpointB",
            "type": "u128"
          },
          {
            "name": "feeOwedB",
            "type": "u64"
          },
          {
            "name": "rewardInfos",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "positionRewardInfo"
                  }
                },
                3
              ]
            }
          }
        ]
      }
    },
    {
      "name": "positionBundle",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "positionBundleMint",
            "type": "pubkey"
          },
          {
            "name": "positionBitmap",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "positionRewardInfo",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "growthInsideCheckpoint",
            "type": "u128"
          },
          {
            "name": "amountOwed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "remainingAccountsInfo",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "slices",
            "type": {
              "vec": {
                "defined": {
                  "name": "remainingAccountsSlice"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "remainingAccountsSlice",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "accountsType",
            "type": {
              "defined": {
                "name": "accountsType"
              }
            }
          },
          {
            "name": "length",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "tick",
      "serialization": "bytemuckunsafe",
      "repr": {
        "kind": "c",
        "packed": true
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "initialized",
            "type": "bool"
          },
          {
            "name": "liquidityNet",
            "type": "i128"
          },
          {
            "name": "liquidityGross",
            "type": "u128"
          },
          {
            "name": "feeGrowthOutsideA",
            "type": "u128"
          },
          {
            "name": "feeGrowthOutsideB",
            "type": "u128"
          },
          {
            "name": "rewardGrowthsOutside",
            "type": {
              "array": [
                "u128",
                3
              ]
            }
          }
        ]
      }
    },
    {
      "name": "tickArray",
      "serialization": "bytemuckunsafe",
      "repr": {
        "kind": "c",
        "packed": true
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "startTickIndex",
            "type": "i32"
          },
          {
            "name": "ticks",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "tick"
                  }
                },
                88
              ]
            }
          },
          {
            "name": "whirlpool",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "tokenBadge",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "whirlpoolsConfig",
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "attributeRequireNonTransferablePosition",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "tokenBadgeAttribute",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "requireNonTransferablePosition",
            "fields": [
              "bool"
            ]
          }
        ]
      }
    },
    {
      "name": "traded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "whirlpool",
            "type": "pubkey"
          },
          {
            "name": "aToB",
            "type": "bool"
          },
          {
            "name": "preSqrtPrice",
            "type": "u128"
          },
          {
            "name": "postSqrtPrice",
            "type": "u128"
          },
          {
            "name": "inputAmount",
            "type": "u64"
          },
          {
            "name": "outputAmount",
            "type": "u64"
          },
          {
            "name": "inputTransferFee",
            "type": "u64"
          },
          {
            "name": "outputTransferFee",
            "type": "u64"
          },
          {
            "name": "lpFee",
            "type": "u64"
          },
          {
            "name": "protocolFee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "whirlpool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "whirlpoolsConfig",
            "type": "pubkey"
          },
          {
            "name": "whirlpoolBump",
            "type": {
              "array": [
                "u8",
                1
              ]
            }
          },
          {
            "name": "tickSpacing",
            "type": "u16"
          },
          {
            "name": "feeTierIndexSeed",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "feeRate",
            "type": "u16"
          },
          {
            "name": "protocolFeeRate",
            "type": "u16"
          },
          {
            "name": "liquidity",
            "type": "u128"
          },
          {
            "name": "sqrtPrice",
            "type": "u128"
          },
          {
            "name": "tickCurrentIndex",
            "type": "i32"
          },
          {
            "name": "protocolFeeOwedA",
            "type": "u64"
          },
          {
            "name": "protocolFeeOwedB",
            "type": "u64"
          },
          {
            "name": "tokenMintA",
            "type": "pubkey"
          },
          {
            "name": "tokenVaultA",
            "type": "pubkey"
          },
          {
            "name": "feeGrowthGlobalA",
            "type": "u128"
          },
          {
            "name": "tokenMintB",
            "type": "pubkey"
          },
          {
            "name": "tokenVaultB",
            "type": "pubkey"
          },
          {
            "name": "feeGrowthGlobalB",
            "type": "u128"
          },
          {
            "name": "rewardLastUpdatedTimestamp",
            "type": "u64"
          },
          {
            "name": "rewardInfos",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "whirlpoolRewardInfo"
                  }
                },
                3
              ]
            }
          }
        ]
      }
    },
    {
      "name": "whirlpoolBumps",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "whirlpoolBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "whirlpoolRewardInfo",
      "docs": [
        "Stores the state relevant for tracking liquidity mining rewards at the `Whirlpool` level.",
        "These values are used in conjunction with `PositionRewardInfo`, `Tick.reward_growths_outside`,",
        "and `Whirlpool.reward_last_updated_timestamp` to determine how many rewards are earned by open",
        "positions."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "docs": [
              "Reward token mint."
            ],
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "Reward vault token account."
            ],
            "type": "pubkey"
          },
          {
            "name": "extension",
            "docs": [
              "reward_infos[0]: Authority account that has permission to initialize the reward and set emissions.",
              "reward_infos[1]: used for a struct that contains fields for extending the functionality of Whirlpool.",
              "reward_infos[2]: reserved for future use.",
              "",
              "Historical notes:",
              "Originally, this was a field named \"authority\", but it was found that there was no opportunity",
              "to set different authorities for the three rewards. Therefore, the use of this field was changed for Whirlpool's future extensibility."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "emissionsPerSecondX64",
            "docs": [
              "Q64.64 number that indicates how many tokens per second are earned per unit of liquidity."
            ],
            "type": "u128"
          },
          {
            "name": "growthGlobalX64",
            "docs": [
              "Q64.64 number that tracks the total tokens earned per unit of liquidity since the reward",
              "emissions were turned on."
            ],
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "whirlpoolsConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feeAuthority",
            "type": "pubkey"
          },
          {
            "name": "collectProtocolFeesAuthority",
            "type": "pubkey"
          },
          {
            "name": "rewardEmissionsSuperAuthority",
            "type": "pubkey"
          },
          {
            "name": "defaultProtocolFeeRate",
            "type": "u16"
          },
          {
            "name": "featureFlags",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "whirlpoolsConfigExtension",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "whirlpoolsConfig",
            "type": "pubkey"
          },
          {
            "name": "configExtensionAuthority",
            "type": "pubkey"
          },
          {
            "name": "tokenBadgeAuthority",
            "type": "pubkey"
          }
        ]
      }
    }
  ]
};
