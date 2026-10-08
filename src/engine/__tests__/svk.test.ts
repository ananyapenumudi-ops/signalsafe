import { describe, expect, it } from 'vitest'
import { Scenario, type Aspect, type PointPosition } from '../schema'
import { Simulation } from '../sim'
import { ReferenceSvk, mostRestrictive, type FieldInputs, type LocationReport } from '../svk/svk'
import { YardModel } from '../yard'
import { twoStation } from '../../scenarios/twoStation'
import type { LogEvent } from '../log'

const yard = Scenario.parse(twoStation).yard

function bench() {
  const aspects = new Map<string, Aspect>(yard.signals.map((s) => [s.id, s.initialAspect]))
  aspects.set('S3', 'G').set('S5', 'G').set('S11', 'Y')
  const points = new Map<string, PointPosition | undefined>(yard.points.map((p) => [p.id, 'normal']))
  const occupied = new Set<string>()
  const inputs: FieldInputs = {
    aspect: (id) => aspects.get(id) ?? 'R',
    point: (id) => points.get(id),
    occupied: (t) => occupied.has(t),
  }
  const svk = new ReferenceSvk('SVK-A', ['S1', 'S3', 'S4', 'S5'], new YardModel(yard))
  svk.observe(0, inputs)
  return { svk, inputs, aspects, points, occupied }
}

/** Loco on A_MAIN at chainage 900 m, 140 m before S3 (chainage 1040 m). */
const onAMain: LocationReport = { locoId: 'L1', absLocM: 900, direction: 'nominal', tin: 102 }
/** Loco in the block section at chainage 3000 m; S11 is at 3960 m. */
const inBlock: LocationReport = { locoId: 'L1', absLocM: 3000, direction: 'nominal', tin: 201 }

describe('Reference SVK — movement authority', () => {
  it('ranks aspects R < Y < YY < G', () => {
    expect(mostRestrictive('G', 'YY')).toBe('YY')
    expect(mostRestrictive('Y', 'YY')).toBe('Y')
    expect(mostRestrictive('R', 'G')).toBe('R')
  })

  it('extends the MA over OFF signals up to its look-ahead (SRS 5.4)', () => {
    const { svk, inputs } = bench()
    const ma = svk.computeMa(onAMain, inputs)!
    expect(ma).toMatchObject({ signal: 'S3', aspect: 'G', signalDistM: 140, nextAspect: 'G', eoa: 'S11', restricted: [] })
    expect(ma.maM).toBe(3060)
  })

  it('ends the MA at the first signal at ON', () => {
    const { svk, inputs, aspects } = bench()
    aspects.set('S5', 'R')
    svk.observe(10, inputs)
    expect(svk.computeMa(onAMain, inputs)).toMatchObject({ eoa: 'S5', signal: 'S3', nextAspect: 'R' })
  })

  it('shows R and shortens the MA when a point in the route is not proved (SRS 12.1)', () => {
    const { svk, inputs, points } = bench()
    points.set('P2', undefined)
    const ma = svk.computeMa(onAMain, inputs)!
    expect(ma).toMatchObject({ signal: 'S3', aspect: 'R', eoa: 'S3', maM: 140, restricted: [{ signal: 'S3', reason: 'ROUTE_MISMATCH' }] })
  })

  it('shows R when the point is detected but in the wrong position', () => {
    const { svk, inputs, points } = bench()
    points.set('P2', 'reverse')
    expect(svk.computeMa(onAMain, inputs)!.restricted).toEqual([{ signal: 'S3', reason: 'ROUTE_MISMATCH' }])
  })

  it('shows R when the route’s berthing track is occupied (SRS 12.1)', () => {
    const { svk, inputs, occupied } = bench()
    occupied.add('B_MAIN')
    expect(svk.computeMa(inBlock, inputs)).toMatchObject({ signal: 'S11', aspect: 'R', eoa: 'S11', restricted: [{ signal: 'S11', reason: 'ROUTE_OCCUPIED' }] })
  })

  it('restricts at once on OFF→ON and extends only after a 2 s hold (SRS 5.2)', () => {
    const { svk, inputs, aspects } = bench()
    aspects.set('S3', 'R')
    svk.observe(1, inputs)
    expect(svk.effectiveAspect('S3', inputs).aspect).toBe('R')
    aspects.set('S3', 'G')
    svk.observe(1.5, inputs)
    expect(svk.effectiveAspect('S3', inputs)).toEqual({ aspect: 'R', reason: 'HOLD' })
    svk.observe(3.4, inputs)
    expect(svk.effectiveAspect('S3', inputs).aspect).toBe('R')
    svk.observe(3.5, inputs)
    expect(svk.effectiveAspect('S3', inputs)).toEqual({ aspect: 'G' })
  })

  it('keeps a flickering signal at its most restrictive state until stable (SRS 18.8)', () => {
    const { svk, inputs, aspects } = bench()
    for (let i = 1; i <= 20; i++) {
      aspects.set('S3', i % 2 ? 'R' : 'G')
      svk.observe(i * 0.3, inputs)
      expect(svk.effectiveAspect('S3', inputs).aspect).toBe('R')
    }
  })

  it('cannot place a report on an unknown TIN', () => {
    const { svk, inputs } = bench()
    expect(svk.computeMa({ ...onAMain, tin: 999 }, inputs)).toBeNull()
  })
})

