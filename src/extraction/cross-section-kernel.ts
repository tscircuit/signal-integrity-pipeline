import atan from "@stdlib/math-base-special-atan"
import log from "@stdlib/math-base-special-ln"
import log1p from "@stdlib/math-base-special-log1p"
import sin from "@stdlib/math-base-special-sin"
import sinh from "@stdlib/math-base-special-sinh"
import { hypotenuse } from "../kernel"
import type { SectionPanel } from "./cross-section-types"

/** Four-point Gauss–Legendre nodes and weights on the interval [-1, 1]. */
const quadrature = [
  [-0.8611363115940526, 0.3478548451374538],
  [-0.3399810435848563, 0.6521451548625461],
  [0.3399810435848563, 0.6521451548625461],
  [0.8611363115940526, 0.3478548451374538],
]

/** Cross-product tolerance for deciding whether the panel directions are parallel. */
const PARALLEL_TOLERANCE = 1e-14

/** Length ratio and separation limits for the analytic parallel-panel integral. */
const MAX_PARALLEL_LENGTH_RATIO = 30
/** Separation in units of the longer panel length. */
const MAX_PARALLEL_SEPARATION = 3

/** The coplanar limit of the across-panel field is zero. */
const COPLANAR_TOLERANCE = 1e-15

/** Two-plane interactions at greater horizontal separation than this have negligible weight. */
const MAX_SEPARATION_IN_PLANE_HEIGHTS = 200

/** Keep the analytic singularity correction within this many combined panel lengths. */
const NEAR_PANEL_LENGTHS = 2

/** Integrated log singularity across a panel's own length. */
const SELF_LOG_INTEGRAL = 1.5

/** Antiderivative of log distance, including points on a source panel. */
function primitive({ x, y }: { x: number; y: number }): number {
  let correction = 0
  if (y) correction = Math.abs(y) * atan(x / Math.abs(y))
  return x * log(hypotenuse(x, y) || 1) - x + correction
}

/** Second antiderivative of log distance, for exact Galerkin integration of parallel panels. */
function secondPrimitive({ x, y }: { x: number; y: number }): number {
  const r = hypotenuse(x, y)
  let logarithm = 0
  let correction = 0
  if (r) logarithm = 0.5 * (x * x - y * y) * log(r)
  if (y) correction = Math.abs(y) * x * atan(x / Math.abs(y))
  return logarithm - 0.75 * x * x + correction
}

/** Normal derivative of the second primitive; the coplanar principal value is zero. */
function secondNormal({ x, y }: { x: number; y: number }): number {
  if (!y) return 0
  return (
    Math.sign(y) *
    (x * atan(x / Math.abs(y)) - Math.abs(y) * (log(hypotenuse(x, y)) + 0.5))
  )
}

/** Exact potential or upward field primitive at one endpoint pair. */
function parallelPrimitive({
  x,
  v,
  tx,
  tz,
  normal,
}: {
  x: number
  v: number
  tx: number
  tz: number
  normal: boolean
}): number {
  if (normal)
    return tz * primitive({ x, y: v }) + tx * secondNormal({ x, y: v })
  return -secondPrimitive({ x, y: v })
}

/** Target and source panels for the kernel interaction. */
interface PanelPair {
  a: SectionPanel
  b: SectionPanel
}

