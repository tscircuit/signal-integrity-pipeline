import type { SimulationPcbDriverReceiverChannel, SourcePortId } from "../board"
import {
  getIdealGroupId,
  type IdealGroups,
  type SourceContactId,
} from "./ideal-connectivity"

/** Driver-first contacts of one differential channel, in declaration order. */
export interface DifferentialContacts {
  name: string
  positiveSourcePortIds: SourcePortId[]
  negativeSourcePortIds: SourcePortId[]
}

/** List the physical contacts without losing their leg or declaration order. */
export function listDifferentialContacts(
  channels: readonly SimulationPcbDriverReceiverChannel[],
): DifferentialContacts[] {
  return channels.flatMap(({ name, driver, receivers }) => {
    if ("source_port_id" in driver) return []
    const endpoints = [
      driver,
      ...receivers.filter((endpoint) => "p_source_port_id" in endpoint),
    ]
    return [
      {
        name,
        positiveSourcePortIds: endpoints.map(
          ({ p_source_port_id }) => p_source_port_id,
        ),
        negativeSourcePortIds: endpoints.map(
          ({ n_source_port_id }) => n_source_port_id,
        ),
      },
    ]
  })
}

/** Groups reached by the declared contacts on the two differential legs. */
interface DifferentialGroups {
  positive: ReadonlySet<SourceContactId>
  negative: ReadonlySet<SourceContactId>
}

/** Find the differential leg groups before introducing passive bridges. */
export function resolveDifferentialGroups({
  contacts,
  groups,
}: {
  contacts: readonly DifferentialContacts[]
  groups: IdealGroups
}): DifferentialGroups[] {
  return contacts.map(({ positiveSourcePortIds, negativeSourcePortIds }) => ({
    positive: new Set(
      positiveSourcePortIds.map((sourcePortId) =>
        getIdealGroupId({ groups, sourcePortId }),
      ),
    ),
    negative: new Set(
      negativeSourcePortIds.map((sourcePortId) =>
        getIdealGroupId({ groups, sourcePortId }),
      ),
    ),
  }))
}
