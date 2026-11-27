import { LIGHT_SPEED } from "./cross-section"

/** Vacuum impedance in ohms, from the reference formulas. */
const VACUUM_IMPEDANCE = 376.730313668

/** Vacuum permittivity in farads per meter, CODATA 2018. */
const VACUUM_PERMITTIVITY = 8.8541878128e-12

/** Number of image terms in the independent thin-sheet calculation. */
const IMAGE_TERMS = 64

/** Default panel count for the independent thin-sheet reference. */
const IMAGE_PANELS = 32

/** Modal impedances and mutual per-unit-length terms in a homogeneous dielectric. */
interface CoupledLine {
  ze: number
  zo: number
  l12: number
  c12: number
}

/** Modal impedances and effective permittivities for coupled microstrip. */
interface CoupledMicrostrip extends CoupledLine {
  ee: number
  eo: number
}

/** Width and gap normalized to substrate height, with relative permittivity. */
interface MicrostripGeometry {
  width: number
  gap: number
  er: number
}

/** Hammerstad–Jensen single-line dielectric filling factor. */
function fillingFactor({ u, er }: { u: number; er: number }): number {
  const a =
    1 +
    Math.log((u ** 4 + (u / 52) ** 2) / (u ** 4 + 0.432)) / 49 +
    Math.log(1 + (u / 18.1) ** 3) / 18.7
  const b = 0.564 * ((er - 0.9) / (er + 3)) ** 0.053
  return (1 + 10 / u) ** (-a * b)
}

/** Independent Hammerstad–Jensen quasi-static oracle, Qucs technical manual eqs. 11.156–11.176.
 * https://qucs.sourceforge.net/tech/node77.html (Hammerstad & Jensen, MTT-S 1980). */
export function coupledMicrostrip({
  width: w,
  gap,
  er,
}: MicrostripGeometry): CoupledMicrostrip {
  const eta = VACUUM_IMPEDANCE
  const f = 6 + (2 * Math.PI - 6) * Math.exp(-((30.666 / w) ** 0.7528))
  const zair =
    (eta / (2 * Math.PI)) * Math.log(f / w + Math.sqrt(1 + (2 / w) ** 2))
  const psi = 1 + gap / 1.45 + gap ** 2.09 / 3.95
  const alpha = 0.5 * Math.exp(-gap)
  const m =
    0.2175 +
    (4.113 + (20.36 / gap) ** 6) ** -0.251 +
    Math.log(gap ** 10 / (1 + (gap / 13.8) ** 10)) / 323
  const phie =
    (0.8645 * w ** 0.172) / (psi * (alpha * w ** m + (1 - alpha) * w ** -m))
  const theta =
    1.729 + 1.175 * Math.log(1 + 0.627 / (gap + 0.327 * gap ** 2.17))
  const beta =
    0.2306 +
    Math.log(gap ** 10 / (1 + (gap / 3.73) ** 10)) / 301.8 +
    Math.log(1 + 0.646 * gap ** 1.175) / 5.3
  const exponent = -6.424 - 0.76 * Math.log(gap) - (gap / 0.23) ** 5
  const n =
    (1 / 17.7 + Math.exp(exponent)) *
    Math.log((10 + 68.3 * gap ** 2) / (1 + 32.5 * gap ** 3.093))
  const phio = phie - (theta / psi) * Math.exp(beta * w ** -n * Math.log(w))
  const mu = gap * Math.exp(-gap) + (w * (20 + gap ** 2)) / (10 + gap ** 2)
  const r = 1 + 0.15 * (1 - Math.exp(1 - (er - 1) ** 2 / 8.2) / (1 + gap ** -6))
  const fo1 =
    1 -
    Math.exp(
      -0.179 * gap ** 0.15 -
        (0.328 * gap ** r) / Math.log(Math.E + (gap / 7) ** 2.8),
    )
  const p = Math.exp(-0.745 * gap ** 0.295) / Math.cosh(gap ** 0.68)
  const q = Math.exp(-1.366 - gap)
  const fo =
    fo1 * Math.exp(p * Math.log(w) + q * Math.sin(Math.PI * Math.log10(w)))
  const ee = (er + 1) / 2 + ((er - 1) / 2) * fillingFactor({ u: mu, er })
  const eo = (er + 1) / 2 + ((er - 1) / 2) * fo * fillingFactor({ u: w, er })
  const zae = zair / (1 - (zair * phie) / eta)
  const zao = zair / (1 - (zair * phio) / eta)
  return {
    ze: zae / Math.sqrt(ee),
    zo: zao / Math.sqrt(eo),
    ee,
    eo,
    l12: (zae - zao) / (2 * LIGHT_SPEED),
    c12: (ee / zae - eo / zao) / (2 * LIGHT_SPEED),
  }
}
/** Complete elliptic integral by the arithmetic–geometric mean; no attempt cap. */
function elliptic(k: number): number {
  let a = 1
  let b = Math.sqrt(1 - k * k)
  while (Math.abs(a - b) > Number.EPSILON * a) {
    const next = (a + b) / 2
    b = Math.sqrt(a * b)
    a = next
  }
  return Math.PI / (2 * a)
}
/** Cohn homogeneous even/odd characteristic impedance. */
function striplineMode(k: number): number {
  return ((VACUUM_IMPEDANCE / 4) * elliptic(Math.sqrt(1 - k * k))) / elliptic(k)
}

