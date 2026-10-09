/**
 * Reference Stationary Kavach (SVK): interlocking inputs → aspect and
 * Movement Authority for each registered loco.
 *
 *  SRS 3.4.4.1 MA built from interlocking inputs and info exchanged with OVK
 *  SRS 5.4     packet content: approaching signal, its aspect and distance,
 *              next signal aspect, MA (distance authorised)
 *  SRS 12.1    on any conflict between aspect, point position, berthing
 *              track and route, send the most restrictive aspect and
 *              shorten the MA
 *  SRS 12.2    routes checked against the KAVACH control table
 *  SRS 5.2 / 18.8  MA held for 2 s (configurable 2–5 s) across aspect
 *              transitions and flicker
 *  SRS 17.3    a loco is served only once it reports a valid absolute
 *              location and direction
 *
 * Interpretation of the hold (documented in docs §09): while a hold is
 * active the SVK uses the MOST RESTRICTIVE aspect seen since the hold began.
 * So an OFF→ON change restricts at once, ON→OFF extends only after the hold,
 * and a flickering signal stays restrictive until it is stable. This never
 * sends an MA longer than any state seen, which is the safe reading.
 */
import { P } from '../params'
import type { Aspect, Direction, PointPosition, Route } from '../schema'
import { YardModel, type PointLookup } from '../yard'
import type { Threat } from './collision'

/** What the SVK reads from the yard (through relay/vital input cards). */
export interface FieldInputs {
  aspect(signalId: string): Aspect
  point(pointId: string): PointPosition | undefined
  occupied(trackId: string): boolean
}

/** OVK location report (SRS 9.2, every frame). */
export interface LocationReport {
  locoId: string
  absLocM: number
  direction: Direction
  tin: number
}

export type RestrictReason = 'ROUTE_MISMATCH' | 'ROUTE_OCCUPIED' | 'HOLD'

export interface MaPacket {
  svk: string
  train: string
  /** Approaching signal (SRS 5.4(a–c)). */
  signal: string | null
  aspect: Aspect | null
  signalDistM: number | null
  /** Aspect of the signal after it, if the approaching one is OFF (SRS 5.4(d)). */
  nextAspect: Aspect | null
  /** Distance the loco is authorised to travel from its reported location (SRS 5.4(e)). */
  maM: number
  /** Where the MA ends: a signal id, or 'route-end' when the SVK can see no further. */
  eoa: string
  /** Signals shown more restrictively than the interlocking set them, and why. */
  restricted: { signal: string; reason: RestrictReason }[]
  /** LC gates ahead on the route: part of the track profile (SRS 5.4(g), 15.2). */
  lcAhead?: { id: string; manning: string; distM: number }[]
  /** Loco-specific SoS (head-on) or rear-end target for this loco (SRS 14). */
  threat?: Threat | null
}

const RANK: Record<Aspect, number> = { R: 0, Y: 1, YY: 2, G: 3 }
export const mostRestrictive = (a: Aspect, b: Aspect): Aspect => (RANK[a] <= RANK[b] ? a : b)

/** How many signals ahead the SVK looks when extending an MA. */
const LOOKAHEAD_SIGNALS = 3
/** How far ahead the track profile lists LC gates. */
const LC_PROFILE_RANGE_M = 3000

interface HoldState {
  lastRaw: Aspect
  /** Active hold: last change time, worst aspect seen since the hold began, number of changes. */
  hold: { lastChange: number; worst: Aspect; changes: number } | null
}

export class ReferenceSvk {
  readonly id: string
  readonly signals: Set<string>
  readonly registered = new Set<string>()
  private readonly yard: YardModel
  private readonly holds = new Map<string, HoldState>()
  private readonly routesBySignal = new Map<string, Route[]>()
  private readonly holdSec = P('maHoldAspectChangeSec')

  constructor(id: string, signals: string[], yard: YardModel) {
    this.id = id
    this.signals = new Set(signals)
    this.yard = yard
    for (const r of yard.yard.controlTable) this.routesBySignal.set(r.signal, [...(this.routesBySignal.get(r.signal) ?? []), r])
  }

  /** Read interlocking inputs; call every tick so that sub-frame flicker is seen. */
  observe(t: number, inputs: FieldInputs): void {
    for (const s of this.yard.yard.signals) {
      const raw = inputs.aspect(s.id)
      const h = this.holds.get(s.id)
      if (!h) {
        this.holds.set(s.id, { lastRaw: raw, hold: null })
        continue
      }
      if (raw !== h.lastRaw) {
        const worst = h.hold ? mostRestrictive(h.hold.worst, raw) : mostRestrictive(h.lastRaw, raw)
        h.hold = { lastChange: t, worst, changes: (h.hold?.changes ?? 0) + 1 }
        h.lastRaw = raw
      }
      if (h.hold && t - h.hold.lastChange >= this.holdSec) h.hold = null
    }
  }

