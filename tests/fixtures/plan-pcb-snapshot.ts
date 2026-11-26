import { expect } from "bun:test"
import assert from "node:assert/strict"
import { type CircuitJsonUtilObjects, cju } from "@tscircuit/circuit-json-util"
import type {
  PcbFabricationNotePath,
  PcbFabricationNoteText,
  PcbTrace,
} from "circuit-json"
import { type CircuitJson, cloneCircuitJson } from "../../src/board"
import type { TransientChannelSimulationPlan } from "../../src/pipeline"
import { circuitNodes } from "../../src/simulation"
import "./extend-expect-circuit-snapshot"

const ROUTE_COLORS = ["#79edb8", "#ffcf7a", "#8bc9ff", "#efa7e7"]
/** Height and vertical spacing for the board-top legend, in millimetres. */
const LEGEND_FONT_MM = 0.48
const LEGEND_MARGIN_MM = 0.7
const LEGEND_LINE_MM = 0.68
const TRACE_WIDTH_MM = 0.22

/** A physical trace and its separated SPICE nodes. */
interface ResolvedPlanTrace {
  pcbTrace: PcbTrace
  fromSourcePortId: string
  toSourcePortId: string
  fromSpiceNode: string
  toSpiceNode: string
}

/** Check that each extracted trace separates two SPICE nodes. */
export function resolvePlanTraces({
  db,
  plan,
  expectedTraceCount,
}: {
  db: CircuitJsonUtilObjects
  plan: TransientChannelSimulationPlan
  expectedTraceCount: number
}): ResolvedPlanTrace[] {
  const { bindings, sections } = plan
  const { node } = circuitNodes({
    ...bindings,
    circuit: cloneCircuitJson(bindings.circuitJson),
  })
  const { channelPcbTraceIds } = sections.copperScope
  assert.equal(channelPcbTraceIds.length, expectedTraceCount)
  assert.equal(bindings.traceContacts.length, expectedTraceCount)
  return channelPcbTraceIds.map((pcbTraceId) => {
    const pcbTrace = db.pcb_trace.get(pcbTraceId)
    assert.ok(pcbTrace?.source_trace_id)
    const contacts = bindings.traceContacts.find(
      ({ sourceTraceId }) => sourceTraceId === pcbTrace.source_trace_id,
    )
    assert.ok(contacts)
    const { fromSourcePortId, toSourcePortId } = contacts
    const fromSpiceNode = node(fromSourcePortId)
    const toSpiceNode = node(toSourcePortId)
    assert.notEqual(fromSpiceNode, toSpiceNode, contacts.sourceTraceId)
    return {
      pcbTrace,
      fromSourcePortId,
      toSourcePortId,
      fromSpiceNode,
      toSpiceNode,
    }
  })
}

/** Verify every in-scope routed trace separates two SPICE nodes and snapshot them. */
export function expectPlanPcbSnapshot({
  circuitJson,
  plan,
  expectedTraceCount,
  testPath,
  caption,
}: {
  circuitJson: CircuitJson
  plan: TransientChannelSimulationPlan
  expectedTraceCount: number
  testPath: string
  caption?: string
}): void {
  const db = cju([...circuitJson])
  const [board] = db.pcb_board.list()
  assert.ok(board?.height)
  const traces = resolvePlanTraces({ db, plan, expectedTraceCount })
  const paths: PcbFabricationNotePath[] = []
  const captions: PcbFabricationNoteText[] = []
  for (const [
    index,
    { pcbTrace, fromSourcePortId, toSourcePortId, fromSpiceNode, toSpiceNode },
  ] of traces.entries()) {
    const pcbTraceId = pcbTrace.pcb_trace_id
    const labels = [fromSourcePortId, toSourcePortId].map((sourcePortId) => {
      const port = db.source_port.get(sourcePortId)
      assert.ok(port?.source_component_id)
      const component = db.source_component.get(port.source_component_id)
      assert.ok(component)
      return `${component.name}.${port.name}`
    })
    const color = ROUTE_COLORS[index]
    paths.push({
      type: "pcb_fabrication_note_path",
      pcb_fabrication_note_path_id: `cut_${pcbTraceId}`,
      layer: "top",
      color,
      route: pcbTrace.route.flatMap((point) => {
        if (point.route_type === "through_pad") return []
        return [{ x: point.x, y: point.y }]
      }),
      stroke_width: TRACE_WIDTH_MM,
    })
    captions.push({
      type: "pcb_fabrication_note_text",
      pcb_fabrication_note_text_id: `nodes_${pcbTraceId}`,
      layer: "top",
      font: "tscircuit2024",
      font_size: LEGEND_FONT_MM,
      text: `${labels[0]} (${fromSpiceNode}) to ${labels[1]} (${toSpiceNode})`,
      color,
      anchor_alignment: "center",
      anchor_position: {
        x: board.center.x,
        y:
          board.center.y +
          board.height / 2 -
          LEGEND_MARGIN_MM -
          index * LEGEND_LINE_MM,
      },
    })
  }
  if (caption) {
    captions.push({
      ...captions[0],
      pcb_fabrication_note_text_id: "plan_caption",
      text: caption,
      color: "#ffffff",
      anchor_position: {
        x: captions[0].anchor_position.x,
        y: captions[0].anchor_position.y - captions.length * LEGEND_LINE_MM,
      },
    })
  }
  expect([...circuitJson, ...paths, ...captions]).toMatchPcbSnapshot(testPath)
}
