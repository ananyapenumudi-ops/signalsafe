/**
 * Scenario library. S01 and S05 follow docs §04; all reuse the two-station yard.
 */
import type { ScenarioInput } from '../engine/schema'
import { twoStation } from './twoStation'

const yard = twoStation.yard
const loco = twoStation.trains[0]!

/** Same yard with some signal aspects changed. */
function withAspects(aspects: Record<string, 'R' | 'Y' | 'YY' | 'G'>): ScenarioInput['yard'] {
  return { ...yard, signals: (yard.signals ?? []).map((s) => (aspects[s.id] ? { ...s, initialAspect: aspects[s.id] } : s)) }
}

/** S01 · Stop short of a red: the pilot keeps notching up; Kavach must stop the train before S11. */
export const s01: ScenarioInput = {
  schemaVersion: 1,
  id: 's01-stop-short-of-red',
  title: 'S01 · Stop short of a red',
  description:
    'Station B home signal S11 is at danger. The loco pilot ignores it and keeps notching up to 90 km/h. Kavach must supervise the braking curve to S11, apply the brakes and stop the train short of the signal, then hold it at a stand.',
  clauseRefs: ['SRS 12', 'SRS 19.2', 'SRS 19.3', 'SRS 3.5.7.1', 'SRS 11.5.1'],
  seed: 101,
  durationSec: 300,
  yard: withAspects({ S1: 'Y', S3: 'G', S5: 'G', S11: 'R' }),
  trains: [{ ...loco, driver: { acksAfterSec: 3, obeysKavach: false, releasesBrakesAtStand: false } }],
  timeline: [{ atSec: 2, action: 'SET_TARGET_SPEED', train: loco.locoId, kmph: 90 }],
  faults: [],
}

/** S05 · Radio goes silent (no acknowledgement): blank at 6 s, failure at 30 s, FSB after 15 s. */
export const s05: ScenarioInput = {
  schemaVersion: 1,
  id: 's05-radio-silent',
  title: 'S05 · Radio goes silent',
  description:
    'In the absolute block section the radio goes quiet in both directions at 110 s. The DMI should blank the aspect after 6 s while Full Supervision continues, declare a radio failure at 30 s and ask the pilot to acknowledge. Nobody does, so Kavach applies the full-service brake 15 s later.',
  clauseRefs: ['SRS 20.1.1', 'SRS 20.1.2', 'SRS 20.1.3', 'SRS 5.1'],
  seed: 505,
  durationSec: 220,
  yard: withAspects({ S1: 'Y', S3: 'G', S5: 'G', S11: 'Y' }),
  trains: [{ ...loco, driver: { acksAfterSec: null, obeysKavach: true, releasesBrakesAtStand: false } }],
  timeline: [{ atSec: 2, action: 'SET_TARGET_SPEED', train: loco.locoId, kmph: 80 }],
  faults: [{ id: 'radio-silent', kind: 'RADIO_LOSS', direction: 'both', startSec: 110 }],
}

/** S05b · Same, but the pilot acknowledges: degraded to Staff Responsible, no brake. */
export const s05b: ScenarioInput = {
  ...s05,
  id: 's05b-radio-silent-ack',
  title: 'S05b · Radio silent, pilot acknowledges',
  description:
    'As S05, but the loco pilot acknowledges the radio-failure prompt after 4 s. Kavach drops to Staff Responsible instead of braking, and the pilot continues at the SR ceiling. When the radio returns at 190 s a new session starts and Full Supervision resumes.',
  seed: 506,
  trains: [{ ...loco, driver: { acksAfterSec: 4, obeysKavach: true, releasesBrakesAtStand: false } }],
  faults: [{ id: 'radio-silent', kind: 'RADIO_LOSS', direction: 'both', startSec: 110, endSec: 190 }],
}

const second = (over: Partial<ScenarioInput['trains'][number]>): ScenarioInput['trains'][number] => ({
  locoId: '22910',
  lengthM: 420,
  maxKmph: 110,
  start: { track: 'BLOCK', offsetM: 2900, dir: 'reverse' },
  driver: { acksAfterSec: 3, obeysKavach: true, releasesBrakesAtStand: false },
  ...over,
})

