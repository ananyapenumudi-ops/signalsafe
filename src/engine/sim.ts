/**
 * Simulation core: fixed 100 ms tick, 2 s radio frame, deterministic.
 *
 * Module order within a tick is fixed and part of the contract:
 *   1. Bench controller: timeline actions, fault windows open/close
 *   2. Speed simulator: driver → kinematics → odometry (ODO-A)
 *   3. RFID simulator: swept tag crossings → RFID-A → OVK
 *   4. Signals passed (ground truth for evaluation)
 *   5. Reference SVKs read interlocking inputs (every tick, to see flicker)
 *   6. OVK supervision: radio timers, braking curve → brake command (BIU)
 *   7. On frame boundaries: location report up through the RMS, SVK builds
 *      the MA, MA down through the RMS to the OVK; periodic loggers
 */
import { driverCommand, gradientAccel, stepTrain } from './dynamics'
import { EventLog, type LogEvent } from './log'
import { OvkPosition } from './ovk/position'
import { OvkSupervisor, type CauseKey } from './ovk/supervision'
import { DT, TICKS_PER_FRAME, kmph } from './params'
import { crossed } from './rfid'
import { Rng } from './rng'
import { Scenario, type Aspect, type BrakeLevel, type Fault, type ScenarioInput, type Signal, type Tag, type Train } from './schema'
import { ReferenceSvk, maChanged, type FieldInputs, type MaPacket } from './svk/svk'
import { assessCollisions, type Threat, type TrainReport } from './svk/collision'
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
  sup: OvkSupervisor
  /** Seqs of the events the supervisor's events cite. */
  causes: Partial<Record<CauseKey, number>>
  /** When the DMI auto-player will press Ack, if a prompt is pending. */
  ackAt: number | null
  ma: MaPacket | null
  /** Wrecked in a ground-truth collision: no longer moves. */
  crashed: boolean
  /** Threat the SVK currently holds for this loco (for SVK_SOS logging). */
  threat: Threat | null
  /** The pilot is calling for traction this tick. */
  traction: boolean
  atEndOfLine: boolean
}

export class Simulation {
  readonly scenario: Scenario
  readonly yard: YardModel
  readonly log: EventLog
  readonly rng: Rng
  readonly trains: TrainState[]
  readonly aspects = new Map<string, Aspect>()
  readonly svks: ReferenceSvk[]
  /** Seq of the latest event that changed each signal's / point's input, for causedBy. */
  private readonly aspectCause = new Map<string, number>()
  private readonly pointCause = new Map<string, number>()
  tick = 0
  ended = false

  private nextTimeline = 0
  private readonly rmsRng: Rng
  /** Fault id → seq of its FAULT_START event while active. */
  private readonly activeFaults = new Map<string, number>()
  private readonly faultEnded = new Set<string>()

  constructor(input: ScenarioInput | Scenario, seed?: number) {
    this.scenario = Scenario.parse(input)
    this.rng = new Rng(seed ?? this.scenario.seed)
    this.log = new EventLog(() => ({ tSim: this.tSim, frame: this.frame }))
    this.rmsRng = this.rng.fork('rms')
    this.yard = new YardModel(this.scenario.yard)
    for (const s of this.scenario.yard.signals) this.aspects.set(s.id, s.initialAspect)
    this.scenario.timeline.sort((a, b) => a.atSec - b.atSec)
    this.log.append({ source: 'TBC', type: 'SIM_START', data: { scenario: this.scenario.id, seed: seed ?? this.scenario.seed } })
    this.trains = this.scenario.trains.map((spec) => this.initTrain(spec))
    this.svks = this.scenario.yard.stations.map((st) => new ReferenceSvk(st.id, st.signals, this.yard))
  }

