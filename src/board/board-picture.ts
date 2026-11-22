import {
  convertCircuitJsonToPcbSvg,
  type PcbColorOverrides,
} from "circuit-to-svg"
import {
  type GraphicsObject,
  getBounds,
  getSvgFromGraphicsObject,
  type Viewbox,
} from "graphics-debug"
import { routeBoardBox, routeBounds } from "./route-visual"
import type { CircuitJsonSnapshot, Point } from "./schema"

/** Keep a visible view box for drawings with coincident coordinates. */
const MINIMUM_EXTENT_MM = 1e-3
/** Pad drawings without an explicit camera. */
const DRAWING_MARGIN = 0.04
/** Include nearby PCB records so their shapes can extend into the camera. */
const CROP_MARGIN = 0.1
/** Bound the number of stored crops and SVGs per board. */
const CACHED_CAMERAS_PER_BOARD = 6

/** Dark, desaturated board colours so bright stage overlays stand out on a realistic top view. */
export const boardColors = {
  background: "#0c0f12",
  overrides: {
    copper: { top: "#8c7a4e", bottom: "#8c7a4e" },
    drill: "#07090a",
    silkscreen: { top: "#5d665f", bottom: "#5d665f" },
    boardOutline: "#58665e",
    soldermask: { top: "#0f2a1e", bottom: "#0f2a1e" },
    soldermaskOverCopper: { top: "#1d4532", bottom: "#1d4532" },
    soldermaskWithCopperUnderneath: { top: "#163a29", bottom: "#163a29" },
  } satisfies PcbColorOverrides,
}

/** Aligned SVG layers for the board and the stage drawing. */
export interface BoardPicture {
  /** The real board from circuit-to-svg, cropped to the camera and letterboxed. */
  board: string
  /** The stage drawing with a transparent background, pixel-aligned with the board. */
  overlay: string
}

/** The camera: the drawing's `camera` frame, else its bounds with a margin, else the whole board. */
export function boardPictureView({
  circuit,
  drawing,
}: {
  circuit: CircuitJsonSnapshot
  drawing: GraphicsObject
}): Viewbox {
  const frame = drawing.rects?.find((rect) => rect.label === "camera")
  if (frame)
    return {
      minX: frame.center.x - frame.width / 2,
      maxX: frame.center.x + frame.width / 2,
      minY: frame.center.y - frame.height / 2,
      maxY: frame.center.y + frame.height / 2,
    }
  const box = drawingBounds({ circuit, drawing })
  const margin =
    Math.max(box.maxX - box.minX, box.maxY - box.minY, MINIMUM_EXTENT_MM) *
    DRAWING_MARGIN
  return {
    minX: box.minX - margin,
    maxX: box.maxX + margin,
    minY: box.minY - margin,
    maxY: box.maxY + margin,
  }
}

/** Use the board's extent when the drawing carries no geometry. */
function drawingBounds({
  circuit,
  drawing,
}: {
  circuit: CircuitJsonSnapshot
  drawing: GraphicsObject
}): Viewbox {
  if (
    (
      ["lines", "rects", "circles", "polygons", "points", "texts"] as const
    ).some((key) => drawing[key]?.length)
  ) {
    return getBounds(drawing)
  }
  return routeBoardBox(circuit)
}

/** A point with numeric x and y. */
function isPoint(item: unknown): item is Point {
  if (typeof item !== "object" || item === null) return false
  const { x, y } = item as Partial<Point>
  return typeof x === "number" && typeof y === "number"
}

/** Every coordinate a record carries, whatever its shape. */
function recordPoints(record: object): Point[] {
  const { center, anchor_position, route, points, outline } = record as Record<
    string,
    unknown
  >
  const pointLists = [route, points, outline].filter(Array.isArray)
  return [record, center, anchor_position, ...pointLists.flat()].filter(isPoint)
}

/** Serialized camera bounds used to cache cropped Circuit JSON. */
type CameraKey = string
const crops = new WeakMap<
  CircuitJsonSnapshot,
  Map<CameraKey, CircuitJsonSnapshot>
>()

/**
 * Only records near the camera reach circuit-to-svg, and silkscreen text never does, so the board layer stays
 * small and wordless.
 */
function cropCircuit({
  circuit,
  view,
}: {
  circuit: CircuitJsonSnapshot
  view: Viewbox
}): CircuitJsonSnapshot {
  const key = JSON.stringify(view)
  const cache = crops.get(circuit) ?? new Map<CameraKey, CircuitJsonSnapshot>()
  crops.set(circuit, cache)
  const margin =
    Math.max(view.maxX - view.minX, view.maxY - view.minY) * CROP_MARGIN
  const cropped =
    cache.get(key) ??
    circuit.filter((record) => {
      if (
        record.type === "pcb_silkscreen_text" ||
        record.type.startsWith("pcb_fabrication_note")
      )
        return false
      if (
        !record.type.startsWith("pcb_") ||
        record.type === "pcb_board" ||
        record.type === "pcb_copper_pour"
      ) {
        return true
      }
      const box = routeBounds(recordPoints(record))
      if (!box) return true
      const overlapsX =
        box.maxX >= view.minX - margin && box.minX <= view.maxX + margin
      const overlapsY =
        box.maxY >= view.minY - margin && box.minY <= view.maxY + margin
      return overlapsX && overlapsY
    })
  cache.set(key, cropped)
  if (cache.size > CACHED_CAMERAS_PER_BOARD)
    cache.delete(cache.keys().next().value!)
  return cropped
}

/** Serialized bounds and dimensions used to cache board SVGs. */
type BoardSvgKey = string
const boards = new WeakMap<CircuitJsonSnapshot, Map<BoardSvgKey, string>>()

