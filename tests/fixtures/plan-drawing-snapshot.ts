import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import { withPlanCaption } from "./plan-caption"

/** Round drawing coordinates at the precision shared by the supported JavaScript engines. */
const SNAPSHOT_DECIMAL_PLACES = 6
/** Export the plan drawing at a fixed size for snapshot comparison. */
const SNAPSHOT_WIDTH = 1100
const SNAPSHOT_HEIGHT = 800

/** Compare actual exported SVG, including explicit text and fills; snapshots contain no vendor data. */
export function assertPlanDrawingSnapshot({
  drawing,
  module,
  name,
  caption,
  trimTrailingWhitespace = false,
}: {
  drawing: GraphicsObject
  module: string
  name: string
  caption?: string
  trimTrailingWhitespace?: boolean
}): void {
  const path = join(
    import.meta.dirname,
    "..",
    module,
    "__snapshots__",
    `${name}.snap.svg`,
  )
  // Ignore sub-micro-drawing-unit V8/JavaScriptCore rounding in display coordinates only.
  let picture = drawing
  if (caption) picture = withPlanCaption({ drawing, caption })
  const serialized = JSON.stringify(picture, (_key, value) => {
    if (typeof value === "number")
      return Number(value.toFixed(SNAPSHOT_DECIMAL_PLACES))
    return value
  })
  const normalized: GraphicsObject = JSON.parse(serialized)
  let svg = getSvgFromGraphicsObject(normalized, {
    svgWidth: SNAPSHOT_WIDTH,
    svgHeight: SNAPSHOT_HEIGHT,
    backgroundColor: "white",
    includeTextLabels: false,
  })
  if (trimTrailingWhitespace)
    svg = svg
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
  if (process.env.UPDATE_PLAN_DRAWINGS === "1") {
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, svg)
  }
  assert.equal(
    svg,
    readFileSync(path, "utf8"),
    `${module}/${name} SVG changed; inspect PNGs before updating snapshots`,
  )
}
