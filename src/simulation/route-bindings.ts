import { BaseSolver } from '@tscircuit/solver-utils'
import type { GraphicsObject } from 'graphics-debug'
import { admitBuffers, compileBuffers, ibisAssembly, type AdmittedBuffers, type AssemblyEntry } from '../buffers'
import { rootScope, snapshot, type Artifact, type Produced } from '../kernel'
import { routeBoardDrawing, routeBuffers, routeFailure, routeLengths, routeOutline, routePinDirection, routePortPoint, routeStrip, routeTones, routeView } from '../board'
import { generalDeclarations, modelRunDefinition } from './declarations'
import { electricalSources } from './netlist'
import type { Declarations, SimulationPlan } from './types'
import type { RouteBindingsInput, RoutedBindings, RouteBuffer } from './routed-types'

/** Bind one vendor buffer per step; electrical names retain source-record order. */
export class RouteBindingsSolver extends BaseSolver {
  private declarations?: Declarations
  private admitted?: AdmittedBuffers
  private plan?: SimulationPlan
  private electricalLines: string[] = []
  private readonly models: RouteBuffer[] = []
  private readonly assembly: AssemblyEntry[] = []
  private readonly artifacts: Artifact[] = []
  private output?: Produced<RoutedBindings>
  /** Inputs contain domain intent, never another stage's internals. */
  constructor(private readonly input: RouteBindingsInput) { super() }
  /** Cut physical copper out of ideal connectivity, then compile one original IBIS model. */
  override _step(): void {
    const scope = rootScope('buffers').child(this.input.artifactPrefix)
    if (!this.declarations) {
      const mappings = structuredClone(this.input.mappings)
      if (!mappings.length) throw new Error('Routed compilation requires physical signal mappings')
      mappings[0].sourceTraceIds = this.input.circuitJson.filter(record => record.type === 'pcb_trace').filter(trace => this.input.scope.pcbTraceIds.includes(trace.pcb_trace_id) && !this.input.scope.nonReferenceRailTraceIds.includes(trace.pcb_trace_id)).map(trace => trace.source_trace_id!)
      this.declarations = generalDeclarations({
        circuit: this.input.circuitJson, mappings, modeling: this.input.modeling, controls: this.input.controls,
      })
      this.plan = this.declarations.plans[0]
      this.plan.durationSeconds = this.input.options.durationSeconds
      this.plan.maxStepSeconds = this.input.options.stepSeconds
      this.electricalLines = electricalSources(this.input.circuitJson, this.input.modeling, this.declarations.nodes).lines
      const admitted = admitBuffers({ models: this.declarations.models, ibisSources: this.input.ibisSources, scope })
      this.admitted = admitted.value
      this.artifacts.push(...admitted.artifacts)
    }
    const model = this.declarations.models[this.models.length]
    if (model) {
      const [compiled] = compileBuffers(this.admitted!, [{ ...this.plan!, models: [model] }], modelRunDefinition)[0]
      this.models.push({ name: compiled.name, source: compiled.source, spicePinMapping: compiled.spicePinMapping, metadata: compiled.metadata, warnings: compiled.warnings, sourceEvidence: compiled.sourceEvidence })
      this.assembly.push(...ibisAssembly([compiled], scope).value)
    }
    this.stats = { models: this.models.length, probes: this.plan!.probes.length, warnings: this.models.reduce((n, model) => n + model.warnings.length, 0) }
    if (this.models.length !== this.declarations.models.length) return
    const bindings = snapshot({ circuitJson: this.input.circuitJson, scope: this.input.scope, mappings: this.input.mappings, plan: this.plan!, nodeMap: this.declarations.nodes.mapping, groundSourcePortId: this.declarations.nodes.groundSourcePortId, electricalLines: this.electricalLines, models: this.models })
    this.artifacts.push(scope.json('native-ibis-assembly.json', this.assembly), rootScope('simulation').child(this.input.artifactPrefix).json('electrical-node-map.json', { nodes: bindings.nodeMap, channelReferenceSourcePortId: bindings.groundSourcePortId }))
    this.output = { value: bindings, artifacts: this.artifacts }
    this.solved = true
  }
  /** Complete immutable bindings only. */
  override getOutput(): Produced<RoutedBindings> {
    if (!this.output) throw new Error('Route bindings are incomplete')
    return this.output
  }
  /** Original input without converter objects. */
  override getConstructorParams(): [RouteBindingsInput] { return [this.input] }
  /** Bound components outlined, IBIS buffer glyphs at their signal pins (▶ driver, ◀ receiver) and rail pins as grey dots; unbound lane ends turn red. */
  override visualize(): GraphicsObject {
    const circuit = this.input.circuitJson
    const view = routeView(circuit, this.input.scope)
    const drawing = routeBoardDrawing({ circuit, scope: this.input.scope })
    const pcbPorts = new Map(circuit.filter(port => port.type === 'pcb_port').map(port => [port.source_port_id, port]))
    const components = new Map(circuit.filter(component => component.type === 'pcb_component').map(component => [component.pcb_component_id, component]))
    const outlineContext = { pcbPorts, components, drawing, unit: view.unit }
    const buffers = this.models.flatMap(model => {
      outlinePortComponents({ ports: Object.values(model.spicePinMapping), color: routeTones.via, label: model.name }, outlineContext)
      return [...new Set(Object.values(model.spicePinMapping))].flatMap(id => {
        const point = routePortPoint(circuit, id)
        if (!point) return []
        if (!this.input.mappings.some(mapping => mapping.from === id || mapping.to === id) || !model.metadata.pins.some(pin => pin.port === id)) {
          drawing.circles!.push({ center: point, radius: view.unit * 0.3, fill: routeTones.quiet, stroke: routeTones.quiet })
          return []
        }
        const net = view.ports.get(id)
        return [{ point, direction: routePinDirection({ circuit, view, pin: point }), color: net?.color ?? routeTones.copper, driver: Boolean(this.plan?.states.some(state => state.source_port_id === id && state.is_output)), label: net?.label }]
      })
    })
    routeBuffers({ drawing, buffers, unit: view.unit })
    // Each bound net unrolled, its driver and receiver glyphs at the ends once both are bound.
    const bound = new Set(buffers.map(buffer => buffer.label))
    routeStrip({ drawing, pane: view.pane, rows: routeLengths(circuit, view).filter(row => bound.has(row.net.label)), buffers: { driver: true, receiver: true } })
    if (this.failed) {
      outlinePortComponents({ ports: this.input.mappings.flatMap(mapping => [mapping.from, mapping.to]), color: routeTones.failure, label: 'unbound' }, outlineContext)
      routeFailure({ drawing, box: view.pane, message: this.error ?? 'IBIS binding unavailable' })
    }
    return drawing
  }
}

type PcbPort = Extract<RouteBindingsInput['circuitJson'][number], { type: 'pcb_port' }>
type PcbComponent = Extract<RouteBindingsInput['circuitJson'][number], { type: 'pcb_component' }>

/** Outline the parts that own the selected ports. */
function outlinePortComponents({ ports, color, label }: { ports: Iterable<PcbPort['source_port_id']>; color: string; label: string }, {
  pcbPorts, components, drawing, unit,
}: {
  pcbPorts: ReadonlyMap<PcbPort['source_port_id'], PcbPort>
  components: ReadonlyMap<PcbComponent['pcb_component_id'], PcbComponent>
  drawing: GraphicsObject
  unit: number
}): void {
  for (const id of new Set([...ports].map(port => pcbPorts.get(port)?.pcb_component_id))) {
    if (!id) continue
    const component = components.get(id)
    if (component) drawing.polygons!.push({ points: routeOutline(component), stroke: color, strokeWidth: unit * 0.2, label })
  }
}