  /** Aspect after hold and control-table checks, with the reason if restricted. */
  effectiveAspect(signalId: string, inputs: FieldInputs): { aspect: Aspect; reason?: RestrictReason } {
    const raw = inputs.aspect(signalId)
    const h = this.holds.get(signalId)
    let aspect = h?.hold ? mostRestrictive(h.hold.worst, raw) : raw
    // Held = raw is OFF but being held back, or the input is unstable (flicker), even
    // if this sample happens to read ON. A single deliberate change to ON is just R.
    let reason: RestrictReason | undefined = h?.hold && (aspect !== raw || h.hold.changes >= 2) ? 'HOLD' : undefined
    if (aspect !== 'R') {
      const routes = this.routesBySignal.get(signalId)
      if (routes?.length) {
        const pointsOk = routes.filter((r) => Object.entries(r.points).every(([pt, pos]) => inputs.point(pt) === pos))
        if (pointsOk.length === 0) {
          aspect = 'R'
          reason = 'ROUTE_MISMATCH'
        } else if (!pointsOk.some((r) => r.tracks.every((tr) => !inputs.occupied(tr)))) {
          aspect = 'R'
          reason = 'ROUTE_OCCUPIED'
        }
      }
    }
    return { aspect, reason }
  }

  /** The SVK that should serve a loco: the owner of its approaching signal. */
  ownsSignal(signalId: string): boolean {
    return this.signals.has(signalId)
  }

  /** Signals ahead of a reported location, as the SVK sees the yard. */
  signalsAhead(report: LocationReport, inputs: FieldInputs) {
    const at = this.yard.locateAbs(report.tin, report.absLocM)
    if (!at) return null
    const points: PointLookup = (id) => inputs.point(id)
    const route = this.yard.buildRoute(at.track.id, report.direction, 0, 20_000, points)
    const pos = YardModel.routeMOf(route[0]!, at.offsetM)
    const ahead = this.yard.signalsOnRoute(route).filter((s) => s.routeM > pos + 0.5)
    const lc = this.yard.lcGatesOnRoute(route).filter((g) => g.routeM > pos)
    return { pos, ahead, routeEndM: route[route.length - 1]!.endM, lc }
  }

  /** Builds the MA packet for one loco (SRS 5.4). Null if the location can't be placed. */
  computeMa(report: LocationReport, inputs: FieldInputs): MaPacket | null {
    const view = this.signalsAhead(report, inputs)
    if (!view) return null
    const { pos, ahead, routeEndM, lc } = view
    const restricted: MaPacket['restricted'] = []
    const eff = ahead.slice(0, LOOKAHEAD_SIGNALS).map((s) => {
      const e = this.effectiveAspect(s.item.id, inputs)
      if (e.reason) restricted.push({ signal: s.item.id, reason: e.reason })
      return { ...s, ...e }
    })
    const first = eff[0]
    const stop = eff.find((s) => s.aspect === 'R')
    const last = eff[eff.length - 1]
    const eoaM = stop ? stop.routeM : eff.length >= LOOKAHEAD_SIGNALS && last ? last.routeM : routeEndM
    return {
      svk: this.id,
      train: report.locoId,
      signal: first?.item.id ?? null,
      aspect: first?.aspect ?? null,
      signalDistM: first ? round(first.routeM - pos) : null,
      nextAspect: first && first.aspect !== 'R' ? (eff[1]?.aspect ?? null) : null,
      maM: round(Math.max(eoaM - pos, 0)),
      eoa: stop ? stop.item.id : eff.length >= LOOKAHEAD_SIGNALS && last ? last.item.id : 'route-end',
      restricted,
      lcAhead: lc.filter((g) => g.routeM - pos <= LC_PROFILE_RANGE_M).map((g) => ({ id: g.item.id, manning: g.item.manning, distM: round(g.routeM - pos) })),
    }
  }
}

const round = (x: number) => Math.round(x * 10) / 10

/** True if two packets differ in anything but the continuously shrinking distances. */
export function maChanged(a: MaPacket | null, b: MaPacket | null): boolean {
  if (!a || !b) return a !== b
  return (
    a.svk !== b.svk ||
    a.signal !== b.signal ||
    a.aspect !== b.aspect ||
    a.nextAspect !== b.nextAspect ||
    a.eoa !== b.eoa ||
    (a.threat?.kind ?? null) !== (b.threat?.kind ?? null) ||
    (a.threat?.other ?? null) !== (b.threat?.other ?? null) ||
    JSON.stringify(a.restricted) !== JSON.stringify(b.restricted)
  )
}
