import { describe, expect, it } from 'vitest'
import { assessCollisions, type TrainReport } from '../svk/collision'
import { OvkSupervisor } from '../ovk/supervision'
import { Simulation } from '../sim'
import { mps } from '../params'
import { s03, s04, s08 } from '../../scenarios/library'
import type { LogEvent } from '../log'
import type { ScenarioInput } from '../schema'

const r = (locoId: string, absLocM: number, direction: 'nominal' | 'reverse', speed = 20, tin = 201): TrainReport => ({
  locoId,
  absLocM,
  direction,
  tin,
  lengthM: 400,
  uncertaintyM: 10,
  speed,
})
const block = (tin: number) => tin === 201

describe('collision assessment (SRS 14)', () => {
  it('flags head-on for both locos when they face each other on the same block TIN (14.7)', () => {
    const m = assessCollisions([r('A', 1000, 'nominal'), r('B', 3000, 'reverse')], block)
    expect(m.get('A')).toEqual({ kind: 'HEAD_ON', other: 'B', gapM: 1980 })
    expect(m.get('B')).toEqual({ kind: 'HEAD_ON', other: 'A', gapM: 1980 })
  })

  it('does not flag locos going away from each other, on different TINs, or in a station section (14.6)', () => {
    expect(assessCollisions([r('A', 3000, 'nominal'), r('B', 1000, 'reverse')], block).size).toBe(0)
    expect(assessCollisions([r('A', 1000, 'nominal'), r('B', 3000, 'reverse', 20, 202)], block).size).toBe(0)
    expect(assessCollisions([r('A', 1000, 'nominal', 20, 102), r('B', 3000, 'reverse', 20, 102)], block).size).toBe(0)
  })

  it('keeps a head-on situation while both stand (it is over only when one leaves the TIN)', () => {
    expect(assessCollisions([r('A', 1000, 'nominal', 0), r('B', 3000, 'reverse', 0)], block).size).toBe(2)
  })

  it('gives a rear-end target to the rear loco only, 300 m behind the front train’s min safe rear end (14.3)', () => {
    const m = assessCollisions([r('FRONT', 3000, 'nominal'), r('REAR', 1500, 'nominal')], block)
    expect(m.has('FRONT')).toBe(false)
    // front rear end = 3000 − (400 + 10) = 2590; target = 2590 − 300
    expect(m.get('REAR')).toEqual({ kind: 'REAR_END', other: 'FRONT', gapM: 1080, targetAbsM: 2290 })
  })

  it('works in the reverse direction too', () => {
    const m = assessCollisions([r('FRONT', 1000, 'reverse'), r('REAR', 2500, 'reverse')], block)
    expect(m.get('REAR')).toMatchObject({ kind: 'REAR_END', targetAbsM: 1710 })
  })
})

describe('OVK response to collision alerts', () => {
  const ma = (threat: ReturnType<typeof assessCollisions> extends Map<string, infer T> ? T | null : never) => ({
    svk: 'S',
    train: 'A',
    signal: null,
    aspect: null,
    signalDistM: null,
    nextAspect: null,
    maM: 5000,
    eoa: 'route-end',
    restricted: [],
    threat,
  })

  it('head-on: EB immediately, released at 0 km/h (14.2, 14.4), and permitted speed 0', () => {
    const s = new OvkSupervisor('absolute')
    s.onMa(ma({ kind: 'HEAD_ON', other: 'B', gapM: 2000 }), 0, 1, 0)
    s.step(0, mps(80), { absLocM: 0, uncertaintyM: 5, dir: 1 }, 110)
    expect(s.brake).toBe('EB')
    expect(s.dmi(0).permittedKmph).toBe(0)
    s.step(1, 0, { absLocM: 200, uncertaintyM: 5, dir: 1 }, 110)
    expect(s.brake).toBeNull()
  })

  it('withdraws the alert when the situation is over (14.5)', () => {
    const s = new OvkSupervisor('absolute')
    s.onMa(ma({ kind: 'HEAD_ON', other: 'B', gapM: 2000 }), 0, 1, 0)
    expect(s.onMa(ma(null), 0, 1, 2).map((e) => e.type)).toContain('COLLISION_CLEAR')
    expect(s.dmi(2).threat).toBeNull()
  })
})

describe('roll-back protection (SRS 13.1)', () => {
  it('brakes once the train has rolled back more than 5 m, and holds until the pilot takes power', () => {
    const s = new OvkSupervisor('absolute')
    let t = 0
    let back = 0
    const ev: string[] = []
    while (back < 6) {
      t += 0.1
      back += 0.1 * 0.5
      ev.push(...s.step(t, -0.5, null, 110).map((e) => e.type))
    }
    expect(ev).toEqual(['ROLLBACK', 'BRAKE'])
    expect(s.brakeReason).toBe('ROLLBACK')
    s.step(t + 1, 0, null, 110, false)
    expect(s.brake).toBe('FSB')
    s.step(t + 2, 0, null, 110, true)
    expect(s.brake).toBeNull()
  })

  it('does not trigger on 4 m of roll-back', () => {
    const s = new OvkSupervisor('absolute')
    for (let i = 1; i <= 80; i++) expect(s.step(i / 10, -0.5, null, 110)).toEqual([])
  })
})

