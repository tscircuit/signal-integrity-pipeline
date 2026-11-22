import { cju } from "@tscircuit/circuit-json-util"
import { Circuit, simulation } from "@tscircuit/core"
import type { SourceComponentBase, SourcePort } from "circuit-json"
import React from "react"
import type { CircuitJson } from "../../src/board"

const cpu = ["M3", "M4", "N1", "N2", "N3", "N4", "P3", "P4", "M2", "P1", "P2"]
const dram = ["F2", "G2", "E3", "H3", "F8", "H7", "F7", "H8", "E7", "F3", "G3"]
export const addrCmdPins = [
  ["A0", "F3", "N3"],
  ["A1", "H1", "P7"],
  ["A2", "E4", "P3"],
  ["A3", "C3", "N2"],
  ["A4", "C2", "P8"],
  ["A5", "B1", "P2"],
  ["A6", "D5", "R8"],
  ["A7", "E2", "R2"],
  ["A8", "D4", "T8"],
  ["A9", "C1", "R3"],
  ["A10", "F4", "L7"],
  ["A11", "F2", "R7"],
  ["A12", "E3", "N7"],
  ["BA0", "C4", "M2"],
  ["BA1", "E1", "N8"],
  ["BA2", "B3", "M3"],
  ["CASn", "F1", "K3"],
  ["RASn", "G4", "J3"],
  ["CSn0", "H2", "L2"],
  ["CKE", "G3", "K9"],
  ["ODT", "G1", "K1"],
  ["WEn", "B2", "L3"],
  ["CK", "D2", "J7"],
  ["CKn", "D1", "K7"],
] as const
/** Select the DDR3 block, driver model and active channel patterns. */
export interface Ddr3Options {
  block?: "DDR3_LOWER_WRITE" | "DDR3_ADDR_CMD"
  pattern?:
    | "prbs7"
    | "simultaneous"
    | "quiet"
    | "victim-even"
    | "victim-odd"
    | "isolated-a4"
  durationSeconds?: number
  driverModel?: "Model_352" | "Model_345" | "Model_273"
  nets?: readonly string[]
  activeNets?: readonly string[]
}

/** Props for the declaration-only DDR3 board. */
interface Ddr3SignalsProps {
  "addr-cmd": boolean
  pattern?: Ddr3Options["pattern"]
  "duration-seconds"?: number
  "driver-model"?: Ddr3Options["driverModel"]
  nets?: readonly string[]
  "active-nets"?: readonly string[]
}

/** Match the stack dimensions of the routed fixture. */
const BOARD_LAYERS = 8
const BOARD_THICKNESS_MM = 1.2
/** Space declaration pads far enough apart for core to assign separate ports. */
const DECLARATION_PAD_PITCH_MM = 0.5
const DECLARATION_PAD_WIDTH_MM = 0.2

/** Duration of the address and command simulation when the caller supplies none. */
const DEFAULT_DURATION_SECONDS = 8e-9
/** The two clock lanes follow the 22 address and command lanes in the pin table. */
const FIRST_CLOCK_LANE = 22
/** The lower write byte has eight data lanes, followed by the data mask and two strobe legs. */
const DATA_MASK_LANE = 8
const POSITIVE_STROBE_LANE = DATA_MASK_LANE + 1
const NEGATIVE_STROBE_LANE = DATA_MASK_LANE + 2
/** The active clock leg switches after three bits; the other leg uses its complement. */
const CLOCK_PATTERN = "0001111111111111"
const COMPLEMENTARY_CLOCK_PATTERN = "1110000000000000"
/** Seed the address and command lanes differently while keeping the seeds in the same range. */
const SEED_BASE = 32
const SEED_STRIDE = 7

/** Choose the SoC output buffer for an address, data or strobe lane. */
function cpuModel({
  lane,
  options,
}: {
  lane: number
  options: Ddr3SignalsProps
}): string {
  if (options["addr-cmd"]) {
    if (lane >= FIRST_CLOCK_LANE) return "Model_343"
    return options["driver-model"] ?? "Model_352"
  }
  if (lane === POSITIVE_STROBE_LANE) return "Model_655"
  if (lane === NEGATIVE_STROBE_LANE) return "Model_847"
  return "Model_336"
}

/** The channel name and its position in the address and command pin table. */
interface AddressLane {
  name: string
  lane: number
}

