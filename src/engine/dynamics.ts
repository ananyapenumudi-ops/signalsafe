/**
 * Speed Simulator (FRS 7.6.5): train motion along its route.
 * Integration is exact for constant acceleration within a tick, so the
 * generated speed matches theory far inside FRS 7.6.5.5's 1% limit.
 */
import { DT, P, mps } from './params'
import type { BrakeLevel } from './schema'

export interface Kinematics {
  /** Distance travelled this step (signed along the direction of travel). */
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
  /** Signed speed along the train's direction of travel (negative = rolling back). */
  v: number
  targetKmph: number
  maxKmph: number
  gradientPermille: number
  /** A Kavach brake command overrides the driver (BIU, SRS 3.5.6.3(b)). */
  kavachBrake: BrakeLevel | null
  /** Pilot releases the brakes when stopped (used to provoke roll-back, S08). */
  releasesBrakesAtStand?: boolean
}

/** What the driver/BIU applies: forward traction and a brake that opposes motion (both ≥ 0, m/s²). */
export interface Command {
  traction: number
  brake: number
}

/**
 * Command for the auto-driver (DMI auto-player stand-in): notch up below
 * target, hold at target, service-brake above it, hold the train at a stand.
 * Kavach braking cuts traction (SRS 3.5.6.3(d)).
 */
export function driverCommand({ v, targetKmph, maxKmph, gradientPermille, kavachBrake, releasesBrakesAtStand }: DriveInput): Command {
  const g = gradientAccel(gradientPermille)
  if (kavachBrake) return { traction: 0, brake: BRAKE_DECEL[kavachBrake] }
  const service = P('driverServiceDecel')
  const target = mps(Math.min(targetKmph, maxKmph))
  if (target === 0) {
    // an inattentive pilot who has released the brakes doesn't react to a slow roll-back either
    if (v < 0.05 && releasesBrakesAtStand) return { traction: 0, brake: 0 }
    return { traction: 0, brake: service }
  }
  if (v < 0) return { traction: P('tractionAccel'), brake: 0 } // rolling back: pilot takes power
  const band = mps(1)
  if (v < target - band / 2) return { traction: Math.max(Math.min(P('tractionAccel'), (target - v) / DT - g), 0), brake: 0 }
  if (v > target + band) {
    const desired = Math.max(-service + g, -(v - target) / DT)
    return { traction: 0, brake: Math.min(Math.max(g - desired, 0), service) }
  }
  // holding speed: compensate for the gradient
  return g < 0 ? { traction: Math.min(-g, P('tractionAccel')), brake: 0 } : { traction: 0, brake: g }
}

/**
 * One tick of signed motion. Gradient (`g`, signed along the direction of
 * travel) and traction push; the brake opposes motion, holds the train at a
 * stand if strong enough, and never reverses it within a tick.
 */
export function stepTrain(v: number, cmd: Command, g: number, dt: number): Kinematics {
  const push = cmd.traction + g
  if (Math.abs(v) < 1e-9) {
    if (Math.abs(push) <= cmd.brake) return { dx: 0, v: 0 }
    const a = push - Math.sign(push) * cmd.brake
    return { dx: 0.5 * a * dt * dt, v: a * dt }
  }
  const a = push - Math.sign(v) * cmd.brake
  const v1 = v + a * dt
  if (Math.sign(v1) !== Math.sign(v) && cmd.brake > 0) {
    const t0 = -v / a
    return { dx: v * t0 + 0.5 * a * t0 * t0, v: 0 }
  }
  return { dx: v * dt + 0.5 * a * dt * dt, v: v1 }
}
