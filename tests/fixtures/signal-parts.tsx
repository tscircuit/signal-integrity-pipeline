import { simulation } from "@tscircuit/core"
import type { SimulationIbisModelProps } from "@tscircuit/props"
import type React from "react"

/** Common physical ground pad offset and matching through-board via. */
const GROUND_PAD_Y_MM = -3.5

interface InverterProps {
  name: string
  x: number
  y: number
  driver: boolean
  powerY?: number
  clampNet?: string
  modelFile?: string
}

type IbisAsset = SimulationIbisModelProps["ibisModelAsset"]
type ReferenceLabels = NonNullable<
  SimulationIbisModelProps["ibisPinNameToReferencePortLabels"]
>[string]

/** Describe the local vendor asset used to render the IBIS record. */
function asset(file: string): IbisAsset {
  return {
    project_relative_path: `models/${file}`,
    url: `./models/${file}`,
    mimetype: "text/plain",
  }
}

/** Map each of the four IBIS reference roles to its fixture rail. */
function referenceLabels(): ReferenceLabels {
  return {
    pullup: "VCC",
    pulldown: "GND",
    powerClamp: "VCC",
    groundClamp: "GND",
  }
}

/** Small explicit-pad source for topology unit tests. */
export function Inverter({
  name,
  x,
  y,
  driver,
  powerY = 2,
  clampNet,
  modelFile = "sn74lvc1g04.ibs",
}: InverterProps): React.JSX.Element {
  let pin = "2"
  let label = "A"
  let model = "LVC1G04_IN_33"
  if (driver) {
    pin = "4"
    label = "Y"
    model = "LVC1G04_OUT_33"
  }
  const pinLabels: Record<string, string> = {
    pin2: "A",
    pin3: "GND",
    pin4: "Y",
    pin5: "VCC",
  }
  const ibisPinNameToPortLabel: Record<string, string> = {
    [pin]: label,
    "3": "GND",
    "5": "VCC",
  }
  const connections: Record<string, string> = { VCC: "net.VCC", GND: "net.GND" }
  const references = referenceLabels()
  if (clampNet) {
    pinLabels.pin6 = "PC"
    ibisPinNameToPortLabel["6"] = "PC"
    connections.PC = clampNet
    references.powerClamp = "PC"
  }
  return (
    <>
      <chip
        name={name}
        pcbX={x}
        pcbY={y}
        pinLabels={pinLabels}
        connections={connections}
        footprint={
          <footprint>
            <smtpad
              portHints={[`pin${pin}`]}
              pcbX={0}
              pcbY={0}
              width={0.3}
              height={0.3}
              shape="rect"
            />
            <smtpad
              portHints={["pin3"]}
              pcbX={0}
              pcbY={GROUND_PAD_Y_MM}
              width={0.5}
              height={0.5}
              shape="rect"
            />
            {clampNet && (
              <smtpad
                portHints={["pin6"]}
                pcbX={0}
                pcbY={1.2}
                width={0.2}
                height={0.2}
                shape="rect"
              />
            )}
            <smtpad
              portHints={["pin5"]}
              pcbX={0}
              pcbY={powerY}
              width={0.5}
              height={0.5}
              shape="rect"
            />
          </footprint>
        }
      />
      <via
        name={`G_${name}`}
        pcbX={x}
        pcbY={y + GROUND_PAD_Y_MM}
        fromLayer="top"
        toLayer="bottom"
        holeDiameter={0.15}
        outerDiameter={0.3}
        connectsTo={`.${name} > .GND`}
      />
      <simulation.ibismodel
        componentRef={`.${name}`}
        ibisModelAsset={asset(modelFile)}
        ibisComponentName="LVC1G04_DCK"
        ibisPinNameToPortLabel={ibisPinNameToPortLabel}
        ibisPinNameToModelName={{ [pin]: model }}
        ibisPinNameToReferencePortLabels={{ [pin]: references }}
      />
    </>
  )
}

/** Real SN65HVD72 bus buffers in a designed two-pad channel fixture. */
export function Transceiver({
  name,
  x,
}: {
  name: string
  x: number
}): React.JSX.Element {
  return (
    <>
      <chip
        name={name}
        pcbX={x}
        pinLabels={{
          pin5: "GND",
          pin6: "A",
          pin7: "B",
          pin8: "VCC",
        }}
        connections={{ VCC: "net.VCC", GND: "net.GND" }}
        footprint={
          <footprint>
            <smtpad
              portHints={["pin6"]}
              pcbX={0}
              pcbY={0.3}
              width={0.25}
              height={0.25}
              shape="rect"
            />
            <smtpad
              portHints={["pin7"]}
              pcbX={0}
              pcbY={-0.3}
              width={0.25}
              height={0.25}
              shape="rect"
            />
            <smtpad
              portHints={["pin5"]}
              pcbX={0}
              pcbY={GROUND_PAD_Y_MM}
              width={0.5}
              height={0.5}
              shape="rect"
            />
            <smtpad
              portHints={["pin8"]}
              pcbX={0}
              pcbY={2}
              width={0.5}
              height={0.5}
              shape="rect"
            />
          </footprint>
        }
      />
      <via
        name={`G_${name}`}
        pcbX={x}
        pcbY={GROUND_PAD_Y_MM}
        fromLayer="top"
        toLayer="bottom"
        holeDiameter={0.15}
        outerDiameter={0.3}
        connectsTo={`.${name} > .GND`}
      />
      <simulation.ibismodel
        componentRef={`.${name}`}
        ibisModelAsset={asset("sn65hvd72.ibs")}
        ibisComponentName="SN65HVD72D"
        ibisPinNameToPortLabel={{
          "5": "GND",
          "6": "A",
          "7": "B",
          "8": "VCC",
        }}
        ibisPinNameToModelName={{ "6": "a_b_p", "7": "a_b_n" }}
        ibisPinNameToReferencePortLabels={{
          "6": referenceLabels(),
          "7": referenceLabels(),
        }}
      />
    </>
  )
}

/** Full opposite-layer plane for topology tests, reached by explicit pad vias. */
export function Reference({
  powerStartMm = 1.8,
}: {
  powerStartMm?: number
}): React.JSX.Element {
  return (
    <>
      <net name="GND" />
      <net name="VCC" />
      <copperpour
        name="POWER"
        layer="top"
        connectsTo="net.VCC"
        unbroken
        outline={[
          { x: -8, y: powerStartMm },
          { x: 8, y: powerStartMm },
          { x: 8, y: 5 },
          { x: -8, y: 5 },
        ]}
      />
      <copperpour
        name="RETURN"
        layer="bottom"
        connectsTo="net.GND"
        unbroken
        outline={[
          { x: -8, y: -5 },
          { x: 8, y: -5 },
          { x: 8, y: 5 },
          { x: -8, y: 5 },
        ]}
      />
    </>
  )
}
