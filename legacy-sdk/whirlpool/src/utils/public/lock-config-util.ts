import type { LockTypeData } from "../../types/public";

/**
 * A collection of utility functions when interacting with a LockConfig.
 * @category Whirlpool Utils
 */
export class LockConfigUtil {
  public static getPermanentLockType(): LockTypeData {
    return { permanent: {} };
  }

  // We may add getSomethingNewLockType(args) here in the future.
  // Also we can add helper function to compile LockTypeLabelData and related fields.
}
