# TokenExtensions

On May 28th 2024, Whirlpool program has been upgraded to support TokenExtensions (aka Token-2022 program).

## Extension List
**Supported**
- TransferFee
- InterestBearing (supported since Oct 11th 2024)
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
- Group, GroupPointer
- Member, MemberPointer
- NonTransferable
- All other extensions not listed above

## New Instructions
### V2 Instructions
V2 instructions have been added to handle tokens owned by Token-2022 program.

- V1 instructions don’t work for pools with Token-2022 tokens.
- V2 instructions work for pools with the following combinations. So V2 encompasses V1; an implementation that always uses V2 is simple, but the downside is increased transaction size if ALT is not used because of the larger number of accounts required.
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
Allowing unrestricted pool creation with tokens that have certain extensions, like PermanentDelegate, was found to pose more risks than benefits. To safely support these types of tokens, the TokenBadge was introduced as a whitelist mechanism.

A TokenBadge is a PDA which allows pools and rewards to be initialized for such tokens. Each wirlpool config can independently whitelist tokens using a TokenBadge account

The TokenBadge itself only records the WhirlpoolsConfig and Mint used at initialization, without any additional information. Its existence signifies that pools and rewards can be initialized for the associated token.

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

The user can set conditions on the exact amount going out of and coming into the token account, regardless of fees.

No additional parameters are added to limit the amount of fees. If the fee is changed, the new rate is delayed by two epochs to prevent sudden increases. In the edge case where a fee change is scheduled to take effect within the transaction’s lifetime, transactions that exceed the outgoing and incoming amount thresholds will fail.

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
The TransferHook extension is a relatively new feature in the ecosystem, and its use cases are still being explored.

While it’s still undecided which types of TransferHook tokens will be eligible for a TokenBadge, the following best practices should guide selection:

- The code of the TransferHook program is publicly available.
- Verifiable Build has been done to ensure the code and program match.
- Upgrade authority have been disabled (ideal, but not required)
- Only perform processes that pose no risk to the user (e.g. logging)
- TransferHook must not block the transfer of tokens, or that the criteria for blocking are clearly declared, fair and reasonable.
- TransferHook must not interfere with the operation of the pool. It must not interfere with the trade, deposit, withdraw and harvest.
- Extensions that block transactions based on the amount of tokens to be transferred are undesirable because they cause transactions to fail in ways that are surprising to pool users. On the other hand, failing transfers to sanctioned wallets according to some public standard will not obstruct pool usage for many users.
- TransferHook must not request large numbers of accounts that would increase transaction size.
- TransferHook should not attempt any token transfers (including WSOL and native SOL).
- TransferHook should not attempt imposing any kind of additional fees.