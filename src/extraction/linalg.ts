import type { Matrix, Snapshot } from "../kernel"

export { type Matrix, symmetrize } from "../kernel"
/** Adds up a list of numbers (0 for an empty list). */
export const sum = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + b, 0)
/** Swaps rows and columns of a matrix. */
export const transpose = (a: Snapshot<Matrix>): Matrix =>
  a[0].map((_, j) => a.map((r) => r[j]))
/** Ordinary matrix product a·b. */
export const multiply = ({
  a,
  b,
}: {
  a: Snapshot<Matrix>
  b: Snapshot<Matrix>
}): Matrix =>
  a.map((r) => transpose(b).map((c) => sum(r.map((v, k) => v * c[k]))))
