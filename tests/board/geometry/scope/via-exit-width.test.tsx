import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  scopeFor,
  scopeTrace,
  viaApproach,
} from "../../../fixtures/copper-scope-board"

test("copper screening includes the width of a wire leaving a via", async () => {
  const circuit = await viaApproach({
    explicitWire: false,
    exitToLeft: true,
    neighborY: 1.3,
    width: 0.8,
  })
  const fan = scopeTrace({ circuit, name: "FAN" })
  assert(
    fan.route.some((point, index) => {
      const end = fan.route[index + 1]
      return (
        point.route_type === "via" &&
        end?.route_type === "wire" &&
        end.layer === "bottom" &&
        end.width === 0.8
      )
    }),
  )
  assert(scopeFor({ circuit }).pcbTraceIds.includes(fan.pcb_trace_id))
})
