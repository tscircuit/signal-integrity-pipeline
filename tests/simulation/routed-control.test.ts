import { test } from "bun:test"
import assert from "node:assert/strict"
import { routedControl } from "../../src/simulation/routed-control"

test("writes declarative transient and save lines", () => {
  assert.deepEqual(
    routedControl({
      saved: "v(receiver) i(vdrive)",
      stepSeconds: 1e-11,
      durationSeconds: 4e-9,
    }),
    [".save v(receiver) i(vdrive)", ".tran 1e-11 4e-9 0 1e-11", ".end"],
  )
})

test("omits interactive commands", () => {
  assert.doesNotMatch(
    routedControl({
      saved: "v(n)",
      stepSeconds: 1e-11,
      durationSeconds: 4e-9,
    }).join("\n"),
    /control|wrdata|quit|resume|stop when/,
  )
})
