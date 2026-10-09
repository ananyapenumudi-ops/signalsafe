/**
 * Reference OVK — supervision: modes, braking curve, radio fallback,
 * collision response and roll-back protection.
 *
 *  SRS 11.5.1  distances to targets use the max safe front end
 *  SRS 19.1–19.3  several situations at once → act on the most restrictive
 *  SRS 19.4    once braking is warranted and no new info arrives, continue
 *  SRS 20.1.2  last SVK packet older than 6 s → aspect blank, FS continues
 *  SRS 20.1.1  no packet for 30 s (absolute) / 10 s (automatic) → radio failure
 *  SRS 20.1.3  degraded mode + ack request; no ack in 15 s → brake
 *  SRS 3.4.8.7(h) on resumption a new session; valid MA is followed again
 *  SRS 3.5.6.4(g) not enough distance → maximum brake
 *  SRS 14.2–14.5  head-on: brake immediately; rear-end: rear loco stops
 *              300 m short; brakes released at 0 km/h and withdrawn when
 *              the situation is over
 *  SRS 13.1–13.5  roll-back > 5 m against the cab direction → brake + warning
 *
 * Modes are a subset (Annexure A1 is not in our sources): SR before the
 * first MA and after an acknowledged radio failure; FS with a valid MA;
 * TRIP after passing the EOA.
 */
import { P, kmph, mps } from '../params'
import type { Aspect, BrakeLevel } from '../schema'
import type { Threat } from '../svk/collision'
import type { MaPacket } from '../svk/svk'

export type Mode = 'SR' | 'FS' | 'TRIP'
export type BrakeReason = 'CURVE' | 'OVERSPEED_EB' | 'SR_CEILING' | 'NO_ACK' | 'TRIP' | 'HEAD_ON' | 'REAR_END' | 'ROLLBACK'

/**
 * Keys of earlier events the supervisor's events can cite. 'silence' is bench
 * knowledge (the first packet the RMS dropped), not something the OVK can see.
 */
export type CauseKey = 'ma' | 'silence' | 'blank' | 'radioFailure' | 'ackRequest' | 'trip' | 'threat' | 'rollback' | 'lc' | 'lcApproach'