const ofType = <K extends LogEvent['type']>(events: LogEvent[], type: K) =>
  events.filter((e): e is Extract<LogEvent, { type: K }> => e.type === type)

describe('Reference SVK in the demo run', () => {
  const sim = new Simulation(twoStation)
  const events = sim.runToEnd()
  const mas = ofType(events, 'SVK_MA')

  it('registers the loco only after its direction is known (SRS 17.3)', () => {
    const reg = ofType(events, 'SVK_REGISTER')
    const dir = ofType(events, 'OVK_DIRECTION')[0]!
    expect(reg[0]!.data.svk).toBe('SVK-A')
    expect(reg[0]!.seq).toBeGreaterThan(dir.seq)
    expect(mas[0]!.seq).toBeGreaterThan(reg[0]!.seq)
  })

  it('cuts the MA back to S3 while P2 is undetected, citing the fault', () => {
    const fault = ofType(events, 'FAULT_START').find((e) => e.data.fault === 'p2-undetected')!
    const cut = mas.find((e) => e.data.restricted.some((r) => r.signal === 'S3' && r.reason === 'ROUTE_MISMATCH'))!
    expect(cut.tSim).toBeGreaterThanOrEqual(60)
    expect(cut.tSim).toBeLessThanOrEqual(62)
    expect(cut.data.eoa).toBe('S3')
    expect(cut.causedBy).toContain(fault.seq)
    const restored = mas.find((e) => e.seq > cut.seq && e.data.restricted.length === 0)!
    expect(restored.tSim).toBeGreaterThanOrEqual(66)
    const end = ofType(events, 'FAULT_END').find((e) => e.data.fault === 'p2-undetected')!
    expect(restored.causedBy).toContain(end.seq)
  })

  it('holds S11 at R through the flicker and for the hold after it', () => {
    // the flicker starts in its "set" phase; the first ON is seen at 150.4 s
    const firstRed = mas.find((e) => e.tSim >= 150 && e.data.signal === 'S11' && e.data.aspect === 'R')!
    expect(firstRed.data.restricted).toEqual([{ signal: 'S11', reason: 'HOLD' }])
    for (const e of mas.filter((x) => x.seq > firstRed.seq && x.tSim < 156)) if (e.data.signal === 'S11') expect(e.data.aspect).toBe('R')
    const firstClear = mas.find((e) => e.seq > firstRed.seq && e.data.signal === 'S11' && e.data.aspect !== 'R')!
    // flicker ends at 154 s; hold is 2 s after the last change; MAs go out on 2 s frames
    expect(firstClear.tSim).toBeGreaterThanOrEqual(156)
  })

  it('never sends an MA past a signal that is at ON', () => {
    for (const e of mas) if (e.data.aspect === 'R') expect(e.data.eoa).toBe(e.data.signal)
  })

  it('hands the loco to SVK-B when its approaching signal belongs to Station B', () => {
    expect(ofType(events, 'SVK_REGISTER').map((e) => e.data.svk)).toEqual(['SVK-A', 'SVK-B'])
  })
})
