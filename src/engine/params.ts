/**
 * Every number SignalSafe enforces lives here, with the clause it comes from.
 * The appendix traceability table in docs/ is generated from this file, so a
 * value must never be hard-coded elsewhere in the engine.
 *
 *  SRS = RDSO/SPN/196/2020 v4.0 Amdt-3 (System Requirements Specification of KAVACH)
 *  FRS = RDSO/GTB Kavach/FRS/2026 v1.0 draft (Generic Test Bench)
 *
 * `standIn: true` marks values that are NOT in our source documents (usually
 * because the governing annexure is unavailable). The UI and reports label
 * anything that depends on a stand-in.
 */
export interface Param {
  readonly value: number
  readonly unit: string
  readonly clause: string
  readonly label: string
  readonly standIn?: boolean
  readonly note?: string
}

const p = (value: number, unit: string, clause: string, label: string, extra: Partial<Param> = {}): Param => ({
  value,
  unit,
  clause,
  label,
  ...extra,
})

export const PARAMS = {
  // ── timing ──────────────────────────────────────────────
  tickMs: p(100, 'ms', 'design', 'Simulation tick (fixed)', { note: 'SignalSafe design choice; see docs §08' }),
  frameSec: p(2, 's', 'SRS 17.11 · 9.2', 'Radio frame cycle / OVK location report interval'),
  logIntervalSec: p(2, 's', 'SRS 21.2', 'Periodic logging interval'),

  // ── radio & fallback (used from week 4) ─────────────────
  aspectBlankSec: p(6, 's', 'SRS 20.1.2', 'Aspect blanked when last SVK packet older than'),
  radioFailAbsSec: p(30, 's', 'SRS 20.1.1', 'Radio failure declared, Absolute Block'),
  radioFailAutoSec: p(10, 's', 'SRS 20.1.1', 'Radio failure declared, Automatic Block'),
  ackWindowSec: p(15, 's', 'SRS 20.1.3', 'Loco pilot acknowledgement window before brake'),
  maHoldOnSilenceSec: p(6, 's', 'SRS 5.1', 'SVK holds FS MA after OVK silence'),
  maHoldAspectChangeSec: p(2, 's', 'SRS 5.2', 'SVK holds FS MA on aspect transition'),
  flickerHoldMinSec: p(2, 's', 'SRS 18.8', 'MA hold on signal flicker (min)'),
  flickerHoldMaxSec: p(5, 's', 'SRS 18.8', 'MA hold on signal flicker (max)'),
  deregAbsSec: p(120, 's', 'SRS 3.4.5.3', 'SVK deregisters silent loco, Absolute Block'),
  deregAutoSec: p(30, 's', 'SRS 3.4.5.3', 'SVK deregisters silent loco, Automatic Block'),

  // ── tags, linking, location ─────────────────────────────
  maxNormalTagGapM: p(1000, 'm', 'SRS 3.4.2.6', 'Max distance between two normal tags'),
  tagLocationAccuracyM: p(5, 'm', 'SRS 3.4.2.4(b)', 'RFID tag location accuracy'),
  odometryErrorFraction: p(0.05, 'ratio', 'SRS 3.4.2.4(b)', 'Odometry error per metre since last tag'),
  rfidHorizontalRangeM: p(0.75, 'm', 'SRS 3.5.4.3', 'RFID reader horizontal range (max)'),
  rfidNoMissUpToKmph: p(200, 'km/h', 'FRS 7.6.6.3', 'RFID simulator: no unintended tag miss up to'),
  odometryErrorToleranceM: p(120, 'm', 'SRS 20.7.1', 'Odometry error tolerance before SVK SoS'),

  // ── supervision (used from week 4) ──────────────────────
  rearEndMarginM: p(300, 'm', 'SRS 14.3 · 3.5.6.4(c)', 'Rear-end stopping margin behind train ahead'),
  headOnMaxStopM: p(5000, 'm', 'SRS 3.5.6.4(c)', 'Head-on prevention distance (whichever is less)'),
  rollbackM: p(5, 'm', 'SRS 13.1', 'Roll-back before intervention'),
  pgMismatchKmph: p(5, 'km/h', 'SRS 20.5.1', 'PG speed disagreement for one frame → System Failure'),
  lcWhistleStartM: p(600, 'm', 'SRS 15.8', 'LC auto-whistle start distance'),
  radioHoleExtraSec: p(10, 's', 'SRS 3.4.8.7(g)', 'Radio-hole distance margin (× current speed)'),
  trainLengthAccuracyM: p(25, 'm', 'SRS 8.1.4', 'Train length accuracy'),

  // ── bench accuracy ──────────────────────────────────────
  speedSimMaxDeviation: p(0.01, 'ratio', 'FRS 7.6.5.5', 'Speed simulator deviation from theoretical (max)'),

  // ── dynamics stand-ins (Annexure O not available) ───────
  tractionAccel: p(0.35, 'm/s²', 'stand-in', 'Traction acceleration on level track', { standIn: true, note: 'Loco-dependent; Annexure O / train config' }),
  driverServiceDecel: p(0.5, 'm/s²', 'stand-in', 'Driver service-brake deceleration', { standIn: true }),
  nbDecel: p(0.3, 'm/s²', 'stand-in', 'Normal Brake deceleration', { standIn: true, note: 'Annexure O (braking algorithm) not available' }),
  fsbDecel: p(0.6, 'm/s²', 'stand-in', 'Full-Service Brake deceleration', { standIn: true, note: 'Annexure O not available' }),
  ebDecel: p(1.0, 'm/s²', 'stand-in', 'Emergency Brake deceleration', { standIn: true, note: 'Annexure O not available' }),
  gravity: p(9.81, 'm/s²', 'physics', 'Gravitational acceleration'),
} as const satisfies Record<string, Param>

export type ParamKey = keyof typeof PARAMS

/** Value of a parameter. Scenarios may override configurable values later. */
export const P = (key: ParamKey): number => PARAMS[key].value

export const DT = P('tickMs') / 1000
export const TICKS_PER_FRAME = Math.round(P('frameSec') / DT)
export const kmph = (mps: number) => mps * 3.6
export const mps = (kmphValue: number) => kmphValue / 3.6
