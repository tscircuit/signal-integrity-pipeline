import { test } from "bun:test"
import assert from "node:assert/strict"
import { convertIbisModelToSpice } from "@tscircuit/ibis-to-spice"

import {
  convert,
  points,
  run,
  source,
  switchingInput,
} from "../../fixtures/switching"

test("interpolates a run ending during an edge", async () => {
  const input = await switchingInput()
  const finite = run({
    input,
    bits: "1",
    interval: "1.25ns",
    duration: "0.5ns",
  })
  const original = convertIbisModelToSpice(
    source,
    { ...finite.definition, packagePolicy: "omit" },
    finite.run,
  )
  assert.deepEqual(
    points({ text: convert({ next: finite }).source, label: "KU" }),
    points({ text: original.source, label: "KU" }),
    "finite window interpolates inside the measured transition",
  )
})
