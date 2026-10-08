/**
 * Reference OVK — supervision: modes, braking curve, radio-failure fallback.
 *
 *  SRS 11.5.1  distances to targets use the max safe front end
 *              (estimate + location uncertainty in the direction of travel)
 *  SRS 19.2–19.3  brake curve built from the MA; the most restrictive curve governs
 *  SRS 19.4    once braking is warranted and no new info arrives, continue
 *              per the last curve
 *  SRS 20.1.2  last SVK packet older than 6 s → aspect blank, FS continues
 *  SRS 20.1.1  no packet for 30 s (absolute block) / 10 s (automatic) → radio failure
 *  SRS 20.1.3  degraded mode + acknowledgement request; no ack in 15 s → brake
 *  SRS 3.4.8.7(h) on resumption a new session; valid MA is followed again
 *  SRS 3.5.6.4(g) if distance is not enough, apply maximum brake
 *
 * Modes here are a subset (Annexure A1, the full transition table, is not in
 * our sources): SR before the first MA and after an acknowledged radio
 * failure; FS with a valid MA; TRIP after passing the EOA.
 */
import { P, kmph, mps } from '../params'
import type { Aspect, BrakeLevel } from '../schema'
import type { MaPacket } from '../svk/svk'

export type Mode = 'SR' | 'FS' | 'TRIP'
export type BrakeReason = 'CURVE' | 'OVERSPEED_EB' | 'SR_CEILING' | 'NO_ACK' | 'TRIP'

/**
 * Keys of earlier events the supervisor's events can cite. 'silence' is bench
 * knowledge (the first packet the RMS dropped), not something the OVK can see.
 */
export type CauseKey = 'ma' | 'silence' | 'blank' | 'radioFailure' | 'ackRequest' | 'trip'

export type SupervisorEvent = { cause: CauseKey[] } & (
  | { type: 'OVK_MODE'; data: { from: Mode; to: Mode; reason: string } }
  | { type: 'DMI_ASPECT_BLANK'; data: { lastPacketAgeSec: number } }
  | { type: 'DMI_ASPECT_RESTORED'; data: Record<string, never> }
  | { type: 'RADIO_FAILURE'; data: { silentSec: number; limitSec: number } }
  | { type: 'ACK_REQUEST'; data: { prompt: 'RADIO_FAILURE'; deadlineSec: number } }
  | { type: 'ACK'; data: { prompt: 'RADIO_FAILURE'; afterSec: number } }
  | { type: 'BRAKE'; data: { level: BrakeLevel | null; reason: BrakeReason | null; speedKmph: number; permittedKmph: number | null; targetDistM: number | null } }
  | { type: 'SPAD'; data: { signal: string | null; overrunM: number } }
)

export interface DmiState {
  mode: Mode
  permittedKmph: number | null
  targetDistM: number | null
  /** null = blank (SRS 20.1.2) or none known. */
  aspect: Aspect | null
  signal: string | null
  nextAspect: Aspect | null
  lastPacketAgeSec: number | null
  radioFailure: boolean
  ackPending: boolean
  brake: BrakeLevel | null
  brakeReason: BrakeReason | null
}

/** OVK's own view of where it is (from OvkPosition). */
export interface OwnPosition {
  absLocM: number
  uncertaintyM: number
  /** +1 nominal, -1 reverse. */
  dir: 1 | -1
}

interface HeldMa {
  eoaAbsM: number
  eoa: string
  signal: string | null
  aspect: Aspect | null
  nextAspect: Aspect | null
}

export class OvkSupervisor {
  mode: Mode = 'SR'
  brake: BrakeLevel | null = null
  brakeReason: BrakeReason | null = null
  private ma: HeldMa | null = null
  private lastRx: number | null = null
  private blank = false
  private radioFailedAt: number | null = null
  private ackRequestedAt: number | null = null
  private permitted: number | null = null
  private targetDist: number | null = null
  private readonly failLimitSec: number

  constructor(blockType: 'absolute' | 'automatic') {
    this.failLimitSec = blockType === 'absolute' ? P('radioFailAbsSec') : P('radioFailAutoSec')
  }

  /** An MA packet arrived over the radio. `reportAbsM` is the location it was computed from. */
  onMa(packet: MaPacket, reportAbsM: number, dir: 1 | -1, t: number): SupervisorEvent[] {
    const out: SupervisorEvent[] = []
    this.lastRx = t
    this.ma = {
      eoaAbsM: reportAbsM + dir * packet.maM,
      eoa: packet.eoa,
      signal: packet.signal,
      aspect: packet.aspect,
      nextAspect: packet.nextAspect,
    }
    if (this.blank) {
      this.blank = false
      out.push({ type: 'DMI_ASPECT_RESTORED', data: {}, cause: ['ma'] })
    }
    if (this.radioFailedAt !== null) {
      // SRS 3.4.8.7(h): new session; follow the valid MA again
      this.radioFailedAt = null
      this.ackRequestedAt = null
      if (this.brakeReason === 'NO_ACK') this.setBrake(null, null, out, ['ma'], 0)
    }
    if (this.mode === 'SR') {
      out.push({ type: 'OVK_MODE', data: { from: 'SR', to: 'FS', reason: 'valid MA received' }, cause: ['ma'] })
      this.mode = 'FS'
    }
    return out
  }

