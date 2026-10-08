/** Human-readable text and clause for each log event. */
import type { LogEvent } from '../engine/log'

export type Tone = 'fault' | 'ovk' | 'yard' | 'bench' | 'status'

export interface Described {
  text: string
  tone: Tone
  clause?: string
}

const m = (x: number) => `${Math.round(x).toLocaleString('en-IN')} m`

export function describe(e: LogEvent): Described {
  switch (e.type) {
    case 'SIM_START':
      return { text: `Run started · seed ${e.data.seed}`, tone: 'bench' }
    case 'SIM_END':
      return { text: 'Run complete', tone: 'bench' }
    case 'TARGET_SPEED':
      return { text: `Driver target ${e.data.kmph} km/h`, tone: 'bench' }
    case 'ROUTE_SET':
      return { text: `Route ${e.data.tracks.join(' → ')}`, tone: 'bench' }
    case 'END_OF_LINE':
      return { text: `End of line on ${e.data.track}`, tone: 'bench' }
    case 'POINT_SET':
      return { text: `Point ${e.data.point} set ${e.data.position}`, tone: 'yard' }
    case 'ASPECT_SET':
      return { text: `Signal ${e.data.signal} → ${e.data.aspect}`, tone: 'yard' }
    case 'SIGNAL_PASSED':
      return { text: `Passed ${e.data.signal} at ${e.data.aspect}`, tone: 'yard' }
    case 'FAULT_START':
      return { text: `Fault ${e.data.fault} (${e.data.kind}) active`, tone: 'fault' }
    case 'FAULT_END':
      return { text: `Fault ${e.data.fault} cleared`, tone: 'fault' }
    case 'TAG_CROSSED':
      return e.data.delivered
        ? { text: `Antenna over ${e.data.tag}`, tone: 'status' }
        : { text: `Tag ${e.data.tag} withheld from reader`, tone: 'fault', clause: 'FRS 7.6.6.2' }
    case 'TAG_READ':
      return { text: `Read ${e.data.tag} · ${m(e.data.absLocM)} · TIN ${e.data.tin}`, tone: 'ovk' }
    case 'OVK_DIRECTION':
      return { text: `Direction ${e.data.direction} from ${e.data.fromTags.join(' + ')}`, tone: 'ovk', clause: 'SRS 7.2 · 7.5' }
    case 'OVK_TIN':
      return { text: `TIN ${e.data.from ?? '—'} → ${e.data.to}`, tone: 'ovk', clause: 'SRS 16.6' }
    case 'OVK_LOCATION_CORRECTED':
      return {
        text: `Location corrected at ${e.data.tag} by ${e.data.errorM > 0 ? '−' : '+'}${Math.abs(e.data.errorM).toFixed(1)} m (bound ±${e.data.boundM.toFixed(1)} m${e.data.withinBound ? '' : ', EXCEEDED'})`,
        tone: e.data.withinBound ? 'ovk' : 'fault',
        clause: 'SRS 3.4.2.4',
      }
    case 'BRAKE':
      return { text: e.data.level ? `Kavach brake ${e.data.level}` : 'Kavach brake released', tone: 'fault' }
    case 'OVK_STATUS':
      return {
        text: `${e.data.speedKmph.toFixed(1)} km/h · loc ${e.data.absLocM === null ? 'undefined' : m(e.data.absLocM)} · ${e.data.direction} · TIN ${e.data.tin ?? '—'}`,
        tone: 'status',
        clause: 'SRS 21.5',
      }
  }
}

/** Events worth showing by default (the rest are periodic or ground-truth noise). */
export const isNotable = (e: LogEvent) => e.type !== 'OVK_STATUS' && !(e.type === 'TAG_CROSSED' && e.data.delivered)
