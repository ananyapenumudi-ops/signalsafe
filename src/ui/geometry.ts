/** Schematic layout: maps yard coordinates to SVG space and positions along tracks. */
import type { Track, Yard } from '../engine/schema'

export type Pt = [number, number]

export interface Layout {
  width: number
  height: number
  /** Drawn polyline for each track, from `a` to `b`. */
  polylines: Map<string, Pt[]>
}

const PAD_X = 40
const LANE_PX = 54

export function layoutYard(yard: Yard, width = 1000): Layout {
  const xs = yard.nodes.map((n) => n.x)
  const ys = [...yard.nodes.map((n) => n.y), ...yard.tracks.flatMap((t) => t.via.map((v) => v[1]))]
  const minX = Math.min(...xs)
  const spanX = Math.max(...xs) - minX || 1
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const top = 70 // room for signals and labels above the highest lane
  const height = top + (maxY - minY) * LANE_PX + 70
  const sx = (width - 2 * PAD_X) / spanX
  const map = ([x, y]: Pt): Pt => [PAD_X + (x - minX) * sx, top + (y - minY) * LANE_PX]
  const nodes = new Map(yard.nodes.map((n) => [n.id, [n.x, n.y] as Pt]))
  const polylines = new Map<string, Pt[]>()
  for (const t of yard.tracks) {
    polylines.set(t.id, [nodes.get(t.a)!, ...t.via, nodes.get(t.b)!].map(map))
  }
  return { width, height, polylines }
}

const segLen = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1])

/** Point at fraction f (0..1) of a polyline's drawn length. */
export function pointAt(poly: Pt[], f: number): Pt {
  const total = poly.slice(1).reduce((s, p, i) => s + segLen(poly[i]!, p), 0)
  let want = Math.min(Math.max(f, 0), 1) * total
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!
    const b = poly[i]!
    const l = segLen(a, b)
    if (want <= l || i === poly.length - 1) {
      const k = l === 0 ? 0 : Math.min(want / l, 1)
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
    }
    want -= l
  }
  return poly[0]!
}

/** Sub-polyline between fractions f0 and f1 (order-independent). */
export function slice(poly: Pt[], f0: number, f1: number, samples = 12): Pt[] {
  const lo = Math.min(f0, f1)
  const hi = Math.max(f0, f1)
  return Array.from({ length: samples + 1 }, (_, i) => pointAt(poly, lo + ((hi - lo) * i) / samples))
}

/** Position of a track offset (metres from `a`) on the drawing. */
export const at = (layout: Layout, track: Track, offsetM: number): Pt => pointAt(layout.polylines.get(track.id)!, offsetM / track.lengthM)

export const pathD = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
