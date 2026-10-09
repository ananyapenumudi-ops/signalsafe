/** Human-readable text and clause for each log event. */
import type { LogEvent } from '../engine/log'
import type { Fault } from '../engine/schema'

export type Tone = 'fault' | 'ovk' | 'svk' | 'yard' | 'bench' | 'status'

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
    case 'BRAKE': {
      const d = e.data
      if (!d.level) return { text: `Kavach brake released at ${d.speedKmph} km/h`, tone: 'ovk', clause: 'SRS 3.5.6.3(d)' }
      const why = BRAKE_WHY[d.reason ?? 'CURVE']
      const ctx = d.permittedKmph !== null && d.reason !== 'NO_ACK' && d.reason !== 'TRIP' ? ` · ${d.speedKmph} km/h vs permitted ${d.permittedKmph}` : ` · ${d.speedKmph} km/h`
      return { text: `Kavach ${d.level}: ${why.text}${ctx}${d.targetDistM !== null ? ` · ${Math.round(d.targetDistM)} m to EOA` : ''}`, tone: 'fault', clause: why.clause }
    }
    case 'RADIO_PACKET':
      return e.data.delivered
        ? { text: `${e.data.kind === 'LOC' ? 'Location report ↑' : 'MA ↓'} delivered`, tone: 'status', clause: 'FRS 7.6.7' }
        : { text: `${e.data.kind === 'LOC' ? 'Location report ↑' : 'MA ↓'} lost (${e.data.fault})`, tone: 'fault', clause: 'FRS 7.6.7.5' }
    case 'OVK_MODE':
      return { text: `Mode ${e.data.from} → ${e.data.to}: ${e.data.reason}`, tone: e.data.to === 'TRIP' ? 'fault' : 'ovk' }
    case 'DMI_ASPECT_BLANK':
      return { text: `DMI aspect blanked: last SVK packet ${e.data.lastPacketAgeSec} s old, FS continues`, tone: 'fault', clause: 'SRS 20.1.2' }
    case 'DMI_ASPECT_RESTORED':
      return { text: 'DMI aspect restored: SVK packets resumed', tone: 'ovk', clause: 'SRS 3.4.8.7(h)' }
    case 'RADIO_FAILURE':
      return { text: `Radio failure: no SVK packet for ${e.data.silentSec} s (limit ${e.data.limitSec} s)`, tone: 'fault', clause: 'SRS 20.1.1' }
    case 'ACK_REQUEST':
      return { text: `DMI asks loco pilot to acknowledge within ${e.data.deadlineSec} s`, tone: 'fault', clause: 'SRS 20.1.3' }
    case 'ACK':
      return { text: `Loco pilot acknowledged after ${e.data.afterSec} s`, tone: 'ovk', clause: 'SRS 3.5.5.7' }
    case 'SVK_SOS':
      return e.data.kind === 'HEAD_ON'
        ? { text: `HEAD-ON: ${e.data.trains.join(' and ')} approaching on the same TIN, ${Math.round(e.data.gapM)} m apart → SoS to both`, tone: 'fault', clause: 'SRS 14.7' }
        : { text: `REAR-END: ${e.data.trains[0]} closing on the train ahead (${Math.round(e.data.gapM)} m) → target to rear loco only`, tone: 'fault', clause: 'SRS 14.3' }
    case 'SVK_SOS_CLEAR':
      return { text: `${e.data.kind === 'HEAD_ON' ? 'Head-on' : 'Rear-end'} situation over (${e.data.trains.join(', ')})`, tone: 'svk', clause: 'SRS 14.5' }
    case 'COLLISION_ALERT':
      return { text: `DMI: ${e.data.kind === 'HEAD_ON' ? 'head-on SoS' : 'rear-end warning'} for loco ${e.data.other}, ${Math.round(e.data.gapM)} m`, tone: 'fault', clause: e.data.kind === 'HEAD_ON' ? 'SRS 14.2' : 'SRS 14.3' }
    case 'COLLISION_CLEAR':
      return { text: `DMI: ${e.data.kind === 'HEAD_ON' ? 'head-on SoS' : 'rear-end warning'} withdrawn`, tone: 'ovk', clause: 'SRS 14.5' }
    case 'LC_APPROACH':
      return { text: `DMI: ${e.data.manning} LC Gate ${e.data.gate} approaching in ${m(e.data.distM)} (from ${e.data.source === 'TAG' ? 'LC tag' : 'track profile'})`, tone: 'ovk', clause: 'SRS 15.2' }
    case 'HORN': {
      const why = { WITHIN_600M: `${m(e.data.distM)} from the gate`, PASSED: 'gate reached', CANCELLED: 'cancelled with Ack', MA_SHORT: 'MA ends short of the gate', STANDSTILL: 'train at a stand', MODE: 'not in this mode' }[e.data.reason]
      const clause = { WITHIN_600M: 'SRS 15.8', PASSED: 'SRS 15.8', CANCELLED: 'SRS 15.9', MA_SHORT: 'SRS 15.4', STANDSTILL: 'SRS 15.5', MODE: 'SRS 15.7' }[e.data.reason]
      return { text: `Auto-whistle ${e.data.on ? 'ON' : 'off'} for ${e.data.gate}: ${why}`, tone: e.data.on ? 'yard' : 'status', clause }
    }
    case 'ROLLBACK':
      return { text: `Roll-back of ${e.data.distanceM} m against the cab direction → brake + warning`, tone: 'fault', clause: 'SRS 13.1' }
    case 'COLLISION':
      return { text: `COLLISION: ${e.data.trains.join(' and ')} on ${e.data.track} at ${Math.round(e.data.closingKmph)} km/h closing speed (bench ground truth)`, tone: 'fault' }
    case 'SPAD':
      return { text: `Passed end of authority${e.data.signal ? ` at ${e.data.signal}` : ''} by ${e.data.overrunM} m: TRIP`, tone: 'fault', clause: 'SRS 12 · 21.3(a)' }
    case 'SVK_REGISTER':
      return { text: `${e.data.svk} registered loco at ${m(e.data.absLocM)}, ${e.data.direction}, TIN ${e.data.tin}`, tone: 'svk', clause: 'SRS 17.3' }
    case 'SVK_MA': {
      const d = e.data
      const sig = d.signal ? `${d.signal} ${d.aspect}${d.nextAspect ? ` (next ${d.nextAspect})` : ''}` : 'no signal ahead'
      const why = d.restricted.length
        ? ` · ${d.restricted.map((r) => `${r.signal} held at R: ${REASON[r.reason]}`).join('; ')}`
        : ''
      return {
        text: `MA ${m(d.maM)} to ${d.eoa === 'route-end' ? 'end of known route' : d.eoa} · ${sig}${why}`,
        tone: d.restricted.length ? 'fault' : 'svk',
        clause: d.restricted.some((r) => r.reason === 'HOLD') ? 'SRS 5.2 · 18.8' : d.restricted.length ? 'SRS 12.1' : 'SRS 5.4',
      }
    }
    case 'OVK_STATUS':
      return {
        text: `${e.data.speedKmph.toFixed(1)} km/h · loc ${e.data.absLocM === null ? 'undefined' : m(e.data.absLocM)} · ${e.data.direction} · TIN ${e.data.tin ?? '—'}`,
        tone: 'status',
        clause: 'SRS 21.5',
      }
  }
}