/** Exact thin edge-coupled stripline conformal map, S. B. Cohn, IRE MTT-3 (1955), pp. 29–38.
 * Primary implementation/reference: https://wcalc.sourceforge.net/coupled_stripline.html
 * b is ground-plane separation. At large separation, both modes approach the isolated stripline.
 */
export function coupledStripline({
  width: w,
  gap,
  planeSpacing: b,
  er,
}: {
  width: number
  gap: number
  planeSpacing: number
  er: number
}): CoupledLine {
  const t = Math.tanh((Math.PI * (w + gap)) / (2 * b))
  const widthTerm = Math.tanh((Math.PI * w) / (2 * b))
  const ze = striplineMode(widthTerm * t)
  const zo = striplineMode(widthTerm / t)
  return {
    ze: ze / Math.sqrt(er),
    zo: zo / Math.sqrt(er),
    l12: (ze - zo) / (2 * LIGHT_SPEED),
    c12: (er * (1 / ze - 1 / zo)) / (2 * LIGHT_SPEED),
  }
}

/** Arithmetic–geometric mean. Evaluates K(k)/K(k') as AGM(1, k)/AGM(1, k') to avoid 1 - k^2 cancellation. */
function agm(a: number, b: number): number {
  while (Math.abs(a - b) > Number.EPSILON * a)
    [a, b] = [(a + b) / 2, Math.sqrt(a * b)]
  return a
}

/** Centred stripline impedance in ohms and capacitance per meter. */
interface StriplineReference {
  z: number
  capacitance: number
}

/** Exact zero-thickness centred stripline, S. B. Cohn, "Characteristic impedance of the shielded-strip
 * transmission line", IRE Trans. MTT-2 (1954), pp. 52–57: Z0 = eta0/(4 sqrt(er)) K(k)/K(k'), k = sech(pi w/2b)
 * (the familiar 30 pi is eta0/4 with eta0 ~ 120 pi). Per-unit-length C = sqrt(er)/(c Z0) = 4 eps0 er K(k')/K(k).
 * w and b share any length unit; capacitance is in F/m.
 */
export function stripline({
  w,
  b,
  er,
}: {
  w: number
  b: number
  er: number
}): StriplineReference {
  const x = (Math.PI * w) / (2 * b)
  const ratio = agm(1, 1 / Math.cosh(x)) / agm(1, Math.tanh(x))
  return {
    z: (VACUUM_IMPEDANCE / (4 * Math.sqrt(er))) * ratio,
    capacitance: (4 * VACUUM_PERMITTIVITY * er) / ratio,
  }
}

/** Wheeler incremental-inductance stripline conductor loss as tabulated by D. M. Pozar, Microwave Engineering,
 * 4th ed., section 3.7 (Cohn thick-strip fit):
 * alpha_c = 2.7e-3 Rs er Z0 A / (30 pi (b - t)) Np/m when sqrt(er) Z0 < 120 ohm,
 * A = 1 + 2W/(b - t) + (b + t)/(pi (b - t)) ln((2b - t)/t), with Pozar's own Z0 = 30 pi b/(sqrt(er) (We + 0.441 b)).
 * Returns alpha_c in Np/m. Lengths in metres; a curve fit, never an exact reference.
 */
export function pozarStriplineAttenuation({
  w,
  b,
  t,
  er,
  surfaceResistance,
}: {
  w: number
  b: number
  t: number
  er: number
  surfaceResistance: number
}): number {
  let effective = w
  if (!(w / b >= 0.35)) effective = w - b * (0.35 - w / b) ** 2
  const z = (30 * Math.PI * b) / (Math.sqrt(er) * (effective + 0.441 * b))
  if (Math.sqrt(er) * z >= 120)
    throw new Error("Pozar narrow-strip branch is not implemented")
  const a =
    1 +
    (2 * w) / (b - t) +
    ((b + t) / (Math.PI * (b - t))) * Math.log((2 * b - t) / t)
  return (2.7e-3 * surfaceResistance * er * z * a) / (30 * Math.PI * (b - t))
}

/** Isolated line impedance and effective relative permittivity. */
interface MicrostripReference {
  z: number
  ee: number
}

/** Hammerstad–Jensen single microstrip, Qucs equations 11.4–11.7 and 11.15–11.16; dimensions normalized to h. */
export function singleMicrostrip({
  u,
  er,
}: {
  u: number
  er: number
}): MicrostripReference {
  const ee = (er + 1) / 2 + ((er - 1) / 2) * fillingFactor({ u, er })
  const f = 6 + (2 * Math.PI - 6) * Math.exp(-((30.666 / u) ** 0.7528))
  const z =
    ((VACUUM_IMPEDANCE / (2 * Math.PI)) *
      Math.log(f / u + Math.sqrt(1 + (2 / u) ** 2))) /
    Math.sqrt(ee)
  return { z, ee }
}

