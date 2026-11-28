import { expect, test } from "bun:test"
import type { Datum } from "../../site/workbench/chart"
import { foldEye } from "../../site/workbench/model/eye"

test("foldEye interpolates complete unit intervals and detects piecewise-linear mask crossings", () => {
  const points: Datum[] = [
    [0, 0],
    [0.95, 0],
    [1.05, 2],
    [1.95, 2],
    [2.05, 0],
    [2.95, 0],
    [3.05, 2],
    [3.95, 2],
    [4.05, 0],
  ]
  const options = {
    points,
    bitNs: 1,
    startNs: 0,
    skip: 0,
    phase: 0,
    crossingVoltage: 1,
    maskHeight: 0.4,
    maskWidth: 0.25,
  }
  const open = foldEye(options)
  expect(open.segments).toHaveLength(2)
  expect(open.segments[0][0]).toEqual([0, 0])
  expect(open.segments[0].at(-1)?.[0]).toBe(2)
  expect(open.height).toBeCloseTo(2)
  expect(open.widthFraction).toBeCloseTo(1)
  expect(open.violations).toBe(0)
  expect(open.mask[1][0]).toBe(1)
  expect(open.crossingVoltage).toBeCloseTo(1)
  const shifted = foldEye({ ...options, phase: 0.5 })
  expect(shifted.height).toBeCloseTo(2)
  expect(shifted.widthFraction).toBeCloseTo(1)
  expect(shifted.violations + shifted.betweenSamples).toBeGreaterThan(0)
  const jittered = foldEye({
    ...options,
    points: [
      [0, 0],
      [0.43, 0],
      [0.53, 2],
      [1.47, 2],
      [1.57, 0],
      [2.43, 0],
      [2.53, 2],
      [3.47, 2],
      [3.57, 0],
      [4, 0],
    ],
  })
  expect(jittered.widthFraction).toBeCloseTo(0.96)
  expect(jittered.crossingVoltage).toBeCloseTo(1.4)
})
