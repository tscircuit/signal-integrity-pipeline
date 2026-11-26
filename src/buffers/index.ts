/**
 * Load and validate IBIS sources, inspect pin references, and convert components to SPICE.
 * Evidence includes the source hash, package matrices and switching waveform truncations.
 */

export {
  assertConverter,
  compileBuffers,
  ibisAssembly,
  validateIbisSources,
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
export { captureIbisSources, loadModelSource, relativeFile } from "./source"
export type {
  AssemblyEntry,
  BufferModeling,
  CompiledIbisComponent,
  IbisSources,
  LoadedModelSource,
  ModelRunDefinition,
  ModelSourceRequest,
  SourceEvidence,
  ValidatedIbisSources,
} from "./types"
