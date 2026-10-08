import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { crossed } from '../rfid'
import { DT, P, mps } from '../params'

describe('RFID simulator swept detection (FRS 7.6.6.3)', () => {
  it(`reads every tag exactly once at any speed up to ${P('rfidNoMissUpToKmph')} km/h and beyond`, () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.double({ min: 0.5, max: 4999, noNaN: true }), { minLength: 1, maxLength: 40 }),
        fc.double({ min: 1, max: 250, noNaN: true }),
        (positions, speedKmph) => {
          const tags = [...positions].sort((a, b) => a - b).map((routeM, item) => ({ item, routeM }))
          const seen: number[] = []
          const step = mps(speedKmph) * DT
          for (let m = 0; m < 5000; m += step) seen.push(...crossed(tags, m, Math.min(m + step, 5000)).map((t) => t.item))
          expect(seen).toEqual(tags.map((t) => t.item))
        },
      ),
    )
  })

  it('reports tags in the order met when moving backwards', () => {
    const tags = [10, 20, 30].map((routeM, item) => ({ item, routeM }))
    expect(crossed(tags, 35, 5).map((t) => t.item)).toEqual([2, 1, 0])
  })

  it('reports nothing when stationary', () => {
    expect(crossed([{ item: 0, routeM: 10 }], 10, 10)).toEqual([])
  })
})
