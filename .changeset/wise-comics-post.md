---
"@orca-so/rust-tx-sender": major
---

BREAKING: Changed build_transaction to accept the transaction payer instead of a list of signers because the caller might not have access to all signers when building a transaction. Under the hood, we rely on the `num_required_signers` in a compiled message to determine how many signatures to include when creating a VersionedTransaction
