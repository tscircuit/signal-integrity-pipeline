import type { SectionPanel } from './cross-section-types'

const quadrature = [
  [-.8611363115940526, .3478548451374538],
  [-.3399810435848563, .6521451548625461],
  [.3399810435848563, .6521451548625461],
  [.8611363115940526, .3478548451374538],
]

/** Antiderivative of log distance, including points on a source panel. */
function primitive(x: number, y: number): number {
  let correction = 0
  if (y) correction = Math.abs(y) * Math.atan(x / Math.abs(y))
  return x * Math.log(Math.hypot(x, y) || 1) - x + correction
}

/** Second antiderivative of log distance, for exact Galerkin integration of parallel panels. */
function secondPrimitive(x: number, y: number): number {
  const r = Math.hypot(x, y)
  let logarithm = 0
  let correction = 0
  if (r) logarithm = .5 * (x * x - y * y) * Math.log(r)
  if (y) correction = Math.abs(y) * x * Math.atan(x / Math.abs(y))
  return logarithm - .75 * x * x + correction
}

/** Normal derivative of the second primitive; the coplanar principal value is zero. */
function secondNormal(x: number, y: number): number {
  if (!y) return 0
  return Math.sign(y) * (x * Math.atan(x / Math.abs(y)) - Math.abs(y) * (Math.log(Math.hypot(x, y)) + .5))
}

/** Exact potential or upward field primitive at one endpoint pair. */
function parallelPrimitive(x: number, { v, tx, tz, normal }: { v: number; tx: number; tz: number; normal: boolean }): number {
  if (normal) return tz * primitive(x, v) + tx * secondNormal(x, v)
  return -secondPrimitive(x, v)
}

interface PanelPair { a: SectionPanel; b: SectionPanel }

/** Analytic source integral, with four-point target averaging, for the free-space logarithmic kernel. */
function freeKernel({ a, b, mirror, normal }: PanelPair & { mirror?: boolean; normal: boolean }): number {
  let tz = b.tz
  let sourceZ = b.z
  if (mirror) {
    tz = -tz
    sourceZ = -sourceZ
  }
  const dx = a.x - b.x
  const dz = a.z - sourceZ
  const parallel = Math.abs(a.tx * tz - a.tz * b.tx) < 1e-14
  if (parallel && Math.max(a.length, b.length) < 30 * Math.min(a.length, b.length) && Math.hypot(dx, dz) < 3 * Math.max(a.length, b.length)) {
    const u = dx * b.tx + dz * tz
    const v = -dx * tz + dz * b.tx
    const h = (a.length + b.length) / 2
    const d = (a.length - b.length) / 2
    const projection = { v, tx: b.tx, tz, normal }
    return (parallelPrimitive(u + h, projection) - parallelPrimitive(u + d, projection) - parallelPrimitive(u - d, projection) + parallelPrimitive(u - h, projection)) / (2 * Math.PI * a.length * b.length)
  }
  // For unequal potential panels, average over the shorter panel and integrate the longer one.
  if (!normal && !mirror && a.length > b.length) return freeKernel({ a: b, b: a, normal: false })
  let result = 0
  for (const [t, weight] of quadrature) {
    const dx = a.x + t * a.tx * a.length / 2 - b.x
    const dz = a.z + t * a.tz * a.length / 2 - sourceZ
    const u = dx * b.tx + dz * tz
    const v = -dx * tz + dz * b.tx
    const h = b.length / 2
    if (!normal) {
      const potential = -(primitive(u + h, v) - primitive(u - h, v)) / (2 * Math.PI * b.length)
      result += potential * weight / 2
      continue
    }
    const along = Math.log(Math.hypot(u + h, v) / Math.hypot(u - h, v)) / b.length
    let across = 0
    if (!(Math.abs(v) < 1e-15)) across = Math.sign(v) * (Math.atan((u + h) / Math.abs(v)) - Math.atan((u - h) / Math.abs(v))) / b.length
    const field = (tz * along + b.tx * across) / (2 * Math.PI)
    result += field * weight / 2
  }
  return result
}

/** Integrated free-space interaction before applying grounded-plane images. */
function directKernel({ a, b }: PanelPair, normal: boolean): number {
  if (a !== b) return freeKernel({ a, b, normal })
  if (normal) return 0
  return (-Math.log(a.length) + 1.5) / (2 * Math.PI)
}

/** Grounded half-space or exact two-plane Green function; no meshed planes or vertical truncation.
 * The logarithmic singularity is integrated analytically. Only the smooth two-plane correction
 * needs double quadrature. Dielectric rows request the upward normal electric field instead.
 */
export function sectionKernel({ a, b, height }: PanelPair & { height: number }): number {
  const normal = a.group < 0
  const self = directKernel({ a, b }, normal)
  if (!height) return self - freeKernel({ a, b, mirror: true, normal })
  if (Math.abs(a.x - b.x) - (a.length + b.length) / 2 > 200 * height) return 0
  const near = Math.hypot(a.x - b.x, a.z - b.z) < 2 * (a.length + b.length)
  let result = 0
  if (near) result = self
  for (const [ta, wa] of quadrature) for (const [tb, wb] of quadrature) {
    const dx = a.x + ta * a.tx * a.length / 2 - b.x - tb * b.tx * b.length / 2
    const za = a.z + ta * a.tz * a.length / 2
    const zb = b.z + tb * b.tz * b.length / 2
    const dz = za - zb
    const u = Math.PI * dx / height
    const v = Math.PI * dz / height
    const s = Math.PI * (za + zb) / height
    const denominator = 2 * (Math.sinh(u / 2) ** 2 + Math.sin(v / 2) ** 2)
    const difference = 2 * Math.sin(Math.PI * za / height) * Math.sin(Math.PI * zb / height)
    const numerator = denominator + difference
    const coincident = dx === 0 && dz === 0
    if (normal) {
      let field = (Math.sin(v) / denominator - Math.sin(s) / numerator) / (4 * height)
      if (near) field -= dz / (2 * Math.PI * (dx * dx + dz * dz))
      if (coincident) field = -Math.sin(s) / (4 * height * numerator)
      result += wa * wb * field / 4
      continue
    }
    let potential = Math.log1p(difference / denominator) / (4 * Math.PI)
    if (near) potential -= -Math.log(Math.hypot(dx, dz)) / (2 * Math.PI)
    if (coincident) potential = Math.log(numerator * 2 * (height / Math.PI) ** 2) / (4 * Math.PI)
    result += wa * wb * potential / 4
  }
  return result
}
