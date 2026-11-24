import { expect, test } from "bun:test"
import { calculateRlgc } from "../../src/rlgc"
import { kisiReportSchema, runKisi } from "./kisi"
import {
  couponLengthMm,
  couponNet,
  couponSection,
  kisiCoupons,
} from "./kisi-fixtures"

// Protocol and tolerances were committed before the first pipeline/Kisi comparison.
const impedanceTolerance = 0.03
const delayTolerance = 0.02

/** Reject nonphysical numbers and report both tools' results alongside their relative difference. */
function compareMetric({
  label,
  pipeline,
  kisi,
  tolerance,
}: {
  label: string
  pipeline: number
  kisi: number
  tolerance: number
}): void {
  expect(
    Number.isFinite(pipeline) && pipeline > 0,
    `${label}: invalid pipeline result ${pipeline}`,
  ).toBe(true)
  expect(
    Number.isFinite(kisi) && kisi > 0,
    `${label}: invalid Kisi result ${kisi}`,
  ).toBe(true)
  const difference = Math.abs(pipeline / kisi - 1)
  console.log(
    `${label.padEnd(40)} pipeline=${pipeline.toFixed(3)} kisi=${kisi.toFixed(3)} difference=${(difference * 100).toFixed(3)}%`,
  )
  expect(
    difference,
    `${label}: ${(difference * 100).toFixed(3)}% exceeds ${tolerance * 100}%`,
  ).toBeLessThanOrEqual(tolerance)
}

for (const coupon of kisiCoupons) {
  test.skipIf(process.env.SI_KISI_TESTS !== "1")(
    `Kisi field solver agrees on ${coupon.name}`,
    async () => {
      const started = performance.now()
      const report = await runKisi(coupon)
      expect(report.net).toBe(couponNet(coupon))
      expect(report.length_mm).toBe(couponLengthMm)
      expect(report.segments[0].len_mm).toBe(couponLengthMm)
      expect(report.differential).toBe(coupon.gapMm !== undefined)
      const section = calculateRlgc({ crossSection: couponSection(coupon) })
      const oddInductance =
        section.externalInductanceHenriesPerMeter[0][0] -
        (section.externalInductanceHenriesPerMeter[0][1] ?? 0)
      const oddCapacitance =
        section.capacitanceFaradsPerMeter[0][0] -
        (section.capacitanceFaradsPerMeter[0][1] ?? 0)
      let factor = 1
      if (coupon.gapMm !== undefined) factor = 2
      compareMetric({
        label: `${coupon.name} impedance (ohm)`,
        pipeline: factor * Math.sqrt(oddInductance / oddCapacitance),
        kisi: report.impedance.mean,
        tolerance: impedanceTolerance,
      })
      compareMetric({
        label: `${coupon.name} delay (ps)`,
        pipeline:
          ((Math.sqrt(oddInductance * oddCapacitance) * couponLengthMm) /
            1000) *
          1e12,
        kisi: report.delay_ps,
        tolerance: delayTolerance,
      })
      if (coupon.gapMm !== undefined) {
        if (!report.mixed_mode)
          throw new Error("Expected independently solved odd and even modes")
        expect(report.mixed_mode.delay_ps_diff).toBe(report.delay_ps)
        const evenInductance =
          section.externalInductanceHenriesPerMeter[0][0] +
          section.externalInductanceHenriesPerMeter[0][1]
        const evenCapacitance =
          section.capacitanceFaradsPerMeter[0][0] +
          section.capacitanceFaradsPerMeter[0][1]
        compareMetric({
          label: "differential-microstrip common delay (ps)",
          pipeline:
            ((Math.sqrt(evenInductance * evenCapacitance) * couponLengthMm) /
              1000) *
            1e12,
          kisi: report.mixed_mode.delay_ps_common,
          tolerance: delayTolerance,
        })
      } else expect(report.mixed_mode).toBeNull()
      // Guard against a green result if a future CLI falls back to formulas or loses field coverage.
      expect(
        kisiReportSchema.safeParse({
          ...report,
          field_solver: { ...report.field_solver, cross_sections_field: 0 },
        }).success,
      ).toBe(false)
      expect(
        kisiReportSchema.safeParse({ ...report, delay_ps: NaN }).success,
      ).toBe(false)
      console.log(
        `${coupon.name} duration=${((performance.now() - started) / 1000).toFixed(3)}s`,
      )
    },
    150_000,
  )
}
