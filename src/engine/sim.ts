/**
 * Simulation core: fixed 100 ms tick, 2 s radio frame, deterministic.
 *
 * Module order within a tick is fixed and part of the contract:
 *   1. Bench controller: timeline actions, fault windows open/close
 *   2. Speed simulator: driver → kinematics → odometry (ODO-A)
 *   3. RFID simulator: swept tag crossings → RFID-A → OVK
 *   4. Signals passed (ground truth for evaluation)
 *   5. Periodic loggers on frame boundaries (SRS 21.2)
 * Reference SVK, RMS and supervision slot in from weeks 3–4.
 */
import { driverAccel, stepKinematics } from './dynamics'
import { EventLog, type LogEvent } from './log'
import { OvkPosition } from './ovk/position'
import { DT, TICKS_PER_FRAME, kmph } from './params'
import { crossed } from './rfid'
import { Rng } from './rng'
import { Scenario, type Aspect, type BrakeLevel, type Fault, type ScenarioInput, type Signal, type Tag, type Train } from './schema'
import { YardModel, type OnRoute, type RouteSegment } from './yard'
import type { Snapshot } from './snapshot'

export interface TrainState {
  spec: Train
  route: RouteSegment[]
  /** Front of train, as route distance. */
  routeM: number
  speed: number
  accel: number
  targetKmph: number
  kavachBrake: BrakeLevel | null
  tagsAhead: OnRoute<Tag>[]
  signalsAhead: OnRoute<Signal>[]
  ovk: OvkPosition
  atEndOfLine: boolean
}

export class Simulation {
  readonly scenario: Scenario
  readonly yard: YardModel
  readonly log: EventLog
  readonly rng: Rng
  readonly trains: TrainState[]
  readonly aspects = new Map<string, Aspect>()
  tick = 0
  ended = false

  private nextTimeline = 0
  /** Fault id → seq of its FAULT_START event while active. */
  private readonly activeFaults = new Map<string, number>()
  private readonly faultEnded = new Set<string>()

  constructor(input: ScenarioInput | Scenario, seed?: number) {
    this.scenario = Scenario.parse(input)
    this.rng = new Rng(seed ?? this.scenario.seed)
    this.log = new EventLog(() => ({ tSim: this.tSim, frame: this.frame }))
    this.yard = new YardModel(this.scenario.yard)
    for (const s of this.scenario.yard.signals) this.aspects.set(s.id, s.initialAspect)
    this.scenario.timeline.sort((a, b) => a.atSec - b.atSec)
    this.log.append({ source: 'TBC', type: 'SIM_START', data: { scenario: this.scenario.id, seed: seed ?? this.scenario.seed } })
    this.trains = this.scenario.trains.map((spec) => this.initTrain(spec))
  }

  get tSim(): number {
    return round3(this.tick * DT)
  }

  get frame(): number {
    return Math.floor(this.tick / TICKS_PER_FRAME)
  }

  private initTrain(spec: Train): TrainState {
    const route = this.yard.buildRoute(spec.start.track, spec.start.dir)
    const first = route[0]!
    const routeM = YardModel.routeMOf(first, spec.start.offsetM)
    const t: TrainState = {
      spec,
      route,
      routeM,
      speed: 0,
      accel: 0,
      targetKmph: 0,
      kavachBrake: null,
      tagsAhead: [],
      signalsAhead: [],
      ovk: new OvkPosition(),
      atEndOfLine: false,
    }
    this.refreshObjects(t)
    this.log.append({ source: 'TBC', type: 'ROUTE_SET', train: spec.locoId, data: { tracks: route.map((s) => s.track.id) } })
    return t
  }

  /** Recompute a train's route from where it is (e.g. after a point moves). */
  private reroute(t: TrainState, cause: number) {
    const { seg } = YardModel.locate(t.route, t.routeM)
    t.route = this.yard.buildRoute(seg.track.id, seg.dir, seg.startM)
    this.refreshObjects(t)
    this.log.append({ source: 'TBC', type: 'ROUTE_SET', train: t.spec.locoId, data: { tracks: t.route.map((s) => s.track.id) }, causedBy: [cause] })
  }

  private refreshObjects(t: TrainState) {
    t.tagsAhead = this.yard.tagsOnRoute(t.route)
    t.signalsAhead = this.yard.signalsOnRoute(t.route)
  }

