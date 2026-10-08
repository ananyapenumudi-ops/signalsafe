/**
 * Yard graph: tracks are edges between nodes, points pick the onward track at
 * a node. A train's position is a distance along a *route* — the ordered list
 * of tracks it will traverse given the current point settings.
 */
import { P } from './params'
import type { Direction, Point, PointPosition, Signal, Tag, Track, Yard } from './schema'

export interface RouteSegment {
  track: Track
  dir: Direction
  /** Route distance where this segment starts / ends. */
  startM: number
  endM: number
}

export interface OnRoute<T> {
  item: T
  routeM: number
}

export interface YardIssue {
  severity: 'error' | 'warning'
  message: string
  ref?: string
}

export class YardModel {
  readonly tracks = new Map<string, Track>()
  readonly points = new Map<string, Point>()
  private readonly pointAtNode = new Map<string, Point>()
  private readonly tracksAtNode = new Map<string, Track[]>()
  readonly pointState = new Map<string, PointPosition>()

  readonly yard: Yard

  constructor(yard: Yard) {
    this.yard = yard
    for (const t of yard.tracks) {
      this.tracks.set(t.id, t)
      for (const n of [t.a, t.b]) this.tracksAtNode.set(n, [...(this.tracksAtNode.get(n) ?? []), t])
    }
    for (const pt of yard.points) {
      this.points.set(pt.id, pt)
      this.pointAtNode.set(pt.node, pt)
      this.pointState.set(pt.id, pt.initial)
    }
  }

  track(id: string): Track {
    const t = this.tracks.get(id)
    if (!t) throw new Error(`Unknown track ${id}`)
    return t
  }

  /** The track (and direction on it) entered after leaving `track` in `dir`, or null at a dead end. */
  next(track: Track, dir: Direction): { track: Track; dir: Direction } | null {
    const node = dir === 'nominal' ? track.b : track.a
    const point = this.pointAtNode.get(node)
    let nextId: string | undefined
    if (point) {
      if (track.id === point.toe) nextId = this.pointState.get(point.id) === 'reverse' ? point.reverse : point.normal
      else if (track.id === point.normal || track.id === point.reverse) nextId = point.toe
    } else {
      const others = (this.tracksAtNode.get(node) ?? []).filter((t) => t.id !== track.id)
      if (others.length === 1) nextId = others[0]!.id
    }
    if (!nextId) return null
    const nt = this.track(nextId)
    return { track: nt, dir: nt.a === node ? 'nominal' : 'reverse' }
  }

  /** Walks the graph from a track/direction using current point settings. */
  buildRoute(startTrack: string, dir: Direction, startM = 0, maxM = 100_000): RouteSegment[] {
    const route: RouteSegment[] = []
    let cur: { track: Track; dir: Direction } | null = { track: this.track(startTrack), dir }
    let m = startM
    const visited = new Set<string>()
    while (cur && m - startM < maxM) {
      const key = `${cur.track.id}:${cur.dir}`
      if (visited.has(key)) break // loop in the graph
      visited.add(key)
      route.push({ track: cur.track, dir: cur.dir, startM: m, endM: m + cur.track.lengthM })
      m += cur.track.lengthM
      cur = this.next(cur.track, cur.dir)
    }
    return route
  }

  /** Route distance of a point on a track given as offset from its `a` node. */
  static routeMOf(seg: RouteSegment, offsetM: number): number {
    return seg.dir === 'nominal' ? seg.startM + offsetM : seg.startM + (seg.track.lengthM - offsetM)
  }

  /** Track and offset-from-`a` at a route distance (clamped to the route). */
  static locate(route: RouteSegment[], m: number): { seg: RouteSegment; offsetM: number } {
    const seg = route.find((s) => m < s.endM) ?? route[route.length - 1]!
    const into = Math.min(Math.max(m - seg.startM, 0), seg.track.lengthM)
    return { seg, offsetM: seg.dir === 'nominal' ? into : seg.track.lengthM - into }
  }

