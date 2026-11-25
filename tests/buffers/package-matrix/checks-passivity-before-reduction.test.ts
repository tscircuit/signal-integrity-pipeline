import { test } from "bun:test"
import assert from "node:assert/strict"
import { reducePackageMatrices } from "../../../src/buffers/reduce-package-matrices"

import { model } from "../../fixtures/package-matrix"

test("checks passivity before reduction", () => {
  for (const field of ["L", "C"] as const) {
    assert.throws(
      () =>
        reducePackageMatrices({
          model: {
            ...model,
            [field]: [
              [1, 2, 0],
              [2, 1, 0],
              [0, 0, 1],
            ],
          },
          pins: model.pins,
        }),
      /positive definite|Maxwell/,
    )
    const semidefiniteModel = {
      ...model,
      [field]: [
        [1, -1, 0],
        [-1, 1, 0],
        [0, 0, 1],
      ],
    }
    const reduceSemidefinite = () =>
      reducePackageMatrices({ model: semidefiniteModel, pins: model.pins })
    if (field === "L") {
      assert.throws(reduceSemidefinite, /positive definite/)
    } else {
      assert.deepEqual(reduceSemidefinite().C, semidefiniteModel.C)
    }
    assert.throws(
      () =>
        reducePackageMatrices({
          model: {
            ...model,
            [field]: [
              [1, 0, 0],
              [0, 1, 2],
              [0, 2, 1],
            ],
          },
          pins: ["B"],
        }),
      /positive definite|Maxwell/,
      "invalid unused blocks cannot disappear during reduction",
    )
  }
})
