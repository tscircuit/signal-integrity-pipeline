import { test } from "bun:test"
import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Resvg, type ResvgRenderOptions } from "@resvg/resvg-js"
import type { GraphicsObject } from "graphics-debug"
import React from "react"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import {
  boardPicture,
  boardPictureSvg,
  boardPictureView,
} from "../../src/board/board-picture"
import { withPlanCaption } from "../fixtures/plan-caption"
import {
  routedVisualFixture,
  twoTracePlanCaption,
} from "../fixtures/routed-visual"
import { renderCoreSignals } from "../support/core-render"

/** The x and y coordinates of a pixel within a drawing. */
type PixelPoint = [x: number, y: number]

/** Find generated SVG tags with the given opening text. */
function svgTags({ svg, opener }: { svg: string; opener: string }): string[] {
  const tags: string[] = []
  let start = svg.indexOf(opener)
  while (start >= 0) {
    const end = svg.indexOf(">", start)
    if (end < 0) break
    tags.push(svg.slice(start, end + 1))
    start = svg.indexOf(opener, end + 1)
  }
  return tags
}

/** Read an attribute value from a generated SVG tag. */
function svgAttribute({ tag, name }: { tag: string; name: string }): string {
  const prefix = `${name}="`
  let index = tag.indexOf(prefix)
  while (index >= 0) {
    const start = index + prefix.length
    const end = tag.indexOf('"', start)
    if (end < 0) break
    if (end > start) return tag.slice(start, end)
    index = tag.indexOf(prefix, end + 1)
  }
  throw new TypeError(`Missing SVG attribute ${name}`)
}

/** The pixel centre of the first SVG circle containing the given attribute. */
function centre({
  svg,
  attribute,
}: {
  svg: string
  attribute: string
}): PixelPoint {
  const element = svgTags({ svg, opener: "<circle" }).find((circle) =>
    circle.includes(attribute),
  )
  if (!element) throw new TypeError(`Missing SVG circle with ${attribute}`)
  return [
    Number(svgAttribute({ tag: element, name: "cx" })),
    Number(svgAttribute({ tag: element, name: "cy" })),
  ]
}

/** The x, y offset of the nested board svg inside the letterboxed picture. */
function offset(board: string): PixelPoint {
  const [nested] = svgTags({ svg: board, opener: '<svg x="' })
  if (!nested) throw new TypeError("Missing nested board SVG")
  return [
    Number(svgAttribute({ tag: nested, name: "x" })),
    Number(svgAttribute({ tag: nested, name: "y" })),
  ]
}

/** An overlay pixel position after its root viewBox crop. */
function project({
  overlay,
  point,
}: {
  overlay: string
  point: PixelPoint
}): PixelPoint {
  const [root] = svgTags({ svg: overlay, opener: "<svg" })
  if (!root) throw new TypeError("Missing overlay SVG")
  const [width, height, box] = ["width", "height", "viewBox"].map((name) =>
    svgAttribute({ tag: root, name }),
  )
  const [x, y, w, h] = box.split(" ").map(Number)
  return [
    ((point[0] - x) * Number(width)) / w,
    ((point[1] - y) * Number(height)) / h,
  ]
}

test("the board and stage overlay place a via at the same pixel", async () => {
  const { root } = await routedVisualFixture()
  const circuit = root.inputProblem.circuitJson
  const via = circuit.find((record) => record.type === "pcb_via")!
  if (via.type !== "pcb_via") throw new Error("fixture has a via")
  const stage = root.visualizeStage(2)
  const drawing: GraphicsObject = {
    ...stage,
    circles: [
      { center: { x: via.x, y: via.y }, radius: 0.05, fill: "#ff0000" },
    ],
    lines: [
      ...stage.lines!,
      {
        points: [
          { x: -1e3, y: -1e3 },
          { x: 1e3, y: 1e3 },
        ],
      },
    ],
  }
  for (const [width, height] of [
    [800, 600],
    [1200, 500],
    [500, 900],
  ]) {
    const picture = boardPicture({
      circuit,
      drawing,
      width,
      height,
    })
    const [left, top] = offset(picture.board)
    const board = centre({
      svg: picture.board,
      attribute: 'data-type="pcb_via"',
    })
    const overlay = project({
      overlay: picture.overlay,
      point: centre({ svg: picture.overlay, attribute: 'fill="#ff0000"' }),
    })
    assert.ok(
      Math.hypot(board[0] + left - overlay[0], board[1] + top - overlay[1]) <
        0.5,
      `${width}x${height}: ${board} vs ${overlay}; a far-away line never moves the camera`,
    )
  }
})