  /** Loco pilot pressed Common/Ack (SRS 3.5.5.7). */
  ack(t: number): SupervisorEvent[] {
    const out: SupervisorEvent[] = []
    if (this.ackRequestedAt === null) return out
    out.push({ type: 'ACK', data: { prompt: 'RADIO_FAILURE', afterSec: round(t - this.ackRequestedAt) }, cause: ['ackRequest'] })
    this.ackRequestedAt = null
    if (this.mode === 'FS') {
      this.mode = 'SR'
      out.push({ type: 'OVK_MODE', data: { from: 'FS', to: 'SR', reason: 'radio failure acknowledged' }, cause: ['radioFailure'] })
    }
    if (this.brakeReason === 'NO_ACK') this.setBrake(null, null, out, ['ackRequest'], 0)
    return out
  }

  get ackPending(): boolean {
    return this.ackRequestedAt !== null
  }

  /** Called every tick. `v` is OVK-measured speed (m/s). */
  step(t: number, v: number, pos: OwnPosition | null, maxKmph: number): SupervisorEvent[] {
    const out: SupervisorEvent[] = []

    // ── radio timers (SRS 20.1) ───────────────────────────
    if (this.lastRx !== null) {
      const age = t - this.lastRx
      if (!this.blank && age > P('aspectBlankSec')) {
        this.blank = true
        out.push({ type: 'DMI_ASPECT_BLANK', data: { lastPacketAgeSec: round(age) }, cause: ['ma', 'silence'] })
      }
      if (this.radioFailedAt === null && age >= this.failLimitSec) {
        this.radioFailedAt = t
        this.ackRequestedAt = t
        out.push({ type: 'RADIO_FAILURE', data: { silentSec: round(age), limitSec: this.failLimitSec }, cause: ['blank'] })
        out.push({ type: 'ACK_REQUEST', data: { prompt: 'RADIO_FAILURE', deadlineSec: P('ackWindowSec') }, cause: ['radioFailure'] })
      }
      if (this.ackRequestedAt !== null && this.brakeReason !== 'NO_ACK' && t - this.ackRequestedAt >= P('ackWindowSec')) {
        this.setBrake('FSB', 'NO_ACK', out, ['ackRequest'], v)
      }
    }

    // ── permitted speed ───────────────────────────────────
    const ceiling = mps(this.mode === 'SR' ? Math.min(P('srCeilingKmph'), maxKmph) : maxKmph)
    let permitted = ceiling
    this.targetDist = null
    if (this.mode !== 'SR' && this.ma && pos) {
      const frontMax = pos.absLocM + pos.dir * pos.uncertaintyM
      const d = pos.dir * (this.ma.eoaAbsM - frontMax)
      this.targetDist = round(d)
      const usable = Math.max(d - P('stopMarginM'), 0)
      permitted = Math.min(ceiling, Math.sqrt(2 * P('brakeCurveDecel') * usable))
      // SPAD: the estimated front itself has passed the EOA while moving
      const overrun = pos.dir * (pos.absLocM - this.ma.eoaAbsM)
      if (this.mode === 'FS' && overrun > 0 && v > 0.1) {
        this.mode = 'TRIP'
        out.push({ type: 'SPAD', data: { signal: this.ma.signal, overrunM: round(overrun) }, cause: ['ma'] })
        out.push({ type: 'OVK_MODE', data: { from: 'FS', to: 'TRIP', reason: 'passed end of authority' }, cause: ['trip'] })
      }
    }
    this.permitted = permitted

    // ── brake decisions ───────────────────────────────────
    if (this.mode === 'TRIP') {
      if (v > 0.05) {
        if (this.brake !== 'EB') this.setBrake('EB', 'TRIP', out, ['trip'], v)
      } else if (this.brake) this.setBrake(null, null, out, ['trip'], v)
      return out
    }
    if (this.brakeReason === 'NO_ACK') return out // held until ack or recovery
    const over = kmph(v - permitted)
    const reason: BrakeReason = this.mode === 'SR' ? 'SR_CEILING' : 'CURVE'
    // EB is for gross overspeed against the braking curve; coming down to the SR
    // ceiling after a mode change is done with the service brake.
    if (over > P('ebInterventionKmph') && this.mode === 'FS') {
      if (this.brake !== 'EB') this.setBrake('EB', 'OVERSPEED_EB', out, ['ma'], v)
    } else if (over > P('fsbInterventionKmph')) {
      if (!this.brake) this.setBrake('FSB', reason, out, ['ma'], v)
    } else if (this.brake) {
      // Release once well under the curve. At the end of authority (permitted ≈ 0)
      // the brake is held at a stand until the MA extends — no creeping up to the EOA.
      const holdAtStand = permitted < mps(5)
      if (over < -P('fsbReleaseKmph') && !holdAtStand) this.setBrake(null, null, out, ['ma'], v)
    }
    return out
  }

  dmi(t: number): DmiState {
    return {
      mode: this.mode,
      permittedKmph: this.permitted === null ? null : round(kmph(this.permitted)),
      targetDistM: this.targetDist,
      aspect: this.blank ? null : (this.ma?.aspect ?? null),
      signal: this.ma?.signal ?? null,
      nextAspect: this.blank ? null : (this.ma?.nextAspect ?? null),
      lastPacketAgeSec: this.lastRx === null ? null : round(t - this.lastRx),
      radioFailure: this.radioFailedAt !== null,
      ackPending: this.ackPending,
      brake: this.brake,
      brakeReason: this.brakeReason,
    }
  }

  private setBrake(level: BrakeLevel | null, reason: BrakeReason | null, out: SupervisorEvent[], cause: CauseKey[], v: number) {
    this.brake = level
    this.brakeReason = reason
    out.push({
      type: 'BRAKE',
      data: {
        level,
        reason,
        speedKmph: round(kmph(v)),
        permittedKmph: this.permitted === null ? null : round(kmph(this.permitted)),
        targetDistM: this.targetDist,
      },
      cause,
    })
  }
}

const round = (x: number) => Math.round(x * 10) / 10
