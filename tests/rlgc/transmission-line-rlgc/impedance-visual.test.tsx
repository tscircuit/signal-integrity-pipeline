import { test } from "bun:test"
import assert from "node:assert/strict"
import { routeTones } from "../../../src/board"
import type { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import { routedVisualFixture } from "../../fixtures/routed-visual"

/** Check the whole-ohm label used for mapped copper. */
function isImpedanceLabel(label: string): boolean {
  const suffix = " Ω"
  if (!label.endsWith(suffix)) return false
  const value = label.slice(0, -suffix.length)
  return (
    value.length > 0 && [...value].every((char) => char >= "0" && char <= "9")
  )
}

test("field drawing cuts the board at the slice and shows its stack in a pane, writing only Z0", async () => {
  const { root } = await routedVisualFixture()
  const drawing = root
    .getSolver<TransmissionLineRlgcSolver>("TransmissionLineRlgcSolver")!
    .visualize()
  assert.ok(
    drawing.polygons!.some((polygon) => polygon.fill === routeTones.slice),
    "amber cut on the board",
  )
  assert.ok(
    drawing.lines!.some(
      (line) => line.zIndex === -1 && line.strokeColor === routeTones.pane,
    ),
    "the pane is opaque over the board",
  )
  const mapped = drawing.lines!.filter((line) =>
    isImpedanceLabel(line.label ?? ""),
  )
  assert.ok(
    mapped.length >= 2 &&
      mapped.every((line) => line.strokeColor!.startsWith("rgb(")),
    "solved copper is coloured by its Z0",
  )
  assert.equal(
    drawing.rects!.filter(
      (rect) => rect.fill?.startsWith("rgb(") && rect.width < 1,
    ).length >= 2,
    true,
    "conductors share the Z0 scale",
  )
  assert.ok(
    drawing.polygons!.some((polygon) => polygon.fill === routeTones.coupling),
    "coupling band paints in front of the stack",
  )
  assert.ok(
    drawing.texts!.every((text) => /^\d+ Ω$/.test(text.text)),
    "only impedances are written",
  )
})
