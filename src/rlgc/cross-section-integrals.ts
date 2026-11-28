/// <reference path="./stdlib-math.d.ts" />
import atan from "@stdlib/math/base/special/atan/lib/index.js"
import log from "@stdlib/math/base/special/ln/lib/index.js"
import { hypotenuse } from "../kernel"

/** Antiderivative of log distance, including points on a source panel. */
export function evaluateLogDistanceIntegral({
  x,
  y,
}: {
  x: number
  y: number
}): number {
  let correction = 0
  if (y) correction = Math.abs(y) * atan(x / Math.abs(y))
  return x * log(hypotenuse(x, y) || 1) - x + correction
}

/** Second antiderivative of log distance, for exact Galerkin integration of parallel panels. */
function evaluateLogDistanceDoubleIntegral({
  x,
  y,
}: {
  x: number
  y: number
}): number {
  const r = hypotenuse(x, y)
  let logarithm = 0
  let correction = 0
  if (r) logarithm = 0.5 * (x * x - y * y) * log(r)
  if (y) correction = Math.abs(y) * x * atan(x / Math.abs(y))
  return logarithm - 0.75 * x * x + correction
}

/** Normal derivative of the second primitive; the coplanar principal value is zero. */
function evaluateNormalFieldDoubleIntegral({
  x,
  y,
}: {
  x: number
  y: number
}): number {
  if (!y) return 0
  return (
    Math.sign(y) *
    (x * atan(x / Math.abs(y)) - Math.abs(y) * (log(hypotenuse(x, y)) + 0.5))
  )
}

/** Exact potential or upward field primitive at one endpoint pair. */
export function evaluateParallelPanelIntegral({
  x,
  v,
  tangentX,
  tangentZ,
  isNormalField,
}: {
  x: number
  v: number
  tangentX: number
  tangentZ: number
  isNormalField: boolean
}): number {
  if (isNormalField)
    return (
      tangentZ * evaluateLogDistanceIntegral({ x, y: v }) +
      tangentX * evaluateNormalFieldDoubleIntegral({ x, y: v })
    )
  return -evaluateLogDistanceDoubleIntegral({ x, y: v })
}
