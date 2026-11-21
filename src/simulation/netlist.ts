/* eslint-disable local/max-file-lines -- SPICE source generation and its shared deck namespacing stay together. */
// Electrical sources and SPICE namespacing for the routed deck.
import type { SimulationVoltageSource } from "circuit-json"
import type { CircuitJson, SourceNetId, SourcePortId } from "../board"
import { selectPort } from "../board"
import { fail } from "./diagnostics"
import type {
  CircuitNodes,
  ElectricalSources,
  SimulationModeling,
} from "./types"

/** This many significant digits preserve double-precision values in SPICE decks. */
const SPICE_SIGNIFICANT_DIGITS = 17

/** One second contains this many milliseconds. */
const MILLISECONDS_PER_SECOND = 1000

/** Without a declared duty cycle, a square pulse stays high for half the period. */
const DEFAULT_DUTY_CYCLE = 0.5

interface ElectricalValue {
  input: unknown
  label: string
  positive?: boolean
}

/** Rejects any input that is not finite and, when required, positive. */
function finite({ input, label, positive = false }: ElectricalValue): number {
  if (
    typeof input === "number" &&
    Number.isFinite(input) &&
    (!positive || input > 0)
  )
    return input
  let range = ""
  if (positive) range = "positive "
  return fail(
    "electrical_input",
    `${label}: explicit finite ${range}value required`,
  )
}

/** Checks an electrical input and formats it for the deck. */
function value(options: ElectricalValue): string {
  return Number(
    finite(options).toPrecision(SPICE_SIGNIFICANT_DIGITS),
  ).toString()
}

/** The rewritten SPICE source and name of its prefixed wrapper. */
type NamespacedSpice = {
  source: string
  wrapper: string
}

/**
 * Prefixes every subcircuit name in a converter library so several IBIS models can share one deck.
 * Also returns the prefixed name of the top-level wrapper to instantiate.
 */
export function namespaceSpice({
  source,
  prefix,
}: {
  source: string
  prefix: string
}): NamespacedSpice {
  const names: string[] = []
  for (
    let offset = source.indexOf(".");
    offset !== -1;
    offset = source.indexOf(".", offset + 1)
  ) {
    if (offset > 0 && !isSpiceLineBreak(source[offset - 1])) continue
    const keywordEnd = offset + ".subckt".length
    if (source.slice(offset, keywordEnd).toLowerCase() !== ".subckt") continue
    const start = skipSpiceWhitespace({ source, start: keywordEnd })
    const end = spiceTokenEnd({ source, start })
    if (start === keywordEnd || start === end) continue
    names.push(source.slice(start, end))
    offset = end - 1
  }
  if (!names.length)
    fail("ibis_contract", "Converter did not emit a SPICE component wrapper")

  const renamed = new Map(
    names.map((name) => [name.toLowerCase(), `${prefix}_${name}`]),
  )
  let output = ""
  let copied = 0
  while (copied < source.length) {
    const start = skipSpiceWhitespace({ source, start: copied })
    const end = spiceTokenEnd({ source, start })
    const token = source.slice(start, end)
    output += `${source.slice(copied, start)}${renamed.get(token.toLowerCase()) ?? token}`
    copied = end
  }
  return { source: output, wrapper: `${prefix}_${names[0]}` }
}

/** Index after the whitespace that starts at the given offset. */
function skipSpiceWhitespace({
  source,
  start,
}: {
  source: string
  start: number
}): number {
  while (source[start]?.trim() === "") start++
  return start
}

/** Index after the non-whitespace token that starts at the given offset. */
function spiceTokenEnd({
  source,
  start,
}: {
  source: string
  start: number
}): number {
  while (start < source.length && source[start].trim() !== "") start++
  return start
}

