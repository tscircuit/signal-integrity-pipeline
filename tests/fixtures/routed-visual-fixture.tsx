export const routedVisualIbis = `[IBIS Ver] 4.2
[Component] LVC1G04_DCK
[Manufacturer] Drawing fixture
[Package]
R_pkg 0 0 0
L_pkg 0 0 0
C_pkg 0 0 0
[Pin] signal_name model_name
2 A LVC1G04_IN_33
3 GND GND
4 Y LVC1G04_OUT_33
5 VCC POWER
[Model] LVC1G04_OUT_33
Model_type Output
Polarity Non-Inverting
C_comp 1p 1p 1p
[Voltage Range] 3.3 3.3 3.3
[Pullup]
-3.3 .066 .066 .066
0 0 0 0
6.6 -.132 -.132 -.132
[Pulldown]
-3.3 -.066 -.066 -.066
0 0 0 0
6.6 .132 .132 .132
[Ramp]
dV/dt_r 1.98/1n 1.98/1n 1.98/1n
dV/dt_f 1.98/1n 1.98/1n 1.98/1n
R_load = 50
${(["Rising", "Falling"] as const)
  .flatMap((kind) =>
    [0, 3.3].map(
      (voltage) =>
        `[${kind} Waveform]\nR_fixture = 50\nV_fixture = ${voltage}\n${[
          [0, 0],
          [0.2, 0],
          [0.4, 0.5],
          [0.6, 1],
          [0.8, 1],
          [1, 1],
          [2, 1],
          [4, 1],
        ]
          .map(([time, fraction]) => {
            let amplitude = fraction
            if (kind === "Falling") amplitude = 1 - fraction
            const value = voltage / 2 + 1.65 * amplitude
            return `${time}n ${value} ${value} ${value}`
          })
          .join("\n")}`,
    ),
  )
  .join("\n")}
[Model] LVC1G04_IN_33
Model_type Input
C_comp 1p 1p 1p
[Voltage Range] 3.3 3.3 3.3
[End]
`

const outputModel = routedVisualIbis
  .split("[Model] LVC1G04_OUT_33")[1]
  .split("[Model] LVC1G04_IN_33")[0]
  .replace("Model_type Output", "Model_type I/O")

export const differentialIbis = `[IBIS Ver] 4.2
[Component] SN65HVD72D
[Manufacturer] Synthetic fixture
[Package]
R_pkg 0 0 0
L_pkg 0 0 0
C_pkg 0 0 0
[Pin] signal_name model_name
5 GND GND
6 A a_b_p
7 B a_b_n
8 VCC POWER
[Diff_pin] inv_pin vdiff tdelay_typ tdelay_min tdelay_max
6 7 0.2V 0 0 0
[Model] a_b_p${outputModel}[Model] a_b_n${outputModel}[End]
`

export const separateClampIbis = routedVisualIbis
  .replace(
    "5 VCC POWER\n",
    `5 VCC POWER
6 PC POWER
[Pin Mapping] pulldown_ref pullup_ref gnd_clamp_ref power_clamp_ref ext_ref
2 GND VCC GND PC NC
3 GND NC GND NC NC
4 GND VCC GND PC NC
5 NC VCC NC NC NC
6 NC NC NC PC NC
`,
  )
  .replaceAll(
    "[Voltage Range] 3.3 3.3 3.3\n",
    `[Voltage Range] 3.3 3.3 3.3
[Power Clamp Reference] 1.8 1.8 1.8
[Power Clamp]
-10 -0.1 -0.1 -0.1
10 0.1 0.1 0.1
`,
  )
