import React, { useMemo, useState } from 'react'
import { BoardPage } from '../site/debugger'
import type { CircuitJson } from '../src/board'

/** Collect each declared model basename once, in board order. */
function collectModelNames(records: CircuitJson | undefined): string[] {
  const models = new Set<string>()
  for (const record of records ?? []) {
    if (record.type !== 'simulation_ibis_model') continue
    const path = record.ibis_model_asset?.project_relative_path
    if (typeof path !== 'string') continue
    models.add(path.split('/').at(-1)!)
  }
  return [...models]
}

/** Paste or upload records without inventing geometry or simulation declarations. */
export default function CircuitJsonPage(): React.JSX.Element {
  const [text, setText] = useState('[]')
  const [records, setRecords] = useState<CircuitJson>()
  const [error, setError] = useState<string>()
  const models = useMemo(() => collectModelNames(records), [records])
  const loadBoard = useMemo(() => async (): Promise<CircuitJson> => records!, [records])
  return (
    <>
      <h1>Paste / upload Circuit JSON</h1>
      <p>Include physical copper, stackup, IBIS declarations and transient channel blocks.</p>
      <label>
        Circuit JSON file{' '}
        <input
          type="file"
          accept=".json"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            void file
              .text()
              .then(setText)
              .catch((cause) => setError(String(cause)))
          }}
        />
      </label>
      <textarea aria-label="Circuit JSON" value={text} onChange={(event) => setText(event.target.value)} />
      <button
        onClick={() => {
          try {
            const parsedRecords: unknown = JSON.parse(text)
            if (
              !Array.isArray(parsedRecords) ||
              parsedRecords.some((record) => !record || typeof record !== 'object' || typeof record.type !== 'string')
            )
              throw new Error('Expected an array of Circuit JSON records')
            setRecords(parsedRecords as CircuitJson)
            setError(undefined)
          } catch (cause) {
            setError((cause as Error).message)
          }
        }}
      >
        Inspect circuit
      </button>
      {error && <p role="alert">{error}</p>}
      {records && <BoardPage load-board={loadBoard} models={models} />}
    </>
  )
}
