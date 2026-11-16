"""Compare openEMS and pipeline-ladder S-parameters of one net with the tolerances in docs/physics-coverage.md.

usage: python compare.py <model.json> <openEMS sparams.json> <ngspice ladder-ac.txt> <output.json>

Both sides go through the same processing: S11 -> TDR impedance with a 100 ps (10-90 %) Gaussian step,
S21 -> |S21| in dB and the 50 % delay of the same step. Tolerances were fixed before the first run.
"""
import json
import sys

import numpy as np

Z0_TOLERANCE = 0.03
DELAY_TOLERANCE = 0.02
S21_TOLERANCE_DB = 0.5
S21_BAND_HZ = 3e9
RISE_SECONDS = 100e-12
OFFSET_SECONDS = 0.5e-9
PAD = 16

model_path, oems_path, ladder_path, output_path = sys.argv[1:5]
model = json.load(open(model_path))
oems = json.load(open(oems_path))
frequency = np.array(oems['frequencyHz'])
names = [f'S{i + 1}1' for i in range(len(model['ports']))]
openems = {name: np.array(oems['S'][name]['re']) + 1j * np.array(oems['S'][name]['im']) for name in names}
table = np.loadtxt(ladder_path, skiprows=1)
if not np.allclose(table[:, 0], frequency, rtol=1e-9):
    raise SystemExit('frequency grids differ')
voltage = [table[:, 1 + 2 * i] + 1j * table[:, 2 + 2 * i] for i in range(len(names))]
# 2 V behind 50 ohm: incident a1 = 1 V, so S11 = V1 - 1 and Sk1 = Vk at matched ports.
ladder = {name: (voltage[0] - 1 if i == 0 else voltage[i]) for i, name in enumerate(names)}

step = frequency[1] - frequency[0]
grid = np.concatenate([[0.0], frequency])
sigma = RISE_SECONDS / 2.563
gauss = np.exp(-(2 * np.pi * grid * sigma) ** 2 / 2) * np.exp(-2j * np.pi * grid * OFFSET_SECONDS)
count = PAD * 2 * len(grid)
time = np.arange(count) / (count * step)


def step_response(spectrum):
    """Unit-step response of a band-limited transfer function, DC extended from the first sample's real part."""
    full = np.concatenate([[spectrum[0].real], spectrum]) * gauss
    return np.cumsum(np.fft.irfft(full, n=count)) * 1.0


def crossing(response, level):
    """First time the response crosses level, linearly interpolated."""
    index = int(np.argmax(response >= level))
    a, b = response[index - 1], response[index]
    return time[index - 1] + (level - a) / (b - a) * (time[index] - time[index - 1])


