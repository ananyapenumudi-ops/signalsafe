/**
 * The Test Scenario Logger (FRS 7.6.11): the bench's single source of truth.
 * Every event carries `causedBy`, the seqs of the events that triggered it, so
 * the Evaluation Tool can rebuild the causal chain behind any outcome.
 */
import type { Aspect, BrakeLevel, Direction, FaultKind, PointPosition } from './schema'
import type { MaPacket } from './svk/svk'
import type { BrakeReason, Mode } from './ovk/supervision'

export type Source = 'TBC' | 'YARD' | 'SS' | 'RFID-S' | 'RMS' | 'FAULT' | 'DIS' | `OVK:${string}` | `SVK:${string}`

/** Payload for each event type. Extend here as modules are added. */
export interface EventDataMap {
  SIM_START: { scenario: string; seed: number }
  SIM_END: { reason: 'duration' | 'stopped' }
  TARGET_SPEED: { kmph: number }
  POINT_SET: { point: string; position: PointPosition }
  ASPECT_SET: { signal: string; aspect: Aspect }
  FAULT_START: { fault: string; kind: FaultKind }
  FAULT_END: { fault: string; kind: FaultKind }
  ROUTE_SET: { tracks: string[] }
  END_OF_LINE: { track: string }
  /** Ground truth from the RFID simulator: the antenna crossed this tag. */
  TAG_CROSSED: { tag: string; pair: string; delivered: boolean }
  /** What the OVK received through RFID-A. */
  TAG_READ: { tag: string; pair: string; absLocM: number; tin: number }
  SIGNAL_PASSED: { signal: string; aspect: Aspect }
  /** Brake command to the BIU, with the supervision state that caused it. */
  BRAKE: { level: BrakeLevel | null; reason: BrakeReason | null; speedKmph: number; permittedKmph: number | null; targetDistM: number | null }
  /** A packet through the Radio Message Simulator (FRS 7.6.7). */
  RADIO_PACKET: { dir: 'up' | 'down'; kind: 'LOC' | 'MA'; delivered: boolean; fault?: string }
  OVK_MODE: { from: Mode; to: Mode; reason: string }
  DMI_ASPECT_BLANK: { lastPacketAgeSec: number }
  DMI_ASPECT_RESTORED: Record<string, never>
  RADIO_FAILURE: { silentSec: number; limitSec: number }
  ACK_REQUEST: { prompt: 'RADIO_FAILURE'; deadlineSec: number }
  ACK: { prompt: 'RADIO_FAILURE'; afterSec: number }
  /** OVK detected it passed its end of authority (SRS 12, 21.3(a)). */
  SPAD: { signal: string | null; overrunM: number }
  OVK_DIRECTION: { direction: Direction; fromTags: [string, string] }
  OVK_TIN: { from: number | null; to: number }
  OVK_LOCATION_CORRECTED: { tag: string; errorM: number; boundM: number; withinBound: boolean }
  /** SVK accepted a loco's first valid location report (SRS 17.3). */
  SVK_REGISTER: { svk: string; absLocM: number; direction: Direction; tin: number }
  /** New or changed Movement Authority (SRS 5.4, 21.6(b)). */
  SVK_MA: MaPacket
  /** Periodic OVK data-logger record (SRS 21.5(a)). */
  OVK_STATUS: {
    speedKmph: number
    absLocM: number | null
    direction: Direction | 'undefined'
    tin: number | null
    lastTag: string | null
    brake: BrakeLevel | null
  }
}

export type EventType = keyof EventDataMap

export type LogEvent = {
  [K in EventType]: {
    seq: number
    /** Simulated time, seconds. */
    tSim: number
    /** Radio frame number at tSim. */
    frame: number
    source: Source
    type: K
    train?: string
    /** True absolute location (chainage) where relevant. */
    locM?: number
    data: EventDataMap[K]
    causedBy: number[]
  }
}[EventType]

export type NewEvent<K extends EventType = EventType> = {
  source: Source
  type: K
  train?: string
  locM?: number
  data: EventDataMap[K]
  causedBy?: number[]
}

export class EventLog {
  readonly events: LogEvent[] = []

  private readonly clock: () => { tSim: number; frame: number }

  constructor(clock: () => { tSim: number; frame: number }) {
    this.clock = clock
  }

  /** Appends an event and returns its seq, for use in later `causedBy` lists. */
  append<K extends EventType>(e: NewEvent<K>): number {
    const seq = this.events.length
    const { tSim, frame } = this.clock()
    this.events.push({ ...e, causedBy: e.causedBy ?? [], seq, tSim, frame } as LogEvent)
    return seq
  }

  get(seq: number): LogEvent | undefined {
    return this.events[seq]
  }

  since(seq: number): LogEvent[] {
    return this.events.slice(seq)
  }

  /** Walks `causedBy` links back from an event, oldest cause first. */
  chain(seq: number): LogEvent[] {
    const seen = new Set<number>()
    const visit = (s: number) => {
      if (seen.has(s)) return
      seen.add(s)
      this.events[s]?.causedBy.forEach(visit)
    }
    visit(seq)
    return [...seen].sort((a, b) => a - b).map((s) => this.events[s]!)
  }
}