export type SupervisorEvent = { cause: CauseKey[] } & (
  | { type: 'OVK_MODE'; data: { from: Mode; to: Mode; reason: string } }
  | { type: 'DMI_ASPECT_BLANK'; data: { lastPacketAgeSec: number } }
  | { type: 'DMI_ASPECT_RESTORED'; data: Record<string, never> }
  | { type: 'RADIO_FAILURE'; data: { silentSec: number; limitSec: number } }
  | { type: 'ACK_REQUEST'; data: { prompt: 'RADIO_FAILURE'; deadlineSec: number } }
  | { type: 'ACK'; data: { prompt: 'RADIO_FAILURE'; afterSec: number } }
  | { type: 'BRAKE'; data: { level: BrakeLevel | null; reason: BrakeReason | null; speedKmph: number; permittedKmph: number | null; targetDistM: number | null } }
  | { type: 'SPAD'; data: { signal: string | null; overrunM: number } }
  | { type: 'COLLISION_ALERT'; data: { kind: Threat['kind']; other: string; gapM: number } }
  | { type: 'COLLISION_CLEAR'; data: { kind: Threat['kind']; other: string } }
  | { type: 'ROLLBACK'; data: { distanceM: number } }
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
  /** Collision message shown on the DMI (SRS 14.3: rear-end only to the rear loco). */
  threat: { kind: Threat['kind']; other: string; gapM: number } | null
  rollback: boolean
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

const RANK: Record<BrakeLevel, number> = { NB: 1, FSB: 2, EB: 3 }

export class OvkSupervisor {
  mode: Mode = 'SR'
  brake: BrakeLevel | null = null
  brakeReason: BrakeReason | null = null
  private ma: HeldMa | null = null
  private threat: Threat | null = null
  private lastRx: number | null = null
  private blank = false
  private radioFailedAt: number | null = null
  private ackRequestedAt: number | null = null
  private noAckLatched = false
  private curveBraking = false
  private backM = 0
  private rollbackLatched = false
  private lastT: number | null = null
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
    this.ma = { eoaAbsM: reportAbsM + dir * packet.maM, eoa: packet.eoa, signal: packet.signal, aspect: packet.aspect, nextAspect: packet.nextAspect }
    const next = packet.threat ?? null
    if (this.threat && (!next || next.kind !== this.threat.kind || next.other !== this.threat.other)) {
      out.push({ type: 'COLLISION_CLEAR', data: { kind: this.threat.kind, other: this.threat.other }, cause: ['ma'] })
    }
    if (next && (!this.threat || next.kind !== this.threat.kind || next.other !== this.threat.other)) {
      out.push({ type: 'COLLISION_ALERT', data: { kind: next.kind, other: next.other, gapM: next.gapM }, cause: ['ma'] })
    }
    this.threat = next
    if (this.blank) {
      this.blank = false
      out.push({ type: 'DMI_ASPECT_RESTORED', data: {}, cause: ['ma'] })
    }
    if (this.radioFailedAt !== null) {
      // SRS 3.4.8.7(h): new session; follow the valid MA again
      this.radioFailedAt = null
      this.ackRequestedAt = null
      this.noAckLatched = false
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
    this.noAckLatched = false
    if (this.mode === 'FS') {
      this.mode = 'SR'
      out.push({ type: 'OVK_MODE', data: { from: 'FS', to: 'SR', reason: 'radio failure acknowledged' }, cause: ['radioFailure'] })
    }
    return out
  }

  /** End of the held MA (absolute), for the LC whistle's "MA short of gate" check. */
  get eoaAbsM(): number | null {
    return this.ma?.eoaAbsM ?? null
  }

  get ackPending(): boolean {
    return this.ackRequestedAt !== null
  }

  /**
   * Called every tick.
   * @param v signed OVK-measured speed along the cab direction (negative = rolling back)
   * @param tractionDemanded the pilot is calling for power (releases a roll-back brake at a stand)
   */
  step(t: number, v: number, pos: OwnPosition | null, maxKmph: number, tractionDemanded = false): SupervisorEvent[] {
    const out: SupervisorEvent[] = []
    const dt = this.lastT === null ? 0 : t - this.lastT
    this.lastT = t
    const speed = Math.abs(v)

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
      if (this.ackRequestedAt !== null && t - this.ackRequestedAt >= P('ackWindowSec')) this.noAckLatched = true
    }

    // ── roll-back (SRS 13.1) ──────────────────────────────
    if (v < 0) this.backM += -v * dt
    else if (v > 0.05) this.backM = 0
    if (!this.rollbackLatched && this.backM > P('rollbackM')) {
      this.rollbackLatched = true
      out.push({ type: 'ROLLBACK', data: { distanceM: round(this.backM) }, cause: [] })
    }
    if (this.rollbackLatched && speed < 0.05 && tractionDemanded) {
      this.rollbackLatched = false
      this.backM = 0
    }

    // ── permitted speed: most restrictive of ceiling, MA curve, rear-end curve ──
    const ceiling = mps(this.mode === 'SR' ? Math.min(P('srCeilingKmph'), maxKmph) : maxKmph)
    let permitted = ceiling
    let binding: BrakeReason = this.mode === 'SR' ? 'SR_CEILING' : 'CURVE'
    this.targetDist = null
    if (pos && this.mode !== 'SR') {
      const frontMax = pos.absLocM + pos.dir * pos.uncertaintyM
      const curveTo = (targetAbs: number) => {
        const d = pos.dir * (targetAbs - frontMax)
        return { d, v: Math.sqrt(2 * P('brakeCurveDecel') * Math.max(d - P('stopMarginM'), 0)) }
      }
      if (this.ma) {
        const c = curveTo(this.ma.eoaAbsM)
        this.targetDist = round(c.d)
        if (c.v < permitted) {
          permitted = c.v
          binding = 'CURVE'
        }
        // SPAD: the estimated front itself has passed the EOA while moving forward
        const overrun = pos.dir * (pos.absLocM - this.ma.eoaAbsM)
        if (this.mode === 'FS' && overrun > 0 && v > 0.1) {
          this.mode = 'TRIP'
          out.push({ type: 'SPAD', data: { signal: this.ma.signal, overrunM: round(overrun) }, cause: ['ma'] })
          out.push({ type: 'OVK_MODE', data: { from: 'FS', to: 'TRIP', reason: 'passed end of authority' }, cause: ['trip'] })
        }
      }
      // head-on SoS: no movement authority toward the other loco
      if (this.threat?.kind === 'HEAD_ON') {
        permitted = 0
        binding = 'HEAD_ON'
      }
      if (this.threat?.kind === 'REAR_END') {
        const c = curveTo(this.threat.targetAbsM)
        if (c.v < permitted) {
          permitted = c.v
          binding = 'REAR_END'
          this.targetDist = round(c.d)
        }
      }
    }
    this.permitted = permitted

    // ── brake demands; the most restrictive wins (SRS 19.1) ──
    let want: { level: BrakeLevel; reason: BrakeReason; cause: CauseKey[] } | null = null
    const consider = (level: BrakeLevel, reason: BrakeReason, cause: CauseKey[]) => {
      if (!want || RANK[level] > RANK[want.level]) want = { level, reason, cause }
    }
    if (this.mode === 'TRIP' && speed > 0.05) consider('EB', 'TRIP', ['trip'])
    // head-on: brake immediately, released at 0 km/h (14.4) or when over (14.5)
    if (this.threat?.kind === 'HEAD_ON' && speed > 0.05) consider('EB', 'HEAD_ON', ['threat'])
    if (this.noAckLatched) consider('FSB', 'NO_ACK', ['ackRequest'])
    if (this.rollbackLatched) consider('FSB', 'ROLLBACK', ['rollback'])
    // Under a head-on SoS the EB above does the work and is released at 0 km/h
    // (SRS 14.4); the zero permitted speed only tells the pilot not to move.
    if (binding === 'HEAD_ON') this.curveBraking = false
    else if (this.mode !== 'TRIP' && v >= 0) {
      const over = kmph(speed - permitted)
      const cause: CauseKey[] = binding === 'REAR_END' ? ['threat'] : ['ma']
      if (over > P('ebInterventionKmph') && this.mode === 'FS') {
        this.curveBraking = true
        consider('EB', binding === 'REAR_END' ? 'REAR_END' : 'OVERSPEED_EB', cause)
      } else if (over > P('fsbInterventionKmph')) {
        this.curveBraking = true
        consider('FSB', binding, cause)
      } else if (this.curveBraking) {
        // released once well under the curve; held at a stand when permitted ≈ 0
        if (over < -P('fsbReleaseKmph') && permitted >= mps(5)) this.curveBraking = false
        else consider('FSB', binding, cause)
      }
    }
    const w = want as { level: BrakeLevel; reason: BrakeReason; cause: CauseKey[] } | null
    if ((w?.level ?? null) !== this.brake || (w?.reason ?? null) !== this.brakeReason) {
      this.setBrake(w?.level ?? null, w?.reason ?? null, out, w?.cause ?? (this.brakeReason === 'HEAD_ON' ? ['threat'] : ['ma']), v)
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
      threat: this.threat ? { kind: this.threat.kind, other: this.threat.other, gapM: this.threat.gapM } : null,
      rollback: this.rollbackLatched,
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
        speedKmph: round(kmph(Math.abs(v))),
        permittedKmph: this.permitted === null ? null : round(kmph(this.permitted)),
        targetDistM: this.targetDist,
      },
      cause,
    })
  }
}

const round = (x: number) => Math.round(x * 10) / 10