/** Twice-integrated log distance for the independent thin-sheet image reference. */
function imagePrimitive({ x, y }: { x: number; y: number }): number {
  let correction = 0
  if (y) correction = Math.abs(y) * x * Math.atan(x / Math.abs(y))
  return (
    0.5 * (x * x - y * y) * Math.log(Math.hypot(x, y) || 1) -
    0.75 * x * x +
    correction
  )
}

/** Integrate one direct or image sheet's potential over both intervals. */
function imagePotential({
  y,
  u,
  h,
  d,
  area,
}: {
  y: number
  u: number
  h: number
  d: number
  area: number
}): number {
  const high = imagePrimitive({ x: u + h, y }) - imagePrimitive({ x: u + d, y })
  return (
    (high - imagePrimitive({ x: u - d, y }) + imagePrimitive({ x: u - h, y })) /
    area
  )
}

/** Grounded capacitance coefficients from the independent thin-sheet reference. */
type ImageCapacitance = number[][]

/** Independent thin-sheet layered Green reference (h=1):
 * G(x) = [-log|x| + (1+r) sum((-r)^(n-1) log(hypot(x,2n)))]/[pi*(er+1)],
 * r=(er-1)/(er+1). It sums dielectric images analytically, without interface panels.
 * See https://www.polarinstruments.com/support/cits/AP135.html and Chew, section 7.1.1,
 * https://wcchew.ece.illinois.edu/chew/course/tgwAll20160215.pdf .
 */
export function imageMicrostrip({
  width: w,
  gap,
  er,
  count = IMAGE_PANELS,
}: MicrostripGeometry & {
  count?: number
}): ImageCapacitance {
  const r = (er - 1) / (er + 1)
  const panels = [0, 1].flatMap((group) =>
    Array.from({ length: count }, (_, i) => {
      const low = (1 - Math.cos((Math.PI * i) / count)) / 2
      const high = (1 - Math.cos((Math.PI * (i + 1)) / count)) / 2
      return {
        x: (group - 0.5) * (w + gap) + w * ((low + high) / 2 - 0.5),
        length: w * (high - low),
        group,
      }
    }),
  )
  const a = panels.map((q) =>
    panels.map((t) => {
      const u = q.x - t.x
      const h = (q.length + t.length) / 2
      const d = (q.length - t.length) / 2
      const intervals = {
        u,
        h,
        d,
        area: q.length * t.length,
      }
      let potential = -imagePotential({ y: 0, ...intervals })
      for (let n = 1; n <= IMAGE_TERMS; n++) {
        potential +=
          (1 + r) * (-r) ** (n - 1) * imagePotential({ y: 2 * n, ...intervals })
      }
      return potential / (Math.PI * (er + 1))
    }),
  )
  const rightHandSides = panels.map((q) => [
    Number(q.group === 0),
    Number(q.group === 1),
  ])
  // Independent small SPD elimination; deliberately does not import the production linear algebra.
  for (let k = 0; k < panels.length; k++) {
    for (let i = k + 1; i < panels.length; i++) {
      const factor = a[i][k] / a[k][k]
      for (let j = k + 1; j < panels.length; j++) a[i][j] -= factor * a[k][j]
      for (let j = 0; j < 2; j++)
        rightHandSides[i][j] -= factor * rightHandSides[k][j]
    }
  }
  for (let i = panels.length - 1; i >= 0; i--) {
    for (let j = 0; j < 2; j++) {
      for (let k = i + 1; k < panels.length; k++)
        rightHandSides[i][j] -= a[i][k] * rightHandSides[k][j]
      rightHandSides[i][j] /= a[i][i]
    }
  }
  return [0, 1].map((i) =>
    [0, 1].map((j) =>
      panels.reduce((potential, q, k) => {
        let contribution = 0
        if (q.group === i)
          contribution = VACUUM_PERMITTIVITY * rightHandSides[k][j]
        return potential + contribution
      }, 0),
    ),
  )
}

/** Hammerstad–Jensen finite-thickness correction, Qucs 11.22–11.25; dimensions normalized to substrate height. */
export function thickMicrostrip({
  width: u,
  er,
  thickness,
}: {
  width: number
  er: number
  thickness: number
}): MicrostripReference {
  const du =
    (thickness / Math.PI) *
    Math.log(
      1 + (4 * Math.E) / (thickness / Math.tanh(Math.sqrt(6.517 * u)) ** 2),
    )
  const mixed = (du / 2) * (1 + 1 / Math.cosh(Math.sqrt(er - 1)))
  const vacuum = singleMicrostrip({ u: u + du, er: 1 }).z
  const dielectric = singleMicrostrip({ u: u + mixed, er: 1 }).z
  const line = singleMicrostrip({ u: u + mixed, er })
  return { z: line.z, ee: line.ee * (vacuum / dielectric) ** 2 }
}
