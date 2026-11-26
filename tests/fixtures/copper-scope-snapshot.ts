import { expect } from "bun:test"
import assert from "node:assert/strict"
import {
  cju,
  getPlatedHolePolygon,
  getPourPolygon,
  getSmtPadPolygon,
} from "@tscircuit/circuit-json-util"
import type {
  PcbFabricationNotePath,
  PcbFabricationNoteText,
  PcbNoteRect,
  PcbTrace,
  Point,
} from "circuit-json"
import { channelCopperScopeWithBounds } from "../../src/board/geometry/scope"
import type { CopperBox } from "../../src/board/geometry/scope-bounds"
import { scopeOptions } from "./copper-scope-board"
import "./extend-expect-circuit-snapshot"

const CHANNEL_COLOR = "#75f5bd"
const EXTRACTED_COLOR = "#78bfff"
const RAIL_COLOR = "#ffc568"
const DROPPED_COLOR = "#9b939f"
const GAP_COLOR = "#f9f1da"

/** Keeps annotation outlines visible without hiding small copper features. */
const OUTLINE_WIDTH_MM = 0.08
/** Caption height as a share of the board height, so text reads the same on every board. */
const CAPTION_HEIGHT_RATIO = 0.035
/** Caption advance per character as a fraction of its height, with margin. */
const CHARACTER_WIDTH_RATIO = 0.45
/** Share of the board width the longest caption line may use. */
const CAPTION_WIDTH_RATIO = 0.9
const TOP_MARGIN_MM = 0.75
/** Baseline-to-baseline distance as a multiple of the caption height. */
const LINE_SPACING_RATIO = 1.5

/** Count with its noun, singular for one. */
function counted({ count, noun }: { count: number; noun: string }): string {
  if (count === 1) return `${count} ${noun}`
  return `${count} ${noun}s`
}

/** The rendered board and its channel, rail, and distance selection. */
type CopperScopeSnapshotOptions = Parameters<typeof scopeOptions>[0] & {
  testPath: string
}

/** Draw a wire over its original path in the colour of its scope category. */
function traceNotes({
  trace,
  color,
}: {
  trace: PcbTrace
  color: string
}): PcbFabricationNotePath[] {
  return trace.route.slice(1).flatMap((end, index) => {
    const start = trace.route[index]
    if (end.route_type === "through_pad" || start.route_type === "through_pad")
      return []
    let width = OUTLINE_WIDTH_MM
    if (start.route_type === "wire") width = Math.max(width, start.width)
    if (end.route_type === "wire") width = Math.max(width, end.width)
    return [
      {
        type: "pcb_fabrication_note_path",
        pcb_fabrication_note_path_id: `${trace.pcb_trace_id}_scope_${index}`,
        layer: "top",
        color,
        route: [
          { x: start.x, y: start.y },
          { x: end.x, y: end.y },
        ],
        stroke_width: width,
      },
    ]
  })
}

/** Outline a feature or its Euclidean gap boundary in world millimetres. */
function outline({
  box,
  id,
  color,
  radius = 0,
  gap = 0,
}: {
  box: CopperBox["xy"]
  id: string
  color: string
  radius?: number
  gap?: number
}): PcbNoteRect {
  return {
    type: "pcb_note_rect",
    pcb_note_rect_id: id,
    layer: "top",
    center: { x: (box.xmin + box.xmax) / 2, y: (box.ymin + box.ymax) / 2 },
    width: box.xmax - box.xmin + 2 * gap,
    height: box.ymax - box.ymin + 2 * gap,
    stroke_width: OUTLINE_WIDTH_MM,
    color,
    corner_radius: radius,
    is_stroke_dashed: gap > 0,
  }
}

/** Select overlay ink for a channel member, an extracted neighbor, or dropped copper. */
function copperColor({
  channel,
  extracted,
}: {
  channel: boolean
  extracted: boolean
}): string {
  if (channel) return CHANNEL_COLOR
  if (extracted) return EXTRACTED_COLOR
  return DROPPED_COLOR
}

/** Keep the result and legend horizontally centered at the top edge. */
function caption({
  text,
  position,
  index,
  fontSizeMm,
}: {
  text: string
  position: Point
  index: number
  fontSizeMm: number
}): PcbFabricationNoteText {
  return {
    type: "pcb_fabrication_note_text",
    pcb_fabrication_note_text_id: `scope_caption_${index}`,
    font: "tscircuit2024",
    font_size: fontSizeMm,
    text,
    layer: "top",
    anchor_position: {
      x: position.x,
      y: position.y - index * fontSizeMm * LINE_SPACING_RATIO,
    },
    anchor_alignment: "center",
    color: GAP_COLOR,
  }
}

