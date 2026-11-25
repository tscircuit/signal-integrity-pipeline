import { test } from "bun:test"
import assert from "node:assert/strict"
import { convert, source, switchingInput } from "../../fixtures/switching"

test("leaves an off-package VREF on the board terminal", async () => {
  const input = await switchingInput()
  const next = {
    ...input,
    definition: {
      ...input.definition,
      references: { "1": { external: "board_vref" } },
    },
  }
  const converted = convert({
    next,
    text: source.replace(
      "[Voltage Range]",
      "[External Reference] 0.75 0.75 0.75\n[Voltage Range]",
    ),
  })
  assert.ok(Object.values(converted.spicePinMapping).includes("board_vref"))
  assert.equal(converted.metadata.pins[0].references.external, "board_vref")
})
