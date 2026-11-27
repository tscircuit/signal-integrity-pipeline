// The IBIS part of general-pipeline.ts runPipeline (hash pinning, loading, conversion, assembly).
import * as converter from "@tscircuit/ibis-to-spice"
import type { SourceComponentBase } from "circuit-json"
import type {
  CircuitJson,
  SimulationIbisModel,
  SourcePort,
  SourcePortId,
} from "../board"
import {
  type Artifact,
  type ArtifactScope,
  type Produced,
  sha256,
} from "../kernel"
import { fail } from "./diagnostics"
import { loadModelSource } from "./source"

/** SHA-256 hashes are written as 64 hexadecimal digits. */
const SHA256_HEX_LENGTH = 64
const HEX_DIGITS = "0123456789abcdefABCDEF"

import type {
  AdmittedBuffers,
  AssemblyEntry,
  BufferModeling,
  CompiledBuffer,
  CompiledBuffersByPlan,
  IbisSources,
  LoadedModelSource,
  ModelRunDefinition,
  ModelSourceRequest,
} from "./types"

/** Fails 'converter_version' unless the pinned upstream general converter is installed. Today's first IBIS check. */
export function assertConverter({
  convertIbisModelToSpice,
}: {
  convertIbisModelToSpice?: unknown
} = converter): void {
  if (typeof convertIbisModelToSpice !== "function")
    fail(
      "converter_version",
      "Install the pinned upstream general IBIS converter",
    )
}

/**
 * Validate modeling.ibisModelAssetSha256 and load every used model before any solver work, in
 * declaration order. Artifacts (under `scope`, the output root): inputs/ibis/<pipelineId>.ibs and
 * vendor-sources.json, byte-identical to today.
 */
export function admitBuffers({
  models,
  ibisSources,
  modeling,
  scope,
}: {
  models: readonly ModelSourceRequest[]
  ibisSources: IbisSources
  modeling: BufferModeling
  scope: ArtifactScope
}): Produced<AdmittedBuffers> {
  const expectedHashes: unknown = modeling.ibisModelAssetSha256
  const isHashMap =
    expectedHashes !== null &&
    typeof expectedHashes === "object" &&
    !Array.isArray(expectedHashes)
  if (expectedHashes !== undefined && !isHashMap) {
    fail(
      "vendor_hash",
      "modeling.ibisModelAssetSha256 must map project-relative IBIS asset paths to SHA-256 hashes",
    )
  }
  const hashes = expectedHashes as Record<string, unknown> | undefined
  const loaded: LoadedModelSource[] = []
  for (const model of models) {
    const path = model.ibis_model_asset.project_relative_path
    let expected: string | undefined
    if (hashes !== undefined) {
      const pinned = hashes[path]
      const isSha256 =
        typeof pinned === "string" &&
        pinned.length === SHA256_HEX_LENGTH &&
        Array.from(pinned).every((char) => HEX_DIGITS.includes(char))
      if (!isSha256) {
        const requirement =
          "requires an expected 64-digit SHA-256 hash for each used IBIS asset"
        fail(
          "vendor_hash",
          `${path}: modeling.ibisModelAssetSha256 ${requirement}`,
        )
      }
      expected = pinned
    }
    const source = loadModelSource({ model, sources: ibisSources })
    if (
      expected !== undefined &&
      source.evidence.sourceSha256 !== expected.toLowerCase()
    )
      fail(
        "vendor_hash",
        `${path}: IBIS asset bytes differ from modeling.ibisModelAssetSha256`,
      )
    loaded.push(source)
  }
  const artifacts: Artifact[] = loaded.map((source) =>
    scope.text(source.evidence.ibsFile, source.text),
  )
  artifacts.push(
    scope.json(
      "vendor-sources.json",
      loaded.map((source) => source.evidence),
    ),
  )
  const value = {
    models: models.map((model) => ({ pipelineId: model.pipelineId })),
    sources: loaded,
  } as unknown as AdmittedBuffers
  return { value, artifacts }
}

/** Indexed source components and source ports for readable pin diagnostics. */
type CircuitPinLookup = {
  components: Map<
    SourceComponentBase["source_component_id"],
    SourceComponentBase
  >
  ports: Map<SourcePortId, SourcePort>
}

/** Index source components and ports from Circuit JSON when available. */
function circuitPinLookup(circuit: CircuitJson | undefined): CircuitPinLookup {
  const components = new Map<
    SourceComponentBase["source_component_id"],
    SourceComponentBase
  >()
  const ports = new Map<SourcePortId, SourcePort>()
  if (!circuit) return { components, ports }
  for (const record of circuit) {
    if (record.type === "source_component")
      components.set(record.source_component_id, record)
    if (record.type === "source_port") ports.set(record.source_port_id, record)
  }
  return { components, ports }
}

