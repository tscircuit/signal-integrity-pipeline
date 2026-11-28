import { Circuit } from "@tscircuit/core"
import type { ReactElement } from "react"
import type { CircuitJson } from "../../src/board"

/** Render TSX through core and preserve partial records when it rejects the board. */
export async function renderCoreBoard({
  tree,
  keepDrcErrors = false,
}: {
  tree: ReactElement
  keepDrcErrors?: boolean
}): Promise<CircuitJson> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  try {
    circuit.add(tree)
    await circuit.renderUntilSettled()
    const records = circuit.getCircuitJson()
    if (keepDrcErrors) return records
    const errors = records.filter((record) => record.type.endsWith("_error"))
    if (errors.length) throw new Error(JSON.stringify(errors))
    return records
  } catch (error) {
    throw Object.assign(new Error((error as Error).message, { cause: error }), {
      circuitJson: circuit.db.toArray(),
    })
  }
}

/** Render an error-free signal fixture through core. */
export function renderCoreSignals(tree: ReactElement): Promise<CircuitJson> {
  return renderCoreBoard({ tree })
}
