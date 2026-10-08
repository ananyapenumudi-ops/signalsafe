import { describe, expect, it } from 'vitest'
import { Simulation } from '../sim'
import { twoStation } from '../../scenarios/twoStation'
import type { LogEvent } from '../log'

const ofType = <K extends LogEvent['type']>(events: LogEvent[], type: K) =>
  events.filter((e): e is Extract<LogEvent, { type: K }> => e.type === type)

describe('Simulation', () => {
  it('is deterministic: same scenario + seed → identical log', () => {
    const a = JSON.stringify(new Simulation(twoStation).runToEnd())
    const b = JSON.stringify(new Simulation(twoStation).runToEnd())
    expect(a).toBe(b)
  })

  it('logs OVK status every 2 s (SRS 21.2)', () => {
    const sim = new Simulation(twoStation)
    sim.runUntil(20)
    expect(ofType(sim.log.events, 'OVK_STATUS').map((e) => e.tSim)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20])
  })

  describe('demo scenario', () => {
    const sim = new Simulation(twoStation)
    const events = sim.runToEnd()

    it('derives direction from the first two tag pairs', () => {
      const dir = ofType(events, 'OVK_DIRECTION')
      expect(dir).toHaveLength(1)
      expect(dir[0]!.data).toEqual({ direction: 'nominal', fromTags: ['T01a', 'T02a'] })
    })

    it('withholds the dropped pair and links its cause to the fault', () => {
      const crossedT07 = ofType(events, 'TAG_CROSSED').filter((e) => e.data.pair === 'T07')
      expect(crossedT07.map((e) => e.data.delivered)).toEqual([false, false])
      const faultStart = ofType(events, 'FAULT_START').find((e) => e.data.fault === 'drop-T07')!
      expect(crossedT07[0]!.causedBy).toEqual([faultStart.seq])
      expect(ofType(events, 'TAG_READ').some((e) => e.data.pair === 'T07')).toBe(false)
    })

    it('corrects the 3% PG under-read at every tag, within the SRS bound', () => {
      const fixes = ofType(events, 'OVK_LOCATION_CORRECTED')
      expect(fixes.length).toBeGreaterThan(4)
      for (const f of fixes) expect(f.data.withinBound).toBe(true)
      // the correction after the missing pair spans ~1800 m, so its error is the largest
      const worst = fixes.reduce((m, f) => (Math.abs(f.data.errorM) > Math.abs(m.data.errorM) ? f : m))
      expect(worst.data.tag).toBe('T08a')
    })

    it('reroutes into the Station B loop when P3 is reversed', () => {
      const routes = ofType(events, 'ROUTE_SET').filter((e) => e.causedBy.length > 0)
      expect(routes.at(-1)!.data.tracks).toContain('B_LOOP')
      expect(ofType(events, 'TAG_READ').some((e) => e.data.pair === 'T10')).toBe(true)
      expect(ofType(events, 'OVK_TIN').map((e) => e.data.to)).toContain(303)
    })

    it('passes signals with the aspect showing at the time', () => {
      const passed = Object.fromEntries(ofType(events, 'SIGNAL_PASSED').map((e) => [e.data.signal, e.data.aspect]))
      expect(passed).toMatchObject({ S1: 'Y', S3: 'G', S5: 'G', S11: 'YY' })
    })

    it('every causedBy points to an earlier event', () => {
      for (const e of events) for (const c of e.causedBy) expect(c).toBeLessThan(e.seq)
    })

    it('builds the causal chain behind a withheld tag', () => {
      const e = ofType(events, 'TAG_CROSSED').find((x) => !x.data.delivered)!
      expect(sim.log.chain(e.seq).map((x) => x.type)).toEqual(['FAULT_START', 'TAG_CROSSED'])
    })
  })
})
