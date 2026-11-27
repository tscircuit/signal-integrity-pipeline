import { test } from "bun:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { convertIbisModelToSpice, parseIbis } from "@tscircuit/ibis-to-spice"
import { cloneCircuitJson } from "../../../src/board"
import { compileBuffers, validateIbisSources } from "../../../src/buffers"
import { rootScope } from "../../../src/kernel"
import {
  generalDeclarations,
  modelRunDefinition,
} from "../../../src/simulation"
import { plannedBindings, renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"
import Single from "../../fixtures/unit-single-ended"

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
  return source
    .split("\n")
    .filter((line) => prefixes.some((prefix) => line.startsWith(prefix)))
}

/** A decimal digit in a generated package node suffix. */
function isDigit(character: string): boolean {
  return character >= "0" && character <= "9"
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

/** Vendor source bytes and declarations for a rendered package fixture. */
interface PackageFixture {
  bytes: Uint8Array
  file: string
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
  return { bytes, file, declarations }
}

test("ideal die rails preserve every pin package at the typical corner", async () => {
  for (const differential of [false, true]) {
    const { bytes, file, declarations } = await fixture(differential)
    const document = parseIbis(new TextDecoder().decode(bytes))
    const { value: validated } = validateIbisSources({
      models: declarations.models,
      ibisSources: { [`models/${file}`]: bytes },
      scope: rootScope("buffers"),
    })
    const [models] = compileBuffers({
      validated,
      plans: declarations.plans,
      define: modelRunDefinition,
    })
    for (const converted of models) {
      const { input } = converted
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
      assert.deepEqual(driveTables, originalDriveTables)
      assert.deepEqual(converted.metadata.omissions, [])
    }
  }
})
