/**
 * Speed Simulator (FRS 7.6.5): train motion along its route.
 * Integration is exact for constant acceleration within a tick, so the
 * generated speed matches theory far inside FRS 7.6.5.5's 1% limit.
 */
import { DT, P, mps } from './params'
import type { BrakeLevel } from './schema'

export interface Kinematics {
  /** Distance travelled this step (≥ 0; this model does not roll back yet). */
  dx: number
  v: number
}

/** Exact constant-acceleration step that stops at v = 0 instead of reversing. */
export function stepKinematics(v: number, a: number, dt: number): Kinematics {
  if (a < 0 && v + a * dt < 0) {
    const t0 = -v / a
    return { dx: v * t0 + 0.5 * a * t0 * t0, v: 0 }
  }
  return { dx: v * dt + 0.5 * a * dt * dt, v: v + a * dt }
}

/** Deceleration from gradient: rising track (positive ‰) slows the train. */
export const gradientAccel = (gradientPermille: number) => (-P('gravity') * gradientPermille) / 1000

const BRAKE_DECEL: Record<BrakeLevel, number> = {
  NB: P('nbDecel'),
  FSB: P('fsbDecel'),
  EB: P('ebDecel'),
}

export interface DriveInput {
  v: number
  targetKmph: number
  maxKmph: number
  gradientPermille: number
  /** A Kavach brake command overrides the driver (BIU, SRS 3.5.6.3(b)). */
  kavachBrake: BrakeLevel | null
}

/**
 * Commanded acceleration for the auto-driver (DMI auto-player stand-in):
 * notch up below target, hold at target, service-brake above it.
 */
export function driverAccel({ v, targetKmph, maxKmph, gradientPermille, kavachBrake }: DriveInput): number {
  const g = gradientAccel(gradientPermille)
  if (kavachBrake) return -BRAKE_DECEL[kavachBrake] + g
  const target = mps(Math.min(targetKmph, maxKmph))
  const band = mps(1)
  if (v < target - band / 2) return Math.min(P('tractionAccel') + g, (target - v) / DT)
  // A zero target means stop: no hold band, brake right down to a stand.
  if (v > target + band || (target === 0 && v > 0)) return Math.max(-P('driverServiceDecel') + g, -(v - target) / DT)
  return 0 // holding speed: driver compensates for the gradient
}
