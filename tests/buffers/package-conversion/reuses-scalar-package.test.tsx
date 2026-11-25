import { test } from "bun:test"
import assert from "node:assert/strict"
import { convertIbisModelToSpice } from "@tscircuit/ibis-to-spice"
import { convert, run, source, switchingInput } from "../../fixtures/switching"

test("reuses upstream scalar SPICE for series-only signal parasitics and ideal rails", async () => {
  const input = await switchingInput()
  const next = run({ input, bits: "0", interval: "5ns" })
  const text = source
    .replace(
      "[Pin] signal_name model_name",
      "[Pin] signal_name model_name R_pin L_pin C_pin",
    )
    .replace("1 DQ driver", "1 DQ driver 0.02 1n 0")
  assert.notEqual(text, source)
  const definition = {
    ...next.definition,
    packagePolicy: "vendor" as const,
    source: { content: text },
  }
  const upstream = convertIbisModelToSpice(text, definition, next.run)
  const converted = convert({ next: { ...next, definition }, text })

  assert.match(upstream.source, /RPKG0 PAD0 PKGR0 0\.02\n/)
  assert.match(upstream.source, /LPKG0 PKGR0 PKGL0 1e-9\n/)
  assert.equal(converted.source, upstream.source)
  assert.deepEqual(converted.metadata, upstream.metadata)
})