/** Pick the waveform for one address, command or clock lane. */
function addressPattern({
  name,
  lane,
  options,
}: AddressLane & { options: Ddr3SignalsProps }): string {
  const { pattern, "active-nets": activeNets } = options
  if (activeNets && !activeNets.includes(name)) return "0"
  if (pattern === "isolated-a4") {
    if (name === "A4") return "prbs7"
    return "0"
  }
  if (lane === FIRST_CLOCK_LANE) return CLOCK_PATTERN
  if (lane > FIRST_CLOCK_LANE) return COMPLEMENTARY_CLOCK_PATTERN
  if (pattern === "quiet") return "0"
  if (pattern === "victim-even" && lane % 2 === 0) return "0"
  if (pattern === "victim-odd" && lane % 2 === 1) return "0"
  if (pattern === "simultaneous") return "01"
  return "prbs7"
}

/** List the SoC and DRAM with their respective IBIS files and reference pins. */
function ddrChips({
  cpuPins,
  dramPins,
}: {
  cpuPins: string[]
  dramPins: string[]
}): readonly DdrChip[] {
  return [
    {
      name: "U1",
      pins: cpuPins,
      power: "E5",
      ground: "A1",
      file: "sprm552c.ibs",
      component: "am335x_zcz",
    },
    {
      name: "U3",
      pins: dramPins,
      power: "A1",
      ground: "B1",
      file: "W631GG6MB-12.ibs",
      component: "W631GG6MB-12",
    },
  ]
}

/** The declaration-only component and its IBIS pin names. */
interface DdrChip {
  name: "U1" | "U3"
  pins: string[]
  power: string
  ground: string
  file: string
  component: string
}

/** Render one component, its reference connections and its IBIS model. */
function chipDeclarations({
  chip,
  options,
}: {
  chip: DdrChip
  options: Ddr3SignalsProps
}): React.JSX.Element {
  const { name, pins, power, ground, file, component } = chip
  const allPins = [...pins, power, ground]
  const pinLabels = Object.fromEntries(allPins.map((pin) => [pin, pin]))
  let dramModel = "ODT_60"
  if (options["addr-cmd"]) dramModel = "CMD"
  const models = Object.fromEntries(
    pins.map((pin, lane) => {
      if (name === "U3") return [pin, dramModel]
      return [pin, cpuModel({ lane, options })]
    }),
  )
  const referenceLabels = Object.fromEntries(
    pins.map((pin) => [
      pin,
      {
        pullup: power,
        pulldown: ground,
        powerClamp: power,
        groundClamp: ground,
      },
    ]),
  )
  return (
    <React.Fragment key={name}>
      <chip
        name={name}
        pinLabels={pinLabels}
        footprint={
          <footprint>
            {allPins.map((pin, i) => (
              <React.Fragment key={pin}>
                <smtpad
                  portHints={[pin]}
                  pcbX={i * DECLARATION_PAD_PITCH_MM}
                  pcbY={0}
                  width={DECLARATION_PAD_WIDTH_MM}
                  height={DECLARATION_PAD_WIDTH_MM}
                  shape="rect"
                />
              </React.Fragment>
            ))}
          </footprint>
        }
      />
      <trace from={`.${name} > .${power}`} to="net.VDDQ" />
      <trace from={`.${name} > .${ground}`} to="net.GND" />
      <simulation.ibismodel
        componentRef={`.${name}`}
        ibisModelAsset={{
          project_relative_path: `models/${file}`,
          url: `./models/${file}`,
          mimetype: "text/plain",
        }}
        ibisComponentName={component}
        ibisPinNameToPortLabel={pinLabels}
        ibisPinNameToModelName={models}
        ibisPinNameToReferencePortLabels={referenceLabels}
      />
    </React.Fragment>
  )
}

