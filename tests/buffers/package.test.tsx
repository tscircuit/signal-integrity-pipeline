import { test } from "bun:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { convertIbisModelToSpice, parseIbis } from "@tscircuit/ibis-to-spice"
import { cloneCircuitJson } from "../../src/board"
import { convertIbisComponentWithPackage } from "../../src/buffers/package-conversion"
import { isDigit, lineRanges } from "../../src/buffers/source-tokens"
import { generalDeclarations, modelRunDefinition } from "../../src/simulation"
import { plannedBindings, renderSignals } from "../fixtures/signal-render"
import Differential from "../fixtures/unit-differential"
import Single from "../fixtures/unit-single-ended"

const DEFAULT_DIFFERENTIAL_FIXTURE = false

const modelDir = process.env.IBIS_MODEL_DIR || "models"

/** Read the netlist lines with any of the requested element prefixes. */
function sourceLines({
  source,
  prefixes,
}: {
  source: string
  prefixes: string[]
}): string[] {
  return Array.from(lineRanges(source), ({ start, end }) =>
    source.slice(start, end),
  ).filter((line) => prefixes.some((prefix) => line.startsWith(prefix)))
}

/** Recover original terminal names to compare the unchanged die buffer and drive tables. */
function normalizeNodes({
  line,
  terminals,
}: {
  line: string
  terminals: string[]
}): string {
  let result = ""
  for (let start = 0; start < line.length; ) {
    let digits = start
    if (line.startsWith("PKGL", start)) digits += 4
    if (line.startsWith("DIE", start)) digits += 3
    if (digits === start || !isDigit(line[digits])) {
      result += line[start]
      start++
      continue
    }
    let end = digits + 1
    while (isDigit(line[end])) end++
    result += terminals[Number(line.slice(digits, end))]
    start = end
  }
  return result
}

/** Detect the tiny upstream hold step when comparing PWL knots. */
const HOLD_STEP_THRESHOLD_SECONDS = 1e-14

/** Upstream holds each state until 1 fs before an edge; the pipeline starts the edge from that held state. */
function held({
  line,
  companion,
}: {
  line: string
  companion: string
}): string {
  const open = line.indexOf("PWL(")
  const close = line.lastIndexOf(")")
  if (open < 0 || close < open + 4) return line
  const knots = line.slice(open + 4, close).split(" ")
  const companionKnots = companion
    .slice(companion.indexOf("PWL(") + 4, companion.lastIndexOf(")"))
    .split(" ")
  const kept: string[] = []
  for (let i = 0; i < knots.length; i += 2) {
    if (
      i + 2 < knots.length &&
      Number(knots[i + 2]) - Number(knots[i]) < HOLD_STEP_THRESHOLD_SECONDS &&
      Math.abs(Number(knots[i + 3]) - Number(knots[i + 1])) <= 0.01 &&
      Math.abs(Number(companionKnots[i + 3]) - Number(companionKnots[i + 1])) <=
        0.01
    ) {
      i += 2
      kept.push(knots[i], knots[i - 1])
      continue
    }
    kept.push(knots[i], knots[i + 1])
  }
  return `${line.slice(0, open)}PWL(${kept.join(" ")})${line.slice(close + 1)}`
}

/** Vendor source bytes and declarations for a rendered package fixture. */
interface PackageFixture {
  bytes: Uint8Array
  declarations: ReturnType<typeof generalDeclarations>
}

/** Use the real TSX board and unmodified vendor model, without invoking extraction. */
async function fixture(
  differential: boolean = DEFAULT_DIFFERENTIAL_FIXTURE,
): Promise<PackageFixture> {
  let file = "sn74lvc1g04.ibs"
  let board = <Single />
  if (differential) {
    file = "sn65hvd72.ibs"
    board = <Differential />
  }
  const bytes = await readFile(`${modelDir}/${file}`)
  const bindings = plannedBindings({
    circuitJson: await renderSignals({ tree: board }),
    ibisSources: { [`models/${file}`]: bytes },
  })
  const declarations = generalDeclarations({
    circuit: cloneCircuitJson(bindings.circuitJson),
    receiverPaths: bindings.receiverPaths,
    traceContacts: bindings.traceContacts,
    modeling: bindings.modeling,
    controls: bindings.controls,
  })
  return { bytes, declarations }
}

test("ideal die rails preserve every pin package at the typical corner", async () => {
  for (const differential of [false, true]) {
    const { bytes, declarations } = await fixture(differential)
    const document = parseIbis(new TextDecoder().decode(bytes))
    for (const model of declarations.models) {
      const input = modelRunDefinition({ model, plan: declarations.plans[0] })
      const converted = convertIbisComponentWithPackage({ bytes, input })
      const die = convertIbisModelToSpice(
        bytes,
        { ...input.definition, packagePolicy: "omit" },
        input.run,
      )
      const component = document.components[input.definition.component]
      for (const [i, [terminal, port]] of Object.entries(
        converted.spicePinMapping,
      ).entries()) {
        const physical = Object.keys(input.definition.pinMap).find(
          (pin) => input.definition.pinMap[pin] === port,
        )!
        const pin = component.pins[physical]
        const resistance = pin.resistance ?? component.package.resistance![0]
        const inductance = pin.inductance ?? component.package.inductance![0]
        assert.ok(
          converted.source.includes(
            `RPKG${i} ${terminal} PKGR${i} ${resistance}`,
          ),
        )
        assert.ok(
          converted.source.includes(`LPKG${i} PKGR${i} PKGL${i} ${inductance}`),
        )
        assert.ok(converted.source.includes(`CPKG${i}a ${terminal} `))
        assert.ok(converted.source.includes(`CPKG${i}b PKGL${i} `))
        const modelName = pin.model.toLowerCase()
        if (modelName === "power" || modelName === "gnd") {
          const buffer = document.getBuffer(converted.metadata.pins[0].model)
          let voltage = (buffer.pulldownReference ?? [0, 0, 0])[0]
          if (modelName === "power") {
            const range = buffer.pullupReference ?? buffer.voltage
            assert.ok(range)
            voltage = range[0]
          }
          assert.ok(converted.source.includes(`VDIE${i} DIE${i} 0 ${voltage}`))
        }
      }
      // Renaming only package nodes must preserve the converter's rail references and KU/KD.
      const terminals = Object.keys(converted.spicePinMapping)
      const buffers = sourceLines({
        source: converted.source,
        prefixes: ["XBUF"],
      }).map((line) => normalizeNodes({ line, terminals }))
      assert.deepEqual(
        buffers,
        sourceLines({ source: die.source, prefixes: ["XBUF"] }),
      )
      const drive = ["VKU", "VKD"]
      const driveTables = sourceLines({
        source: converted.source,
        prefixes: drive,
      }).map((line) => normalizeNodes({ line, terminals }))
      const originalDriveTables = sourceLines({
        source: die.source,
        prefixes: drive,
      })
      assert.deepEqual(
        driveTables,
        originalDriveTables.map((line, index) =>
          held({ line, companion: originalDriveTables[index ^ 1] }),
        ),
      )
      assert.deepEqual(converted.metadata.omissions, [])
    }
  }
})
