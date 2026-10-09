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
  expect: [
    { id: 'fs', label: 'Enters Full Supervision on the first MA', clause: 'SRS 17.3', event: 'OVK_MODE', filters: { to: 'FS' } },
    { id: 'curve', label: 'Brakes on the curve to S11', clause: 'SRS 19.3', event: 'BRAKE', filters: { level: 'FSB', reason: 'CURVE' }, at: { after: 'fs' } },
    { id: 'stop', label: 'Stops 0–15 m short of S11 (SRS asks ≤ 5 m in 90% of runs)', clause: 'SRS 3.5.7.1', event: 'OVK_STATUS', filters: { speedKmph: 0 }, at: { after: 'curve', locM: [3945, 3959.9] } },
    { id: 'no-pass', label: 'Never passes S11 at danger', clause: 'SRS 12', expect: 'absent', event: 'SIGNAL_PASSED', filters: { signal: 'S11' } },
    { id: 'no-trip', label: 'No trip', clause: 'SRS 12', expect: 'absent', event: 'SPAD' },
  ],
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
  expect: [
    { id: 'blank', label: 'Aspect blanks 6–8 s into the silence', clause: 'SRS 20.1.2', event: 'DMI_ASPECT_BLANK', at: { after: 'fault:radio-silent', sec: [6, 8] } },
    { id: 'fs-kept', label: 'Full Supervision continues while blank', clause: 'SRS 20.1.2', expect: 'absent', event: 'OVK_MODE', at: { after: 'fault:radio-silent', sec: [0, 29.9] } },
    { id: 'fail', label: 'Radio failure declared at 30 s', clause: 'SRS 20.1.1', event: 'RADIO_FAILURE', at: { after: 'fault:radio-silent', sec: [30, 32] } },
    { id: 'ask', label: 'Pilot asked to acknowledge', clause: 'SRS 20.1.3', event: 'ACK_REQUEST', at: { after: 'fail', sec: [0, 0.1] } },
    { id: 'fsb', label: 'FSB 15 s later without an ack', clause: 'SRS 20.1.3', event: 'BRAKE', filters: { level: 'FSB', reason: 'NO_ACK' }, at: { after: 'ask', sec: [15, 15.2] } },
    { id: 'stand', label: 'Train brought to a stand', clause: 'SRS 20.1.3', event: 'OVK_STATUS', filters: { speedKmph: 0 }, at: { after: 'fsb' } },
  ],
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
  expect: [
    { id: 'blank', label: 'Aspect blanks 6–8 s into the silence', clause: 'SRS 20.1.2', event: 'DMI_ASPECT_BLANK', at: { after: 'fault:radio-silent', sec: [6, 8] } },
    { id: 'fail', label: 'Radio failure declared at 30 s', clause: 'SRS 20.1.1', event: 'RADIO_FAILURE', at: { after: 'fault:radio-silent', sec: [30, 32] } },
    { id: 'ack', label: 'Pilot acknowledges within 15 s', clause: 'SRS 3.5.5.7', event: 'ACK', at: { after: 'fail', sec: [0, 15] } },
    { id: 'sr', label: 'Degrades to Staff Responsible', clause: 'SRS 20.1.3', event: 'OVK_MODE', filters: { to: 'SR' }, at: { after: 'ack', sec: [0, 0.1] } },
    { id: 'no-noack', label: 'No brake for a missing ack', clause: 'SRS 20.1.3', expect: 'absent', event: 'BRAKE', filters: { reason: 'NO_ACK' } },
    { id: 'no-eb', label: 'Slows to the SR ceiling without an EB', clause: 'Annex A2 (stand-in)', expect: 'absent', event: 'BRAKE', filters: { level: 'EB' } },
    { id: 'restored', label: 'Aspect restored when the radio returns at 190 s', clause: 'SRS 3.4.8.7(h)', event: 'DMI_ASPECT_RESTORED', at: { sec: [190, 192] } },
    { id: 'fs-again', label: 'New session: Full Supervision resumes', clause: 'SRS 3.4.8.7(h)', event: 'OVK_MODE', filters: { to: 'FS' }, at: { after: 'restored', sec: [0, 0.1] } },
  ],
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
  expect: [
    { id: 'sos', label: 'Head-on detected: SoS to both locos', clause: 'SRS 14.7', event: 'SVK_SOS', filters: { kind: 'HEAD_ON' } },
    { id: 'eb-a', label: '37421 applies EB immediately', clause: 'SRS 14.2', event: 'BRAKE', filters: { train: '37421', level: 'EB', reason: 'HEAD_ON' }, at: { after: 'sos', sec: [0, 0.2] } },
    { id: 'eb-b', label: '22910 applies EB immediately', clause: 'SRS 14.2', event: 'BRAKE', filters: { train: '22910', level: 'EB', reason: 'HEAD_ON' }, at: { after: 'sos', sec: [0, 0.2] } },
    { id: 'rel-a', label: '37421 brakes released at 0 km/h', clause: 'SRS 14.4', event: 'BRAKE', filters: { train: '37421', level: null, speedKmph: 0 }, at: { after: 'eb-a' } },
    { id: 'rel-b', label: '22910 brakes released at 0 km/h', clause: 'SRS 14.4', event: 'BRAKE', filters: { train: '22910', level: null, speedKmph: 0 }, at: { after: 'eb-b' } },
    { id: 'no-crash', label: 'No collision', clause: 'SRS 14.1', expect: 'absent', event: 'COLLISION' },
  ],
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
  expect: [
    { id: 'warn', label: 'Rear-end warning on the rear loco', clause: 'SRS 14.3', event: 'COLLISION_ALERT', filters: { train: '37421', kind: 'REAR_END' } },
    { id: 'brake', label: 'Rear loco brakes to keep 300 m', clause: 'SRS 14.3', event: 'BRAKE', filters: { train: '37421', reason: 'REAR_END' }, at: { after: 'warn' } },
    { id: 'front-quiet', label: 'No rear-end message on the front loco', clause: 'SRS 14.3', expect: 'absent', event: 'COLLISION_ALERT', filters: { train: '22910' } },
    { id: 'front-no-brake', label: 'Front loco never brakes for it', clause: 'SRS 14.3', expect: 'absent', event: 'BRAKE', filters: { train: '22910' } },
    { id: 'no-crash', label: 'No collision', clause: 'SRS 14.1', expect: 'absent', event: 'COLLISION' },
  ],
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
  expect: [
    { id: 'rb', label: 'Roll-back detected at 5 m', clause: 'SRS 13.1', event: 'ROLLBACK', filters: { distanceM: { gte: 5, lte: 5.5 } } },
    { id: 'brake', label: 'Brake applied with warning', clause: 'SRS 13.1 · 13.5', event: 'BRAKE', filters: { level: 'FSB', reason: 'ROLLBACK' }, at: { after: 'rb', sec: [0, 0.1] } },
    { id: 'held', label: 'Held until the pilot takes power at 120 s', clause: 'SRS 13.3', expect: 'absent', event: 'BRAKE', filters: { level: null }, at: { sec: [55, 119.9] } },
    { id: 'release', label: 'Released when the pilot takes power', clause: 'SRS 3.5.6.3(d)', event: 'BRAKE', filters: { level: null }, at: { sec: [120, 121] } },
  ],
}

