/**
 * buffers — IBIS driver/receiver models as SPICE.
 * Owns: IbisSources admission (path safety, ZIP/HTML rejection, UTF-8), SHA-256 pinning
 * (modeling.ibisModelAssetSha256), the pinned @tscircuit/ibis-to-spice converter, compiled
 * libraries and their evidence, plus inspection of IBIS pin bindings, references and capabilities.
 * Order (today's runPipeline): assertConverter -> admitBuffers (pure checks, no solver work) ->
 * compileBuffers -> per experiment ibisAssembly.
 * compileBuffers takes AdmittedBuffers so only checked bytes reach the converter.
 * Artifacts: inputs/ibis/<id>.ibs, vendor-sources.json, experiments/<id>/native-ibis-assembly.json.
 * The `<id>.lib` bytes are CompiledBuffer.source; simulation hands them to ngspice (solver records them).
 * Imports: kernel, board (types). (Was: model-source.ts, IBIS parts of general-pipeline.ts.)
 */

export {
  admitBuffers,
  assertConverter,
  compileBuffers,
  ibisAssembly,
} from "./buffers"
export { edgeDurationSeconds } from "./edge-duration"
export type {
  InspectedPin,
  InspectedPins,
  PinCapabilities,
  ReferencePorts,
  ReferenceVoltages,
} from "./inspect"
export {
  inspectPins,
  pinCapabilities,
  referenceVoltages,
} from "./inspect"
export { failInvalidIbisSource, loadModelSource, relativeFile } from "./source"
export type {
  AdmittedBuffers,
  AssemblyEntry,
  BufferModeling,
  CompiledBuffer,
  IbisSources,
  LoadedModelSource,
  ModelRunDefinition,
  ModelSourceRequest,
  SourceEvidence,
} from "./types"
