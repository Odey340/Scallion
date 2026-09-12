/**
 * `0` = <20, `1` = <100, `2` = <500, `3` = >=500. Per docs/contracts.md §2.
 * Shared by every parser — WhatsApp buckets a character count (the only
 * thing kept after reading the text); Gmail buckets `sizeEstimate` bytes
 * instead, since the `gmail.metadata` scope never exposes message bodies.
 */
export function bucketLength(n: number): 0 | 1 | 2 | 3 {
  if (n < 20) return 0;
  if (n < 100) return 1;
  if (n < 500) return 2;
  return 3;
}
