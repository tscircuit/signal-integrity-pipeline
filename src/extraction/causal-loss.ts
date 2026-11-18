/** Positive-real Foster quadrature: sqrt(s), and a finite-band constant-loss-tangent dielectric. */
export interface LossPole {
  rate: number
  skin: number
  dielectric: number
}

/** Skin weight / sqrt(rate) and dielectric weight per pole, a nonnegative least-squares fit of Zs = (1 + j) sqrt(f)
 * and of a constant loss tangent (G = w, dC/d ln w = -(2/pi) G/w) over 10 MHz–5 GHz. The interior weights stay near the
 * log-uniform Stieltjes quadrature (0.2197, 0.7788); the end poles absorb the truncated tails. Worst error in band: 0.8%
 * skin magnitude and phase, 0.2% dielectric G, 1.0% Kramers–Kronig slope.
 */
const skinWeights = [
  0.617084, 0.126051, 0.234089, 0.215091, 0.222717, 0.215633, 0.232706,
  0.127446, 0.617523,
]
const dielectricWeights = [
  1.22314, 0.743928, 0.775148, 0.781415, 0.776727, 0.781436, 0.774987, 0.743842,
  1.22581,
]

/** Nine negative real poles, log-uniform from 10^6.25 to 10^10.5 Hz, each with positive branch weights. */
export function causalLossPoles(): LossPole[] {
  return skinWeights.map((skin, i) => {
    const rate = 2 * Math.PI * 10 ** (6.25 + (4.25 * i) / 8)
    return {
      rate,
      skin: skin * Math.sqrt(rate),
      dielectric: dielectricWeights[i],
    }
  })
}

/**
 * Rate shift that turns R_dc + S z(s) into R_dc + S (z(s + shift) - z(shift)). With z(s) = sqrt(s / pi), the series
 * impedance becomes sqrt(R_dc^2 + S^2 s / pi): exactly R_dc at DC, rising as f^2 just above it, and S (1 + j) sqrt(f)
 * once skin effect dominates. The plain sum R_dc + S z(s) counts both asymptotes at once through the crossover.
 */
export function skinCrossover(
  dcResistance: number,
  skinResistance: number,
): number {
  if (!(skinResistance > 0)) return 0
  return Math.PI * (dcResistance / skinResistance) ** 2
}

/** Foster stages of z(s + shift) - z(shift): every R || L stage keeps positive elements, so it stays passive. */
export function crossoverPoles(poles: LossPole[], shift: number): LossPole[] {
  return poles.map((pole) => ({
    rate: pole.rate + shift,
    skin: (pole.skin * pole.rate) / (pole.rate + shift),
    dielectric: pole.dielectric,
  }))
}

/** AC response of the implemented unit skin impedance (shifted by `shift`) / unit dielectric admittance, for fit evidence. */
export function causalLossResponse(
  frequency: number,
  shift = 0,
): {
  skinReal: number
  skinImaginary: number
  dielectricReal: number
  dielectricCapacitance: number
} {
  const omega = 2 * Math.PI * frequency
  const poles = causalLossPoles()
  const skin = crossoverPoles(poles, shift)
  return {
    skinReal: skin.reduce(
      (sum, pole) =>
        sum + (pole.skin * omega ** 2) / (pole.rate ** 2 + omega ** 2),
      0,
    ),
    skinImaginary: skin.reduce(
      (sum, pole) =>
        sum + (pole.skin * omega * pole.rate) / (pole.rate ** 2 + omega ** 2),
      0,
    ),
    dielectricReal: poles.reduce(
      (sum, pole) =>
        sum +
        (pole.dielectric * pole.rate * omega ** 2) /
          (pole.rate ** 2 + omega ** 2),
      0,
    ),
    dielectricCapacitance: poles.reduce(
      (sum, pole) =>
        sum +
        (pole.dielectric * pole.rate ** 2) / (pole.rate ** 2 + omega ** 2),
      0,
    ),
  }
}
