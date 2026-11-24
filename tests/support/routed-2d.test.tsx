import { beforeAll, describe, test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import React from "react"
import {
  type CircuitJson,
  type CopperScope,
  channelCopperScope,
  type ExtractedCopper,
  extractCopperGeometry,
  findPadContactWire,
  findWireReferences,
  getSourcePortConnectivityMapFromCircuitJson,
  type SourceNetId,
  type SourcePortId,
  sourceNetMembers,
} from "../../src/board"
import {
  type ExtractedRoutes,
  RouteFieldsSolver,
  type RouteMaterials,
  referenceSeries,
} from "../../src/extraction"
import {
  type RouteLadder,
  routeLadder,
  routeOblique,
  routeTransitions,
} from "../../src/simulation"
import type { RouteEndpoint } from "../../src/simulation/route-network"
import { RoutedBoard, ViaPadBoard } from "../fixtures/routed-2d"
import { renderCoreSignals } from "./core-render"

/** Normalize coordinate punctuation when deriving synthetic SPICE endpoint names. */
function endpointName(name: string): string {
  return name.replaceAll("-", "_").replaceAll(".", "_")
}

/** The source IDs and geometry shared by the routed board variants. */
interface RouteFixture {
  geometry: ExtractedCopper
  scope: CopperScope
  ground: ReturnType<typeof sourceNetMembers>
  groundId: SourceNetId
  portId: SourcePortId
}

/** The ground and source-port identities of the original routed board. */
async function routeFixture(): Promise<RouteFixture> {
  const circuit = await renderCoreSignals(<RoutedBoard />)
  const db = cju(circuit)
  const component = db.source_component.getWhere({ name: "A" })
  assert(component)
  const port = db.source_port.getWhere({
    source_component_id: component.source_component_id,
  })
  const groundNet = db.source_net.getWhere({ name: "GND" })
  const powerNet = db.source_net.getWhere({ name: "VDDQ" })
  assert(port && groundNet && powerNet)
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const ground = sourceNetMembers({
    connectivity,
    memberId: groundNet.source_net_id,
  })
  const scope = channelCopperScope({
    circuit,
    connectivity,
    channelSourceIds: sourceNetMembers({
      connectivity,
      memberId: port.source_port_id,
    }),
    referenceSourceIds: ground,
    railSourceIds: sourceNetMembers({
      connectivity,
      memberId: powerNet.source_net_id,
    }),
    distanceMm: 1,
  })
  const geometry = extractCopperGeometry({ circuit, copperScope: scope })
  return {
    geometry,
    scope,
    ground,
    groundId: groundNet.source_net_id,
    portId: port.source_port_id,
  }
}

/** Assumed materials for the routed 2D fixture. */
const materials: RouteMaterials = {
  maskMm: 0.02,
  maskEr: 3.3,
  maskLoss: 0.025,
  substrateLoss: 0.02,
}

/** The fixture's rising edge sets the baseline ladder cell size. */
const RISE_SECONDS = 230e-12

/** Use physical wire and position to name simulated endpoints. */
function wireEndpoint({ wire, point }: Parameters<RouteEndpoint>[0]): string {
  return endpointName(`n${wire.wireIndex}_${point[0]}_${point[1]}`)
}

/** Solve fields with the fixture's shared material assumptions. */
function solveFields({
  geometry,
  panels,
}: {
  geometry: ExtractedCopper
  panels?: number
}): ExtractedRoutes {
  const solver = new RouteFieldsSolver({
    geometry,
    materials,
    artifactPrefix: "test",
    panels,
  })
  solver.solve()
  return solver.getOutput().value
}

describe("routed 2D board", () => {
  let fixture: RouteFixture
  let extracted: ExtractedRoutes
  let ladder: RouteLadder
  beforeAll(async () => {
    fixture = await routeFixture()
    extracted = solveFields({ geometry: fixture.geometry, panels: 12 })
    ladder = routeLadder({
      extracted,
      endpoint: wireEndpoint,
      riseSeconds: RISE_SECONDS,
    })
  })

  test("keeps nearby copper in scope", () => {
    assert.equal(fixture.scope.extractedPcbTraceIds.length, 3)
    assert.ok(
      fixture.geometry.sections.some((slice) => slice.wires.length === 2),
    )
  })

  test("changes the reference along the route", () => {
    const referenceLayers = fixture.geometry.sections.flatMap((slice) =>
      slice.references.map((ref) => ref.layer),
    )
    assert.deepEqual(new Set(referenceLayers), new Set(["inner1", "inner3"]))
  })

  test("keeps the intervening power plane as a reference", () => {
    const { geometry } = fixture
    const inner4 = { ...geometry.wires[0], layer: "inner4" as const }
    assert.deepEqual(
      findWireReferences({ geometry, wire: inner4, positionMm: -2 }).map(
        (plane) => plane.layer,
      ),
      ["inner5", "inner3"],
      "inner5 power copper intervenes before inner6 GND",
    )
  })

  test("reuses cross sections", () => {
    assert.ok(extracted.sections.length <= fixture.geometry.sections.length)
  })

  test("reduces inductance with a shorted AC return", () => {
    const pair = extracted.slices.find(
      (slice) => slice.wires.length === 2,
    )!.line
    const referenced = referenceSeries({ line: pair, grounded: [1] })
    const inductance = referenced.L[0][0]
    assert.ok(
      inductance < pair.L[0][0],
      "shorted AC reference induces a return current instead of an open conductor",
    )
    const vacuumPermeability = 1.25663706212e-6
    const vacuumPermittivity = 8.8541878128e-12
    const ratio =
      (inductance * pair.C0[0][0]) / (vacuumPermeability * vacuumPermittivity)
    assert.ok(
      Math.abs(ratio - 1) < 1e-6,
      "shorted series inductance matches the independent fixed-potential C0 relationship",
    )
  })

  test("bounds ladder cell delay", () => {
    assert.ok(ladder.maximumDelaySeconds <= 23e-12)
  })

  test("stamps mutual inductance", () => {
    assert.ok(ladder.lines.some((line) => line.startsWith("K")))
  })

  test("stamps causal dielectric loss", () => {
    const hasDielectricLoss = ladder.lines.some((line) =>
      line.startsWith("RARCG"),
    )
    assert.ok(
      hasDielectricLoss,
      "dielectric loss uses causal series-RC relaxation branches",
    )
  })

  test("allows a coarser ladder", () => {
    const coarse = routeLadder({
      extracted,
      endpoint: wireEndpoint,
      riseSeconds: RISE_SECONDS,
      refinement: 1,
      cellsPerRise: 2,
    })
    assert.ok(coarse.cells <= ladder.cells)
    assert.ok(coarse.maximumDelaySeconds <= 115e-12)
  })

  test("rejects zero cells per rise", () => {
    assert.throws(
      () =>
        routeLadder({
          extracted,
          endpoint: () => "0",
          riseSeconds: RISE_SECONDS,
          refinement: 1,
          cellsPerRise: 0,
        }),
      /Cells per rise/,
    )
  })

  test("rejects zero rise time", () => {
    assert.throws(
      () => routeLadder({ extracted, endpoint: () => "0", riseSeconds: 0 }),
      /rise time/,
    )
  })
})

test("solves overlapping copper as equipotential patches", async () => {
  const { portId, ground } = await routeFixture()
  const mergedCircuit = await renderCoreSignals(<RoutedBoard overlap />)
  const mergedConnectivity =
    getSourcePortConnectivityMapFromCircuitJson(mergedCircuit)
  const mergedScope = channelCopperScope({
    circuit: mergedCircuit,
    connectivity: mergedConnectivity,
    channelSourceIds: sourceNetMembers({
      connectivity: mergedConnectivity,
      memberId: portId,
    }),
    referenceSourceIds: ground,
    railSourceIds: new Set(),
    distanceMm: 1,
  })
  const merged = extractCopperGeometry({
    circuit: mergedCircuit,
    copperScope: mergedScope,
  })
  const hasJoins = merged.wires.some((wire) => wire.joins?.length)
  assert.ok(
    hasJoins,
    "same-net overlapping bend bodies become equipotential breakout patches",
  )
  assert.doesNotThrow(() => solveFields({ geometry: merged }))
})

describe("oblique route", () => {
  let circuit: CircuitJson
  let scope: CopperScope
  let geometry: ExtractedCopper
  let groundId: SourceNetId

  beforeAll(async () => {
    const fixture = await routeFixture()
    groundId = fixture.groundId
    circuit = await renderCoreSignals(<RoutedBoard oblique />)
    const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
    scope = channelCopperScope({
      circuit,
      connectivity,
      channelSourceIds: sourceNetMembers({
        connectivity,
        memberId: fixture.portId,
      }),
      referenceSourceIds: fixture.ground,
      railSourceIds: new Set(),
      distanceMm: 1,
    })
    geometry = extractCopperGeometry({ circuit, copperScope: scope })
  })

  test("records shielding at the local plane", () => {
    const extracted = solveFields({ geometry })
    const ladder = routeLadder({
      extracted,
      endpoint: wireEndpoint,
      riseSeconds: RISE_SECONDS,
    })
    const encounters = routeOblique({
      geometry,
      extracted,
      ladder,
      scope,
      materials,
    })
    const shielded = encounters.records.some((record) =>
      String(record.policy).includes("intervening local reference"),
    )
    assert.ok(
      shielded,
      "neighbour on the local plane height uses recorded shielding instead of an invalid solver rectangle",
    )
  })

  test("adds capacitance at connected annular via pads", () => {
    const transitions = routeTransitions({
      circuit,
      scope,
      geometry,
      endpoint: ({ wire, point }) =>
        endpointName(`n${wire.wireIndex}_${point.join("_")}`),
      groundPort: groundId,
    })
    const viaPads = transitions.records.filter(
      (record) => record.kind === "via",
    )
    const hasCapacitance = viaPads.some((record) =>
      (record.padCapacitanceF as number[]).some((value) => value > 0),
    )
    assert.ok(
      hasCapacitance,
      "connected annular via pads add explicit capacitance",
    )
  })
})

describe("via-in-pad route", () => {
  let viaCircuit: CircuitJson
  let viaScope: CopperScope
  let viaGeometry: ExtractedCopper

  beforeAll(async () => {
    const { ground } = await routeFixture()
    viaCircuit = await renderCoreSignals(<ViaPadBoard />).catch(
      (error: Error & { circuitJson: CircuitJson }) => {
        assert.deepEqual(
          error.circuitJson
            .filter((record) => record.type.endsWith("_error"))
            .map((record) => record.type),
          ["pcb_placement_error", "pcb_placement_error"],
          "expected core via-in-pad placement diagnostics only",
        )
        return error.circuitJson
      },
    )
    const viaSource = viaCircuit.find(
      (record) => record.type === "source_trace",
    )!
    const viaConnectivity =
      getSourcePortConnectivityMapFromCircuitJson(viaCircuit)
    viaScope = channelCopperScope({
      circuit: viaCircuit,
      connectivity: viaConnectivity,
      channelSourceIds: sourceNetMembers({
        connectivity: viaConnectivity,
        memberId: viaSource.connected_source_port_ids[0],
      }),
      referenceSourceIds: ground,
      railSourceIds: new Set(),
      distanceMm: 1,
    })
    viaGeometry = extractCopperGeometry({
      circuit: viaCircuit,
      copperScope: viaScope,
    })
  })

  test("keeps every planar wire on the routing layer", () => {
    assert.ok(viaGeometry.wires.every((wire) => wire.layer === "inner2"))
  })

  test("keeps contacts at zero-length top wires", () => {
    assert.ok(
      findPadContactWire({
        geometry: viaGeometry,
        layer: "top",
        point: [-3, 0],
      }),
    )
    assert.equal(
      viaGeometry.vias.filter((via) => via.layers.includes("top")).length,
      2,
      "via-in-pad contacts survive zero-length top wires",
    )
  })

  test("connects surface pad capacitance through the vias", () => {
    const viaTransitions = routeTransitions({
      circuit: viaCircuit,
      scope: viaScope,
      geometry: viaGeometry,
      endpoint: ({ wire, point }) =>
        endpointName(`${wire.layer}_${point.join("_")}`),
      groundPort: "source_net_0",
    })
    assert.equal(
      viaTransitions.records.filter((record) => record.kind === "pad").length,
      2,
      "BGA/SMD pad C remains attached through via-only contacts",
    )
  })
})
