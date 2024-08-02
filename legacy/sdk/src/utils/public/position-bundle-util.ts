import invariant from "tiny-invariant";
import { PositionBundleData, POSITION_BUNDLE_SIZE } from "../../types/public";

/**
 * A collection of utility functions when interacting with a PositionBundle.
 * @category Whirlpool Utils
 */
export class PositionBundleUtil {
  private constructor() {}

  /**
   * Check if the bundle index is in the correct range.
   *
   * @param bundleIndex The bundle index to be checked
   * @returns true if bundle index is in the correct range
   */
  public static checkBundleIndexInBounds(bundleIndex: number): boolean {
    return bundleIndex >= 0 && bundleIndex < POSITION_BUNDLE_SIZE;
  }

  /**
   * Check if the Bundled Position corresponding to the bundle index has been opened.
   *
   * @param positionBundle The position bundle to be checked
   * @param bundleIndex The bundle index to be checked
   * @returns true if Bundled Position has been opened
   */
  public static isOccupied(positionBundle: PositionBundleData, bundleIndex: number): boolean {
    invariant(PositionBundleUtil.checkBundleIndexInBounds(bundleIndex), "bundleIndex out of range");
    const array = PositionBundleUtil.convertBitmapToArray(positionBundle);
    return array[bundleIndex];
  }

  /**
   * Check if the Bundled Position corresponding to the bundle index has not been opened.
   *
   * @param positionBundle The position bundle to be checked
   * @param bundleIndex The bundle index to be checked
   * @returns true if Bundled Position has not been opened
   */
  public static isUnoccupied(positionBundle: PositionBundleData, bundleIndex: number): boolean {
    return !PositionBundleUtil.isOccupied(positionBundle, bundleIndex);
  }

  /**
   * Check if all bundle index is occupied.
   *
   * @param positionBundle The position bundle to be checked
   * @returns true if all bundle index is occupied
   */
  public static isFull(positionBundle: PositionBundleData): boolean {
    const unoccupied = PositionBundleUtil.getUnoccupiedBundleIndexes(positionBundle);
    return unoccupied.length === 0;
  }

  /**
   * Check if all bundle index is unoccupied.
   *
   * @param positionBundle The position bundle to be checked
   * @returns true if all bundle index is unoccupied
   */
  public static isEmpty(positionBundle: PositionBundleData): boolean {
    const occupied = PositionBundleUtil.getOccupiedBundleIndexes(positionBundle);
    return occupied.length === 0;
  }

  /**
   * Get all bundle indexes where the corresponding Bundled Position is open.
   *
   * @param positionBundle The position bundle to be checked
   * @returns The array of bundle index where the corresponding Bundled Position is open
   */
  public static getOccupiedBundleIndexes(positionBundle: PositionBundleData): number[] {
    const result: number[] = [];
    PositionBundleUtil.convertBitmapToArray(positionBundle).forEach((occupied, index) => {
      if (occupied) {
        result.push(index);
      }
    });
    return result;
  }

  /**
   * Get all bundle indexes where the corresponding Bundled Position is not open.
   *
   * @param positionBundle The position bundle to be checked
   * @returns The array of bundle index where the corresponding Bundled Position is not open
   */
  public static getUnoccupiedBundleIndexes(positionBundle: PositionBundleData): number[] {
    const result: number[] = [];
    PositionBundleUtil.convertBitmapToArray(positionBundle).forEach((occupied, index) => {
      if (!occupied) {
        result.push(index);
      }
    });
    return result;
  }

  /**
   * Get the first unoccupied bundle index in the position bundle.
   *
   * @param positionBundle The position bundle to be checked
   * @returns The first unoccupied bundle index, null if the position bundle is full
   */
  public static findUnoccupiedBundleIndex(positionBundle: PositionBundleData): number | null {
    const unoccupied = PositionBundleUtil.getUnoccupiedBundleIndexes(positionBundle);
    return unoccupied.length === 0 ? null : unoccupied[0];
  }

  /**
   * Convert position bitmap to the array of boolean which represent if Bundled Position is open.
   *
   * @param positionBundle The position bundle whose bitmap will be converted
   * @returns The array of boolean representing if Bundled Position is open
   */
  public static convertBitmapToArray(positionBundle: PositionBundleData): boolean[] {
    const result: boolean[] = [];
    positionBundle.positionBitmap.map((bitmap) => {
      for (let offset = 0; offset < 8; offset++) {
        result.push((bitmap & (1 << offset)) !== 0);
      }
    });
    return result;
  }
}