/** SPICE terminal lists end at a carriage return or line feed. */
const SPICE_TERMINAL_LINE_ENDINGS = "\r\n"
/** SPICE statement scanning also recognizes the Unicode line and paragraph separators. */
const SPICE_LINE_ENDINGS = `${SPICE_TERMINAL_LINE_ENDINGS}\u2028\u2029`

/** Whether the previous character starts a new SPICE statement line. */
function isSpiceLineBreak(char: string): boolean {
  return SPICE_LINE_ENDINGS.includes(char)
}

/** Split the trimmed terminal list, preserving an empty terminal for an empty list. */
function splitSpicePins(source: string): string[] {
  if (source.length === 0) return [""]
  const pins: string[] = []
  for (let start = 0; start < source.length; ) {
    const end = spiceTokenEnd({ source, start })
    pins.push(source.slice(start, end))
    start = skipSpiceWhitespace({ source, start: end })
  }
  return pins
}

/** Read terminals from the first placed subcircuit header with a name and terminal field. */
function placedSubcircuitPins(source: string): string[] | undefined {
  for (
    let start = source.indexOf(".");
    start !== -1;
    start = source.indexOf(".", start + 1)
  ) {
    if (start > 0 && !isSpiceLineBreak(source[start - 1])) continue
    let keywordEnd = start + 1
    while (isSpiceWordCharacter(source[keywordEnd])) keywordEnd++
    if (source.slice(start + 1, keywordEnd).toLowerCase() !== "subckt") continue

    const nameStart = skipSpiceWhitespace({ source, start: keywordEnd })
    if (nameStart === keywordEnd) continue
    const nameEnd = spiceTokenEnd({ source, start: nameStart })
    if (nameEnd === source.length) continue

    const pinsStart = skipSpiceWhitespace({ source, start: nameEnd })
    if (pinsStart === source.length) {
      // A spaces-only terminal field can follow the required separator.
      for (let offset = nameEnd + 1; offset < source.length; offset++) {
        if (!SPICE_TERMINAL_LINE_ENDINGS.includes(source[offset])) return [""]
      }
      continue
    }
    let pinsEnd = pinsStart
    while (
      pinsEnd < source.length &&
      !SPICE_TERMINAL_LINE_ENDINGS.includes(source[pinsEnd])
    )
      pinsEnd++
    return splitSpicePins(source.slice(pinsStart, pinsEnd).trim())
  }
  return undefined
}

/** Behavioral and controlled-source device prefixes excluded from placed passive subcircuits. */
const UNSUPPORTED_SPICE_DEVICES = "BESGWFTbesgwft"

const unsupportedSpiceDirectives = [
  "include",
  "lib",
  "control",
  "end",
  "tran",
  "ac",
  "dc",
]

/** Check the ASCII letters, digits and underscore used in a directive name. */
function isSpiceWordCharacter(char: string | undefined): boolean {
  if (char === undefined) return false
  return (
    (char >= "A" && char <= "Z") ||
    (char >= "a" && char <= "z") ||
    (char >= "0" && char <= "9") ||
    char === "_"
  )
}

/** Find directives and device types excluded from placed passive subcircuits. */
function hasUnsupportedPlacedSpice(source: string): boolean {
  for (let start = 0; start < source.length; start++) {
    if (start > 0 && !isSpiceLineBreak(source[start - 1])) continue
    start = skipSpiceWhitespace({ source, start })
    const first = source[start]
    if (first && UNSUPPORTED_SPICE_DEVICES.includes(first)) return true
    if (first !== ".") continue

    let end = start + 1
    while (isSpiceWordCharacter(source[end])) end++
    const directive = source.slice(start + 1, end).toLowerCase()
    if (unsupportedSpiceDirectives.includes(directive)) return true
  }
  return false
}

/** The two terminals on a SPICE resistor or inductor line. */
type SpiceTerminalPair = [first: string, second: string]

/** Resistor and inductor device prefixes used to find DC-connected terminals. */
const DC_SPICE_DEVICES = "RLrl"