/** Format component, pin and IBIS signal names for an unbound run-state pin. */
function missingRunStatePinLabel({
  definition,
  sourceText,
  portId,
  physicalPin,
  sourceComponentId,
  lookup,
}: {
  definition: ModelRunDefinition["definition"]
  sourceText: string
  portId: SourcePortId
  physicalPin: string
  sourceComponentId: SimulationIbisModel["source_component_id"] | undefined
  lookup: CircuitPinLookup
}): string {
  let component: SourceComponentBase | undefined
  if (sourceComponentId !== undefined)
    component = lookup.components.get(sourceComponentId)
  const port = lookup.ports.get(portId)
  const ibisSignal =
    converter.parseIbis(sourceText).components[definition.component]?.pins[
      physicalPin
    ]?.signal
  const componentName = component?.name ?? definition.component
  let pinName = port?.name ?? physicalPin
  if (
    ibisSignal !== undefined &&
    port?.name === ibisSignal &&
    physicalPin !== ibisSignal &&
    port.port_hints?.includes(physicalPin) === true
  ) {
    pinName = physicalPin
  }
  let ibisLabel = physicalPin
  if (ibisSignal !== undefined && ibisSignal !== physicalPin) {
    if (pinName === physicalPin) ibisLabel = ibisSignal
    else if (pinName === ibisSignal) ibisLabel = physicalPin
    else ibisLabel = `${physicalPin} ${ibisSignal}`
  }
  return `${componentName}.${pinName} (IBIS ${ibisLabel})`
}

/** Replace raw source_port_id prefixes on missing_run_state errors with readable pin labels. */
function rethrowMissingRunState({
  error,
  definition,
  sourceText,
  sourceComponentId,
  lookup,
}: {
  error: unknown
  definition: ModelRunDefinition["definition"]
  sourceText: string
  sourceComponentId: SimulationIbisModel["source_component_id"] | undefined
  lookup: CircuitPinLookup
}): never {
  if (
    !(error instanceof converter.IbisError) ||
    error.code !== "missing_run_state"
  )
    throw error
  const entry = Object.entries(definition.pinMap).find(([, portId]) =>
    error.message.startsWith(`${portId}: `),
  )
  if (!entry) throw error
  const [physicalPin, rawPortId] = entry
  const prefix = `${rawPortId}: `
  const detail = error.message.slice(prefix.length)
  const label = missingRunStatePinLabel({
    definition,
    sourceText,
    portId: rawPortId as SourcePortId,
    physicalPin,
    sourceComponentId,
    lookup,
  })
  throw new converter.IbisError(
    "missing_run_state",
    `${label}: ${detail}; set ibisPinStates (e.g. { isOutput: false })`,
  )
}

/**
 * Convert each plan's models (plan order, then model order), exactly as today: `define` builds the
 * converter input (simulation's modelRunDefinition), its source is pinned to the admitted bytes,
 * then convertIbisModelToSpice runs. Missing run-state errors name the component, pin and IBIS signal.
 */
export function compileBuffers<
  M extends {
    pipelineId: string
    ibis_component_name: string
    source_component_id?: SimulationIbisModel["source_component_id"]
  },
  P extends { readonly models: readonly M[] },
>({
  admitted,
  plans,
  define,
  circuit,
}: {
  admitted: AdmittedBuffers
  plans: readonly P[]
  define: (input: { model: M; plan: P }) => ModelRunDefinition
  circuit?: CircuitJson
}): CompiledBuffersByPlan {
  const lookup = circuitPinLookup(circuit)
  return plans.map((plan) =>
    plan.models.map((model): CompiledBuffer => {
      const index = admitted.models.findIndex(
        (selected) => selected.pipelineId === model.pipelineId,
      )
      const definition = define({ model, plan })
      const source = admitted.sources[index]
      const input: ModelRunDefinition = {
        ...definition,
        definition: {
          ...definition.definition,
          source: {
            file: source.evidence.ibsFile,
            sha256: source.evidence.sourceSha256,
          },
        },
      }
      let result: converter.ConvertedGeneralIbisComponent
      try {
        result = converter.convertIbisModelToSpice(
          source.bytes,
          input.definition,
          input.run,
        )
      } catch (error) {
        rethrowMissingRunState({
          error,
          definition: input.definition,
          sourceText: source.text,
          sourceComponentId: model.source_component_id,
          lookup,
        })
      }
      return {
        ...result,
        name: model.ibis_component_name,
        pipelineId: model.pipelineId,
        input,
        sourceEvidence: admitted.sources[index].evidence,
      }
    }),
  )
}

/** One experiment's assembly evidence. Artifact: native-ibis-assembly.json under `experiment` (experiments/<id>). */
export function ibisAssembly({
  models,
  experiment,
}: {
  models: readonly CompiledBuffer[]
  experiment: ArtifactScope
}): Produced<AssemblyEntry[]> {
  const assembly: AssemblyEntry[] = models.map((model) => ({
    simulationIbisModelId: model.pipelineId,
    definition: model.input.definition,
    run: model.input.run,
    spicePinMapping: model.spicePinMapping,
    sourceSha256: model.sourceSha256,
    spiceSha256: sha256(model.source),
    sourceEvidence: model.sourceEvidence,
    metadata: model.metadata,
    warnings: model.warnings,
  }))
  return {
    value: assembly,
    artifacts: [experiment.json("native-ibis-assembly.json", assembly)],
  }
}
