/**
 * kernel — the only module every other module may import.
 * Owns: the diagnostic model, artifact values + the single-writer ledger, safe ids,
 * hashing. No domain knowledge.
 * Imports: nothing in src/ except ../modules.generated (types only).
 */

export {
  type Artifact,
  ArtifactLedger,
  type ArtifactPath,
  type ArtifactScope,
  artifactPath,
  type FileMap,
  jsonBody,
  type Produced,
  rootScope,
} from "./artifacts"
export {
  Diagnostic,
  type DiagnosticInit,
  type DiagnosticSubject,
  diagnostics,
} from "./diagnostic"
export { sha256 } from "./hash"
export { hypotenuse } from "./hypotenuse"
export { type SafeId, safeId } from "./ids"

export { snapshot } from "./snapshot"