  /** True absolute location of a train's front, read from the nearest tags' chainage. */
  trueAbsLocM(t: TrainState): number {
    const { seg, offsetM } = YardModel.locate(t.route, t.routeM)
    const tags = this.scenario.yard.tags.filter((g) => g.track === seg.track.id)
    // Chainage is linear along a track: interpolate from any tag on it, else route distance.
    const ref = tags[0]
    return ref ? ref.absLocM + (offsetM - ref.offsetM) : t.routeM
  }

  private train(locoId: string): TrainState {
    const t = this.trains.find((x) => x.spec.locoId === locoId)
    if (!t) throw new Error(`Unknown train ${locoId}`)
    return t
  }

  private faultActive<K extends Fault['kind']>(kind: K): Extract<Fault, { kind: K }>[] {
    return this.scenario.faults.filter((f): f is Extract<Fault, { kind: K }> => f.kind === kind && this.activeFaults.has(f.id))
  }

  // ── 1. bench controller ───────────────────────────────────
  private runController() {
    const t = this.tSim
    for (const f of this.scenario.faults) {
      if (!this.activeFaults.has(f.id) && !this.faultEnded.has(f.id) && t >= f.startSec) {
        this.activeFaults.set(f.id, this.log.append({ source: 'FAULT', type: 'FAULT_START', data: { fault: f.id, kind: f.kind } }))
      }
      if (this.activeFaults.has(f.id) && f.endSec !== undefined && t >= f.endSec) {
        this.log.append({ source: 'FAULT', type: 'FAULT_END', data: { fault: f.id, kind: f.kind }, causedBy: [this.activeFaults.get(f.id)!] })
        this.activeFaults.delete(f.id)
        this.faultEnded.add(f.id)
      }
    }
    const tl = this.scenario.timeline
    while (this.nextTimeline < tl.length && tl[this.nextTimeline]!.atSec <= t) {
      const e = tl[this.nextTimeline++]!
      switch (e.action) {
        case 'SET_TARGET_SPEED':
          this.train(e.train).targetKmph = e.kmph
          this.log.append({ source: 'TBC', type: 'TARGET_SPEED', train: e.train, data: { kmph: e.kmph } })
          break
        case 'SET_POINT': {
          if (!this.yard.points.has(e.point)) throw new Error(`Unknown point ${e.point}`)
          this.yard.pointState.set(e.point, e.position)
          const seq = this.log.append({ source: 'YARD', type: 'POINT_SET', data: { point: e.point, position: e.position } })
          for (const tr of this.trains) this.reroute(tr, seq)
          break
        }
        case 'SET_ASPECT':
          this.aspects.set(e.signal, e.aspect)
          this.log.append({ source: 'YARD', type: 'ASPECT_SET', data: { signal: e.signal, aspect: e.aspect } })
          break
      }
    }
  }

  // ── 2–4. per-train motion, tags, signals ──────────────────
  private moveTrain(t: TrainState) {
    if (t.atEndOfLine) return
    const id = t.spec.locoId
    const { seg } = YardModel.locate(t.route, t.routeM)
    const gradient = (seg.dir === 'nominal' ? 1 : -1) * seg.track.gradientPermille
    t.accel = driverAccel({ v: t.speed, targetKmph: t.targetKmph, maxKmph: t.spec.maxKmph, gradientPermille: gradient, kavachBrake: t.kavachBrake })
    const k = stepKinematics(t.speed, t.accel, DT)
    const from = t.routeM
    const routeEnd = t.route[t.route.length - 1]!.endM
    t.routeM = Math.min(from + k.dx, routeEnd)
    t.speed = t.routeM >= routeEnd ? 0 : k.v
    const dx = t.routeM - from

    // ODO-A: pulse generators may over/under-read under an ODO_SCALE fault
    const scale = this.faultActive('ODO_SCALE').find((f) => f.train === id)?.factor ?? 1
    t.ovk.onOdometry(dx * scale)

    // RFID-S → RFID-A
    const dropped = this.faultActive('RFID_DROP')
    for (const { item: tag } of crossed(t.tagsAhead, from, t.routeM)) {
      const dropFault = dropped.find((f) => f.tags.includes(tag.id))
      const crossSeq = this.log.append({
        source: 'RFID-S',
        type: 'TAG_CROSSED',
        train: id,
        locM: tag.absLocM,
        data: { tag: tag.id, pair: tag.pair, delivered: !dropFault },
        causedBy: dropFault ? [this.activeFaults.get(dropFault.id)!] : [],
      })
      if (dropFault) continue
      const readSeq = this.log.append({
        source: `OVK:${id}`,
        type: 'TAG_READ',
        train: id,
        locM: tag.absLocM,
        data: { tag: tag.id, pair: tag.pair, absLocM: tag.absLocM, tin: tag.tin },
        causedBy: [crossSeq],
      })
      for (const ev of t.ovk.onTag({ tag: tag.id, pair: tag.pair, absLocM: tag.absLocM, tin: tag.tin })) {
        this.log.append({ source: `OVK:${id}`, train: id, locM: tag.absLocM, causedBy: [readSeq], ...ev })
      }
    }

    for (const { item: sig } of crossed(t.signalsAhead, from, t.routeM)) {
      this.log.append({ source: 'YARD', type: 'SIGNAL_PASSED', train: id, data: { signal: sig.id, aspect: this.aspects.get(sig.id) ?? 'R' } })
    }

    if (t.routeM >= routeEnd) {
      t.atEndOfLine = true
      this.log.append({ source: 'SS', type: 'END_OF_LINE', train: id, data: { track: t.route[t.route.length - 1]!.track.id } })
    }
  }

