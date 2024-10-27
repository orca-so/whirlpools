# TokenExtensions

At slot `268396603` (May 28, 2024 07:08:16 UTC), Whirlpool program have been upgraded to support TokenExtensions (aka Token-2022 program).

The same program has been deployed on Devnet. So you can try it on Devnet.

> ℹ️ Now Orca UI doesn't show whirlpools with TokenExtensions, so it is "contract level" support only at the moment.
The only exception is PYUSD, which is supported in the UI.

## Extension List
**Supported**
- TransferFee
- InterestBearing (supported at slot 294954598 (Oct 11, 2024 06:26:42 UTC))
- MemoTransfer
- MetadataPointer
- TokenMetadata
- ConfidentialTransfer (non-confidential transfer only)

**Supported if it has initialized TokenBadge**
- PermanentDelegate
- TransferHook
- MintCloseAuthority
- DefaultAccountState (default state must be Initialized)

> ℹ️ FreezeAuthority is not extensions, but it requires TokenBadge. 
It should be disabled unless there is a reasonable reason (e.g., legal compliance). FreezeAuthority rejection does not apply to TokenProgram tokens, but does apply to TokenExtensions tokens. 

**Not Supported**
- InterestBearing -> supported at slot 294954598 (Oct 11, 2024 06:26:42 UTC)
- Group, GroupPointer
- Member, MemberPointer
- NonTransferable
- All other extensions not listed above

## New Instructions
### V2 Instructions
V2 instructions have been added to handle tokens owned by Token-2022 program.

- V1 instructions don’t work for pools with Token-2022 tokens.
- V2 instructions work for pools with the following combinations. So V2 encompasses V1; an implementation that always uses V2 is simple, but the downside is increased transaction size if ALT is not used because of the large number of accounts required.
    - Token / Token
    - Token-2022 / Token
    - Token / Token-2022
    - Token-2022 / Token-2022
- Token-2022 program requires Mint account for transfer, so the V2 instructions receive token programs and Mint accounts. It must also receive an SPL Memo program to support MemoTransfer.
- When dealing with tokens that have TransferHook extension, instructions will receive the accounts used by the hook program as remaining accounts.
- To reduce transfer fee, two_hop_swap_v2 transfers token directly from the first pool to the second pool. The user's token account is not passed through.
#### For Trade
|Instruction|Corresponding V1|Notes|
|---|---|---|
|swap_v2|swap||
|two_hop_swap_v2|two_hop_swap|intermediate token accounts have been eliminated to reduce transfer fee overhead|

#### For Liquidity
|Instruction|Corresponding V1|
|---|---|
|increase_liquidity_v2|increase_liquidity|
|decrease_liquidity_v2|decrease_liquidity|

#### For Fees and Rewards
|Instruction|Corresponding V1|
|---|---|
|collect_fees_v2|collect_fees|
|collect_reward_v2|collect_reward|
|collect_protocol_fees_v2|collect_protocol_fees|
|set_reward_emissions_v2|set_reward_emissions|

#### For Pool
|Instruction|Corresponding V1|
|---|---|
|initialize_pool_v2|initialize_pool|
|initialize_reward_v2|initialize_reward|

### ConfigExtension & TokenBadge Instructions
- initialize_config_extension
- set_config_extension_authority
- set_token_badge_authority
- initialize_token_badge
- delete_token_badge

## Token Badge
It was determined that the ability to freely create pools with tokens that have functions that may malfunction the pools, such as PermanentDelegate, has more disadvantages for abuse than advantages. However, several stable coins already have PermanentDelegate extension.

If tokens with features such as PermanentDelegate are used to create pools or initialize rewards, some whitelist mechanism is required, which is TokenBadge.

TokenBadge is a PDA whose seed is WhirlpoolsConfig and Mint, and each WhirlpoolsConfig can control whether or not to create TokenBadge in its space.

The TokenBadge itself only records the WhirlpoolsConfig and Mint used at initialization, and has no other additional information at the moment.