/** Read the terminals of a resistor or inductor line that also has a separator after the second terminal. */
function dcSpiceTerminals(line: string): SpiceTerminalPair | undefined {
  const deviceStart = skipSpiceWhitespace({ source: line, start: 0 })
  const device = line[deviceStart]
  if (!device || !DC_SPICE_DEVICES.includes(device)) return undefined
  const first = skipSpiceWhitespace({
    source: line,
    start: spiceTokenEnd({ source: line, start: deviceStart }),
  })
  const firstEnd = spiceTokenEnd({ source: line, start: first })
  const second = skipSpiceWhitespace({ source: line, start: firstEnd })
  const secondEnd = spiceTokenEnd({ source: line, start: second })
  if (secondEnd === line.length) return undefined
  return [line.slice(first, firstEnd), line.slice(second, secondEnd)]
}

/** A voltage source's serialized terminal ids, which may be absent on invalid input. */
type VoltageSourceTerminals = [
  positive: SourcePortId | SourceNetId | undefined,
  negative: SourcePortId | SourceNetId | undefined,
]

/** Reads terminals from the Circuit JSON DC or AC source record. */
export function voltageSourceTerminals(
  source: SimulationVoltageSource,
): VoltageSourceTerminals {
  if (source.is_dc_source) {
    return [
      source.positive_source_port_id ?? source.positive_source_net_id,
      source.negative_source_port_id ?? source.negative_source_net_id,
    ]
  }
  return [source.terminal1_source_port_id, source.terminal2_source_port_id]
}

/** Marks both nodes as modeled and formats their SPICE terminal pair. */
function terminals({
  activeNodes,
  positive,
  negative,
}: {
  activeNodes: Set<string>
  positive: string
  negative: string
}): string {
  activeNodes.add(positive)
  activeNodes.add(negative)
  return `${positive} ${negative}`
}

/** Formats the source's DC or square-wave expression for the SPICE deck. */
function voltageSourceExpression(source: SimulationVoltageSource): string {
  if (source.is_dc_source || !source.wave_shape) {
    return value({ input: source.voltage, label: "voltage source voltage" })
  }
  if (source.wave_shape !== "square") {
    return fail(
      "source_capability",
      `Voltage waveform ${source.wave_shape} is unsupported by this PCB backend`,
    )
  }
  let periodSeconds: number
  if (source.period === undefined) {
    periodSeconds =
      1 /
      finite({
        input: source.frequency,
        label: "source frequency",
        positive: true,
      })
  } else {
    periodSeconds = source.period / MILLISECONDS_PER_SECOND
  }
  const amplitude = finite({
    input: source.peak_to_peak_voltage ?? source.voltage,
    label: "source amplitude",
  })
  let low = 0
  if (source.peak_to_peak_voltage !== undefined) {
    low =
      finite({ input: source.voltage, label: "source offset" }) - amplitude / 2
  }
  const high = low + amplitude
  const riseSeconds = (source.rise_time ?? 0) / MILLISECONDS_PER_SECOND
  const fallSeconds = (source.fall_time ?? 0) / MILLISECONDS_PER_SECOND
  if (riseSeconds <= 0 || fallSeconds <= 0)
    fail(
      "source_edge",
      "Square voltage sources require explicit positive rise/fall times",
    )
  const lowValue = value({ input: low, label: "source low" })
  const highValue = value({ input: high, label: "source high" })
  const delaySeconds = (source.pulse_delay ?? 0) / MILLISECONDS_PER_SECOND
  const delay = value({ input: delaySeconds, label: "source delay" })
  const riseValue = value({
    input: riseSeconds,
    label: "source rise",
    positive: true,
  })
  const fallValue = value({
    input: fallSeconds,
    label: "source fall",
    positive: true,
  })
  let pulseWidthSeconds: number
  if (source.pulse_width === undefined) {
    pulseWidthSeconds =
      periodSeconds * (source.duty_cycle ?? DEFAULT_DUTY_CYCLE)
  } else {
    pulseWidthSeconds = source.pulse_width / MILLISECONDS_PER_SECOND
  }
  const width = value({
    input: pulseWidthSeconds,
    label: "source width",
    positive: true,
  })
  const periodValue = value({
    input: periodSeconds,
    label: "source period",
    positive: true,
  })
  return `PULSE(${lowValue} ${highValue} ${delay} ${riseValue} ${fallValue} ${width} ${periodValue})`
}

