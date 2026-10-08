/**
 * Two stations and a 3 km absolute block section (docs Fig. 1).
 * Chainage runs west → east; "nominal" travel is A → B. Node x/y are schematic
 * drawing coordinates (stations drawn wider than the block), not chainage.
 *
 *            ┌──── A_LOOP (TIN 103) ────┐                 ┌──── B_LOOP (TIN 303) ────┐
 *   A_APP ──P1──── A_MAIN (TIN 102) ────P2──── BLOCK (TIN 201) ────P3──── B_MAIN (302) ────P4── B_EXIT
 *   0 m    400                        1100                       4100                   4800    5200
 */
import type { ScenarioInput } from '../engine/schema'

type TagIn = ScenarioInput['yard']['tags'] extends (infer T)[] | undefined ? T : never

/** A duplicated tag pair 3 m apart (SRS 3.4.2.2). */
const pair = (pairId: string, track: string, offsetM: number, absLocM: number, tin: number): TagIn[] => [
  { id: `${pairId}a`, pair: pairId, track, offsetM, absLocM, tin },
  { id: `${pairId}b`, pair: pairId, track, offsetM: offsetM + 3, absLocM: absLocM + 3, tin },
]

export const twoStation: ScenarioInput = {
  schemaVersion: 1,
  id: 'demo-two-station',
  title: 'Two stations, one block section',
  description:
    'A loco enters Kavach territory at Station A, derives direction and TIN from the first two tag pairs, runs the block section and is routed into Station B loop. Two faults: the pulse generators under-read by 3%, and one tag pair in the block section is withheld.',
  clauseRefs: ['SRS 7.2', 'SRS 7.3', 'SRS 7.5', 'SRS 3.4.2.4', 'SRS 3.5.4.6', 'SRS 16.6'],
  seed: 7731,
  durationSec: 330,
  yard: {
    name: 'Station A — Station B',
    nodes: [
      { id: 'n0', x: 0, y: 0 },
      { id: 'n1', x: 260, y: 0 },
      { id: 'n2', x: 960, y: 0 },
      { id: 'n3', x: 1540, y: 0 },
      { id: 'n4', x: 2240, y: 0 },
      { id: 'n5', x: 2500, y: 0 },
    ],
    tracks: [
      { id: 'A_APP', tin: 101, a: 'n0', b: 'n1', lengthM: 400 },
      { id: 'A_MAIN', tin: 102, a: 'n1', b: 'n2', lengthM: 700 },
      { id: 'A_LOOP', tin: 103, a: 'n1', b: 'n2', lengthM: 720, via: [[340, -1], [880, -1]] },
      { id: 'BLOCK', tin: 201, a: 'n2', b: 'n3', lengthM: 3000, gradientPermille: 2.5 },
      { id: 'B_MAIN', tin: 302, a: 'n3', b: 'n4', lengthM: 700 },
      { id: 'B_LOOP', tin: 303, a: 'n3', b: 'n4', lengthM: 720, via: [[1620, -1], [2160, -1]] },
      { id: 'B_EXIT', tin: 301, a: 'n4', b: 'n5', lengthM: 400 },
    ],
    points: [
      { id: 'P1', node: 'n1', toe: 'A_APP', normal: 'A_MAIN', reverse: 'A_LOOP' },
      { id: 'P2', node: 'n2', toe: 'BLOCK', normal: 'A_MAIN', reverse: 'A_LOOP' },
      { id: 'P3', node: 'n3', toe: 'BLOCK', normal: 'B_MAIN', reverse: 'B_LOOP' },
      { id: 'P4', node: 'n4', toe: 'B_EXIT', normal: 'B_MAIN', reverse: 'B_LOOP' },
    ],
    signals: [
      { id: 'S1', track: 'A_APP', offsetM: 330, facing: 'nominal', kind: 'home', initialAspect: 'Y' },
      { id: 'S3', track: 'A_MAIN', offsetM: 640, facing: 'nominal', kind: 'starter', initialAspect: 'G' },
      { id: 'S4', track: 'A_LOOP', offsetM: 660, facing: 'nominal', kind: 'starter', initialAspect: 'R' },
      { id: 'S5', track: 'BLOCK', offsetM: 180, facing: 'nominal', kind: 'lss', initialAspect: 'G' },
      { id: 'S11', track: 'BLOCK', offsetM: 2860, facing: 'nominal', kind: 'home', initialAspect: 'Y' },
      { id: 'S13', track: 'B_MAIN', offsetM: 640, facing: 'nominal', kind: 'starter', initialAspect: 'R' },
      { id: 'S14', track: 'B_LOOP', offsetM: 660, facing: 'nominal', kind: 'starter', initialAspect: 'R' },
    ],
    tags: [
      ...pair('T01', 'A_APP', 40, 40, 101),
      ...pair('T02', 'A_APP', 300, 300, 101),
      ...pair('T03', 'A_MAIN', 600, 1000, 102),
      ...pair('T04', 'A_LOOP', 620, 1000, 103),
      ...pair('T05', 'BLOCK', 100, 1200, 201),
      ...pair('T06', 'BLOCK', 950, 2050, 201),
      ...pair('T07', 'BLOCK', 1850, 2950, 201),
      ...pair('T08', 'BLOCK', 2750, 3850, 201),
      ...pair('T09', 'B_MAIN', 300, 4400, 302),
      ...pair('T10', 'B_LOOP', 310, 4400, 303),
      ...pair('T11', 'B_EXIT', 200, 5000, 301),
    ],
  },
  trains: [{ locoId: '37421', lengthM: 480, maxKmph: 110, start: { track: 'A_APP', offsetM: 5, dir: 'nominal' } }],
  timeline: [
    { atSec: 2, action: 'SET_TARGET_SPEED', train: '37421', kmph: 80 },
    { atSec: 120, action: 'SET_POINT', point: 'P3', position: 'reverse' },
    { atSec: 120, action: 'SET_POINT', point: 'P4', position: 'reverse' },
    { atSec: 120, action: 'SET_ASPECT', signal: 'S11', aspect: 'YY' },
    { atSec: 200, action: 'SET_TARGET_SPEED', train: '37421', kmph: 30 },
    { atSec: 290, action: 'SET_TARGET_SPEED', train: '37421', kmph: 0 },
  ],
  faults: [
    { id: 'pg-underread', kind: 'ODO_SCALE', train: '37421', factor: 0.97, startSec: 0 },
    { id: 'drop-T07', kind: 'RFID_DROP', tags: ['T07a', 'T07b'], startSec: 0 },
  ],
}
