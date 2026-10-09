/**
 * Reference OVK — auto-whistling on approach of an LC gate (SRS 15, Non-SIL).
 *
 *  15.2  DMI shows "<manning> LC Gate <id> approaching in <d> meters" once
 *        the approach is known, from LC gate tags or the radio track profile
 *  15.3  horn blown at the gate; whichever source (tag / track profile)
 *        arrives first is processed
 *  15.4  no horn if the MA ends short of the LC gate
 *  15.5  no horn at standstill
 *  15.6  on reading the tag, blow the horn even if no MA is available
 *  15.7  no horn in Standby / Isolation / Non-Leading / System Failure
 *        (none of these modes exist in our subset; TRIP is treated alike)
 *  15.8  continuous whistling from 600 m before the gate until reaching it
 *  15.9  Common/Ack alone cancels the auto-whistle
 */
import { P } from '../params'

export interface LcGateInfo {
  id: string
  /** e.g. "Manned", "Unmanned". */
  manning: string
  absLocM: number
  source: 'TAG' | 'TRACK_PROFILE'
}

export type LcEvent =
  | { type: 'LC_APPROACH'; data: { gate: string; manning: string; distM: number; source: 'TAG' | 'TRACK_PROFILE' } }
  | { type: 'HORN'; data: { on: boolean; gate: string; distM: number; reason: HornReason } }

export type HornReason = 'WITHIN_600M' | 'PASSED' | 'CANCELLED' | 'MA_SHORT' | 'STANDSTILL' | 'MODE'

interface Gate extends LcGateInfo {
  announced: boolean
  cancelled: boolean
  passed: boolean
}

export class LcWhistle {
  private readonly gates = new Map<string, Gate>()
  /** Gate the horn is currently blowing for. */
  hornFor: string | null = null

  /** Learn of a gate. The first source wins (SRS 15.3). */
  onGate(info: LcGateInfo): void {
    if (!this.gates.has(info.id)) this.gates.set(info.id, { ...info, announced: false, cancelled: false, passed: false })
  }

  /** Common/Ack pressed: cancels the current auto-whistle (SRS 15.9). Returns true if it did. */
  cancel(): LcEvent[] {
    if (!this.hornFor) return []
    const g = this.gates.get(this.hornFor)!
    g.cancelled = true
    this.hornFor = null
    return [{ type: 'HORN', data: { on: false, gate: g.id, distM: 0, reason: 'CANCELLED' } }]
  }

  get horn(): boolean {
    return this.hornFor !== null
  }

  /** Nearest gate ahead that has been announced (for the DMI). */
  nextGate(pos: { absLocM: number; dir: 1 | -1 } | null): { id: string; manning: string; distM: number } | null {
    if (!pos) return null
    let best: { id: string; manning: string; distM: number } | null = null
    for (const g of this.gates.values()) {
      if (g.passed) continue
      const d = pos.dir * (g.absLocM - pos.absLocM)
      if (d >= 0 && (!best || d < best.distM)) best = { id: g.id, manning: g.manning, distM: Math.round(d) }
    }
    return best
  }

  /**
   * @param pos OVK's estimated front position
   * @param speed OVK-measured speed magnitude, m/s
   * @param eoaAbsM end of the current MA, or null when no MA is held
   * @param modeAllows false in modes where the horn must not blow
   */
  step(pos: { absLocM: number; dir: 1 | -1 } | null, speed: number, eoaAbsM: number | null, modeAllows: boolean): LcEvent[] {
    const out: LcEvent[] = []
    if (!pos) return out
    const start = P('lcWhistleStartM')
    let want: { gate: Gate; d: number } | null = null
    let suppressed: HornReason | null = null
    for (const g of this.gates.values()) {
      if (g.passed) continue
      const d = pos.dir * (g.absLocM - pos.absLocM)
      if (d < 0) {
        g.passed = true
        continue
      }
      if (!g.announced) {
        g.announced = true
        out.push({ type: 'LC_APPROACH', data: { gate: g.id, manning: g.manning, distM: Math.round(d), source: g.source } })
      }
      if (d > start || g.cancelled) continue
      // nearest gate within range decides
      if (want && d >= want.d) continue
      const maShort = eoaAbsM !== null && pos.dir * (eoaAbsM - pos.absLocM) < d
      if (!modeAllows) suppressed = 'MODE'
      else if (maShort) suppressed = 'MA_SHORT'
      else if (speed < 0.05) suppressed = 'STANDSTILL'
      else {
        suppressed = null
        want = { gate: g, d }
        continue
      }
      want = null
    }
    const current = this.hornFor
    if (want && current !== want.gate.id) {
      if (current) out.push({ type: 'HORN', data: { on: false, gate: current, distM: 0, reason: 'PASSED' } })
      this.hornFor = want.gate.id
      out.push({ type: 'HORN', data: { on: true, gate: want.gate.id, distM: Math.round(want.d), reason: 'WITHIN_600M' } })
    } else if (!want && current) {
      const g = this.gates.get(current)!
      this.hornFor = null
      out.push({ type: 'HORN', data: { on: false, gate: current, distM: g.passed ? 0 : Math.max(Math.round(pos.dir * (g.absLocM - pos.absLocM)), 0), reason: g.passed ? 'PASSED' : (suppressed ?? 'PASSED') } })
    }
    return out
  }
}
