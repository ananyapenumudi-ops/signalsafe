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
    'A loco enters Kavach territory at Station A, derives direction and TIN from the first two tag pairs, registers with SVK-A and receives movement authority. Faults: the pulse generators under-read by 3%, a tag pair in the block is withheld, point P2 loses detection under a cleared signal, and Station B home signal S11 flickers on approach.',
  clauseRefs: ['SRS 7.2', 'SRS 7.5', 'SRS 3.4.2.4', 'SRS 16.6', 'SRS 17.3', 'SRS 5.4', 'SRS 12.1', 'SRS 5.2', 'SRS 18.8'],
  seed: 7731,
  durationSec: 370,
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
      { id: 'BLOCK', tin: 201, a: 'n2', b: 'n3', lengthM: 3000, gradientPermille: 2.5, section: 'block' },
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
      // down direction (Station B → Station A)
      { id: 'S22', track: 'B_MAIN', offsetM: 60, facing: 'reverse', kind: 'starter', initialAspect: 'R' },
      { id: 'S24', track: 'BLOCK', offsetM: 2820, facing: 'reverse', kind: 'lss', initialAspect: 'R' },
      { id: 'S26', track: 'BLOCK', offsetM: 140, facing: 'reverse', kind: 'home', initialAspect: 'R' },
      { id: 'S28', track: 'A_MAIN', offsetM: 60, facing: 'reverse', kind: 'starter', initialAspect: 'R' },
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
      ...pair('T08S', 'BLOCK', 2843, 3943, 201), // signal-foot tag at S11 (SRS 3.4.2.6(b))
      // LC gate tags on both sides of LC 42-A (SRS 3.4.2.7)
      ...pair('TLC1', 'BLOCK', 750, 1850, 201).map((t) => ({ ...t, kind: 'lc' as const, lcGate: 'LC42A' })),
      ...pair('TLC2', 'BLOCK', 2050, 3150, 201).map((t) => ({ ...t, kind: 'lc' as const, lcGate: 'LC42A' })),
      ...pair('T09', 'B_MAIN', 300, 4400, 302),
      ...pair('T10', 'B_LOOP', 310, 4400, 303),
      ...pair('T11', 'B_EXIT', 200, 5000, 301),
    ],
    // KAVACH control table (SRS 12.2): points to prove and tracks to be clear for each OFF aspect
    controlTable: [
      { id: 'S1-main', signal: 'S1', points: { P1: 'normal' }, tracks: ['A_MAIN'] },
      { id: 'S1-loop', signal: 'S1', points: { P1: 'reverse' }, tracks: ['A_LOOP'] },
      { id: 'S3-dep', signal: 'S3', points: { P2: 'normal' } },
      { id: 'S4-dep', signal: 'S4', points: { P2: 'reverse' } },
      { id: 'S11-main', signal: 'S11', points: { P3: 'normal' }, tracks: ['B_MAIN'] },
      { id: 'S11-loop', signal: 'S11', points: { P3: 'reverse' }, tracks: ['B_LOOP'] },
      { id: 'S13-dep', signal: 'S13', points: { P4: 'normal' } },
      { id: 'S14-dep', signal: 'S14', points: { P4: 'reverse' } },
      { id: 'S22-dep', signal: 'S22', points: { P3: 'normal' } },
      { id: 'S26-main', signal: 'S26', points: { P2: 'normal' }, tracks: ['A_MAIN'] },
      { id: 'S26-loop', signal: 'S26', points: { P2: 'reverse' }, tracks: ['A_LOOP'] },
      { id: 'S28-dep', signal: 'S28', points: { P1: 'normal' } },
    ],
    lcGates: [{ id: 'LC42A', track: 'BLOCK', offsetM: 1400, absLocM: 2500, manning: 'Manned' }],
    stations: [
      { id: 'SVK-A', name: 'Station A', signals: ['S1', 'S3', 'S4', 'S5', 'S26', 'S28'] },
      { id: 'SVK-B', name: 'Station B', signals: ['S11', 'S13', 'S14', 'S22', 'S24'] },
    ],
  },
  trains: [{ locoId: '37421', lengthM: 480, maxKmph: 110, start: { track: 'A_APP', offsetM: 5, dir: 'nominal' } }],
  timeline: [
    { atSec: 2, action: 'SET_TARGET_SPEED', train: '37421', kmph: 80 },
    { atSec: 120, action: 'SET_POINT', point: 'P3', position: 'reverse' },
    { atSec: 120, action: 'SET_POINT', point: 'P4', position: 'reverse' },
    { atSec: 120, action: 'SET_ASPECT', signal: 'S11', aspect: 'YY' },
    { atSec: 230, action: 'SET_TARGET_SPEED', train: '37421', kmph: 30 },
    { atSec: 320, action: 'SET_TARGET_SPEED', train: '37421', kmph: 0 },
  ],
  faults: [
    { id: 'pg-underread', kind: 'ODO_SCALE', train: '37421', factor: 0.97, startSec: 0 },
    { id: 'drop-T07', kind: 'RFID_DROP', tags: ['T07a', 'T07b'], startSec: 0 },
    { id: 'p2-undetected', kind: 'POINT_NOT_DETECTED', point: 'P2', startSec: 60, endSec: 66 },
    { id: 's11-flicker', kind: 'SIGNAL_FLICKER', signal: 'S11', periodSec: 0.4, startSec: 150, endSec: 154 },
  ],
  expect: [
    { id: 'dir', label: 'Direction derived from two tag pairs', clause: 'SRS 7.2 · 7.5', event: 'OVK_DIRECTION', filters: { direction: 'nominal' } },
    { id: 'reg', label: 'Registered only after direction is known', clause: 'SRS 17.3', event: 'SVK_REGISTER', at: { after: 'dir' } },
    { id: 'withheld', label: 'Tag pair T07 withheld by the fault', clause: 'FRS 7.6.6.2', event: 'TAG_CROSSED', filters: { pair: 'T07', delivered: false }, at: { after: 'fault:drop-T07' } },
    { id: 'linking', label: 'Every correction inside 5 m + 5%', clause: 'SRS 3.4.2.4', expect: 'absent', event: 'OVK_LOCATION_CORRECTED', filters: { withinBound: false } },
    { id: 'p2', label: 'MA cut back to S3 while P2 is undetected', clause: 'SRS 12.1', event: 'SVK_MA', filters: { eoa: 'S3', 'restricted.0.signal': 'S3', 'restricted.0.reason': 'ROUTE_MISMATCH' }, at: { after: 'fault:p2-undetected', sec: [0, 2] } },
    { id: 'flicker', label: 'S11 held at R through the flicker', clause: 'SRS 18.8', event: 'SVK_MA', filters: { signal: 'S11', aspect: 'R' }, at: { after: 'fault:s11-flicker', sec: [0, 4] } },
    { id: 'loop', label: 'Routed into Station B loop (TIN 303)', clause: 'SRS 16.6', event: 'OVK_TIN', filters: { to: 303 } },
  ],
}
