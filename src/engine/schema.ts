/**
 * Scenario file format (validated with Zod at every boundary).
 * A scenario holds the parts FRS 8.2.1.2 lists — test sequence, track
 * description, train description, simulation details — plus faults and
 * expected observables.
 */
import { z } from 'zod'

const id = z.string().min(1)

/** Nominal = travelling from a track's `a` node to its `b` node (absolute location increasing). */
export const Direction = z.enum(['nominal', 'reverse'])
export const Aspect = z.enum(['R', 'Y', 'YY', 'G'])
export const PointPosition = z.enum(['normal', 'reverse'])
export const BrakeLevel = z.enum(['NB', 'FSB', 'EB'])

export const Node = z.object({ id, x: z.number(), y: z.number() })

export const Track = z.object({
  id,
  /** Track Identification Number (SRS 16). */
  tin: z.number().int().positive(),
  a: id,
  b: id,
  lengthM: z.number().positive(),
  /** Block sections get collision assessment (SRS 14.7); station sections rely on SPAD/TIN conflict (14.6). */
  section: z.enum(['station', 'block']).default('station'),
  /** Positive = rising in the nominal direction, per mille. */
  gradientPermille: z.number().default(0),
  /** Extra drawing vertices between a and b (schematic only). */
  via: z.array(z.tuple([z.number(), z.number()])).default([]),
})

export const Point = z.object({
  id,
  node: id,
  /** The single track on the toe side of the switch. */
  toe: id,
  normal: id,
  reverse: id,
  initial: PointPosition.default('normal'),
})

export const Signal = z.object({
  id,
  track: id,
  /** Distance from the track's `a` node. */
  offsetM: z.number().nonnegative(),
  facing: Direction,
  kind: z.enum(['distant', 'home', 'starter', 'lss', 'auto', 'gate']),
  initialAspect: Aspect.default('R'),
})

export const Tag = z.object({
  id,
  track: id,
  offsetM: z.number().nonnegative(),
  /** Absolute location programmed into the tag. */
  absLocM: z.number(),
  tin: z.number().int().positive(),
  /** Tags are duplicated (SRS 3.4.2.2); both tags of a pair share this id. */
  pair: id,
  kind: z.enum(['normal', 'lc', 'adjacent', 'adjustment']).default('normal'),
})

/**
 * KAVACH control table row (SRS 12.2, Annexure I): a signal may show an OFF
 * aspect for this route only if these points are detected in these positions
 * and these tracks are clear.
 */
export const Route = z.object({
  id,
  signal: id,
  points: z.record(z.string(), PointPosition).default({}),
  tracks: z.array(id).default([]),
})

/** A Stationary Kavach unit and the signals it controls. */
export const Station = z.object({
  id,
  name: z.string(),
  signals: z.array(id).min(1),
})

export const Yard = z.object({
  name: z.string(),
  nodes: z.array(Node).min(2),
  tracks: z.array(Track).min(1),
  points: z.array(Point).default([]),
  signals: z.array(Signal).default([]),
  tags: z.array(Tag).default([]),
  controlTable: z.array(Route).default([]),
  stations: z.array(Station).default([]),
})

/** How the DMI auto-player (FRS 7.6.8.5) drives: obedient pilots respect the SR ceiling and acknowledge prompts. */
export const Driver = z.object({
  /** Seconds before acknowledging a DMI prompt (radio failure), or null to never acknowledge. */
  acksAfterSec: z.number().nonnegative().nullable().default(3),
  /** Respect the Staff Responsible ceiling and Kavach's permitted speed (false = keeps notching up). */
  obeysKavach: z.boolean().default(true),
  /** Releases the brakes when stopped, letting a gradient roll the train back (S08). */
  releasesBrakesAtStand: z.boolean().default(false),
})

export const Train = z.object({
  locoId: id,
  lengthM: z.number().positive(),
  maxKmph: z.number().positive().default(110),
  start: z.object({
    track: id,
    offsetM: z.number().nonnegative(),
    dir: Direction,
    /** OVK already running under Kavach: direction, TIN and location known at t = 0 (FRS 8.2.2.2 preparation). */
    preset: z.boolean().default(false),
  }),
  driver: Driver.default({ acksAfterSec: 3, obeysKavach: true, releasesBrakesAtStand: false }),
})

