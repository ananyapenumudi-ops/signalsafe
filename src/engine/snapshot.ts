/** Plain-data view of the simulation sent from the worker to the UI each frame. */
import type { Aspect, BrakeLevel, Direction, PointPosition } from './schema'
import type { MaPacket } from './svk/svk'

export interface TrainSnapshot {
  locoId: string
  speedKmph: number
  targetKmph: number
  accel: number
  routeM: number
  track: string
  offsetM: number
  trueAbsLocM: number
  /** Track spans the train body occupies, as offsets from each track's `a` node. */
  body: { track: string; fromM: number; toM: number }[]
  /** Latest MA from the serving SVK, and the track spans it covers ahead of the train. */
  ma: MaPacket | null
  maSpans: { track: string; fromM: number; toM: number }[]
  kavachBrake: BrakeLevel | null
  atEndOfLine: boolean
  ovk: {
    direction: Direction | 'undefined'
    tin: number | null
    absLocM: number | null
    uncertaintyM: number
    lastTag: string | null
  }
}

export interface Snapshot {
  tSim: number
  frame: number
  ended: boolean
  durationSec: number
  aspects: Record<string, Aspect>
  points: Record<string, PointPosition>
  activeFaults: string[]
  trains: TrainSnapshot[]
}
