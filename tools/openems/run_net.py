"""openEMS FDTD run of one net written by scripts/openems-net.ts.

usage: python run_net.py <model.json> <output dir> [--threads N] [--dry] [--end-ns T] [--fine-mm F]

Copper is PEC with its real thickness. Laminate and mask use the band's permittivity, plus its Debye poles when the model has them.
Every port is a 50 ohm lumped port from the reference plane face (start) to the pad face (stop), so the port
voltage is V(pad) - V(plane) at every port. Port 1 is excited. Writes sparams.json with S_k1 on the model's
frequency grid. --dry builds the mesh and reports its size without running.
"""
import argparse
import json
import os
import time

import numpy as np
from CSXCAD import ContinuousStructure
from CSXCAD.CSProperties import CSPropDebyeMaterial
from CSXCAD.SmoothMeshLines import SmoothMeshLines
from openEMS import openEMS
from openEMS.physical_constants import C0

parser = argparse.ArgumentParser()
parser.add_argument('model')
parser.add_argument('output')
parser.add_argument('--threads', type=int, default=int(os.environ.get('HEAVY_THREADS', '1')))
parser.add_argument('--dry', action='store_true')
parser.add_argument('--end-ns', type=float, default=6.0)
parser.add_argument('--fine-mm', type=float, default=None, help='finest lateral cell; default min(trace width)/4')
parser.add_argument('--air-mm', type=float, default=3.0)
parser.add_argument('--z-cells', type=int, default=6, help='cells per dielectric gap')
parser.add_argument('--thirds', action='store_true', help='axis-aligned selected trace edges get the 1/3-2/3 rule instead of a line on the edge')
args = parser.parse_args()

model = json.load(open(args.model))
unit = 1e-3
fmax = model['maximumFrequencyHz']
region = model['region']
args.output = os.path.abspath(args.output)
os.makedirs(args.output, exist_ok=True)

eps_max = max(band['er'] for band in model['bands'])
coarse = C0 / (fmax * np.sqrt(eps_max)) / unit / 20
widths = [trace['width'] for trace in model['traces'] if trace['selected']]
fine = args.fine_mm or min(widths) / 4

csx = ContinuousStructure()
grid = csx.GetGrid()
grid.SetDeltaUnit(unit)
# The eight PML cells sit outside the region: coarse cells past each side in x and y, and past the air in z.
z_coarse = min(coarse, 0.5)
lines = {'x': [region['x0'] - 8 * coarse, region['x0'], region['x1'], region['x1'] + 8 * coarse],
         'y': [region['y0'] - 8 * coarse, region['y0'], region['y1'], region['y1'] + 8 * coarse], 'z': []}


def cover(axis, lo, hi, step):
    """Uniform lines across [lo, hi] no wider than step."""
    count = max(1, int(np.ceil((hi - lo) / step - 1e-9)))
    lines[axis].extend(np.linspace(lo, hi, count + 1).tolist())


def strip(axis, lo, hi):
    """Fine lines across a conductor's width; with --thirds, a third of the edge cell lies inside the metal."""
    if not args.thirds:
        return cover(axis, lo, hi, fine)
    cover(axis, lo + fine / 3, hi - fine / 3, fine)
    lines[axis].extend([lo - 2 * fine / 3, hi + 2 * fine / 3])


# Dielectric bands, one Debye property each; holes and antipads reuse the band at their height.
bands = []
for i, band in enumerate(model['bands']):
    if not band['poles']:
        material = csx.AddMaterial(f'band{i}', epsilon=band['er'])
    else:
        material = CSPropDebyeMaterial(csx.GetParameterSet(), epsilon=band['epsInf'], order=len(band['poles']))
        csx.AddProperty(material)
        material.SetName(f'band{i}')
    for n, pole in enumerate(band['poles']):
        material.SetDispersiveMaterialProperty(n, eps_delta=pole['delta'], eps_relax=pole['tau'])
    pad = 60.0
    material.AddBox([region['x0'] - pad, region['y0'] - pad, band['zMin']], [region['x1'] + pad, region['y1'] + pad, band['zMax']], priority=1)
    bands.append((band, material))


def band_at(z):
    """Debye property whose band contains height z."""
    for band, material in bands:
        if band['zMin'] - 1e-9 <= z <= band['zMax'] + 1e-9:
            return material
    raise ValueError(f'no dielectric band at z={z}')


copper = csx.AddMetal('copper')


def polygon(prop, ring, z0, z1, priority):
    """Extruded polygon between z0 and z1."""
    points = np.array(ring, dtype=float).T
    prop.AddLinPoly(points=points, norm_dir='z', elevation=z0, length=z1 - z0, priority=priority)


for pour in model['pours']:
    polygon(copper, pour['outer'], pour['zMin'], pour['zMax'], 10)
    for hole in pour['holes']:
        polygon(band_at((pour['zMin'] + pour['zMax']) / 2), hole, pour['zMin'], pour['zMax'], 20)
for antipad in model['antipads']:
    band_at((antipad['zMin'] + antipad['zMax']) / 2).AddCylinder([antipad['x'], antipad['y'], antipad['zMin']], [antipad['x'], antipad['y'], antipad['zMax']], antipad['radius'], priority=20)

