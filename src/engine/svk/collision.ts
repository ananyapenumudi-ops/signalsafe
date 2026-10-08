/**
 * Collision prevention in the block section (SRS 14), done on the stationary
 * side from the location reports received this frame.
 *
 *  SRS 14.1  detection uses TIN, speed, location, train length and direction
 *  SRS 14.2  head-on: BOTH locos brake immediately
 *  SRS 14.3  rear-end: only the REAR loco brakes, to stop short of 300 m
 *            (configurable) from the train ahead; nothing for the front loco
 *  SRS 14.6  in station sections collisions are prevented by SPAD/TIN
 *            conflict instead, so only block-section TINs are assessed here
 *  SRS 14.7  two locos moving toward each other on the same TIN in the block
 *            section → loco-specific SoS to both
 *  SRS 7.6   direction + TIN decide whether two locos approach, follow or
 *            go away from each other
 *
 * Reports from locos served by different Stationary Kavach units are pooled,
 * standing in for the SVK↔SVK exchange of Annexure P.
 */
import { P } from '../params'
import type { Direction } from '../schema'

export interface TrainReport {
  locoId: string
  absLocM: number
  direction: Direction
  tin: number
  /** Train length the OVK knows (SRS 5.4(f), 8). */
  lengthM: number
  /** OVK's location uncertainty (half-width). */
  uncertaintyM: number
  /** Signed speed along its direction of travel, m/s. */
  speed: number
}

export type Threat =
  | { kind: 'HEAD_ON'; other: string; gapM: number }
  | { kind: 'REAR_END'; other: string; gapM: number; targetAbsM: number }

const sign = (d: Direction) => (d === 'nominal' ? 1 : -1)

/** Threats per loco id. A loco not in the map has none. */
export function assessCollisions(reports: TrainReport[], isBlockTin: (tin: number) => boolean): Map<string, Threat> {
  const out = new Map<string, Threat>()
  const keep = (id: string, t: Threat) => {
    const prev = out.get(id)
    // head-on outranks rear-end; otherwise keep the nearer threat
    if (!prev || (t.kind === 'HEAD_ON' && prev.kind !== 'HEAD_ON') || (t.kind === prev.kind && t.gapM < prev.gapM)) out.set(id, t)
  }
  for (let i = 0; i < reports.length; i++) {
    for (let j = i + 1; j < reports.length; j++) {
      const a = reports[i]!
      const b = reports[j]!
      if (a.tin !== b.tin || !isBlockTin(a.tin)) continue
      const sa = sign(a.direction)
      const sb = sign(b.direction)
      if (sa !== sb) {
        // moving towards each other = their directions of travel point at each other
        // (SRS 7.6, 14.7). The situation persists while they stand; it is over when
        // one leaves the TIN or changes direction (SRS 14.5).
        const facing = sa * (b.absLocM - a.absLocM) > 0 && sb * (a.absLocM - b.absLocM) > 0
        if (!facing) continue
        const gapM = round(Math.abs(b.absLocM - a.absLocM) - a.uncertaintyM - b.uncertaintyM)
        keep(a.locoId, { kind: 'HEAD_ON', other: b.locoId, gapM })
        keep(b.locoId, { kind: 'HEAD_ON', other: a.locoId, gapM })
      } else {
        // same direction: who is in front?
        const [front, rear] = sa * (a.absLocM - b.absLocM) > 0 ? [a, b] : [b, a]
        const s = sa
        // min safe rear end of the train ahead
        const frontRear = front.absLocM - s * (front.lengthM + front.uncertaintyM)
        const gapM = round(s * (frontRear - rear.absLocM) - rear.uncertaintyM)
        const targetAbsM = round(frontRear - s * P('rearEndMarginM'))
        keep(rear.locoId, { kind: 'REAR_END', other: front.locoId, gapM, targetAbsM })
      }
    }
  }
  return out
}

const round = (x: number) => Math.round(x * 10) / 10

export const sameThreat = (a: Threat | null | undefined, b: Threat | null | undefined) => (a?.kind ?? null) === (b?.kind ?? null) && (a?.other ?? null) === (b?.other ?? null)