  /** Tags on a route, sorted by route distance. */
  tagsOnRoute(route: RouteSegment[]): OnRoute<Tag>[] {
    return this.onRoute(route, this.yard.tags, () => true)
  }

  /** Signals that face the direction of travel on each segment. */
  signalsOnRoute(route: RouteSegment[]): OnRoute<Signal>[] {
    return this.onRoute(route, this.yard.signals, (s, seg) => s.facing === seg.dir)
  }

  private onRoute<T extends { track: string; offsetM: number }>(
    route: RouteSegment[],
    items: T[],
    keep: (item: T, seg: RouteSegment) => boolean,
  ): OnRoute<T>[] {
    const out: OnRoute<T>[] = []
    for (const seg of route) {
      for (const item of items) {
        if (item.track === seg.track.id && keep(item, seg)) out.push({ item, routeM: YardModel.routeMOf(seg, item.offsetM) })
      }
    }
    return out.sort((x, y) => x.routeM - y.routeM)
  }
}

/** Structural and SRS checks for the Scenario Editor (FRS 7.6.2.6). */
export function checkYard(yard: Yard): YardIssue[] {
  const issues: YardIssue[] = []
  const nodeIds = new Set(yard.nodes.map((n) => n.id))
  const trackIds = new Set(yard.tracks.map((t) => t.id))
  const err = (message: string, ref?: string) => issues.push({ severity: 'error', message, ref })
  const warn = (message: string, ref?: string) => issues.push({ severity: 'warning', message, ref })

  const dupes = (ids: string[]) => ids.filter((x, i) => ids.indexOf(x) !== i)
  for (const d of dupes([...yard.nodes, ...yard.tracks, ...yard.points, ...yard.signals, ...yard.tags].map((x) => x.id)))
    err(`Duplicate id "${d}"`, d)

  for (const t of yard.tracks) {
    if (!nodeIds.has(t.a) || !nodeIds.has(t.b)) err(`Track ${t.id} references an unknown node`, t.id)
  }
  for (const pt of yard.points) {
    if (!nodeIds.has(pt.node)) err(`Point ${pt.id} is on unknown node ${pt.node}`, pt.id)
    for (const leg of [pt.toe, pt.normal, pt.reverse]) {
      const t = yard.tracks.find((x) => x.id === leg)
      if (!t) err(`Point ${pt.id} references unknown track ${leg}`, pt.id)
      else if (t.a !== pt.node && t.b !== pt.node) err(`Track ${leg} does not touch point ${pt.id}'s node`, pt.id)
    }
  }
  for (const obj of [...yard.signals, ...yard.tags]) {
    const t = yard.tracks.find((x) => x.id === obj.track)
    if (!t) err(`${obj.id} is on unknown track ${obj.track}`, obj.id)
    else if (obj.offsetM > t.lengthM) err(`${obj.id} offset ${obj.offsetM} m is beyond track ${t.id} (${t.lengthM} m)`, obj.id)
  }

  // SRS 3.4.2.2: every tag duplicated
  const pairs = new Map<string, number>()
  for (const tag of yard.tags) pairs.set(tag.pair, (pairs.get(tag.pair) ?? 0) + 1)
  for (const [pair, n] of pairs) if (n !== 2) warn(`Tag pair ${pair} has ${n} tag(s); SRS 3.4.2.2 requires duplicated tags`, pair)

  // SRS 3.4.2.6: normal tags at most 1000 m apart — checked per track along absolute location
  const maxGap = P('maxNormalTagGapM')
  for (const t of yard.tracks) {
    if (!trackIds.has(t.id)) continue
    const locs = yard.tags
      .filter((g) => g.track === t.id && g.kind === 'normal')
      .map((g) => g.absLocM)
      .sort((x, y) => x - y)
    for (let i = 1; i < locs.length; i++) {
      const gap = locs[i]! - locs[i - 1]!
      if (gap > maxGap) warn(`Tag gap of ${Math.round(gap)} m on ${t.id} exceeds ${maxGap} m (SRS 3.4.2.6)`, t.id)
    }
  }
  return issues
}