/** S11 · LC gate auto-whistle (SRS 15). */
export const s11: ScenarioInput = {
  schemaVersion: 1,
  id: 's11-lc-whistle',
  title: 'S11 · LC gate auto-whistle',
  description:
    'Approach to manned LC gate 42-A in the block section. The track profile announces the gate on the DMI as soon as the MA covers it. Kavach blows the horn continuously from 600 m until the train reaches the gate.',
  clauseRefs: ['SRS 15.2', 'SRS 15.3', 'SRS 15.8'],
  seed: 1101,
  durationSec: 140,
  yard: withAspects({ S1: 'Y', S3: 'G', S5: 'G', S11: 'Y' }),
  trains: [{ ...loco, start: { track: 'BLOCK', offsetM: 300, dir: 'nominal', preset: true } }],
  timeline: [{ atSec: 2, action: 'SET_TARGET_SPEED', train: loco.locoId, kmph: 60 }],
  faults: [],
  expect: [
    { id: 'announce', label: 'DMI announces LC 42-A from the track profile', clause: 'SRS 15.2', event: 'LC_APPROACH', filters: { gate: 'LC42A' } },
    { id: 'on', label: 'Horn on from 600 m', clause: 'SRS 15.8', event: 'HORN', filters: { on: true, distM: { gte: 590, lte: 600 } }, at: { after: 'announce' } },
    { id: 'off', label: 'Horn off on reaching the gate', clause: 'SRS 15.8', event: 'HORN', filters: { on: false, reason: 'PASSED' }, at: { after: 'on', locM: [2495, 2510] } },
  ],
}