/** Analytic source integral, with four-point target averaging, for the free-space logarithmic kernel. */
function freeKernel({
  a,
  b,
  mirror,
  normal,
}: PanelPair & {
  mirror?: boolean
  normal: boolean
}): number {
  let tz = b.tz
  let sourceZ = b.z
  if (mirror) {
    tz = -tz
    sourceZ = -sourceZ
  }
  const dx = a.x - b.x
  const dz = a.z - sourceZ
  const parallel = Math.abs(a.tx * tz - a.tz * b.tx) < PARALLEL_TOLERANCE
  const longer = Math.max(a.length, b.length)
  const comparable =
    longer < MAX_PARALLEL_LENGTH_RATIO * Math.min(a.length, b.length)
  if (
    parallel &&
    comparable &&
    hypotenuse(dx, dz) < MAX_PARALLEL_SEPARATION * longer
  ) {
    const u = dx * b.tx + dz * tz
    const v = -dx * tz + dz * b.tx
    const h = (a.length + b.length) / 2
    const d = (a.length - b.length) / 2
    const projection = {
      v,
      tx: b.tx,
      tz,
      normal,
    }
    const high =
      parallelPrimitive({ x: u + h, ...projection }) -
      parallelPrimitive({ x: u + d, ...projection })
    const low = parallelPrimitive({ x: u - d, ...projection })
    const end = parallelPrimitive({ x: u - h, ...projection })
    return (high - low + end) / (2 * Math.PI * a.length * b.length)
  }
  // For unequal potential panels, average over the shorter panel and integrate the longer one.
  if (!normal && !mirror && a.length > b.length)
    return freeKernel({ a: b, b: a, normal: false })
  let result = 0
  for (const [t, weight] of quadrature) {
    const dx = a.x + (t * a.tx * a.length) / 2 - b.x
    const dz = a.z + (t * a.tz * a.length) / 2 - sourceZ
    const u = dx * b.tx + dz * tz
    const v = -dx * tz + dz * b.tx
    const h = b.length / 2
    if (!normal) {
      const potential =
        -(primitive({ x: u + h, y: v }) - primitive({ x: u - h, y: v })) /
        (2 * Math.PI * b.length)
      result += (potential * weight) / 2
      continue
    }
    const along = log(hypotenuse(u + h, v) / hypotenuse(u - h, v)) / b.length
    let across = 0
    const separation = Math.abs(v)
    if (!(separation < COPLANAR_TOLERANCE)) {
      const angle = atan((u + h) / separation) - atan((u - h) / separation)
      across = (Math.sign(v) * angle) / b.length
    }
    const field = (tz * along + b.tx * across) / (2 * Math.PI)
    result += (field * weight) / 2
  }
  return result
}

/** Integrated free-space interaction before applying grounded-plane images. */
function directKernel({
  a,
  b,
  normal,
}: PanelPair & { normal: boolean }): number {
  if (a !== b) return freeKernel({ a, b, normal })
  if (normal) return 0
  return (-log(a.length) + SELF_LOG_INTEGRAL) / (2 * Math.PI)
}

/** Grounded half-space or exact two-plane Green function; no meshed planes or vertical truncation.
 * The logarithmic singularity is integrated analytically. Only the smooth two-plane correction
 * needs double quadrature. Dielectric rows request the upward normal electric field instead.
 */
export function sectionKernel({
  a,
  b,
  height,
}: PanelPair & { height: number }): number {
  const normal = a.group < 0
  const self = directKernel({ ...{ a, b }, normal })
  if (!height) {
    return (
      self -
      freeKernel({
        a,
        b,
        mirror: true,
        normal,
      })
    )
  }
  const horizontalGap = Math.abs(a.x - b.x) - (a.length + b.length) / 2
  if (horizontalGap > MAX_SEPARATION_IN_PLANE_HEIGHTS * height) return 0
  const near =
    hypotenuse(a.x - b.x, a.z - b.z) <
    NEAR_PANEL_LENGTHS * (a.length + b.length)
  let result = 0
  if (near) result = self
  for (const [ta, wa] of quadrature) {
    for (const [tb, wb] of quadrature) {
      const dx =
        a.x + (ta * a.tx * a.length) / 2 - b.x - (tb * b.tx * b.length) / 2
      const za = a.z + (ta * a.tz * a.length) / 2
      const zb = b.z + (tb * b.tz * b.length) / 2
      const dz = za - zb
      const u = (Math.PI * dx) / height
      const v = (Math.PI * dz) / height
      const s = (Math.PI * (za + zb)) / height
      const denominator = 2 * (sinh(u / 2) ** 2 + sin(v / 2) ** 2)
      const difference =
        2 * sin((Math.PI * za) / height) * sin((Math.PI * zb) / height)
      const numerator = denominator + difference
      const coincident = dx === 0 && dz === 0
      if (normal) {
        let field = (sin(v) / denominator - sin(s) / numerator) / (4 * height)
        if (near) field -= dz / (2 * Math.PI * (dx * dx + dz * dz))
        if (coincident) field = -sin(s) / (4 * height * numerator)
        result += (wa * wb * field) / 4
        continue
      }
      let potential = log1p(difference / denominator) / (4 * Math.PI)
      if (near) potential -= -log(hypotenuse(dx, dz)) / (2 * Math.PI)
      if (coincident)
        potential = log(numerator * 2 * (height / Math.PI) ** 2) / (4 * Math.PI)
      result += (wa * wb * potential) / 4
    }
  }
  return result
}