/** circuit-to-svg is the slow part on large boards, so keep the last few cameras per board. */
function boardSvg({
  circuit,
  view,
  width,
  height,
}: {
  circuit: CircuitJsonSnapshot
  view: Viewbox
  width: number
  height: number
}): string {
  const cache = boards.get(circuit) ?? new Map<BoardSvgKey, string>()
  boards.set(circuit, cache)
  const key = JSON.stringify([view, width, height])
  const svg =
    cache.get(key) ??
    convertCircuitJsonToPcbSvg(
      cropCircuit({ circuit, view }) as Parameters<
        typeof convertCircuitJsonToPcbSvg
      >[0],
      {
        width,
        height,
        viewport: view,
        layer: "top",
        showSolderMask: true,
        showFabricationNotes: false,
        backgroundColor: boardColors.background,
        colorOverrides: boardColors.overrides,
      },
    )
  cache.set(key, svg)
  if (cache.size > CACHED_CAMERAS_PER_BOARD)
    cache.delete(cache.keys().next().value!)
  return svg
}

/** The drawing, board and render dimensions for one board picture. */
interface BoardPictureInput {
  circuit: CircuitJsonSnapshot
  drawing: GraphicsObject
  width: number
  height: number
  region?: Viewbox
}

/** Find the camera rect emitted by graphics-debug. */
function cameraRect(svg: string): string {
  let start = svg.indexOf("<rect")
  while (start >= 0) {
    const end = svg.indexOf(">", start)
    if (end < 0) break
    const rect = svg.slice(start, end + 1)
    if (rect.includes('data-label="camera"')) return rect
    start = svg.indexOf("<rect", end + 1)
  }
  throw new TypeError("Missing SVG camera rect")
}

/** Read a nonempty numeric attribute from a generated SVG tag. */
function svgNumber({ tag, name }: { tag: string; name: string }): number {
  const prefix = ` ${name}="`
  let index = tag.indexOf(prefix)
  while (index >= 0) {
    const start = index + prefix.length
    const end = tag.indexOf('"', start)
    if (end < 0) break
    if (end > start) return Number(tag.slice(start, end))
    index = tag.indexOf(prefix, end + 1)
  }
  throw new TypeError(`Missing SVG attribute ${name}`)
}

/** Replace the generated SVG root's opening tag. */
function replaceSvgRoot({ svg, tag }: { svg: string; tag: string }): string {
  const end = svg.indexOf(">")
  if (!svg.startsWith("<svg") || end < 0) return svg
  return `${tag}${svg.slice(end + 1)}`
}

/**
 * The real board under a stage drawing, both cropped to one camera and letterboxed in width × height.
 * `region` zooms into part of the camera; labels keep their on-screen size.
 */
export function boardPicture({
  circuit,
  drawing,
  width,
  height,
  region,
}: BoardPictureInput): BoardPicture {
  const camera = boardPictureView({ circuit, drawing })
  const view = region ?? camera
  const scale = Math.min(
    width / (view.maxX - view.minX),
    height / (view.maxY - view.minY),
  )
  const pictureWidth = (view.maxX - view.minX) * scale
  const pictureHeight = (view.maxY - view.minY) * scale
  const left = (width - pictureWidth) / 2
  const top = (height - pictureHeight) / 2
  const zoom = (view.maxX - view.minX) / (camera.maxX - camera.minX)
  const frame = {
    center: { x: (view.minX + view.maxX) / 2, y: (view.minY + view.maxY) / 2 },
    width: view.maxX - view.minX,
    height: view.maxY - view.minY,
    fill: "none",
    stroke: "none",
    label: "camera",
  }
  const raw = getSvgFromGraphicsObject(
    {
      ...drawing,
      rects: [
        ...(drawing.rects ?? []).filter((rect) => rect.label !== "camera"),
        frame,
      ],
      texts: drawing.texts?.map((text) => ({
        ...text,
        fontSize: (text.fontSize ?? 1) * zoom,
      })),
    },
    { svgWidth: pictureWidth, svgHeight: pictureHeight, backgroundColor: null },
  )
  // Wherever graphics-debug placed the frame, crop the overlay to it: objects outside the camera never move it.
  const rect = cameraRect(raw)
  const [x, y, w, h] = ["x", "y", "width", "height"].map((name) =>
    svgNumber({ tag: rect, name }),
  )
  const unit = w / pictureWidth
  const dimensions = svgDimensions({ width, height })
  const overlayBox = [
    x - left * unit,
    y - top * unit,
    width * unit,
    height * unit,
  ].join(" ")
  const overlay = replaceSvgRoot({
    svg: raw,
    tag: `<svg ${dimensions} viewBox="${overlayBox}">`,
  })
  const svg = boardSvg({
    circuit,
    view,
    width: pictureWidth,
    height: pictureHeight,
  })
  let board = svg
  if (svg.startsWith("<svg "))
    board = `<svg x="${left}" y="${top}" ${svg.slice("<svg ".length)}`
  const background = `<rect width="${width}" height="${height}" fill="${boardColors.background}"/>`
  return {
    board: `<svg ${dimensions}>${background}${board}</svg>`,
    overlay,
  }
}

/** SVG root attributes shared by both layers and the composed picture. */
function svgDimensions({
  width,
  height,
}: {
  width: number
  height: number
}): string {
  return `xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`
}

/** Both layers as one standalone SVG, for PNG renders and snapshots. */
export function boardPictureSvg({
  circuit,
  drawing,
  width,
  height,
}: Omit<BoardPictureInput, "region">): string {
  const picture = boardPicture({
    circuit,
    drawing,
    width,
    height,
  })
  const dimensions = svgDimensions({ width, height })
  return `<svg ${dimensions} viewBox="0 0 ${width} ${height}">${picture.board}${picture.overlay}</svg>`
}