  // ── 5. periodic loggers ───────────────────────────────────
  private logPeriodic() {
    for (const t of this.trains) {
      this.log.append({
        source: `OVK:${t.spec.locoId}`,
        type: 'OVK_STATUS',
        train: t.spec.locoId,
        locM: round3(this.trueAbsLocM(t)),
        data: {
          speedKmph: round3(kmph(t.speed)),
          absLocM: t.ovk.absLocM === null ? null : round3(t.ovk.absLocM),
          direction: t.ovk.direction,
          tin: t.ovk.tin,
          lastTag: t.ovk.lastTag,
          brake: t.kavachBrake,
        },
      })
    }
  }

  /** Advance one 100 ms tick. */
  step(): void {
    if (this.ended) return
    this.runController()
    for (const t of this.trains) this.moveTrain(t)
    this.tick++
    if (this.tick % TICKS_PER_FRAME === 0) this.logPeriodic()
    if (this.tSim >= this.scenario.durationSec) {
      this.ended = true
      this.log.append({ source: 'TBC', type: 'SIM_END', data: { reason: 'duration' } })
    }
  }

  runUntil(sec: number): void {
    while (!this.ended && this.tSim < sec) this.step()
  }

  runToEnd(): LogEvent[] {
    while (!this.ended) this.step()
    return this.log.events
  }

  snapshot(): Snapshot {
    return {
      tSim: this.tSim,
      frame: this.frame,
      ended: this.ended,
      durationSec: this.scenario.durationSec,
      aspects: Object.fromEntries(this.aspects),
      points: Object.fromEntries(this.yard.pointState),
      activeFaults: [...this.activeFaults.keys()],
      trains: this.trains.map((t) => {
        const front = YardModel.locate(t.route, t.routeM)
        const rearM = Math.max(t.routeM - t.spec.lengthM, t.route[0]!.startM)
        return {
          locoId: t.spec.locoId,
          speedKmph: kmph(t.speed),
          targetKmph: t.targetKmph,
          accel: t.accel,
          routeM: t.routeM,
          track: front.seg.track.id,
          offsetM: front.offsetM,
          trueAbsLocM: this.trueAbsLocM(t),
          body: bodySpans(t.route, rearM, t.routeM),
          kavachBrake: t.kavachBrake,
          atEndOfLine: t.atEndOfLine,
          ovk: {
            direction: t.ovk.direction,
            tin: t.ovk.tin,
            absLocM: t.ovk.absLocM,
            uncertaintyM: t.ovk.uncertaintyM,
            lastTag: t.ovk.lastTag,
          },
        }
      }),
    }
  }
}

/** Track spans (offsets from `a`) covered by a train between rear and front route distances. */
function bodySpans(route: RouteSegment[], rearM: number, frontM: number) {
  const out: { track: string; fromM: number; toM: number }[] = []
  for (const s of route) {
    const lo = Math.max(rearM, s.startM)
    const hi = Math.min(frontM, s.endM)
    if (hi <= lo) continue
    const a = YardModel.routeMOf(s, 0)
    const toOffset = (m: number) => (s.dir === 'nominal' ? m - a : a - m)
    out.push({ track: s.track.id, fromM: toOffset(lo), toM: toOffset(hi) })
  }
  return out
}

const round3 = (x: number) => Math.round(x * 1000) / 1000