reference = step_response(np.ones_like(frequency, dtype=complex))
t_reference = crossing(reference, 0.5 * reference[-count // 4])


def impedance(spectrum):
    """TDR impedance profile from S11."""
    rho = step_response(spectrum)
    return 50 * (1 + rho) / (1 - rho)


power = {side: float(np.max(sum(np.abs(data[name]) ** 2 for name in names))) for side, data in (('openems', openems), ('pipeline', ladder))}
result = {'passivityMaxPower': power, 'tolerances': {'z0': Z0_TOLERANCE, 'delay': DELAY_TOLERANCE, 's21Db': S21_TOLERANCE_DB, 's21BandHz': S21_BAND_HZ}, 'riseSeconds': RISE_SECONDS}
z_oems = impedance(openems['S11'])
z_ladder = impedance(ladder['S11'])
markers = []
for marker in model['markers']:
    t = OFFSET_SECONDS + marker['roundTripSeconds']
    a = float(np.interp(t, time, z_oems))
    b = float(np.interp(t, time, z_ladder))
    markers.append({**marker, 'openemsOhm': a, 'pipelineOhm': b, 'error': a / b - 1, 'pass': bool(abs(a / b - 1) <= Z0_TOLERANCE)})
result['z0'] = markers
window = (time >= OFFSET_SECONDS - 2 * RISE_SECONDS) & (time <= OFFSET_SECONDS + max(2 * max([m['roundTripSeconds'] for m in model['markers']] + [0]), 1e-9) + 4 * RISE_SECONDS)
deviation = np.abs(z_oems - z_ladder) * window
worst = int(np.argmax(deviation))
result['tdrWorst'] = {'seconds': float(time[worst] - OFFSET_SECONDS), 'openemsOhm': float(z_oems[worst]), 'pipelineOhm': float(z_ladder[worst])}
result['tdr'] = {'seconds': (time[window] - OFFSET_SECONDS)[::4].tolist(), 'openemsOhm': z_oems[window][::4].tolist(), 'pipelineOhm': z_ladder[window][::4].tolist()}

if len(names) == 1:
    # One-port TDR into an open far end: one-way delay is half the time the reflection takes to reach +0.5.
    t_open = [crossing(step_response(spectrum), 0.5) for spectrum in (openems['S11'], ladder['S11'])]
    delays = [(t - t_reference) / 2 for t in t_open]
    result['openEndDelaySeconds'] = {'openems': float(delays[0]), 'pipeline': float(delays[1]), 'error': float(delays[0] / delays[1] - 1),
                                     'pass': bool(abs(delays[0] / delays[1] - 1) <= DELAY_TOLERANCE)}
for name in names[1:]:
    s_oems = step_response(openems[name])
    s_ladder = step_response(ladder[name])
    final = [s[-count // 4] for s in (s_oems, s_ladder)]
    delays = [crossing(s, 0.5 * f) - t_reference for s, f in zip((s_oems, s_ladder), final)]
    db = [20 * np.log10(np.abs(s)) for s in (openems[name], ladder[name])]
    difference = db[0] - db[1]
    bands = {}
    for lo, hi in ((0, S21_BAND_HZ), (S21_BAND_HZ, 5e9), (5e9, frequency[-1] + 1)):
        mask = (frequency > lo) & (frequency <= hi)
        k = int(np.argmax(np.abs(difference) * mask))
        bands[f'{lo / 1e9:g}-{hi / 1e9:.3g} GHz'] = {'worstDb': float(difference[k]), 'atHz': float(frequency[k])}
    result[name] = {'delaySeconds': {'openems': float(delays[0]), 'pipeline': float(delays[1]), 'error': float(delays[0] / delays[1] - 1), 'pass': bool(abs(delays[0] / delays[1] - 1) <= DELAY_TOLERANCE)},
                    'finalStep': {'openems': float(final[0]), 'pipeline': float(final[1])},
                    's21Db': {**bands, 'pass': bool(abs(bands[f'0-{S21_BAND_HZ / 1e9:.3g} GHz']['worstDb']) <= S21_TOLERANCE_DB)},
                    'curveDb': {'hz': frequency[::10].tolist(), 'openems': db[0][::10].tolist(), 'pipeline': db[1][::10].tolist()}}
json.dump(result, open(output_path, 'w'), indent=1)
print(json.dumps({'passivityMaxPower': power, 'openEndDelay': result.get('openEndDelaySeconds'), 'z0': [(m['label'], round(m['openemsOhm'], 2), round(m['pipelineOhm'], 2), f"{m['error'] * 100:+.2f}%", m['pass']) for m in markers],
                  'tdrWorst': result['tdrWorst'],
                  **{name: {'delay_ps': (round(result[name]['delaySeconds']['openems'] * 1e12, 2), round(result[name]['delaySeconds']['pipeline'] * 1e12, 2)),
                            'delayError': f"{result[name]['delaySeconds']['error'] * 100:+.2f}%", 'delayPass': result[name]['delaySeconds']['pass'],
                            's21': {k: v for k, v in result[name]['s21Db'].items()}} for name in names[1:]}}, indent=1))