const at = { atSec: z.number().nonnegative() }
export const TimelineEntry = z.discriminatedUnion('action', [
  z.object({ ...at, action: z.literal('SET_TARGET_SPEED'), train: id, kmph: z.number().nonnegative() }),
  z.object({ ...at, action: z.literal('SET_POINT'), point: id, position: PointPosition }),
  z.object({ ...at, action: z.literal('SET_ASPECT'), signal: id, aspect: Aspect }),
])

const window = { id, startSec: z.number().nonnegative(), endSec: z.number().positive().optional() }
export const Fault = z.discriminatedUnion('kind', [
  /** RFID-S withholds these tags from the reader. */
  z.object({ ...window, kind: z.literal('RFID_DROP'), tags: z.array(id).min(1) }),
  /** Pulse generators over/under-read: OVK odometry = true distance × factor. */
  z.object({ ...window, kind: z.literal('ODO_SCALE'), train: id, factor: z.number().positive() }),
  /** Point detection (WKR) lost: the SVK sees the point as undetermined. */
  z.object({ ...window, kind: z.literal('POINT_NOT_DETECTED'), point: id }),
  /** RMS withholds every packet in a direction ('up' = OVK→SVK, 'down' = SVK→OVK). */
  z.object({ ...window, kind: z.literal('RADIO_LOSS'), direction: z.enum(['up', 'down', 'both']).default('both'), train: id.optional() }),
  /** RMS drops each packet with this probability (seeded). */
  z.object({ ...window, kind: z.literal('RADIO_DROP'), probability: z.number().min(0).max(1), direction: z.enum(['up', 'down', 'both']).default('both') }),
  /** Signal ECR input chatters between ON and its set aspect. */
  z.object({ ...window, kind: z.literal('SIGNAL_FLICKER'), signal: id, periodSec: z.number().positive().default(0.5) }),
])

/** Expected observable for the Evaluation Tool (matcher arrives in week 7). */
export const Observable = z.object({
  id,
  event: z.string(),
  filters: z.record(z.string(), z.unknown()).default({}),
  at: z
    .object({
      after: z.string().optional(),
      sec: z.tuple([z.number(), z.number()]).optional(),
      locM: z.tuple([z.number(), z.number()]).optional(),
    })
    .default({}),
})

export const Scenario = z.object({
  schemaVersion: z.literal(1),
  /** Absolute block uses the longer radio-failure timeout (SRS 20.1.1). */
  blockType: z.enum(['absolute', 'automatic']).default('absolute'),
  id,
  title: z.string(),
  description: z.string().default(''),
  clauseRefs: z.array(z.string()).default([]),
  seed: z.number().int().nonnegative().default(1),
  durationSec: z.number().positive().default(300),
  yard: Yard,
  trains: z.array(Train).min(1),
  timeline: z.array(TimelineEntry).default([]),
  faults: z.array(Fault).default([]),
  expect: z.array(Observable).default([]),
})

export type Direction = z.infer<typeof Direction>
export type Aspect = z.infer<typeof Aspect>
export type PointPosition = z.infer<typeof PointPosition>
export type BrakeLevel = z.infer<typeof BrakeLevel>
export type Node = z.infer<typeof Node>
export type Track = z.infer<typeof Track>
export type Point = z.infer<typeof Point>
export type Signal = z.infer<typeof Signal>
export type Tag = z.infer<typeof Tag>
export type Route = z.infer<typeof Route>
export type Station = z.infer<typeof Station>
export type Yard = z.infer<typeof Yard>
export type Train = z.infer<typeof Train>
export type Driver = z.infer<typeof Driver>
export type TimelineEntry = z.infer<typeof TimelineEntry>
export type Fault = z.infer<typeof Fault>
export type FaultKind = Fault['kind']
export type Observable = z.infer<typeof Observable>
export type Scenario = z.infer<typeof Scenario>
/** Authoring shape, before defaults are applied. */
export type ScenarioInput = z.input<typeof Scenario>
