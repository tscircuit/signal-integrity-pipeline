import {
  convertIbisBuffer,
  convertIbisModelToSpice,
  type IbisDocument,
  ibisTimeSeconds,
  logicalBitSchedule,
  sourceHash,
} from "@tscircuit/ibis-to-spice"
import { replacePwl, subcircuitHeader } from "./spice-netlist"
import { scheduleSwitchingCoefficients } from "./switching-coefficients"
import type { WaveformTailTruncation } from "./switching-tail"
import type { ConvertedIbisComponent, ModelRunDefinition } from "./types"

/** The first 20 characters of the content hash identify an IBIS subcircuit. */
const SUBCIRCUIT_HASH_LENGTH = 20

const SETTLED_TAIL_WARNING = [
  "IBIS inactive tails truncated only after all remaining two-fixture voltages and switching coefficients settle",
  "within the recorded 1% tolerances; cutoff coefficients are held, without time compression or",
  "initial-delay removal",
].join(" ")

/** Use upstream pin/reference and die-buffer conversion; the pipeline owns explicit edge scheduling. */
export function convertIbisComponentWithSwitchingSchedule({
  bytes,
  input,
  document,
  canUseVendorPackage,
}: {
  bytes: Uint8Array
  input: ModelRunDefinition
  document: IbisDocument
  canUseVendorPackage?: (
    metadata: ConvertedIbisComponent["metadata"],
  ) => boolean
}): ConvertedIbisComponent {
  // Validate the ORIGINAL pattern before building the steady electrical skeleton.
  for (const stimulus of Object.values(input.run.stimuli))
    logicalBitSchedule(stimulus, input.run.duration)
  const stimuli = Object.fromEntries(
    Object.entries(input.run.stimuli).map(([port, stimulus]) => {
      const pattern = {
        ...stimulus.pattern,
        bits: String(stimulus.initialState),
        repeat: true,
      }
      return [port, { ...stimulus, pattern }]
    }),
  )
  const run = { ...input.run, stimuli }
  const omitted = convertIbisModelToSpice(
    bytes,
    { ...input.definition, packagePolicy: "omit" },
    run,
  )
  let converted: ConvertedIbisComponent = omitted
  if (
    input.definition.packagePolicy === "vendor" &&
    canUseVendorPackage?.(omitted.metadata) === true
  )
    converted = convertIbisModelToSpice(bytes, input.definition, run)
  const tails: WaveformTailTruncation[] = []
  let source = converted.source
  const schedules = converted.metadata.pins.map((pin, index) => {
    const stimulus = input.run.stimuli[pin.port]
    if (!stimulus) return undefined
    const buffer = document.getBuffer(pin.model)
    const schedule = logicalBitSchedule(
      stimulus,
      input.run.duration,
      buffer.polarity,
    )
    if (!schedule.transitions.length) return schedule
    const convertedBuffer = convertIbisBuffer(document, pin.model, {
      corner: input.definition.corner,
      mode: "output",
      separateReferences: true,
      externalReference: pin.references.external !== undefined,
      skipSwitchingWeights: true,
    })
    const { samples, tails: pinTails } = scheduleSwitchingCoefficients({
      convertedBuffer,
      schedule,
      physicalPin: pin.physicalPin,
    })
    tails.push(...pinTails)
    source = replacePwl({
      source,
      voltageSourceName: `VKU${index}`,
      samples,
      coefficientKind: "pullup",
    })
    source = replacePwl({
      source,
      voltageSourceName: `VKD${index}`,
      samples,
      coefficientKind: "pulldown",
    })
    return schedule
  })
  const metadata = {
    ...converted.metadata,
    pins: converted.metadata.pins.map((pin, index) => ({
      ...pin,
      stimulusHash: schedules[index]?.sha256,
    })),
  }
  const original = subcircuitHeader(converted.source)?.[1]
  if (!original) throw new Error("Missing generated IBIS subcircuit header")
  const identity = JSON.stringify([
    metadata,
    schedules,
    ibisTimeSeconds(input.run.duration),
  ])
  const name = `IBIS_${sourceHash(identity).slice(0, SUBCIRCUIT_HASH_LENGTH)}`
  const warnings = [...converted.warnings]
  if (tails.length) {
    metadata.switchingTails = tails
    warnings.push(SETTLED_TAIL_WARNING)
  }
  return {
    ...converted,
    source: source.replaceAll(original, name),
    metadata,
    warnings,
  }
}
