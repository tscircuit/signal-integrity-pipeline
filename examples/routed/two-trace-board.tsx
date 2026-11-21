import { simulation } from "@tscircuit/core"
import React from "react"

/** Recording includes the vendor waveform lead-in and settling. */
const RECORDING_SECONDS = 40e-9

/** Centre-to-centre spacing of the two parallel traces. */
const TRACE_SPACING_MM = 0.35

const transmitter = {
  prefix: "TX",
  x: -4,
  pin: "4",
  label: "Y",
  model: "LVC1G04_OUT_33",
}
const receiver = {
  prefix: "RX",
  x: 4,
  pin: "2",
  label: "A",
  model: "LVC1G04_IN_33",
}

interface TwoTraceBoardProps {
  "bit-rate"?: string
  "duration-seconds"?: number
  "data-pattern"?: string
}

/** Two physical 8 mm traces with a switching driver and a quiet victim. */
export function TwoTraceBoard({
  "bit-rate": bitRate = "50Mbps",
  "duration-seconds": durationSeconds = RECORDING_SECONDS,
  "data-pattern": dataPattern = "01",
}: TwoTraceBoardProps = {}): React.JSX.Element {
  return (
    <board
      width={16}
      height={12}
      layers={4}
      thickness={1.6}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      isViaInPadAllowed
    >
      {[0, 1].map((index) => (
        <React.Fragment key={index}>
          {[transmitter, receiver].map(({ prefix, x, pin, label, model }) => {
            const name = `${prefix}${index}`
            const y = index * TRACE_SPACING_MM
            const ground = -2.5 - index
            const power = 2.5 + index
            return (
              <React.Fragment key={name}>
                <chip
                  name={name}
                  pcbX={x}
                  pcbY={y}
                  pinLabels={{
                    pin2: "A",
                    pin3: "GND",
                    pin4: "Y",
                    pin5: "VCC",
                  }}
                  connections={{ GND: "net.GND", VCC: "net.VCC" }}
                  footprint={
                    <footprint>
                      <smtpad
                        portHints={[`pin${pin}`]}
                        pcbX={0}
                        pcbY={0}
                        width={0.2}
                        height={0.2}
                        shape="rect"
                      />
                      <smtpad
                        portHints={["pin3"]}
                        pcbX={0}
                        pcbY={ground}
                        width={0.4}
                        height={0.4}
                        shape="rect"
                      />
                      <smtpad
                        portHints={["pin5"]}
                        pcbX={0}
                        pcbY={power}
                        width={0.4}
                        height={0.4}
                        shape="rect"
                      />
                    </footprint>
                  }
                />
                <via
                  name={`G_${name}`}
                  pcbX={x}
                  pcbY={y + ground}
                  fromLayer="top"
                  toLayer="bottom"
                  holeDiameter={0.15}
                  outerDiameter={0.3}
                  connectsTo={`.${name} > .GND`}
                />
                <simulation.ibismodel
                  componentRef={`.${name}`}
                  ibisModelAsset={{
                    project_relative_path: "models/sn74lvc1g04.ibs",
                    url: "./models/sn74lvc1g04.ibs",
                    mimetype: "text/plain",
                  }}
                  ibisComponentName="LVC1G04_DCK"
                  ibisPinNameToPortLabel={{
                    [pin]: label,
                    "3": "GND",
                    "5": "VCC",
                  }}
                  ibisPinNameToModelName={{ [pin]: model }}
                  ibisPinNameToReferencePortLabels={{
                    [pin]: {
                      pullup: "VCC",
                      pulldown: "GND",
                      powerClamp: "VCC",
                      groundClamp: "GND",
                    },
                  }}
                />
              </React.Fragment>
            )
          })}
          <trace
            from={`.TX${index} > .Y`}
            to={`.RX${index} > .A`}
            width={0.1}
            pcbPath={[`.TX${index} > .Y`, `.RX${index} > .A`]}
          />
        </React.Fragment>
      ))}
      <net name="GND" />
      <net name="VCC" />
      <copperpour
        name="POWER"
        connectsTo="net.VCC"
        layer="top"
        unbroken
        outline={[
          { x: -7, y: 2.3 },
          { x: 7, y: 2.3 },
          { x: 7, y: 5 },
          { x: -7, y: 5 },
        ]}
      />
      <copperpour
        name="RETURN"
        connectsTo="net.GND"
        layer="bottom"
        unbroken
        outline={[
          { x: -7, y: -5 },
          { x: 7, y: -5 },
          { x: 7, y: 5 },
          { x: -7, y: 5 },
        ]}
      />
      <simulation.pcbtransientchannelsimulation
        name="TWO"
        bitRate={bitRate}
        duration={durationSeconds}
      >
        <simulation.pcbdriverreceiverchannel
          name="DATA"
          driverRef=".TX0 > .Y"
          receiverRef=".RX0 > .A"
          pattern={dataPattern}
        />
        <simulation.pcbdriverreceiverchannel
          name="VICTIM"
          driverRef=".TX1 > .Y"
          receiverRef=".RX1 > .A"
          pattern="0"
        />
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}