/**
 * Turns physical voltage sources, declared supplies and selected passives into SPICE lines.
 * Fails when a source is shorted, floating or unsupported, because this backend never invents rails.
 */
export function electricalSources({
  circuit,
  modeling,
  nodes,
}: {
  circuit: CircuitJson
  modeling: SimulationModeling
  nodes: CircuitNodes
}): ElectricalSources {
  const sources: string[] = []
  const passives: string[] = []
  const activeNodes = new Set(["0"])
  const dcConnections: SpiceTerminalPair[] = []
  const sourceBindings: ElectricalSources["sourceBindings"] = []
  const sourcePorts = circuit.filter((e) => e.type === "source_port")
  const sourceComponents = circuit.filter((e) => e.type === "source_component")
  for (const [i, source] of circuit
    .filter((e) => e.type === "simulation_voltage_source")
    .entries()) {
    const [positive, negative] = voltageSourceTerminals(source)
    if (!positive || !negative)
      return fail(
        "supply_reference",
        "Voltage sources require explicit positive and negative source port/net terminals",
      )
    const pos = nodes.node(positive)
    const neg = nodes.node(negative)
    if (pos === neg)
      fail("supply_short", "Voltage source terminals resolve to the same node")
    const expression = voltageSourceExpression(source)
    sources.push(
      `VPHYSICAL${i} ${terminals({ activeNodes, positive: pos, negative: neg })} ${expression}`,
    )
    const port = sourcePorts.find((e) => e.source_port_id === positive)
    const component = sourceComponents.find(
      (e) => e.source_component_id === port?.source_component_id,
    )
    sourceBindings.push({
      name: component?.name ?? source.simulation_voltage_source_id,
      positiveNode: pos,
      negativeNode: neg,
    })
    dcConnections.push([pos, neg])
  }
  for (const [i, source] of (modeling.supplies ?? []).entries()) {
    const pos = nodes.node(
      selectPort({ circuit, selector: source.positive }).source_port_id,
    )
    const neg = nodes.node(
      selectPort({ circuit, selector: source.negative }).source_port_id,
    )
    if (pos === neg)
      fail("supply_short", "Explicit supply terminals resolve to the same node")
    const pair = terminals({ activeNodes, positive: pos, negative: neg })
    sources.push(
      `VDECLARED${i} ${pair} ${value({ input: source.voltageV, label: "declared supply" })}`,
    )
    sourceBindings.push({
      name: `modeling.supplies[${i}]`,
      positiveNode: pos,
      negativeNode: neg,
    })
    dcConnections.push([pos, neg])
  }
  for (const [i, selection] of (modeling.passiveComponents ?? []).entries()) {
    const components = sourceComponents.filter((component) => {
      if (selection.sourceComponentId)
        return component.source_component_id === selection.sourceComponentId
      return component.name === selection.component
    })
    if (components.length !== 1)
      fail(
        "passive_reference",
        "Selected passive component is missing or ambiguous",
      )
    const component = components[0]
    const ports = sourcePorts
      .filter(
        (port) => port.source_component_id === component.source_component_id,
      )
      .sort((a, b) => Number(a.pin_number) - Number(b.pin_number))
    const spiceSubcircuits = circuit.filter(
      (record) => record.type === "simulation_spice_subcircuit",
    )
    const placed = spiceSubcircuits.filter(
      (record) => record.source_component_id === component.source_component_id,
    )
    if (placed.length) {
      if (placed.length !== 1)
        fail(
          "passive_capability",
          `${component.name}: placed SPICE model is ambiguous`,
        )
      const model = placed[0]
      const pins = placedSubcircuitPins(model.subcircuit_source)
      if (!pins || hasUnsupportedPlacedSpice(model.subcircuit_source)) {
        fail(
          "passive_capability",
          `${component.name}: placed SPICE model is unsupported; it cannot be discarded.`,
        )
      }
      if (pins.some((pin) => !model.spice_pin_to_source_port_map[pin])) {
        fail(
          "passive_capability",
          `${component.name}: placed SPICE model has unmapped terminals`,
        )
      }
      const namespaced = namespaceSpice({
        source: model.subcircuit_source,
        prefix: `PLACED${i}`,
      })
      const nodesForPins = pins.map((pin) =>
        nodes.node(model.spice_pin_to_source_port_map[pin]),
      )
      for (const node of nodesForPins) activeNodes.add(node)
      passives.push(
        namespaced.source,
        `XPHYSICAL${i} ${nodesForPins.join(" ")} ${namespaced.wrapper}`,
      )
      // Supported passive resistor/inductor edges determine the DC rail connectivity.
      for (const line of model.subcircuit_source
        .replaceAll("\r\n", "\n")
        .split("\n")) {
        const terminals = dcSpiceTerminals(line)
        if (!terminals) continue
        const [a, b] = terminals.map((pin) => pins.indexOf(pin))
        if (a >= 0 && b >= 0)
          dcConnections.push([nodesForPins[a], nodesForPins[b]])
      }
      continue
    }
    if (ports.length !== 2)
      fail(
        "passive_capability",
        `${component.name}: expected two physical ports`,
      )
    const pos = nodes.node(ports[0].source_port_id)
    const neg = nodes.node(ports[1].source_port_id)
    let kind: "R" | "C" | "L"
    let amount: unknown
    let quantity: string
    switch (component.ftype) {
      case "simple_resistor":
        kind = "R"
        amount = component.resistance
        quantity = "resistance"
        break
      case "simple_capacitor":
        kind = "C"
        amount = component.capacitance
        quantity = "capacitance"
        break
      case "simple_inductor":
        kind = "L"
        amount = component.inductance
        quantity = "inductance"
        break
      default:
        return fail(
          "passive_capability",
          `${component.name}: only explicit resistor/capacitor/inductor models supported`,
        )
    }
    const pair = terminals({ activeNodes, positive: pos, negative: neg })
    const componentValue = value({
      input: amount,
      label: `${component.name} ${quantity}`,
      positive: true,
    })
    passives.push(`${kind}PHYSICAL${i} ${pair} ${componentValue}`)
    if (kind !== "C") dcConnections.push([pos, neg])
  }
  if (!sources.length)
    fail(
      "supply_missing",
      "Declare physical voltage sources or explicit source-port supplies; this backend never invents VDD",
    )
  const grounded = new Set(["0"])
  let changed = true
  while (changed) {
    changed = false
    for (const [a, b] of dcConnections) {
      if (!grounded.has(a) && !grounded.has(b)) continue
      for (const node of [a, b]) {
        if (grounded.has(node)) continue
        grounded.add(node)
        changed = true
      }
    }
  }
  for (const source of sourceBindings) {
    if (grounded.has(source.positiveNode) && grounded.has(source.negativeNode))
      continue
    const reason =
      "ideal voltage source has no explicit DC connection to channelReference"
    const instruction =
      "wire its physical terminals to the modeled supply/reference ports"
    fail("floating_source", `${source.name}: ${reason}; ${instruction}`)
  }
  return {
    lines: [...sources, ...passives],
    activeNodes,
    grounded,
    sourceBindings,
    scope: {
      voltageSources: sources.length,
      passiveComponents: passives.length,
      unselectedBoardComponents:
        "Excluded from this explicitly selected channel experiment",
    },
  }
}
