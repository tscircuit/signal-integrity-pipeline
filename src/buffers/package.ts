import { type IbisDocument, parseIbis } from "@tscircuit/ibis-to-spice"
import type { SourcePortId } from "../board"
import { sha256 } from "../kernel"
import {
  coupledPackage,
  coupledPackageElements,
  PACKAGE_SHUNT_COUNT,
  packageCapacitanceWarnings,
  packageComparisons,
  packageRail,
} from "./coupled-package"
import { type ReferenceVoltages, referenceVoltages } from "./inspect"
import { convertSwitching } from "./switching"
import { asciiLowerCase, isSpace, tokenEnd } from "./text"
import type { ModelRunDefinition, PackagedComponent } from "./types"

/** External SPICE terminal named by the converter. */
type SpiceTerminal = keyof PackagedComponent["spicePinMapping"]
/** Pin label from the selected IBIS component. */
type PhysicalPin = keyof ReturnType<
  typeof parseIbis
>["components"][string]["pins"]
/** External or internal node in the generated SPICE subcircuit. */
type SpiceNode = string

/** Maximum voltage difference allowed between die rails that share a package pin. */
const DIE_VOLTAGE_TOLERANCE = 1e-8

const RETAINED_PACKAGE_WARNING = [
  "Vendor pin package RLC retained; Ideal rails constrain die POWER/GND nodes,",
  "including behind the reference-pin packages",
].join(" ")

const UNUSED_PIN_POLICY =
  "open-series-leads-floating-charge; unused loads, switching and circulating currents neglected"

const COUPLED_PACKAGE_WARNING = [
  "Coupled package: open unused series leads; floating-charge capacitance reduction;",
  "unused pin loads, switching and circulating currents neglected; one lumped pi section;",
  "unlisted pins follow the IBIS [Pin]/[Package] hierarchy or merged rail bus rules",
].join(" ")

/** Remap whole SPICE tokens while retaining all original whitespace. */
function remapNodes({
  line,
  nodes,
}: {
  line: string
  nodes: ReadonlyMap<string, SpiceNode>
}): string {
  let source = ""
  for (let start = 0; start < line.length; ) {
    if (isSpace(line[start])) {
      source += line[start]
      start++
      continue
    }
    const end = tokenEnd({ text: line, start })
    const token = line.slice(start, end)
    source += nodes.get(token) ?? token
    start = end
  }
  return source
}

/** Resolve the voltage each mapped source port must provide to an ideal die rail. */
function dieVoltages({
  pins,
  document,
}: {
  pins: PackagedComponent["metadata"]["pins"]
  document: IbisDocument
}): Map<SourcePortId, number> {
  const voltages = new Map<SourcePortId, number>()
  for (const pin of pins) {
    for (const [role, voltage] of Object.entries(
      referenceVoltages({ buffer: document.getBuffer(pin.model) }),
    )) {
      const port = pin.references[role as keyof ReferenceVoltages]
      const previous = voltages.get(port)
      if (
        previous !== undefined &&
        Math.abs(previous - voltage) > DIE_VOLTAGE_TOLERANCE
      ) {
        throw new Error(`${port}: incompatible IBIS die voltages`)
      }
      voltages.set(port, voltage)
    }
  }
  return voltages
}

/** Require a finite, nonnegative scalar package coefficient from the pin or component default. */
function packageCoefficient({
  coefficient,
  label,
}: {
  coefficient: number | null | undefined
  label: string
}): number {
  if (coefficient == null || !Number.isFinite(coefficient) || coefficient < 0)
    throw new Error(label)
  return coefficient
}

