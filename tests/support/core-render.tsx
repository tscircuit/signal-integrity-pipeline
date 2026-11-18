import React from 'react'
import { Circuit } from '@tscircuit/core'
import type { CircuitJson } from '../../src/board'

/** Render TSX through core and preserve partial records when it rejects the board. */
export async function renderCoreSignals(tree: React.ReactElement): Promise<CircuitJson> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  try {
    circuit.add(tree)
    await circuit.renderUntilSettled()
    const records = circuit.getCircuitJson()
    const errors = records.filter(record => record.type.endsWith('_error'))
    if (errors.length) throw new Error(JSON.stringify(errors))
    return records
  } catch (error) {
    throw Object.assign(error as Error, { circuitJson: circuit.db.toArray() })
  }
}
