/**
 * RFID Simulator (FRS 7.6.6), swept-path detection.
 *
 * At 200 km/h a train moves 5.6 m per 100 ms tick, far more than the reader's
 * ≤ 0.75 m horizontal range (SRS 3.5.4.3), so sampling position would miss
 * tags. Instead we report every tag whose position the antenna *crossed*
 * between the previous and current tick: no unintended misses at any speed.
 */
import type { OnRoute } from './yard'

/**
 * Items with routeM in the half-open interval (from, to] — or [to, from) when
 * moving backwards — in the order the antenna meets them.
 * `items` must be sorted by routeM ascending.
 */
export function crossed<T>(items: readonly OnRoute<T>[], from: number, to: number): OnRoute<T>[] {
  if (to === from) return []
  if (to > from) return items.filter((i) => i.routeM > from && i.routeM <= to)
  return items.filter((i) => i.routeM < from && i.routeM >= to).reverse()
}
