const RECURSION_BREAKPOINT = 600;

/**
 * Implementation of Floyd-Rivest selection
 * https://en.wikipedia.org/wiki/Floyd%E2%80%93Rivest_algorithm
 *
 * Performs an in place partition of an array of items, such that
 * indices [0, k) contain the k smallest elements and all indices
 * [k, array.length) are larger than all elements in [0, k)
 *
 * @param array
 * @param k
 * @param left
 * @param right
 * @param compare
 */
export function kSmallestPartition<T>(
  array: T[],
  k: number,
  left: number = 0,
  right: number = array.length - 1,
  compare: (a: T, b: T) => number = defaultCompare
) {
  while (right > left) {
    // Recursive sampling and partition of the set
    if (right - left > RECURSION_BREAKPOINT) {
      const n = right - left + 1;
      const i = k - left + 1;
      const z = Math.log(n);
      const s = 0.5 * Math.exp((2 * z) / 3);
      const sd = 0.5 * Math.sqrt((z * s * (n - s)) / n) * (i - n / 2 < 0 ? -1 : 1);
      const newLeft = Math.max(left, Math.floor(k - (i * s) / n + sd));
      const newRight = Math.min(right, Math.floor(k + ((n - i) * s) / n + sd));
      kSmallestPartition(array, k, newLeft, newRight, compare);
    }

    // Partition elements around t
    const t = array[k];
    let i = left;
    let j = right;

    swap(array, left, k);
    if (compare(array[right], t) > 0) {
      swap(array, left, right);
    }

    while (i < j) {
      swap(array, i, j);
      i++;
      j--;
      while (compare(array[i], t) < 0) {
        i++;
      }
      while (compare(array[j], t) > 0) {
        j--;
      }
    }

    if (compare(array[left], t) === 0) {
      swap(array, left, j);
    } else {
      j++;
      swap(array, j, right);
    }

    // Adjust boundaries of partitions
    if (j <= k) {
      left = j + 1;
    }
    if (k <= j) {
      right = j - 1;
    }
  }
}

function swap<T>(arr: T[], i: number, j: number) {
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}

function defaultCompare<T>(a: T, b: T) {
  return a < b ? -1 : a > b ? 1 : 0;
}