![TokenBadge](../../static/img/02-Architecture%20Overview/token-badge.png)

## Notes

### Freeze Authority
Token-2022 tokens with freeze authority will be rejected unless TokenBadge account is initialized.

If you initialise the pool with your Token-2022 tokens, make sure you have disabled FreezeAuthority.

### Native Token (WSOL)
Token-2022 program has its own Wrapped SOL mint address (9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP). Let's call it WSOL-2022.

Whirlpool program rejects WSOL-2022.

WSOL-2022 has no token extensions, so please use original WSOL (So11111111111111111111111111111111111111112).

### TransferFee
Anyone can initialize whirlpool with Token-2022 tokens having `TransferFeeConfig` extension.

#### `amount` and `otherAmountThreshold`
The relationship between `amount`, `otherAmountThreshold` and `TransferFee` in each context.

The relationship between amount, otherAmountThreshold and TransferFee in each context.

ExactIn (`amount_specified_is_input = true`)
- `amount`: transfer fee Included amount (will be sent from user's token account)
- `otherAmountThreshold`: transfer fee Excluded amount (will be received at user's token account)

ExactOut (`amount_specified_is_input = false`)
- `amount`: transfer fee Excluded amount (will be received at user's token account)
- `otherAmountThreshold`: transfer fee Included amount (will be sent from user's token account)

The user can set conditions on the amount actually going out of and coming into the token account, regardless of the amount of fees.

No additional parameters are added to limit the amount of fees.
If the fee will be changed, it is forced to be activated two epochs after, so there is no possibility of the fee suddenly going up. The edge case is when the fee change is scheduled (new epoch is coming) in less than transaction life time. In this case, the UI may need to alert users, but in any case, transactions that exceed the outgoing and incoming amount thresholds will fail.

#### `minA/B`, `maxA/B`
Increase Liquidity: `maxA`, `maxB`
transfer fee Included amount (will be sent from user's token account)

Decrease Liquidity: `minA`, `minB`
transfer fee Excluded amount (will be received at user's token account)

### TransferHook
In order to use TransferHook, the owner of WhirlpoolsConfig must issue a TokenBadge for that token.

#### Use of remaining_accounts
The account used for TransferHook is different for each program used by TransferHook. Therefore, they are received through `remaining_accounts`.

To clarify the context of accounts passed as `remaining_accounts`, the v2 instructions receive `remaining_accounts_info` as data. It is used to classify the accounts contained in `remaining_accounts`. (e.g. The first 3 are for mintA's TransferHook, next 2 are for for mintB's TransferHook).

#### Security notes
- In solana, indirect re-entrance will be rejected. So transfer hook program cannot call Whirlpool program.
- TransferHook program cannot modify transfer amount. It will be called AFTER token transfer processing.
- Token-2022 program remove signer and writable flag of the source, destination and owner when calling the TransferHo[ok program even if they are passed as extra accounts. The source and destination are not updated and the owner's signature is not used unintentionally.

#### TokenBadge request
TransferHook extension is a relatively new feature in the ecosystem and it is still unknown how it will be used.

It remains to be decided what kind of TransferHook tokens TokenBadge will be issued for, but it is important that they have the following characteristics

- The code of the TransferHook program is publicly available.
- Verifiable Build has been done to ensure the code and programme match.
- Upgrade authority have been disabled (ideal, but not required)
- Only perform processes that pose no risk to the user (e.g. logging)
- TransferHook must not block the transfer of tokens, or that the criteria for blocking are clearly declared, fair and reasonable.
- TransferHook must not interfere with the operation of the pool. It must not interfere with the trade, deposit, withdraw and harvest.
- Extensions that block transactions based on the amount of tokens to be transferred are undesirable because they cause transactions to fail in ways that are surprising to pool users. On the other hand, failing transfers to sanctioned wallets according to some public standard will not obstruct pool usage for many users.
- TransferHook must not request large numbers of accounts that would increase transaction size.
- TransferHook must not execute any token transfers (including WSOL and native SOL).
- TransferHook must not impose any kind of additional fees.