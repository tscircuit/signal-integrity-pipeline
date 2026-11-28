import type {
  ConvertedGeneralIbisComponent,
  IbisConversionMetadata,
  IbisModelDefinition,
  IbisRunConfig,
} from "@tscircuit/ibis-to-spice"
import type { SimulationIbisModel } from "../board"
export interface BufferModeling {
  ibisModelAssetSha256?: Record<string, string>
}

export type IbisSources = Record<string, Uint8Array | string>
/** What loading needs from a declared model (today's `Pick<SimulationIbisModel,'ibis_model_asset'> & {pipelineId}`). */
export type ModelSourceRequest = Pick<
  SimulationIbisModel,
  "ibis_model_asset"
> & { pipelineId: string }
/** Converter input for one model in one experiment (was declarations.ts ModelRunDefinition). */
export interface ModelRunDefinition {
  definition: IbisModelDefinition
  run: IbisRunConfig
}

/** One `vendor-sources.json` entry. Key order is serialized. */
export interface SourceEvidence {
  simulationIbisModelId: string
  ibisModelAsset: SimulationIbisModel["ibis_model_asset"]
  resolvedFrom: "provided"
  ibsFile: string
  sourceSha256: string
  rawSourceFile: string
  rawSourceSha256: string
}
/** Today's loadModelSource return value. */
export interface LoadedModelSource {
  text: string
  bytes: Uint8Array
  evidence: SourceEvidence
}

export const validatedSourcesBrand: unique symbol = Symbol(
  "validated IBIS sources",
)
/** Every used model loaded and decoded, in declaration order. Only validateIbisSources builds one. */
export interface ValidatedIbisSources {
  readonly [validatedSourcesBrand]: true
  readonly models: readonly { readonly pipelineId: string }[]
  readonly sources: readonly LoadedModelSource[]
}

/** Compiled buffers grouped by experiment, in plan and model order. */
export type CompiledIbisComponentsByPlan = CompiledIbisComponent[][]

/** Today's per-plan compiled model: the converter result plus pipeline identity and inputs. */
export type CompiledIbisComponent = ConvertedGeneralIbisComponent & {
  name: string
  pipelineId: string
  input: ModelRunDefinition
  sourceEvidence: SourceEvidence
}

/**
 * One `experiments/<id>/native-ibis-assembly.json` entry (and PipelineResult.experiments[].assembly). Key
 * order is serialized.
 */
export interface AssemblyEntry {
  simulationIbisModelId: string
  definition: IbisModelDefinition
  run: IbisRunConfig
  spicePinMapping: Record<string, string>
  sourceSha256: string | undefined
  spiceSha256: string
  sourceEvidence: SourceEvidence
  metadata: IbisConversionMetadata
  warnings: string[]
}
