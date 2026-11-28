import { expect, test } from "bun:test"
import type { Datum } from "../../site/workbench/chart"
import { measureWaveform } from "../../site/workbench/model/waveforms"

test("measureWaveform interpolates directed edges and delay using probe timestamps", () => {
  const driver: Datum[] = [
    [0, 0],
    [1, 0],
    [3, 2],
    [5, 2],
    [7, 0],
    [9, 0],
  ]
  const receiver: Datum[] = [
    [0, 0],
    [2, 0],
    [4, 2],
    [5, 2.2],
    [6, 2],
    [8, 0],
    [9, -0.1],
  ]
  const metrics = measureWaveform({
    points: receiver,
    driver,
    nominalHigh: 2,
    bitNs: 5,
  })
  expect(metrics.riseNs).toBeCloseTo(1.2)
  expect(metrics.fallNs).toBeCloseTo(1.2)
  expect(metrics.delayNs).toBeCloseTo(1)
  expect(metrics.overshootMv).toBeCloseTo(200)
  expect(metrics.undershootMv).toBeCloseTo(100)
  expect(
    measureWaveform({
      points: [
        [0, 1],
        [5, 1],
      ],
    }).riseNs,
  ).toBeUndefined()
})
