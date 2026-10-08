/**
 * Seeded PRNG (mulberry32). All randomness in a run — packet loss, jitter —
 * must come from one of these so that same scenario + same seed = same log.
 * Never use Math.random() inside the engine.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  /** Independent child stream, so adding a consumer doesn't shift others' draws. */
  fork(label: string): Rng {
    let h = this.state ^ 0x9e3779b9
    for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 0x01000193)
    return new Rng(h >>> 0)
  }
}
