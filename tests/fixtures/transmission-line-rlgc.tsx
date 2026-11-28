import {
  type CopperGeometry,
  type CopperGeometryExtractionInput,
  CopperGeometryExtractionSolver,
} from "../../src/board"
import type { TransmissionLineRlgcInput } from "../../src/rlgc"
import { renderRoutedCopper } from "./routed-copper"

/** Solve copper geometry from a rendered fixture. */
export function solveBoardCopperGeometry({
  circuitJson,
  copperScope,
}: Pick<
  CopperGeometryExtractionInput,
  "circuitJson" | "copperScope"
>): CopperGeometry {
  const solver = new CopperGeometryExtractionSolver({
    circuitJson,
    copperScope,
    requiredSourcePortIds: [],
    artifactPrefix: "test",
  })
  solver.solve()
  return solver.getOutput().value
}

/** A core-rendered pair and its solver input. */
export async function renderTransmissionLineRlgcInput(): Promise<TransmissionLineRlgcInput> {
  const copperGeometry = solveBoardCopperGeometry(await renderRoutedCopper())
  return {
    copperGeometry,
    materials: {
      maskThicknessMm: 0.02,
      maskRelativePermittivity: 3.3,
      maskLossTangent: 0.025,
      laminateLossTangent: 0.02,
    },
    artifactPrefix: "test",
  }
}
