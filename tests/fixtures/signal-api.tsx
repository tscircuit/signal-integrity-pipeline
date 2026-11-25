import { readFile } from "node:fs/promises"
import React from "react"
import { Inverter, Reference, simulation } from "./signal-parts"

const modelDir = process.env.IBIS_MODEL_DIR || "models"
/** Read actual vendor bytes only; no synthetic IBIS fallback. */
export async function readSignalApiModels(): Promise<
  Record<string, Uint8Array>
> {
  const files = ["sn74lvc1g04.ibs", "sn65hvd72.ibs"]
  const entries = await Promise.all(
    files.map(async (file) => [
      `models/${file}`,
      await readFile(`${modelDir}/${file}`),
    ]),
  )
  return Object.fromEntries(entries)
}

/** More than three physical conductors, expressed as real TSX. */
export function Four(): React.JSX.Element {
  return (
    <board
      width={16}
      height={12}
      thickness={1.6}
      layers={4}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      isViaInPadAllowed
    >
      {[0, 1, 2, 3].map((i) => (
        <React.Fragment key={i}>
          <Inverter
            name={`TX${i}`}
            x={-5}
            y={i * 0.4}
            powerY={3.2 - i * 0.4}
            driver
          />
          <Inverter
            name={`RX${i}`}
            x={5}
            y={i * 0.4}
            powerY={3.2 - i * 0.4}
            driver={false}
          />
          <trace
            from={`.TX${i} > .Y`}
            to={`.RX${i} > .A`}
            width={0.2}
            pcbPath={[`.TX${i} > .Y`, `.RX${i} > .A`]}
          />
        </React.Fragment>
      ))}
      {/* Keep the ideal-supply contacts and copper beyond the 1 mm coupling horizon. */}
      <Reference powerStartMm={2.4} />
      <simulation.pcbtransientchannelsimulation
        name="FOUR"
        bitRate={20e6}
        duration={48 / 20e6}
      >
        {[0, 1, 2, 3].map((i) => (
          <simulation.pcbdriverreceiverchannel
            key={i}
            name={`D${i}`}
            driverRef={`.TX${i} > .Y`}
            receiverRef={`.RX${i} > .A`}
          />
        ))}
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}
