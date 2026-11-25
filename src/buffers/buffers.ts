import * as converter from "@tscircuit/ibis-to-spice"
import {
  type Artifact,
  type ArtifactScope,
  type Produced,
  sha256,
} from "../kernel"
import { fail } from "./diagnostics"
import { convertIbisComponentWithPackage } from "./package-conversion"
import { loadModelSource } from "./source"

/** SHA-256 hashes are written as 64 hexadecimal digits. */
const SHA256_HEX_LENGTH = 64
const HEX_DIGITS = "0123456789abcdefABCDEF"

import type {
  AssemblyEntry,
  BufferModeling,
  CompiledIbisComponent,
  CompiledIbisComponentsByPlan,
  IbisSources,
  LoadedModelSource,
  ModelRunDefinition,
  ModelSourceRequest,
  ValidatedIbisSources,
} from "./types"
import { validatedSourcesBrand } from "./types"

/** Fails 'converter_version' when the pinned general converter API is unavailable. */
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
 * declaration order. Write the resolved inputs and source evidence under the artifact scope.
 */
export function validateIbisSources({
  models,
  ibisSources,
  modeling = {},
  scope,
}: {
  models: readonly ModelSourceRequest[]
  ibisSources: IbisSources
  modeling?: BufferModeling
  scope: ArtifactScope
}): Produced<ValidatedIbisSources> {
  assertConverter()
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
  const validated: ValidatedIbisSources = {
    [validatedSourcesBrand]: true,
    models: models.map((model) => ({ pipelineId: model.pipelineId })),
    sources: loaded,
  }
  return { value: validated, artifacts }
}

/**
 * Convert the IBIS components in plan order using their validated source bytes.
 */
export function compileBuffers<
  M extends {
    pipelineId: string
    ibis_component_name: string
  },
  P extends { readonly models: readonly M[] },
>({
  validated,
  plans,
  define,
}: {
  validated: ValidatedIbisSources
  plans: readonly P[]
  define: (input: { model: M; plan: P }) => ModelRunDefinition
}): CompiledIbisComponentsByPlan {
  return plans.map((plan) =>
    plan.models.map((model) => {
      const index = validated.models.findIndex(
        (selected) => selected.pipelineId === model.pipelineId,
      )
      const definition = define({ model, plan })
      const source = validated.sources[index]
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
      const sourceFile = source.evidence.ibisModelAsset.project_relative_path
      const result = convertIbisComponentWithPackage({
        bytes: source.bytes,
        input,
        sourceFile,
      })
      return {
        ...result,
        name: model.ibis_component_name,
        pipelineId: model.pipelineId,
        input,
        sourceEvidence: validated.sources[index].evidence,
      }
    }),
  )
}

/** One experiment's assembly evidence. Artifact: native-ibis-assembly.json under `experiment` (experiments/<id>). */
export function ibisAssembly({
  models,
  experiment,
}: {
  models: readonly CompiledIbisComponent[]
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
