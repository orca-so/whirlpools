---
"@orca-so/whirlpools": patch
---

Fix `harvestAllPositionFees` to flush the final instruction batch so all positions are harvested when instructions stay within or cross the transaction size limit.
