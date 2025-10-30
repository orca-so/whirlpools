---
---

Migrate integration tests from Anchor test validator to LiteSVM for improved test performance and reliability. This change includes:

- Updated test infrastructure to support versioned transactions in LiteSVM
- Added polling mechanisms for state synchronization in LiteSVM environment
- Fixed type safety issues in test setup and helpers
- Simplified Anchor.toml configuration now that tests use LiteSVM

This is an internal infrastructure change that does not affect public APIs or functionality.