/**
 * Snapshot the production scope and the exact per-feature bounds used to select it.
 * Mint is the channel, blue extracted copper, amber nearby rail traces, grey dropped
 * copper; dashed outlines are the nearby gap around the channel.
 */
export function expectCopperScopeSnapshot({
  testPath,
  ...options
}: CopperScopeSnapshotOptions): void {
  const { circuit } = options
  const db = cju([...circuit])
  const board = db.pcb_board.getWhere({})
  assert(board?.height)
  const input = scopeOptions(options)
  const { scope, channelBoxes } = channelCopperScopeWithBounds(input)
  const { nearbyGapMm } = scope
  const channelTraces = new Set(scope.channelPcbTraceIds)
  const extractedTraces = new Set(scope.extractedPcbTraceIds)
  const extractedVias = new Set(scope.extractedPcbViaIds)
  const railTraces = new Set(scope.nearbyRailPcbTraceIds)
  const extractedSources = new Set(scope.extractedSourceIds)
  const gapNotes = channelBoxes.map(({ xy }, index) =>
    outline({
      box: xy,
      id: `scope_gap_${index}`,
      color: GAP_COLOR,
      radius: nearbyGapMm,
      gap: nearbyGapMm,
    }),
  )
  const routes = db.pcb_trace.list().flatMap((trace) => {
    const id = trace.pcb_trace_id
    let color = copperColor({
      channel: channelTraces.has(id),
      extracted: extractedTraces.has(id),
    })
    if (railTraces.has(id)) color = RAIL_COLOR
    return traceNotes({ trace, color })
  })
  const vias = db.pcb_via.list().map((via) => {
    const { x, y } = via
    const radius = via.outer_diameter / 2
    const channel =
      (via.pcb_trace_id !== undefined && channelTraces.has(via.pcb_trace_id)) ||
      (via.source_net_id !== undefined &&
        input.channelSourceIds.has(via.source_net_id))
    const color = copperColor({
      channel,
      extracted: extractedVias.has(via.pcb_via_id),
    })
    return outline({
      box: {
        xmin: x - radius,
        ymin: y - radius,
        xmax: x + radius,
        ymax: y + radius,
      },
      id: `${via.pcb_via_id}_scope`,
      color,
      radius,
    })
  })
  const pads = [...db.pcb_smtpad.list(), ...db.pcb_plated_hole.list()].flatMap(
    (pad) => {
      if (pad.pcb_port_id === undefined) return []
      const port = db.pcb_port.get(pad.pcb_port_id)
      if (!port) return []
      const source = port.source_port_id
      const color = copperColor({
        channel: input.channelSourceIds.has(source),
        extracted: extractedSources.has(source),
      })
      if (pad.type === "pcb_smtpad")
        return [
          outline({
            box: getSmtPadPolygon(pad).box,
            id: pad.pcb_smtpad_id,
            color,
          }),
        ]
      return [
        outline({
          box: getPlatedHolePolygon(pad).box,
          id: pad.pcb_plated_hole_id,
          color,
        }),
      ]
    },
  )
  let extractedPourCount = 0
  const pours = db.pcb_copper_pour.list().flatMap((pour) => {
    if (pour.source_net_id === undefined) return []
    if (extractedSources.has(pour.source_net_id)) extractedPourCount += 1
    const color = copperColor({
      channel: input.channelSourceIds.has(pour.source_net_id),
      extracted: extractedSources.has(pour.source_net_id),
    })
    return [
      outline({
        box: getPourPolygon(pour).box,
        id: pour.pcb_copper_pour_id,
        color,
      }),
    ]
  })
  const lines = [
    `Extracted ${counted({ count: extractedTraces.size, noun: "trace" })}, ${counted({ count: extractedVias.size, noun: "via" })}, ${counted({ count: extractedPourCount, noun: "pour" })}`,
    `${counted({ count: railTraces.size, noun: "rail trace" })}, ${nearbyGapMm} mm gap`,
  ]
  const longest = Math.max(...lines.map((line) => line.length))
  const fontSizeMm = Math.min(
    board.height! * CAPTION_HEIGHT_RATIO,
    (board.width! * CAPTION_WIDTH_RATIO) / (longest * CHARACTER_WIDTH_RATIO),
  )
  const captions = lines.map((text, index) =>
    caption({
      text,
      position: {
        x: board.center.x,
        y: board.center.y + board.height! / 2 - TOP_MARGIN_MM,
      },
      index,
      fontSizeMm,
    }),
  )
  const pcb = circuit.filter((record) => record.type !== "pcb_silkscreen_text")
  expect([
    ...pcb,
    ...pours,
    ...gapNotes,
    ...routes,
    ...vias,
    ...pads,
    ...captions,
  ]).toMatchPcbSnapshot(testPath)
}