const ofType = <K extends LogEvent['type']>(events: LogEvent[], type: K) =>
  events.filter((e): e is Extract<LogEvent, { type: K }> => e.type === type)

describe('S03 · Head-on in block section', () => {
  const events = new Simulation(s03).runToEnd()

  it('sends SoS to both locos and both apply EB immediately', () => {
    const sos = ofType(events, 'SVK_SOS')[0]!
    expect(sos.data).toMatchObject({ kind: 'HEAD_ON', trains: ['37421', '22910'] })
    const ebs = ofType(events, 'BRAKE').filter((e) => e.data.level === 'EB' && e.data.reason === 'HEAD_ON')
    expect(ebs.map((e) => e.train).sort()).toEqual(['22910', '37421'])
    for (const e of ebs) expect(e.tSim).toBe(sos.tSim)
  })

  it('both stop with distance to spare, and the brakes release at 0 km/h (14.4)', () => {
    expect(ofType(events, 'COLLISION')).toEqual([])
    const releases = ofType(events, 'BRAKE').filter((e) => e.data.level === null)
    expect(releases.map((e) => e.train).sort()).toEqual(['22910', '37421'])
    for (const e of releases) expect(e.data.speedKmph).toBe(0)
  })

  it('the EB cites the SoS, which cites both locos’ location reports', () => {
    const sim = new Simulation(s03)
    sim.runToEnd()
    const eb = ofType(sim.log.events, 'BRAKE').find((e) => e.data.reason === 'HEAD_ON')!
    const chain = sim.log.chain(eb.seq).map((e) => e.type)
    expect(chain).toEqual(expect.arrayContaining(['RADIO_PACKET', 'SVK_SOS', 'SVK_MA', 'COLLISION_ALERT', 'BRAKE']))
  })
})

describe('S04 · Rear-end following', () => {
  const sim = new Simulation(s04)
  let minGap = Infinity
  while (!sim.ended) {
    sim.step()
    const [rear, front] = sim.trains
    const gap = sim.trueAbsLocM(front!) - front!.spec.lengthM - sim.trueAbsLocM(rear!)
    minGap = Math.min(minGap, gap)
  }
  const events = sim.log.events

  it('only the rear loco brakes for the rear-end situation; the front never does (14.3)', () => {
    const rearEnd = ofType(events, 'BRAKE').filter((e) => e.data.reason === 'REAR_END')
    expect(rearEnd.length).toBeGreaterThan(0)
    expect(new Set(rearEnd.map((e) => e.train))).toEqual(new Set(['37421']))
    expect(ofType(events, 'BRAKE').filter((e) => e.train === '22910')).toEqual([])
    expect(ofType(events, 'COLLISION_ALERT').map((e) => e.train)).toEqual(['37421'])
  })

  it('keeps at least 300 m between the trains (true positions) and never collides', () => {
    expect(ofType(events, 'COLLISION')).toEqual([])
    expect(minGap).toBeGreaterThanOrEqual(300)
  })
})

describe('S08 · Roll back on a gradient', () => {
  const events = new Simulation(s08).runToEnd()

  it('brakes after 5 m of roll-back, warns, and releases when the pilot takes power', () => {
    const rb = ofType(events, 'ROLLBACK')
    expect(rb).toHaveLength(1)
    expect(rb[0]!.data.distanceM).toBeGreaterThanOrEqual(5)
    expect(rb[0]!.data.distanceM).toBeLessThan(5.5)
    const brakes = ofType(events, 'BRAKE')
    expect(brakes[0]).toMatchObject({ data: { level: 'FSB', reason: 'ROLLBACK' } })
    expect(brakes[0]!.causedBy).toEqual([rb[0]!.seq])
    const release = brakes.find((e) => e.data.level === null)!
    expect(release.tSim).toBeGreaterThanOrEqual(120)
  })
})

describe('bench ground-truth collision detector', () => {
  it('catches a collision Kavach cannot prevent: an unregistered train is invisible to it', () => {
    // the front train never reads two tag pairs, so it never registers (SRS 17.3)
    const blind: ScenarioInput = {
      ...s04,
      id: 'blind-front',
      trains: [s04.trains[0]!, { ...s04.trains[1]!, start: { track: 'BLOCK', offsetM: 1100, dir: 'nominal', preset: false } }],
    }
    const events = new Simulation(blind).runToEnd()
    expect(ofType(events, 'SVK_SOS')).toEqual([])
    const crash = ofType(events, 'COLLISION')
    expect(crash).toHaveLength(1)
    expect(crash[0]!.data.trains.sort()).toEqual(['22910', '37421'])
  })
})