/** S11b · MA ends short of the LC gate: no horn (SRS 15.4). */
export const s11b: ScenarioInput = {
  ...s11,
  id: 's11b-lc-ma-short',
  title: 'S11b · LC gate, MA short of the gate',
  description:
    'Interlocked gate signal S30 stands at danger 50 m before LC 42-A, so the movement authority ends short of the gate. Kavach must not blow the horn for a gate the train has no authority to reach.',
  clauseRefs: ['SRS 15.4'],
  seed: 1102,
  durationSec: 200,
  yard: {
    ...withAspects({ S1: 'Y', S3: 'G', S5: 'G', S11: 'Y' }),
    signals: [
      ...(withAspects({ S1: 'Y', S3: 'G', S5: 'G', S11: 'Y' }).signals ?? []),
      { id: 'S30', track: 'BLOCK', offsetM: 1350, facing: 'nominal', kind: 'gate', initialAspect: 'R' },
    ],
    stations: (yard.stations ?? []).map((st) => (st.id === 'SVK-A' ? { ...st, signals: [...st.signals, 'S30'] } : st)),
  },
  expect: [
    { id: 'announce', label: 'DMI announces LC 42-A', clause: 'SRS 15.2', event: 'LC_APPROACH', filters: { gate: 'LC42A' } },
    { id: 'no-horn', label: 'No horn: MA ends short of the gate', clause: 'SRS 15.4', expect: 'absent', event: 'HORN', filters: { on: true } },
    { id: 'no-pass', label: 'Train stops at gate signal S30', clause: 'SRS 12', expect: 'absent', event: 'SIGNAL_PASSED', filters: { signal: 'S30' } },
  ],
}

/** S11c · Stopped inside the whistle zone: horn stops at standstill and resumes (SRS 15.5). */
export const s11c: ScenarioInput = {
  ...s11,
  id: 's11c-lc-standstill',
  title: 'S11c · LC gate, stopped at 400 m',
  description:
    'The train enters the 600 m whistle zone, then stops about 480 m from LC 42-A. The horn must stop while the train stands, and resume when it moves off until the gate is reached.',
  clauseRefs: ['SRS 15.5', 'SRS 15.8'],
  seed: 1103,
  durationSec: 160,
  trains: [{ ...loco, start: { track: 'BLOCK', offsetM: 700, dir: 'nominal', preset: true } }],
  timeline: [
    { atSec: 2, action: 'SET_TARGET_SPEED', train: loco.locoId, kmph: 30 },
    { atSec: 30, action: 'SET_TARGET_SPEED', train: loco.locoId, kmph: 0 },
    { atSec: 60, action: 'SET_TARGET_SPEED', train: loco.locoId, kmph: 30 },
  ],
  expect: [
    { id: 'on', label: 'Horn on from 600 m', clause: 'SRS 15.8', event: 'HORN', filters: { on: true } },
    { id: 'stand', label: 'Horn off while at a stand', clause: 'SRS 15.5', event: 'HORN', filters: { on: false, reason: 'STANDSTILL' }, at: { after: 'on' } },
    { id: 'resume', label: 'Horn resumes on moving off', clause: 'SRS 15.8', event: 'HORN', filters: { on: true }, at: { after: 'stand' } },
    { id: 'off', label: 'Horn off on reaching the gate', clause: 'SRS 15.8', event: 'HORN', filters: { on: false, reason: 'PASSED' }, at: { after: 'resume', locM: [2495, 2510] } },
  ],
}

export const LIBRARY: { scenario: ScenarioInput; status: 'demo' | 'scenario' }[] = [
  { scenario: twoStation, status: 'demo' },
  { scenario: s01, status: 'scenario' },
  { scenario: s05, status: 'scenario' },
  { scenario: s05b, status: 'scenario' },
  { scenario: s03, status: 'scenario' },
  { scenario: s04, status: 'scenario' },
  { scenario: s08, status: 'scenario' },
  { scenario: s11, status: 'scenario' },
  { scenario: s11b, status: 'scenario' },
  { scenario: s11c, status: 'scenario' },
]
