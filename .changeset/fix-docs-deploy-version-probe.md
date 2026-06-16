---
"@orca-so/whirlpools-docs": patch
---

Fix the docs deploy step failing in CI. The version probe in `scripts/deploy-docs` aborted under `set -eo pipefail` when grep found no match, and the `<meta itemprop="version">` tag was no longer reaching the served HTML. The tag is now emitted via `<Head>` and the probe tolerates a missing match.