const BRAKE_WHY = {
  CURVE: { text: 'over the braking curve', clause: 'SRS 19.2–19.3' },
  OVERSPEED_EB: { text: 'well over the braking curve', clause: 'SRS 3.5.6.4(g)' },
  SR_CEILING: { text: 'over the Staff Responsible ceiling', clause: 'Annex A2 (stand-in)' },
  NO_ACK: { text: 'radio failure not acknowledged in 15 s', clause: 'SRS 20.1.3' },
  TRIP: { text: 'trip after passing the EOA', clause: 'SRS 12' },
  HEAD_ON: { text: 'head-on SoS from the stationary side', clause: 'SRS 14.2 · 14.7' },
  REAR_END: { text: 'closing on the train ahead (300 m margin)', clause: 'SRS 14.3' },
  ROLLBACK: { text: 'rolled back more than 5 m', clause: 'SRS 13.1' },
} as const

const REASON = { ROUTE_MISMATCH: 'route not proved (points)', ROUTE_OCCUPIED: 'route occupied', HOLD: 'aspect-change hold' } as const

/** One-line summary of a scheduled fault. */
export function faultSummary(f: Fault): string {
  switch (f.kind) {
    case 'ODO_SCALE':
      return `PG × ${f.factor}`
    case 'RFID_DROP':
      return `drop ${f.tags.join(', ')}`
    case 'POINT_NOT_DETECTED':
      return `${f.point} detection lost`
    case 'SIGNAL_FLICKER':
      return `${f.signal} flickers every ${f.periodSec} s`
    case 'RADIO_LOSS':
      return `radio ${f.direction === 'both' ? 'silent both ways' : f.direction === 'up' ? 'uplink lost' : 'downlink lost'}`
    case 'RADIO_DROP':
      return `${Math.round(f.probability * 100)}% packet loss (${f.direction})`
  }
}

/** Events worth showing by default (the rest are periodic or ground-truth noise). */
export const isNotable = (e: LogEvent) =>
  e.type !== 'OVK_STATUS' && !(e.type === 'TAG_CROSSED' && e.data.delivered) && !(e.type === 'RADIO_PACKET' && e.data.delivered)

/** Default view: notable events, with each radio outage shown once (its first lost packet). */
export function notableEvents(events: LogEvent[]): LogEvent[] {
  const lostStreak = new Set<string>()
  const out: LogEvent[] = []
  for (const e of events) {
    if (e.type === 'RADIO_PACKET') {
      const key = `${e.train}:${e.data.dir}`
      if (e.data.delivered) lostStreak.delete(key)
      else if (!lostStreak.has(key)) {
        lostStreak.add(key)
        out.push(e)
      }
      continue
    }
    if (isNotable(e)) out.push(e)
  }
  return out
}