/** Convert die buffers, retaining every vendor pin package with ideal die rails. */
export function convertPackaged({
  bytes,
  input,
  sourceFile = input.definition.source.file ?? "(inline IBIS)",
}: {
  bytes: Uint8Array
  input: ModelRunDefinition
  sourceFile?: string
}): PackagedComponent {
  const text = new TextDecoder().decode(bytes)
  const document = parseIbis(text)
  const component = document.components[input.definition.component]
  if (!component)
    throw new Error(`Missing IBIS component ${input.definition.component}`)
  const converted = convertSwitching({ bytes, input, document })
  const physicalPins = Object.values(converted.spicePinMapping).map((port) => {
    const physical = Object.keys(input.definition.pinMap).filter(
      (pin) => input.definition.pinMap[pin] === port,
    )
    if (physical.length !== 1)
      throw new Error(`${port}: package pin mapping is ambiguous`)
    return physical[0]
  })
  const selected = coupledPackage({ text, component, pins: physicalPins })
  const top = converted.source.indexOf("\n.ends ")
  const wrapper = converted.source.slice(0, top).split("\n")
  const header = wrapper.findIndex(
    (line) => asciiLowerCase(line.slice(0, ".subckt ".length)) === ".subckt ",
  )
  const nodes = new Map<SpiceTerminal, SpiceNode>()
  const elements: string[] = []
  const refs = converted.metadata.pins.map((pin) => pin.references.pulldown)
  const ground = [...new Set(refs)]
  if (ground.length !== 1) {
    throw new Error(
      `${component.name}: per-bank package ground requires an explicit package model`,
    )
  }
  const groundTerminal = Object.entries(converted.spicePinMapping).find(
    ([, port]) => port === ground[0],
  )?.[0]
  if (!groundTerminal)
    throw new Error(`${component.name}: package ground is not mapped`)
  const voltages = dieVoltages({ pins: converted.metadata.pins, document })
  const rails = new Map<PhysicalPin, SpiceNode>()
  const referenceNodes = new Map(
    Object.entries(converted.spicePinMapping).flatMap(([terminal], i) => {
      const physical = physicalPins[i]
      const pin = component.pins[physical]
      if (packageRail(pin.model) === undefined) return []
      const key = selected?.mergedPins[physical] ?? physical
      if (!rails.has(key)) rails.set(key, `DIE${i}`)
      return [[terminal, rails.get(key)!] as const]
    }),
  )
  const dieGround = referenceNodes.get(groundTerminal)!
  if (!dieGround)
    throw new Error(
      `${component.name}: package ground must map to a physical GND pin`,
    )
  const terminals = Object.keys(converted.spicePinMapping)
  const matrixTerminals =
    selected?.pins.map(
      (pin, i) => terminals[physicalPins.indexOf(pin)] ?? `PKGM${i}`,
    ) ?? []
  const supplied = new Map<SpiceNode, number>()
  let tag = "PKG"
  if (selected) tag = "PKGU"
  for (const [i, [terminal, port]] of Object.entries(
    converted.spicePinMapping,
  ).entries()) {
    const pin = component.pins[physicalPins[i]]
    const matrixPin = selected?.mergedPins[physicalPins[i]] ?? physicalPins[i]
    const matrixIndex = selected?.pins.indexOf(matrixPin) ?? -1
    const scalar = matrixIndex < 0
    let node = terminal
    for (const [field, kind] of [
      ["resistance", "R"],
      ["inductance", "L"],
    ] as const) {
      if (!scalar) continue
      const coefficient = packageCoefficient({
        coefficient: pin[field] ?? component.package[field]?.[0],
        label: `${physicalPins[i]}: vendor package ${field} missing`,
      })
      if (coefficient <= 0) continue
      const next = `${tag}${kind}${i}`
      elements.push(`${kind}${tag}${i} ${node} ${next} ${coefficient}`)
      node = next
    }
    if (!scalar) {
      node = `PKGD${matrixIndex}`
      if (matrixPin !== physicalPins[i])
        elements.push(`VPKGM${i} ${terminal} ${matrixTerminals[matrixIndex]} 0`)
    }
    const reference = referenceNodes.get(terminal)
    nodes.set(terminal, reference || node)
    if (reference) {
      let voltage = voltages.get(port)
      if (voltage == null && packageRail(pin.model) === "pulldown") voltage = 0
      if (voltage === undefined)
        throw new Error(`${port}: no selected model defines this die rail`)
      const previous = supplied.get(reference)
      if (
        previous !== undefined &&
        Math.abs(previous - voltage) > DIE_VOLTAGE_TOLERANCE
      ) {
        throw new Error(
          `${component.name}: incompatible die voltages on merged package pin ${matrixPin}`,
        )
      }
      if (previous === undefined) {
        elements.push(
          `VPDN${i} ${reference} 0 ${voltage}`,
          `VPKG${i} ${node} ${reference} 0`,
        )
      }
      supplied.set(reference, voltage)
    }
    if (!scalar) continue
    const capacitance = packageCoefficient({
      coefficient: pin.capacitance ?? component.package.capacitance?.[0],
      label: `${physicalPins[i]}: vendor package capacitance missing`,
    })
    if (capacitance <= 0) continue
    const half = capacitance / PACKAGE_SHUNT_COUNT
    elements.push(
      `C${tag}${i}a ${terminal} ${dieGround} ${half}`,
      `C${tag}${i}b ${node} ${dieGround} ${half}`,
    )
  }
  if (selected) {
    const die = selected.pins.map((_, i) => `PKGD${i}`)
    elements.push(
      ...coupledPackageElements({
        matrices: selected,
        terminals: matrixTerminals,
        die,
        ground: dieGround,
      }),
    )
    converted.metadata.packageData.matrices = selected
    converted.metadata.packageData.unusedPinPolicy = UNUSED_PIN_POLICY
    for (const pin of physicalPins) {
      const i = selected.pins.indexOf(selected.mergedPins[pin] ?? pin)
      if (i < 0) continue
      const metadata = converted.metadata.packageData.mappedPins.find(
        (entry) => entry.physicalPin === pin,
      )!
      Object.assign(metadata, {
        resistanceOhms: selected.R[i][i],
        inductanceHenries: selected.L[i][i],
        capacitanceFarads: selected.C[i][i],
      })
    }
  }
  const body = wrapper.map((line, index) => {
    if (index <= header) return line
    return remapNodes({ line, nodes })
  })
  converted.source = `${[...body, ...elements].join("\n")}${converted.source.slice(top)}`
  converted.metadata.packagePolicy = "vendor"
  converted.warnings = converted.warnings.filter(
    (warning) => !converted.metadata.omissions.includes(warning),
  )
  converted.metadata.omissions = []
  converted.warnings.push(RETAINED_PACKAGE_WARNING)
  if (selected)
    converted.warnings.push(
      COUPLED_PACKAGE_WARNING,
      ...packageComparisons({ component, selected }),
    )
  converted.warnings.push(
    ...packageCapacitanceWarnings({
      selected,
      file: sourceFile,
      sourceSha256: sha256(bytes),
    }),
  )
  return converted
}
