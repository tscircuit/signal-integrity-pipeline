/** An undirected connection between two electrical vertices with its physical evidence. */
export interface Connection<VertexId, Evidence> {
  fromVertexId: VertexId
  toVertexId: VertexId
  evidence: Evidence
}

/** Electrical vertices indexed by their incident connections. */
export type ConnectionGraph<VertexId, Evidence> = ReadonlyMap<
  VertexId,
  readonly Connection<VertexId, Evidence>[]
>

/** Index connections at both vertices, including contacts that already share a vertex. */
export function buildConnectionGraph<VertexId, Evidence>(
  connections: readonly Connection<VertexId, Evidence>[],
): ConnectionGraph<VertexId, Evidence> {
  const graph = new Map<VertexId, Connection<VertexId, Evidence>[]>()
  for (const connection of connections) {
    const { fromVertexId, toVertexId } = connection
    const vertices = new Set([fromVertexId, toVertexId])
    for (const vertexId of vertices) {
      const incident = graph.get(vertexId)
      if (incident) incident.push(connection)
      else graph.set(vertexId, [connection])
    }
  }
  return graph
}

/** Read the other vertex of an incident connection. */
function getOppositeVertexId<VertexId, Evidence>({
  connection,
  vertexId,
}: {
  connection: Connection<VertexId, Evidence>
  vertexId: VertexId
}): VertexId {
  if (connection.fromVertexId === vertexId) return connection.toVertexId
  return connection.fromVertexId
}

/** Ordered connections traversed between two vertices. */
type ConnectionPath<VertexId, Evidence> = Connection<VertexId, Evidence>[]

/** Find the shortest path in the selected connection graph. */
export function findConnectionPath<VertexId, Evidence>({
  graph,
  fromVertexId,
  toVertexId,
  omitted,
}: {
  graph: ConnectionGraph<VertexId, Evidence>
  fromVertexId: VertexId
  toVertexId: VertexId
  omitted?: Connection<VertexId, Evidence>
}): ConnectionPath<VertexId, Evidence> | undefined {
  const reached = new Map<VertexId, Connection<VertexId, Evidence> | null>([
    [fromVertexId, null],
  ])
  for (const vertexId of reached.keys()) {
    if (vertexId === toVertexId) return reconstructPath({ reached, toVertexId })
    for (const connection of graph.get(vertexId) ?? []) {
      if (connection === omitted) continue
      const nextVertexId = getOppositeVertexId({ connection, vertexId })
      if (!reached.has(nextVertexId)) reached.set(nextVertexId, connection)
    }
  }
}

/** Follow one predecessor per reached vertex back to the path's first contact. */
function reconstructPath<VertexId, Evidence>({
  reached,
  toVertexId,
}: {
  reached: ReadonlyMap<VertexId, Connection<VertexId, Evidence> | null>
  toVertexId: VertexId
}): ConnectionPath<VertexId, Evidence> {
  const path: ConnectionPath<VertexId, Evidence> = []
  let currentVertexId = toVertexId
  let connection = reached.get(currentVertexId)
  while (connection) {
    path.push(connection)
    currentVertexId = getOppositeVertexId({
      connection,
      vertexId: currentVertexId,
    })
    connection = reached.get(currentVertexId)
  }
  return path.reverse()
}

/** An unfinished depth-first visit and its lowest reachable discovery index. */
interface BridgeVisit<VertexId, Evidence> {
  vertexId: VertexId
  discoveryIndex: number
  lowIndex: number
  incident: Iterator<Connection<VertexId, Evidence>>
  parentConnection?: Connection<VertexId, Evidence>
}

/** The connections whose removal disconnects their endpoints in an undirected graph. */
export type ConnectionBridges<VertexId, Evidence> = ReadonlySet<
  Connection<VertexId, Evidence>
>

/** Find every bridge in one traversal, treating parallel connections as separate edges. */
export function findConnectionBridges<VertexId, Evidence>(
  graph: ConnectionGraph<VertexId, Evidence>,
): ConnectionBridges<VertexId, Evidence> {
  const discovery = new Map<VertexId, number>()
  const bridges = new Set<Connection<VertexId, Evidence>>()
  for (const [rootVertexId, incident] of graph) {
    if (discovery.has(rootVertexId)) continue
    discovery.set(rootVertexId, discovery.size)
    const rootIndex = discovery.size - 1
    const visits: BridgeVisit<VertexId, Evidence>[] = [
      {
        vertexId: rootVertexId,
        discoveryIndex: rootIndex,
        lowIndex: rootIndex,
        incident: incident.values(),
      },
    ]
    for (let visit = visits.at(-1); visit; visit = visits.at(-1)) {
      const { value: connection, done } = visit.incident.next()
      if (done) {
        visits.pop()
        const parent = visits.at(-1)
        if (!parent || !visit.parentConnection) continue
        if (visit.lowIndex > parent.discoveryIndex)
          bridges.add(visit.parentConnection)
        parent.lowIndex = Math.min(parent.lowIndex, visit.lowIndex)
        continue
      }
      if (connection === visit.parentConnection) continue
      const vertexId = getOppositeVertexId({
        connection,
        vertexId: visit.vertexId,
      })
      const discoveryIndex = discovery.get(vertexId)
      if (discoveryIndex !== undefined) {
        visit.lowIndex = Math.min(visit.lowIndex, discoveryIndex)
        continue
      }
      const nextIncident = graph.get(vertexId)
      if (!nextIncident) continue
      const nextIndex = discovery.size
      discovery.set(vertexId, nextIndex)
      visits.push({
        vertexId,
        discoveryIndex: nextIndex,
        lowIndex: nextIndex,
        incident: nextIncident.values(),
        parentConnection: connection,
      })
    }
  }
  return bridges
}