  /** Interlocking inputs as the SVKs see them: ground truth with yard faults applied. */
  readonly inputs: FieldInputs = {
    aspect: (id) => {
      const set = this.aspects.get(id) ?? 'R'
      const flicker = this.faultActive('SIGNAL_FLICKER').find((f) => f.signal === id)
      if (!flicker) return set
      return Math.floor((this.tSim - flicker.startSec) / flicker.periodSec) % 2 === 1 ? 'R' : set
    },
    point: (id) => (this.faultActive('POINT_NOT_DETECTED').some((f) => f.point === id) ? undefined : this.yard.pointState.get(id)),
    occupied: (trackId) =>
      this.trains.some((t) => bodySpans(t.route, Math.max(t.routeM - t.spec.lengthM, t.route[0]!.startM), t.routeM).some((b) => b.track === trackId)),
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
      sup: new OvkSupervisor(this.scenario.blockType),
      causes: {},
      ackAt: null,
      ma: null,
      crashed: false,
      threat: null,
      traction: false,
      atEndOfLine: false,
    }
    this.refreshObjects(t)
    this.log.append({ source: 'TBC', type: 'ROUTE_SET', train: spec.locoId, data: { tracks: route.map((s) => s.track.id) } })
    if (spec.start.preset) t.ovk.preset(this.trueAbsLocM(t), spec.start.dir, this.yard.track(spec.start.track).tin)
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
        const seq = this.log.append({ source: 'FAULT', type: 'FAULT_START', data: { fault: f.id, kind: f.kind } })
        this.activeFaults.set(f.id, seq)
        if (f.kind === 'SIGNAL_FLICKER') this.aspectCause.set(f.signal, seq)
        if (f.kind === 'POINT_NOT_DETECTED') this.pointCause.set(f.point, seq)
      }
      if (this.activeFaults.has(f.id) && f.endSec !== undefined && t >= f.endSec) {
        const seq = this.log.append({ source: 'FAULT', type: 'FAULT_END', data: { fault: f.id, kind: f.kind }, causedBy: [this.activeFaults.get(f.id)!] })
        if (f.kind === 'SIGNAL_FLICKER') this.aspectCause.set(f.signal, seq)
        if (f.kind === 'POINT_NOT_DETECTED') this.pointCause.set(f.point, seq)
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
          this.pointCause.set(e.point, seq)
          for (const tr of this.trains) this.reroute(tr, seq)
          break
        }
        case 'SET_ASPECT':
          this.aspects.set(e.signal, e.aspect)
          this.aspectCause.set(e.signal, this.log.append({ source: 'YARD', type: 'ASPECT_SET', data: { signal: e.signal, aspect: e.aspect } }))
          break
      }
    }
  }

  // ── 2–4. per-train motion, tags, signals ──────────────────
  private moveTrain(t: TrainState) {
    if (t.atEndOfLine || t.crashed) return
    const id = t.spec.locoId
    const { seg } = YardModel.locate(t.route, t.routeM)
    const gradient = (seg.dir === 'nominal' ? 1 : -1) * seg.track.gradientPermille
    // an obedient pilot (DMI auto-player) keeps a little under Kavach's permitted speed
    const permitted = t.sup.dmi(this.tSim).permittedKmph
    const target = t.spec.driver.obeysKavach && permitted !== null ? Math.min(t.targetKmph, Math.max(permitted - 4, 0)) : t.targetKmph
    const cmd = driverCommand({
      v: t.speed,
      targetKmph: target,
      maxKmph: t.spec.maxKmph,
      gradientPermille: gradient,
      kavachBrake: t.kavachBrake,
      releasesBrakesAtStand: t.spec.driver.releasesBrakesAtStand,
    })
    // what the pilot asks for, before Kavach cuts it (used to release a roll-back brake)
    t.traction = driverCommand({ v: t.speed, targetKmph: target, maxKmph: t.spec.maxKmph, gradientPermille: gradient, kavachBrake: null }).traction > 0
    const k = stepTrain(t.speed, cmd, gradientAccel(gradient), DT)
    const from = t.routeM
    const routeStart = t.route[0]!.startM
    const routeEnd = t.route[t.route.length - 1]!.endM
    t.routeM = Math.min(Math.max(from + k.dx, routeStart), routeEnd)
    t.accel = (k.v - t.speed) / DT
    t.speed = t.routeM >= routeEnd || (t.routeM <= routeStart && k.v < 0) ? 0 : k.v
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

    for (const { item: sig } of t.routeM > from ? crossed(t.signalsAhead, from, t.routeM) : []) {
      this.log.append({ source: 'YARD', type: 'SIGNAL_PASSED', train: id, data: { signal: sig.id, aspect: this.aspects.get(sig.id) ?? 'R' } })
    }

    if (t.routeM >= routeEnd) {
      t.atEndOfLine = true
      this.log.append({ source: 'SS', type: 'END_OF_LINE', train: id, data: { track: t.route[t.route.length - 1]!.track.id } })
    }
  }

  /** Ground truth: do any two train bodies overlap? (The bench's own check, not Kavach's.) */
  private detectCollisions() {
    for (let i = 0; i < this.trains.length; i++) {
      for (let j = i + 1; j < this.trains.length; j++) {
        const a = this.trains[i]!
        const b = this.trains[j]!
        if (a.crashed && b.crashed) continue
        const spans = (t: TrainState) => bodySpans(t.route, Math.max(t.routeM - t.spec.lengthM, t.route[0]!.startM), t.routeM)
        for (const sa of spans(a)) {
          for (const sb of spans(b)) {
            if (sa.track !== sb.track) continue
            const lo = Math.max(Math.min(sa.fromM, sa.toM), Math.min(sb.fromM, sb.toM))
            const hi = Math.min(Math.max(sa.fromM, sa.toM), Math.max(sb.fromM, sb.toM))
            if (hi <= lo) continue
            const closing = Math.abs(kmph(a.speed)) + Math.abs(kmph(b.speed))
            this.log.append({ source: 'TBC', type: 'COLLISION', locM: round3(this.trueAbsLocM(a)), data: { trains: [a.spec.locoId, b.spec.locoId], track: sa.track, closingKmph: round3(closing) } })
            for (const t of [a, b]) {
              t.crashed = true
              t.speed = 0
            }
            return
          }
        }
      }
    }
  }

  // ── 6. OVK supervision, every tick ────────────────────────
  private superviseTrain(t: TrainState) {
    const id = t.spec.locoId
    if (t.ackAt !== null && this.tSim >= t.ackAt) {
      t.ackAt = null
      this.logSup(t, t.sup.ack(this.tSim), 'DIS')
    }
    const o = t.ovk
    const pos = o.absLocM === null || o.direction === 'undefined' ? null : { absLocM: o.absLocM, uncertaintyM: o.uncertaintyM, dir: (o.direction === 'nominal' ? 1 : -1) as 1 | -1 }
    const scale = this.faultActive('ODO_SCALE').find((f) => f.train === id)?.factor ?? 1
    this.logSup(t, t.sup.step(this.tSim, t.speed * scale, pos, t.spec.maxKmph, t.traction))
    t.kavachBrake = t.sup.brake
  }

  private logSup(t: TrainState, events: ReturnType<OvkSupervisor['step']>, source?: 'DIS') {
    const id = t.spec.locoId
    for (const ev of events) {
      const causedBy = ev.cause.flatMap((k) => (t.causes[k] === undefined ? [] : [t.causes[k]!]))
      const { cause: _cause, ...rest } = ev
      const seq = this.log.append({ source: source ?? `OVK:${id}`, train: id, locM: round3(this.trueAbsLocM(t)), causedBy, ...rest } as never)
      if (ev.type === 'DMI_ASPECT_BLANK') t.causes.blank = seq
      if (ev.type === 'RADIO_FAILURE') t.causes.radioFailure = seq
      if (ev.type === 'ACK_REQUEST') {
        t.causes.ackRequest = seq
        const after = t.spec.driver.acksAfterSec
        if (after !== null) t.ackAt = this.tSim + after
      }
      if (ev.type === 'SPAD') t.causes.trip = seq
      if (ev.type === 'COLLISION_ALERT') t.causes.threat = seq
      if (ev.type === 'ROLLBACK') t.causes.rollback = seq
    }
  }

  /** Manual Common/Ack press from the DMI simulator. */
  ack(locoId: string) {
    const t = this.train(locoId)
    t.ackAt = null
    this.logSup(t, t.sup.ack(this.tSim), 'DIS')
  }

  /** RMS: is this packet delivered? Logs the packet either way. */
  private radio(dir: 'up' | 'down', kind: 'LOC' | 'MA', t: TrainState, carries: number[] = []): { delivered: boolean; seq: number } {
    const loss = this.faultActive('RADIO_LOSS').find((f) => (f.direction === 'both' || f.direction === dir) && (!f.train || f.train === t.spec.locoId))
    const drop = loss ? undefined : this.faultActive('RADIO_DROP').find((f) => (f.direction === 'both' || f.direction === dir) && this.rmsRng.chance(f.probability))
    const fault = loss ?? drop
    const seq = this.log.append({
      source: 'RMS',
      type: 'RADIO_PACKET',
      train: t.spec.locoId,
      data: fault ? { dir, kind, delivered: false, fault: fault.id } : { dir, kind, delivered: true },
      causedBy: fault ? [this.activeFaults.get(fault.id)!] : carries,
    })
    // bench-side causality: remember the first packet lost (either way) since the last
    // delivered MA, so the OVK's reaction to silence can cite it
    if (fault && t.causes.silence === undefined) t.causes.silence = seq
    if (!fault && dir === 'down') delete t.causes.silence
    return { delivered: !fault, seq }
  }

  // ── 7. radio frame: report up, MA down ────────────────────
  private runSvks() {
    // phase 1: location reports up through the RMS
    const received: { t: TrainState; report: TrainReport; upSeq: number }[] = []
    for (const t of this.trains) {
      const o = t.ovk
      if (o.direction === 'undefined' || o.absLocM === null || o.tin === null) continue // SRS 17.3
      const scale = this.faultActive('ODO_SCALE').find((f) => f.train === t.spec.locoId)?.factor ?? 1
      const report: TrainReport = {
        locoId: t.spec.locoId,
        absLocM: o.absLocM,
        direction: o.direction,
        tin: o.tin,
        lengthM: t.spec.lengthM,
        uncertaintyM: o.uncertaintyM,
        speed: t.speed * scale,
      }
      const up = this.radio('up', 'LOC', t)
      if (up.delivered) received.push({ t, report, upSeq: up.seq })
    }
    // phase 2: collision assessment over everything received (SRS 14)
    const blockTins = new Set(this.scenario.yard.tracks.filter((tr) => tr.section === 'block').map((tr) => tr.tin))
    const threats = assessCollisions(received.map((r) => r.report), (tin) => blockTins.has(tin))
    const upSeqOf = new Map(received.map((r) => [r.t.spec.locoId, r.upSeq]))
    const sosSeq = new Map<string, number>()
    for (const { t } of received) {
      const next = threats.get(t.spec.locoId) ?? null
      const prev = t.threat
      const changed = (prev?.kind ?? null) !== (next?.kind ?? null) || (prev?.other ?? null) !== (next?.other ?? null)
      if (changed && prev && (prev.kind === 'REAR_END' || t.spec.locoId < prev.other)) {
        this.log.append({ source: 'SVK:pool', type: 'SVK_SOS_CLEAR', train: t.spec.locoId, data: { kind: prev.kind, trains: [t.spec.locoId, prev.other] } })
      }
      if (changed && next) {
        // a head-on pair is logged once; each loco's packet cites it
        const pairKey = next.kind === 'HEAD_ON' ? [t.spec.locoId, next.other].sort().join('|') : `${t.spec.locoId}>${next.other}`
        let seq = sosSeq.get(pairKey)
        if (seq === undefined) {
          seq = this.log.append({
            source: 'SVK:pool',
            type: 'SVK_SOS',
            train: t.spec.locoId,
            data: { kind: next.kind, trains: next.kind === 'HEAD_ON' ? [t.spec.locoId, next.other] : [t.spec.locoId], gapM: next.gapM },
            causedBy: [upSeqOf.get(t.spec.locoId), upSeqOf.get(next.other)].filter((x): x is number => x !== undefined),
          })
          sosSeq.set(pairKey, seq)
        }
        sosSeq.set(t.spec.locoId, seq)
      }
      t.threat = next
    }
    // phase 3: MA per loco, down through the RMS
    for (const { t, report: r } of received) {
      const id = t.spec.locoId
      const report = { locoId: id, absLocM: r.absLocM, direction: r.direction, tin: r.tin }
      // Serving SVK = owner of the approaching signal (handover per Annex P comes later)
      const approaching = this.svks[0]?.signalsAhead(report, this.inputs)?.ahead[0]?.item.id
      const svk = (approaching && this.svks.find((s) => s.ownsSignal(approaching))) || this.svks.find((s) => s.id === t.ma?.svk) || this.svks[0]
      if (!svk) continue
      if (!svk.registered.has(id)) {
        svk.registered.add(id)
        this.log.append({ source: `SVK:${svk.id}`, type: 'SVK_REGISTER', train: id, data: { svk: svk.id, absLocM: report.absLocM, direction: report.direction, tin: report.tin } })
      }
      const base = svk.computeMa(report, this.inputs)
      const packet = base ? { ...base, threat: t.threat } : null
      let maSeq: number | undefined
      if (packet && maChanged(t.ma, packet)) {
        const causes = new Set<number>()
        const add = (c: number | undefined) => c !== undefined && causes.add(c)
        for (const r of packet.restricted) {
          if (r.reason === 'ROUTE_MISMATCH') this.routePointCauses(r.signal).forEach(add)
          if (r.reason === 'HOLD') add(this.aspectCause.get(r.signal))
        }
        if (packet.signal && packet.aspect !== t.ma?.aspect) add(this.aspectCause.get(packet.signal))
        if (t.ma) for (const r of t.ma.restricted) if (!packet.restricted.some((x) => x.signal === r.signal)) {
          // a restriction lifted: cite what changed
          if (r.reason === 'ROUTE_MISMATCH') this.routePointCauses(r.signal).forEach(add)
          else add(this.aspectCause.get(r.signal))
        }
        const sos = sosSeq.get(id)
        if (sos !== undefined) causes.add(sos)
        maSeq = this.log.append({ source: `SVK:${svk.id}`, type: 'SVK_MA', train: id, data: packet, causedBy: [...causes].sort((a, b) => a - b) })
      }
      t.ma = packet
      if (!packet) continue
      const down = this.radio('down', 'MA', t, maSeq === undefined ? [] : [maSeq])
      if (!down.delivered) continue
      t.causes.ma = down.seq
      this.logSup(t, t.sup.onMa(packet, report.absLocM, report.direction === 'nominal' ? 1 : -1, this.tSim))
    }
  }

  private routePointCauses(signalId: string): (number | undefined)[] {
    return this.scenario.yard.controlTable.filter((r) => r.signal === signalId).flatMap((r) => Object.keys(r.points).map((p) => this.pointCause.get(p)))
  }

  // ── periodic loggers ──────────────────────────────────────
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
    this.detectCollisions()
    for (const t of this.trains) this.superviseTrain(t)
    this.tick++
    for (const svk of this.svks) svk.observe(this.tSim, this.inputs)
    if (this.tick % TICKS_PER_FRAME === 0) {
      this.runSvks()
      this.logPeriodic()
    }
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
          ma: t.ma,
          maSpans: t.ma ? bodySpans(t.route, t.routeM, t.routeM + t.ma.maM) : [],
          kavachBrake: t.kavachBrake,
          dmi: t.sup.dmi(this.tSim),
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
