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
  trains: [{ ...loco, driver: { acksAfterSec: 3, obeysKavach: false } }],
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
  trains: [{ ...loco, driver: { acksAfterSec: null, obeysKavach: true } }],
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
  trains: [{ ...loco, driver: { acksAfterSec: 4, obeysKavach: true } }],
  faults: [{ id: 'radio-silent', kind: 'RADIO_LOSS', direction: 'both', startSec: 110, endSec: 190 }],
}

export const LIBRARY: { scenario: ScenarioInput; status: 'demo' | 'scenario' }[] = [
  { scenario: twoStation, status: 'demo' },
  { scenario: s01, status: 'scenario' },
  { scenario: s05, status: 'scenario' },
  { scenario: s05b, status: 'scenario' },
]
