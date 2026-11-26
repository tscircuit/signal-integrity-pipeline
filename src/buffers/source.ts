// Was src/model-source.ts. Messages and codes are byte-identical.
import { sha256 } from "../kernel"
import { fail } from "./diagnostics"
import type {
  IbisSources,
  LoadedModelSource,
  ModelSourceRequest,
} from "./types"

/** NUL is invalid in a file path. */
const NULL_CHARACTER = "\0"

/** ASCII characters that can continue a word after an HTML tag name. */
const WORD_CHARACTERS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_"

/** HTML tag used to identify assets served as HTML instead of model data. */
const HTML_OPENING_TAG = "<html"

/** ZIP archive headers begin with the ASCII characters P and K. */
const ZIP_SIGNATURE = [0x50, 0x4b]

/** Portable relative paths used by the explicit Node adapter as well as file maps. */
export function relativeFile(path: string): string {
  const invalidPath =
    !path ||
    ["\\", ":", NULL_CHARACTER].some((character) => path.includes(character)) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  if (invalidPath) {
    fail("file_path", `Expected a safe project-relative file path: ${path}`)
  }
  return path
}

/** Detects common HTML document openings in place of IBIS text. */
function containsHtmlOpening(text: string): boolean {
  let opening = text.trimStart()
  if (opening.slice(0, "<!doctype".length).toLowerCase() === "<!doctype") {
    const rest = opening.slice("<!doctype".length)
    if (rest === rest.trimStart()) return false
    opening = `<${rest.trimStart()}`
  }
  if (
    opening.slice(0, HTML_OPENING_TAG.length).toLowerCase() !== HTML_OPENING_TAG
  )
    return false
  const next = opening[HTML_OPENING_TAG.length] ?? ""
  return next === "" || !WORD_CHARACTERS.includes(next)
}

/** Report an asset value whose runtime type cannot contain IBIS text or bytes. */
export function failInvalidIbisSource(path: string): never {
  return fail("ibis_asset", `${path}: expected a string or Uint8Array`)
}

/**
 * Admits the caller-supplied IBIS bytes for one model: checks the path, format and UTF-8 text,
 * then records the SHA-256 evidence. Nothing is ever downloaded from the declared URL.
 */
export function loadModelSource({
  model,
  sources,
}: {
  model: ModelSourceRequest
  sources: IbisSources
}): LoadedModelSource {
  const asset = model.ibis_model_asset
  const path = relativeFile(asset.project_relative_path)
  if (!sources || !Object.hasOwn(sources, path))
    fail("ibis_asset_missing", `Supply IBIS bytes for ${path} in ibisSources`)
  const source = sources[path]
  if (typeof source !== "string" && !(source instanceof Uint8Array))
    failInvalidIbisSource(path)
  let bytes: Uint8Array
  if (typeof source === "string") {
    bytes = new TextEncoder().encode(source)
  } else {
    bytes = source
  }
  if (ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    fail(
      "ibis_asset",
      "IBIS asset must be a plain .ibs file; extract ZIP archives explicitly",
    )
  }
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes)
  if (containsHtmlOpening(text))
    fail("ibis_asset", "IBIS asset contains HTML instead of model data")
  const id = model.pipelineId
  const sourceSha256 = sha256(bytes)
  const ibsFile = `inputs/ibis/${id}.ibs`
  return {
    text,
    bytes,
    evidence: {
      simulationIbisModelId: id,
      ibisModelAsset: asset,
      resolvedFrom: "provided",
      ibsFile,
      sourceSha256,
      rawSourceFile: ibsFile,
      rawSourceSha256: sourceSha256,
    },
  }
}
