import { test } from "bun:test"
import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Resvg } from "@resvg/resvg-js"
import type { GraphicsObject } from "graphics-debug"
import {
  boardPicture,
  boardPictureSvg,
  boardPictureView,
} from "../../src/board/board-picture"
import { routedVisualFixture } from "../support/routed-visual-fixture"

/** Find generated SVG tags with the given opening text. */
function svgTags(svg: string, opener: string): string[] {
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
function svgAttribute(tag: string, name: string): string {
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
function centre(svg: string, attribute: string): [number, number] {
  const element = svgTags(svg, "<circle").find((circle) =>
    circle.includes(attribute),
  )
  if (!element) throw new TypeError(`Missing SVG circle with ${attribute}`)
  return [
    Number(svgAttribute(element, "cx")),
    Number(svgAttribute(element, "cy")),
  ]
}

/** The x, y offset of the nested board svg inside the letterboxed picture. */
function offset(board: string): [number, number] {
  const [nested] = svgTags(board, '<svg x="')
  if (!nested) throw new TypeError("Missing nested board SVG")
  return [Number(svgAttribute(nested, "x")), Number(svgAttribute(nested, "y"))]
}

/** An overlay pixel position after its root viewBox crop. */
function project(overlay: string, point: [number, number]): [number, number] {
  const [root] = svgTags(overlay, "<svg")
  if (!root) throw new TypeError("Missing overlay SVG")
  const [width, height, box] = ["width", "height", "viewBox"].map((name) =>
    svgAttribute(root, name),
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
  const stage = root.visualizeStage(1)
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
    const board = centre(picture.board, 'data-type="pcb_via"')
    const overlay = project(
      picture.overlay,
      centre(picture.overlay, 'fill="#ff0000"'),
    )
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
  const whole = boardPictureView(circuit, { coordinateSystem: "cartesian" })
  assert.ok(
    whole.minX < board.center.x - board.width! / 2 &&
      whole.maxX > board.center.x + board.width! / 2,
  )
  const frame = root
    .visualizeStage(1)
    .rects!.find((rect) => rect.label === "camera")!
  assert.deepEqual(
    boardPictureView(circuit, root.visualizeStage(4)),
    boardPictureView(circuit, root.visualizeStage(1)),
    "every stage shares one camera",
  )
  assert.equal(
    boardPictureView(circuit, root.visualizeStage(1)).maxX,
    frame.center.x + frame.width / 2,
  )
  const labelled = [
    ...circuit,
    {
      type: "pcb_silkscreen_text",
      pcb_silkscreen_text_id: "t",
      pcb_component_id: "c",
      text: "REFDES",
      anchor_position: { x: 0, y: 0 },
      font: "tscircuit2024",
      font_size: 1,
      layer: "top",
      anchor_alignment: "center",
    },
  ] as typeof circuit
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
function pixels(png: Buffer, width: number, height: number): Uint8Array {
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
    const png = new Resvg(
      boardPictureSvg({
        circuit: root.inputProblem.circuitJson,
        drawing: root.visualizeStage(number),
        width,
        height,
      }),
      {
        font: { defaultFontFamily: "Arial" },
      },
    )
      .render()
      .asPng()
    const path = join(
      import.meta.dirname,
      "__snapshots__",
      `board-picture-stage-${number}.png`,
    )
    if (process.env.UPDATE_ROUTED_VISUALS === "1") {
      mkdirSync(join(path, ".."), { recursive: true })
      writeFileSync(path, png)
    }
    const [actual, expected] = [
      pixels(png, width, height),
      pixels(readFileSync(path), width, height),
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
