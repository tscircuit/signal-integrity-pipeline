import type { Snapshot } from "./snapshot"

// Dense real matrices.
export type Matrix = number[][]
/** Averages a matrix with its transpose, removing the small asymmetry solvers leave behind. */
export const symmetrize = (a: Snapshot<Matrix>): Matrix =>
  a.map((r, i) => r.map((v, j) => (v + a[j][i]) / 2))