/** S03 · Head-on in the block section: both locos get SoS and brake (SRS 14.2, 14.7). */
export const s03: ScenarioInput = {
  schemaVersion: 1,
  id: 's03-head-on',
  title: 'S03 · Head-on in block section',
  description:
    'An interlocking error clears signals at both ends of the block section, so 37421 (from Station A) and 22910 (from Station B) both enter TIN 201 heading for each other. Once both are registered, the stationary side sees two locos approaching on the same TIN and sends loco-specific SoS to both. Both brake immediately, and the brakes release at 0 km/h.',
  clauseRefs: ['SRS 14.1', 'SRS 14.2', 'SRS 14.4', 'SRS 14.5', 'SRS 14.7', 'SRS 7.6'],
  seed: 303,
  durationSec: 160,
  yard: withAspects({ S1: 'Y', S3: 'G', S5: 'G', S11: 'Y', S22: 'G', S24: 'G', S26: 'Y' }),
  trains: [
    { ...loco, start: { track: 'A_MAIN', offsetM: 300, dir: 'nominal', preset: true }, driver: { acksAfterSec: 3, obeysKavach: true, releasesBrakesAtStand: false } },
    second({ start: { track: 'B_MAIN', offsetM: 500, dir: 'reverse', preset: true } }),
  ],
  timeline: [
    { atSec: 2, action: 'SET_TARGET_SPEED', train: loco.locoId, kmph: 80 },
    { atSec: 2, action: 'SET_TARGET_SPEED', train: '22910', kmph: 80 },
  ],
  faults: [],
}

/** S04 · Rear-end following: only the rear loco brakes, stopping ≥ 300 m behind (SRS 14.3). */
export const s04: ScenarioInput = {
  schemaVersion: 1,
  id: 's04-rear-end',
  title: 'S04 · Rear-end following',
  description:
    'A slow goods train, 22910, crawls through the block section at 25 km/h. 37421 follows it on the same TIN, and its pilot keeps notching up toward 90 km/h. The stationary side sends a rear-end target to the rear loco only: it must slow and stay 300 m or more behind the train ahead. The front loco never brakes for it.',
  clauseRefs: ['SRS 14.1', 'SRS 14.3', 'SRS 3.5.6.4(c)'],
  seed: 404,
  durationSec: 260,
  yard: withAspects({ S1: 'Y', S3: 'G', S5: 'G', S11: 'G', S13: 'G' }),
  trains: [
    { ...loco, start: { track: 'A_MAIN', offsetM: 300, dir: 'nominal', preset: true }, driver: { acksAfterSec: 3, obeysKavach: false, releasesBrakesAtStand: false } },
    second({ start: { track: 'BLOCK', offsetM: 1100, dir: 'nominal', preset: true }, maxKmph: 60 }),
  ],
  timeline: [
    { atSec: 2, action: 'SET_TARGET_SPEED', train: loco.locoId, kmph: 90 },
    { atSec: 2, action: 'SET_TARGET_SPEED', train: '22910', kmph: 25 },
  ],
  faults: [],
}

/** S08 · Roll back on a gradient (SRS 13.1). */
export const s08: ScenarioInput = {
  schemaVersion: 1,
  id: 's08-rollback',
  title: 'S08 · Roll back on a gradient',
  description:
    'The block section rises at 8‰. 37421 stops halfway up and its pilot releases the brakes, so the train starts rolling backwards, against its cab direction. Past 5 m Kavach applies the brake and warns. When the pilot takes power again at 120 s, the brake releases and the train climbs on.',
  clauseRefs: ['SRS 13.1', 'SRS 13.2', 'SRS 13.4', 'SRS 13.5', 'SRS 21.3(h)'],
  seed: 808,
  durationSec: 200,
  yard: {
    ...withAspects({ S1: 'Y', S3: 'G', S5: 'G', S11: 'Y' }),
    tracks: (yard.tracks ?? []).map((t) => (t.id === 'BLOCK' ? { ...t, gradientPermille: 8 } : t)),
  },
  trains: [{ ...loco, start: { track: 'BLOCK', offsetM: 300, dir: 'nominal', preset: true }, driver: { acksAfterSec: 3, obeysKavach: true, releasesBrakesAtStand: true } }],
  timeline: [
    { atSec: 2, action: 'SET_TARGET_SPEED', train: loco.locoId, kmph: 40 },
    { atSec: 30, action: 'SET_TARGET_SPEED', train: loco.locoId, kmph: 0 },
    { atSec: 120, action: 'SET_TARGET_SPEED', train: loco.locoId, kmph: 40 },
  ],
  faults: [],
}

export const LIBRARY: { scenario: ScenarioInput; status: 'demo' | 'scenario' }[] = [
  { scenario: twoStation, status: 'demo' },
  { scenario: s01, status: 'scenario' },
  { scenario: s05, status: 'scenario' },
  { scenario: s05b, status: 'scenario' },
  { scenario: s03, status: 'scenario' },
  { scenario: s04, status: 'scenario' },
  { scenario: s08, status: 'scenario' },
]
