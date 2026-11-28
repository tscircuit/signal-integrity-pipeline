import type { PcbStackup } from "circuit-json"

/** Validate and read the external soldermask thickness. */
export function getSoldermaskThicknessMm(
  layers: PcbStackup["layers"],
): number | null {
  const masks = layers.filter((layer) => layer.layer_type === "soldermask")
  if (!masks.length) return null
  const [first, second] = masks
  if (masks.length === 1 && first.thickness === undefined) return null
  if (masks.length === 1 && first.thickness === 0) return 0
  if (
    masks.length !== 2 ||
    layers[0] !== first ||
    layers.at(-1) !== second ||
    first.thickness !== second.thickness
  ) {
    throw new Error(
      "Asymmetric soldermask thickness requires separate outer-layer material profiles",
    )
  }
  if (first.thickness === undefined) return null
  return first.thickness
}