/** Render the address, command and clock channel declarations. */
function addressChannels({
  options,
  durationSeconds,
}: {
  options: Ddr3SignalsProps
  durationSeconds: number
}): React.JSX.Element {
  const { nets } = options
  return (
    <simulation.pcbtransientchannelsimulation
      name="DDR3_ADDR_CMD"
      bitRate="400Mbps"
      duration={durationSeconds}
      allowUnroutedTraces
    >
      {addrCmdPins.map(([name, from, to], lane) => {
        if (nets && !nets.includes(name)) return null
        let bitRate = "400Mbps"
        if (lane >= FIRST_CLOCK_LANE) bitRate = "800Mbps"
        return (
          <simulation.pcbdriverreceiverchannel
            key={name}
            name={name}
            driverRef={{
              pin: `.U1 > .${from}`,
              model: cpuModel({ lane, options }),
            }}
            receiverRef={{ pin: `.U3 > .${to}`, model: "CMD" }}
            bitRate={bitRate}
            pattern={addressPattern({ name, lane, options })}
            seed={SEED_BASE + ((lane * SEED_STRIDE) % SEED_BASE)}
          />
        )
      })}
    </simulation.pcbtransientchannelsimulation>
  )
}

/** Render the lower data byte, data mask and differential data strobe. */
function writeChannels(): React.JSX.Element {
  return (
    <simulation.pcbtransientchannelsimulation
      name="DDR3_LOWER_WRITE"
      bitRate="800Mbps"
      allowUnroutedTraces
    >
      {cpu.slice(0, POSITIVE_STROBE_LANE).map((pin, lane) => {
        let name = `DQ${lane}`
        if (lane === DATA_MASK_LANE) name = "DQM0"
        return (
          <React.Fragment key={pin}>
            <simulation.pcbdriverreceiverchannel
              name={name}
              driverRef={{ pin: `.U1 > .${pin}`, model: "Model_336" }}
              receiverRef={{ pin: `.U3 > .${dram[lane]}`, model: "ODT_60" }}
            />
          </React.Fragment>
        )
      })}
      <simulation.pcbdriverreceiverchannel
        name="DQS0"
        driverRef={{
          pin: { p: ".U1 > .P1", n: ".U1 > .P2" },
          model: { p: "Model_655", n: "Model_847" },
        }}
        receiverRef={{
          pin: { p: ".U3 > .F3", n: ".U3 > .G3" },
          model: { p: "ODT_60", n: "ODT_60" },
        }}
        pattern="clock"
        offset="0.5UI"
      />
    </simulation.pcbtransientchannelsimulation>
  )
}

/** The pins and channel elements belonging to one DDR3 block. */
interface Ddr3ChannelDeclarations {
  cpuPins: string[]
  dramPins: string[]
  channels: React.JSX.Element
}

/** Select the channel elements and matching pins for the requested block. */
function ddr3ChannelDeclarations(
  options: Ddr3SignalsProps,
): Ddr3ChannelDeclarations {
  if (!options["addr-cmd"])
    return { cpuPins: cpu, dramPins: dram, channels: writeChannels() }
  const { "duration-seconds": durationSeconds = DEFAULT_DURATION_SECONDS } =
    options
  return {
    cpuPins: addrCmdPins.map(([, pin]) => pin),
    dramPins: addrCmdPins.map(([, , pin]) => pin),
    channels: addressChannels({ options, durationSeconds }),
  }
}

/** Only declarations are retained from this TSX; every physical record comes from the full board. */
export function Ddr3Signals(options: Ddr3SignalsProps): React.JSX.Element {
  const { "addr-cmd": addrCmd } = options
  const { cpuPins, dramPins, channels } = ddr3ChannelDeclarations(options)
  const chips = ddrChips({ cpuPins, dramPins })
  return (
    <board
      width={30}
      height={10}
      layers={BOARD_LAYERS}
      thickness={BOARD_THICKNESS_MM}
      fabricatorPreset="jlcpcb_standard"
      routingDisabled
      schematicDisabled
    >
      {chips.map((chip) => chipDeclarations({ chip, options }))}
      {cpuPins.map((pin, i) => (
        <React.Fragment key={pin}>
          <trace from={`.U1 > .${pin}`} to={`.U3 > .${dramPins[i]}`} />
        </React.Fragment>
      ))}
      {!addrCmd && (
        <differentialpair
          positiveConnection=".U1 > .P1"
          negativeConnection=".U1 > .P2"
        />
      )}
      {channels}
    </board>
  )
}

/** Circuit JSON component and port IDs used by IBIS and channel declarations. */
type DeclarationId =
  | SourceComponentBase["source_component_id"]
  | SourcePort["source_port_id"]

/** Map rendered component and port IDs to the corresponding physical board IDs. */
type DeclarationIds = Map<DeclarationId, DeclarationId>

