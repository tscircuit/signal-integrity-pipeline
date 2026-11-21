// Vendor model admission, conversion and assembly evidence.
import * as converter from "@tscircuit/ibis-to-spice"
import {
  type Artifact,
  type ArtifactScope,
  type Produced,
  sha256,
} from "../kernel"
import { fail } from "./diagnostics"
import { convertPackaged } from "./package"
import { loadModelSource } from "./source"
import type {
  AdmittedBuffers,
  AssemblyEntry,
  CompiledBuffer,
  CompiledBuffersByPlan,
  IbisSources,
  ModelRunDefinition,
  ModelSourceRequest,
} from "./types"

/**
 * Load every used model before any solver work, in
 * declaration order. Artifacts (under `scope`, the output root): inputs/ibis/<pipelineId>.ibs and
 * vendor-sources.json, byte-identical to today.
 */
export function admitBuffers({
  models,
  ibisSources,
  scope,
}: {
  models: readonly ModelSourceRequest[]
  ibisSources: IbisSources
  scope: ArtifactScope
}): Produced<AdmittedBuffers> {
  const loaded = models.map((model) =>
    loadModelSource({ model, sources: ibisSources }),
  )
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

/**
 * Convert each plan's models (plan order, then model order), exactly as today: `define` builds the
 * converter input (simulation's modelRunDefinition), its source is pinned to the admitted bytes,
 * then convertIbisModelToSpice runs. Pure; converter errors propagate unchanged.
 */
export function compileBuffers<
  M extends {
    pipelineId: string
    ibis_component_name: string
  },
  P extends { readonly models: readonly M[] },
>({
  admitted,
  plans,
  define,
}: {
  admitted: AdmittedBuffers
  plans: readonly P[]
  define: (input: { model: M; plan: P }) => ModelRunDefinition
}): CompiledBuffersByPlan {
  return plans.map((plan) =>
    plan.models.map((model) => {
      const index = admitted.models.findIndex(
        (selected) => selected.pipelineId === model.pipelineId,
      )
      const input = define({ model, plan })
      const source = admitted.sources[index]
      input.definition.source = {
        file: source.evidence.ibsFile,
        sha256: source.evidence.sourceSha256,
      }
      const sourceFile = source.evidence.ibisModelAsset.project_relative_path
      const result = convertPackaged({ bytes: source.bytes, input, sourceFile })
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
