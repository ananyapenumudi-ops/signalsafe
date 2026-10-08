import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { driverAccel, stepKinematics } from '../dynamics'
import { DT, PARAMS, mps } from '../params'

describe('Speed simulator (FRS 7.6.5)', () => {
  it('matches closed-form motion within FRS 7.6.5.5 (1%)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 60, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.integer({ min: 1, max: 600 }),
        (v0, a, n) => {
          let v = v0
          let x = 0
          for (let i = 0; i < n; i++) {
            const k = stepKinematics(v, a, DT)
            v = k.v
            x += k.dx
          }
          const tStop = a < 0 ? -v0 / a : Infinity
          const te = Math.min(n * DT, tStop)
          const vTheory = Math.max(v0 + a * te, 0)
          const xTheory = v0 * te + 0.5 * a * te * te
          expect(Math.abs(v - vTheory)).toBeLessThanOrEqual(PARAMS.speedSimMaxDeviation.value * Math.max(vTheory, 1))
          expect(Math.abs(x - xTheory)).toBeLessThanOrEqual(1e-6 * Math.max(xTheory, 1))
        },
      ),
    )
  })

  it('never reverses under braking', () => {
    const k = stepKinematics(0.05, -1, DT) // would cross zero mid-tick
    expect(k.v).toBe(0)
    expect(k.dx).toBeGreaterThan(0)
  })

  it('a Kavach brake command overrides the driver', () => {
    expect(driverAccel({ v: 10, targetKmph: 100, maxKmph: 110, gradientPermille: 0, kavachBrake: 'EB' })).toBe(-PARAMS.ebDecel.value)
  })

  it('comes to a full stand when the target is zero', () => {
    let v = mps(30)
    for (let i = 0; i < 400; i++) v = stepKinematics(v, driverAccel({ v, targetKmph: 0, maxKmph: 110, gradientPermille: 0, kavachBrake: null }), DT).v
    expect(v).toBe(0)
  })

  it('reaches and holds the target speed without overshoot', () => {
    let v = 0
    for (let i = 0; i < 2000; i++) {
      v = stepKinematics(v, driverAccel({ v, targetKmph: 60, maxKmph: 110, gradientPermille: 0, kavachBrake: null }), DT).v
      expect(v).toBeLessThanOrEqual(mps(61))
    }
    expect(v).toBeGreaterThan(mps(59))
  })
})
