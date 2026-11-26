/** Extents of an axis-aligned copper bound in board millimetres. */
export interface CopperBounds {
  xmin: number
  ymin: number
  xmax: number
  ymax: number
}

/** Bounds in board millimetres and the inclusive span of occupied layer indices. */
export interface CopperBox {
  xy: CopperBounds
  firstLayer: number
  lastLayer: number
}

/** Enclose all channel copper seeds in board XY. */
export function getChannelCopperBounds(
  boxes: readonly CopperBox[],
): CopperBounds | undefined {
  const [firstBox] = boxes
  if (!firstBox) return
  const bounds = { ...firstBox.xy }
  for (const { xy } of boxes) {
    bounds.xmin = Math.min(bounds.xmin, xy.xmin)
    bounds.ymin = Math.min(bounds.ymin, xy.ymin)
    bounds.xmax = Math.max(bounds.xmax, xy.xmax)
    bounds.ymax = Math.max(bounds.ymax, xy.ymax)
  }
  return bounds
}
