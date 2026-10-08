import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { driverCommand, gradientAccel, stepKinematics, stepTrain } from '../dynamics'
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

  it('a Kavach brake command overrides the driver and cuts traction (SRS 3.5.6.3)', () => {
    expect(driverCommand({ v: 10, targetKmph: 100, maxKmph: 110, gradientPermille: 0, kavachBrake: 'EB' })).toEqual({ traction: 0, brake: PARAMS.ebDecel.value })
  })

  const drive = (v: number, targetKmph: number, grad = 0, releases = false) =>
    stepTrain(v, driverCommand({ v, targetKmph, maxKmph: 110, gradientPermille: grad, kavachBrake: null, releasesBrakesAtStand: releases }), gradientAccel(grad), DT).v

  it('comes to a full stand when the target is zero, and holds there on a gradient', () => {
    let v = mps(30)
    for (let i = 0; i < 400; i++) v = drive(v, 0, 8)
    expect(v).toBe(0)
  })

  it('reaches and holds the target speed without overshoot, on the level and uphill', () => {
    for (const grad of [0, 5]) {
      let v = 0
      for (let i = 0; i < 3000; i++) {
        v = drive(v, 60, grad)
        expect(v).toBeLessThanOrEqual(mps(61))
      }
      expect(v).toBeGreaterThan(mps(59))
    }
  })

  it('rolls back down a rising gradient when the brakes are released at a stand', () => {
    let v = 0
    for (let i = 0; i < 50; i++) v = drive(v, 0, 8, true)
    expect(v).toBeLessThan(0)
  })

  it('a brake opposing motion stops a rolling-back train without reversing it', () => {
    const k = stepTrain(-0.03, { traction: 0, brake: 0.6 }, gradientAccel(8), DT)
    expect(k.v).toBe(0)
    expect(k.dx).toBeLessThan(0)
  })
})
