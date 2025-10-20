import type {
  WhirlpoolControlFlags,
  ConfigFeatureFlags,
} from "../../types/public";

/**
 * A collection of utility functions when interacting with flags in accounts owned by the Whirlpool program.
 * @category Whirlpool Utils
 */
export class FlagUtil {
  public static u16ToConfigFeatureFlags(flags: number): ConfigFeatureFlags {
    return {
      tokenBadge: (flags & 0b00000000_00000001) !== 0,
    };
  }

  public static u16ToWhirlpoolControlFlags(
    flags: number,
  ): WhirlpoolControlFlags {
    return {
      requireNonTransferablePosition: (flags & 0b00000000_00000001) !== 0,
    };
  }
}