test("the camera uses the stage frame and omits silkscreen text", async () => {
  const { root } = await routedVisualFixture()
  const circuit = root.inputProblem.circuitJson
  const board = circuit.find((record) => record.type === "pcb_board")!
  const whole = boardPictureView({
    circuit,
    drawing: { coordinateSystem: "cartesian" },
  })
  assert.ok(
    whole.minX < board.center.x - board.width! / 2 &&
      whole.maxX > board.center.x + board.width! / 2,
  )
  const sections = root.visualizeStage(2)
  const frame = sections.rects?.find((rect) => rect.label === "camera")
  assert.ok(frame)
  assert.deepEqual(
    boardPictureView({ circuit, drawing: root.visualizeStage(4) }),
    boardPictureView({ circuit, drawing: sections }),
    "downstream stages share one camera",
  )
  assert.equal(
    boardPictureView({ circuit, drawing: sections }).maxX,
    frame.center.x + frame.width / 2,
  )
  const planner = root.visualizeStage(1)
  const planFrame = planner.rects?.find((rect) => rect.layer === "frame")
  assert.ok(planFrame)
  const admissionView = boardPictureView({ circuit, drawing: planner })
  assert.equal(admissionView.maxY, planFrame.center.y + planFrame.height / 2)
  assert.ok(planner.texts?.every((text) => text.y < admissionView.maxY))
  assert.match(
    boardPicture({ circuit, drawing: planner, width: 1100, height: 800 }).board,
    /fill="#ffffff"/,
  )
  const tree = TwoTraceBoard()
  const labelled = await renderCoreSignals(
    React.cloneElement(
      tree,
      {},
      ...React.Children.toArray(tree.props.children),
      <silkscreentext
        text="REFDES"
        pcbX={0}
        pcbY={0}
        fontSize={1}
        layer="top"
      />,
    ),
  )
  assert.ok(
    labelled.some(
      (record) =>
        record.type === "pcb_silkscreen_text" && record.text === "REFDES",
    ),
  )
  assert.doesNotMatch(
    boardPicture({
      circuit: labelled,
      drawing: { coordinateSystem: "cartesian" },
      width: 400,
      height: 300,
    }).board,
    /REFDES/,
  )
})

/** RGBA pixels of a PNG, decoded by rendering it as an SVG image. */
function pixels({
  png,
  width,
  height,
}: {
  png: Buffer
  width: number
  height: number
}): Uint8Array {
  const dimensions = `width="${width}" height="${height}"`
  const data = `data:image/png;base64,${png.toString("base64")}`
  const image = `<image ${dimensions} href="${data}"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" ${dimensions}>${image}</svg>`
  return new Resvg(svg).render().pixels
}

test("composed board pictures of every two-trace stage match their PNG snapshots", async () => {
  const { root } = await routedVisualFixture()
  const [width, height] = [480, 300]
  for (const number of [0, 1, 2, 3, 4, 5, 6]) {
    let drawing = root.visualizeStage(number)
    if (number === 1)
      drawing = withPlanCaption({ drawing, caption: twoTracePlanCaption })
    let font: ResvgRenderOptions["font"] = { defaultFontFamily: "Arial" }
    // Set the sans-serif family explicitly on Linux for the text-heavy plan.
    if (number === 1 && process.platform === "linux")
      font = {
        defaultFontFamily: "DejaVu Sans",
        sansSerifFamily: "DejaVu Sans",
      }
    const png = new Resvg(
      boardPictureSvg({
        circuit: root.inputProblem.circuitJson,
        drawing,
        width,
        height,
      }),
      { font },
    )
      .render()
      .asPng()
    const path = join(
      import.meta.dirname,
      "__snapshots__",
      `board-picture-stage-${number}.png`,
    )
    if (process.env.UPDATE_PLAN_DRAWINGS === "1") {
      mkdirSync(join(path, ".."), { recursive: true })
      writeFileSync(path, png)
    }
    const [actual, expected] = [
      pixels({ png, width, height }),
      pixels({ png: readFileSync(path), width, height }),
    ]
    let differing = 0
    for (let i = 0; i < actual.length; i += 4) {
      if (
        Math.max(
          ...[0, 1, 2].map((c) => Math.abs(actual[i + c] - expected[i + c])),
        ) > 48
      )
        differing++
    }
    // Font rasterisation differs between machines; geometry and colour changes move far more pixels than this.
    assert.ok(
      differing / (width * height) < 0.01,
      `stage ${number}: ${differing} pixels differ; inspect the PNG before updating snapshots`,
    )
  }
})
