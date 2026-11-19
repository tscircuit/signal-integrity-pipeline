import { simulation } from "@tscircuit/core"
import type React from "react"

// LEVEL 3: three receiver waveforms; quiet D1 also has a near waveform and near/far idle levels.
import { Inverter } from "../parts"

/** Three routed channels with traffic and crosstalk scenarios. */
export default (): React.JSX.Element => (
  <board
    width="40mm"
    height="24mm"
    layers={2}
    fabricatorPreset="jlcpcb_standard"
  >
    <Inverter name="TX0" pcbX={-15} pcbY={4} />
    <Inverter name="TX1" pcbX={-15} pcbY={0} />
    <Inverter name="TX2" pcbX={-15} pcbY={-4} />
    <Inverter name="RX0" pcbX={15} pcbY={4} />
    <Inverter name="RX1" pcbX={15} pcbY={0} />
    <Inverter name="RX2" pcbX={15} pcbY={-4} />

    <trace from=".TX0 > .Y" to=".RX0 > .A" />
    <trace from=".TX1 > .Y" to=".RX1 > .A" />
    <trace from=".TX2 > .Y" to=".RX2 > .A" />
    <copperpour connectsTo="net.GND" layer="bottom" unbroken />

    <simulation.pcbtransientchannelsimulation name="TRAFFIC" bitRate="20Mbps">
      <simulation.pcbdriverreceiverchannel
        name="D0"
        driverRef=".TX0 > .Y"
        receiverRef=".RX0 > .A"
      />
      <simulation.pcbdriverreceiverchannel
        name="D1"
        driverRef=".TX1 > .Y"
        receiverRef=".RX1 > .A"
      />
      <simulation.pcbdriverreceiverchannel
        name="D2"
        driverRef=".TX2 > .Y"
        receiverRef=".RX2 > .A"
      />
    </simulation.pcbtransientchannelsimulation>

    <simulation.pcbtransientchannelsimulation name="XTALK_LOW" bitRate="20Mbps">
      <simulation.pcbdriverreceiverchannel
        name="D0"
        driverRef=".TX0 > .Y"
        receiverRef=".RX0 > .A"
      />
      <simulation.pcbdriverreceiverchannel
        name="D1"
        driverRef=".TX1 > .Y"
        receiverRef=".RX1 > .A"
        pattern="0"
      />
      <simulation.pcbdriverreceiverchannel
        name="D2"
        driverRef=".TX2 > .Y"
        receiverRef=".RX2 > .A"
      />
    </simulation.pcbtransientchannelsimulation>

    <simulation.pcbtransientchannelsimulation
      name="XTALK_HIGH"
      bitRate="20Mbps"
    >
      <simulation.pcbdriverreceiverchannel
        name="D0"
        driverRef=".TX0 > .Y"
        receiverRef=".RX0 > .A"
      />
      <simulation.pcbdriverreceiverchannel
        name="D1"
        driverRef=".TX1 > .Y"
        receiverRef=".RX1 > .A"
        pattern="1"
      />
      <simulation.pcbdriverreceiverchannel
        name="D2"
        driverRef=".TX2 > .Y"
        receiverRef=".RX2 > .A"
      />
    </simulation.pcbtransientchannelsimulation>
  </board>
)