for trace in model['traces']:
    (ax, ay), (bx, by) = trace['a'], trace['b']
    length = np.hypot(bx - ax, by - ay)
    if length < 1e-9:
        continue
    nx, ny = -(by - ay) / length * trace['width'] / 2, (bx - ax) / length * trace['width'] / 2
    polygon(copper, [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]], trace['zMin'], trace['zMax'], 30)
    lo_x, hi_x = min(ax, bx) - abs(nx), max(ax, bx) + abs(nx)
    lo_y, hi_y = min(ay, by) - abs(ny), max(ay, by) + abs(ny)
    if not trace['selected']:
        lines['x'].extend([lo_x, hi_x])
        lines['y'].extend([lo_y, hi_y])
    elif abs(by - ay) < 1e-9:
        strip('y', lo_y, hi_y)
        lines['x'].extend([lo_x, hi_x])
    elif abs(bx - ax) < 1e-9:
        strip('x', lo_x, hi_x)
        lines['y'].extend([lo_y, hi_y])
    else:
        cover('x', lo_x, hi_x, fine)
        cover('y', lo_y, hi_y, fine)
for joint in model['joints']:
    copper.AddCylinder([joint['x'], joint['y'], joint['zMin']], [joint['x'], joint['y'], joint['zMax']], joint['radius'], priority=30)
for pad in model['pads']:
    polygon(copper, pad['ring'], pad['zMin'], pad['zMax'], 30)
    ring = np.array(pad['ring'])
    lines['x'].extend([ring[:, 0].min(), ring[:, 0].max()])
    lines['y'].extend([ring[:, 1].min(), ring[:, 1].max()])
layers = {layer['name']: layer for layer in model['copper']}
for via in model['vias']:
    copper.AddCylinder([via['x'], via['y'], via['zMin']], [via['x'], via['y'], via['zMax']], via['radius'], priority=40)
    for name in via['padLayers']:
        layer = layers[name]
        copper.AddCylinder([via['x'], via['y'], layer['zMin']], [via['x'], via['y'], layer['zMax']], via['padRadius'], priority=30)
    for axis, centre in (('x', via['x']), ('y', via['y'])):
        if via['selected']:
            cover(axis, centre - via['padRadius'] - 0.1, centre + via['padRadius'] + 0.1, fine)
        else:
            lines[axis].extend([centre - via['padRadius'], centre, centre + via['padRadius']])

# z: every copper face and band interface; copper is one cell thick, a dielectric gap at least six cells.
faces = sorted({value for layer in model['copper'] for value in (layer['zMin'], layer['zMax'])} | {value for band in model['bands'] for value in (band['zMin'], band['zMax'])})
for lo, hi in zip(faces[:-1], faces[1:]):
    cover('z', lo, hi, (hi - lo) / args.z_cells if hi - lo > 0.04 else hi - lo)
lines['z'].extend([region['zMin'] - args.air_mm - 8 * z_coarse, region['zMin'] - args.air_mm, region['zMax'] + args.air_mm, region['zMax'] + args.air_mm + 8 * z_coarse])

fdtd = openEMS(EndCriteria=1e-4, MaxTime=args.end_ns * 1e-9)
fdtd.SetCSX(csx)
fdtd.SetGaussExcite(fmax / 2, fmax / 2)
fdtd.SetBoundaryCond(['PML_8'] * 6)
ports = []
for i, port in enumerate(model['ports']):
    start = [port['x'] - port['width'] / 2, port['y'] - port['height'] / 2, port['zPlane']]
    stop = [port['x'] + port['width'] / 2, port['y'] + port['height'] / 2, port['zPad']]
    ports.append(fdtd.AddLumpedPort(i + 1, 50, start, stop, 'z', excite=1 if i == 0 else 0, priority=50))
    cover('x', start[0], stop[0], fine)
    cover('y', start[1], stop[1], fine)

def merge(values, gap):
    """Sorted lines with neighbours closer than gap collapsed onto the first."""
    kept = []
    for value in sorted(values):
        if not kept or value - kept[-1] >= gap:
            kept.append(value)
    return np.array(kept)


for axis in 'xyz':
    values = merge(lines[axis], fine / 3 if axis != 'z' else 1e-4)
    grid.SetLines(axis, SmoothMeshLines(values, coarse if axis != 'z' else z_coarse, 1.4))
counts = [len(grid.GetLines(axis)) for axis in 'xyz']
deltas = [np.diff(grid.GetLines(axis)).min() * unit for axis in 'xyz']
dt = 1 / (C0 * np.sqrt(sum(1 / d ** 2 for d in deltas)))
summary = {'cells': int(np.prod(counts)), 'lines': counts, 'minimumCellMm': [d / unit for d in deltas], 'fineMm': fine, 'coarseMm': coarse,
           'courantStepSeconds': dt, 'steps': int(args.end_ns * 1e-9 / dt), 'threads': args.threads, 'thirds': args.thirds, 'zCells': args.z_cells}
print(json.dumps(summary))
json.dump(summary, open(os.path.join(args.output, 'mesh.json'), 'w'), indent=1)
if args.dry:
    raise SystemExit(0)

simulation = os.path.join(os.path.abspath(args.output), 'fdtd')
started = time.time()
fdtd.Run(simulation, cleanup=True, numThreads=args.threads, verbose=1)
seconds = time.time() - started
frequency = np.arange(1, model['frequencyPoints'] + 1) * fmax / model['frequencyPoints']
for port in ports:
    port.CalcPort(simulation, frequency, ref_impedance=50)
incident = ports[0].uf_inc
result = {'frequencyHz': frequency.tolist(), 'seconds': seconds, **summary,
          'S': {f'S{i + 1}1': {'re': (port.uf_ref / incident).real.tolist(), 'im': (port.uf_ref / incident).imag.tolist()} for i, port in enumerate(ports)}}
with open(os.path.join(os.path.abspath(args.output), 'sparams.json'), 'w') as handle:
    json.dump(result, handle)
print(json.dumps({'seconds': seconds, 'cells': summary['cells']}))