/** Match rendered source components and their ports to the corresponding records on the board. */
function declarationIds({
  board,
  declarations,
}: {
  board: CircuitJson
  declarations: CircuitJson
}): DeclarationIds {
  const ids: DeclarationIds = new Map()
  const declarationDb = cju([...declarations])
  const boardDb = cju([...board])
  const components = declarationDb.source_component.list()
  const ports = declarationDb.source_port.list()
  const boardComponents = boardDb.source_component.list()
  const boardPorts = boardDb.source_port.list()
  for (const component of components) {
    const actual = boardComponents.find(
      (record) => record.name === component.name,
    )
    if (!actual) throw new Error(`Full board is missing ${component.name}`)
    ids.set(component.source_component_id, actual.source_component_id)
    const componentPorts = ports.filter(
      (record) => record.source_component_id === component.source_component_id,
    )
    for (const port of componentPorts) {
      const target = boardPorts.find(
        (record) =>
          record.source_component_id === actual.source_component_id &&
          record.name === port.name,
      )
      if (!target)
        throw new Error(`Full board is missing ${component.name}.${port.name}`)
      ids.set(port.source_port_id, target.source_port_id)
    }
  }
  return ids
}

/** Remap only declaration identities; never synthesize or transform physical copper. */
function remapDeclaration({
  value,
  ids,
}: {
  value: unknown
  ids: ReadonlyMap<DeclarationId, DeclarationId>
}): unknown {
  if (typeof value === "string") return ids.get(value) ?? value
  if (Array.isArray(value))
    return value.map((entry) => remapDeclaration({ value: entry, ids }))
  if (!value || typeof value !== "object") return value
  const entries = Object.entries(value).map(([key, entry]) => [
    key,
    remapDeclaration({ value: entry, ids }),
  ])
  return Object.fromEntries(entries)
}

/** The declaration-only records kept from the rendered fixture. */
const DECLARATION_TYPES = [
  "simulation_pcb_transient_channel_simulation",
  "simulation_pcb_driver_receiver_channel",
  "simulation_ibis_model",
]

/** Preserve all source-board records; append TSX SI declarations and the requested preset when absent. */
export async function withDdr3Signals({
  physicalRecords,
  options = {},
}: {
  physicalRecords: CircuitJson
  options?: Ddr3Options
}): Promise<CircuitJson> {
  const board = [...physicalRecords]
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(
    <Ddr3Signals
      addr-cmd={options.block === "DDR3_ADDR_CMD"}
      pattern={options.pattern}
      duration-seconds={options.durationSeconds}
      driver-model={options.driverModel}
      nets={options.nets}
      active-nets={options.activeNets}
    />,
  )
  await circuit.renderUntilSettled()
  const declarations = circuit.getCircuitJson() as CircuitJson
  const errors = declarations.filter((record) => record.type.endsWith("_error"))
  if (errors.length) throw new Error(JSON.stringify(errors))
  const ids = declarationIds({ board, declarations })
  const boardDb = cju([...board])
  const physicalBoard = boardDb.pcb_board.getWhere({})!
  const scope = physicalBoard.subcircuit_id
  if (
    physicalBoard.thickness !== BOARD_THICKNESS_MM ||
    physicalBoard.num_layers !== BOARD_LAYERS
  ) {
    throw new Error(
      "DDR3 fixture requires the supplied 1.2 mm eight-layer JLC08121H-3313 board",
    )
  }
  if (!boardDb.pcb_stackup.getWhere({})) {
    const stackup = cju([...declarations]).pcb_stackup.getWhere({})!
    board.push({
      ...stackup,
      pcb_board_id: physicalBoard.pcb_board_id,
      subcircuit_id: scope,
    })
  }
  const records = declarations.filter((record) =>
    DECLARATION_TYPES.includes(record.type),
  )
  const remappedRecords = records.map((record) => {
    const remapped = remapDeclaration({
      value: record,
      ids,
    }) as CircuitJson[number]
    if ("subcircuit_id" in record)
      Object.assign(remapped, { subcircuit_id: scope })
    if (remapped.type === "simulation_pcb_transient_channel_simulation")
      remapped.allow_unrouted_traces = false
    return remapped
  })
  return [...board, ...remappedRecords]
}
