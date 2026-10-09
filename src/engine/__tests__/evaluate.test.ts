import { describe, expect, it } from 'vitest'
import { evaluate, matchesFilters } from '../eval/evaluate'
import { Simulation } from '../sim'
import { Scenario, type Observable, type ScenarioInput } from '../schema'
import { LIBRARY, s03, s05, s11b } from '../../scenarios/library'
import type { LogEvent } from '../log'

const run = (input: ScenarioInput) => {
  const sim = new Simulation(input)
  const events = sim.runToEnd()
  return { scenario: sim.scenario, events }
}

describe('every library scenario passes its own expectations (FRS 7.6.15)', () => {
  for (const { scenario } of LIBRARY) {
    it(scenario.title as string, () => {
      const { scenario: s, events } = run(scenario)
      const report = evaluate(s, events)
      expect(report.results.length).toBeGreaterThanOrEqual(3)
      const failures = report.results.filter((r) => r.status !== 'pass').map((r) => `${r.id}: ${r.detail} [${r.window}]`)
      expect(failures).toEqual([])
    })
  }
})

describe('the evaluator catches a broken Kavach (mutation checks)', () => {
  it('S05: an FSB applied late falls outside its window and fails', () => {
    const { scenario, events } = run(s05)
    const mutated = events.map((e) =>
      e.type === 'BRAKE' && e.data.reason === 'NO_ACK' ? ({ ...e, tSim: e.tSim + 6.4 } as LogEvent) : e,
    )
    const r = evaluate(scenario, mutated).results.find((x) => x.id === 'fsb')!
    expect(r.status).toBe('fail')
    expect(r.detail).toMatch(/21\.4 s after ask/)
  })

  it('S03: if one loco never brakes, its step fails and the dependent release step is blocked', () => {
    const { scenario, events } = run(s03)
    const mutated = events.filter((e) => !(e.type === 'BRAKE' && e.train === '22910'))
    const report = evaluate(scenario, mutated)
    expect(report.results.find((x) => x.id === 'eb-b')!.status).toBe('fail')
    expect(report.results.find((x) => x.id === 'rel-b')!.status).toBe('blocked')
    expect(report.results.find((x) => x.id === 'eb-a')!.status).toBe('pass')
  })

  it('S11b: a horn blown despite a short MA violates the absent-observable', () => {
    const { scenario, events } = run(s11b)
    const fake = { seq: 99999, tSim: 50, frame: 25, source: 'OVK:37421', type: 'HORN', train: '37421', data: { on: true, gate: 'LC42A', distM: 590, reason: 'WITHIN_600M' }, causedBy: [] } as LogEvent
    const r = evaluate(scenario, [...events, fake]).results.find((x) => x.id === 'no-horn')!
    expect(r.status).toBe('fail')
    expect(r.seq).toBe(99999)
  })
})

describe('evaluator mechanics', () => {
  const ev = (seq: number, tSim: number, type: string, data: object, extra: Partial<LogEvent> = {}) =>
    ({ seq, tSim, frame: Math.floor(tSim / 2), source: 'TBC', type, data, causedBy: [], ...extra }) as LogEvent
  const scenarioWith = (expectList: Partial<Observable>[]) =>
    Scenario.parse({ ...LIBRARY[0]!.scenario, expect: expectList.map((o, i) => ({ id: `o${i}`, label: `o${i}`, event: 'BRAKE', ...o })) })

  it('a matched record is consumed, so one event cannot satisfy two steps', () => {
    const events = [ev(0, 10, 'BRAKE', { level: 'FSB' })]
    const r = evaluate(scenarioWith([{ filters: { level: 'FSB' } }, { filters: { level: 'FSB' } }]), events).results
    expect(r.map((x) => x.status)).toEqual(['pass', 'fail'])
  })

  it('windows are relative to the anchor step', () => {
    const events = [ev(0, 10, 'BRAKE', { level: 'FSB' }), ev(1, 25, 'BRAKE', { level: null })]
    const ok = evaluate(scenarioWith([{ id: 'a', filters: { level: 'FSB' } }, { id: 'b', filters: { level: null }, at: { after: 'a', sec: [14, 16] } }]), events)
    expect(ok.results.map((x) => x.status)).toEqual(['pass', 'pass'])
    const late = evaluate(scenarioWith([{ id: 'a', filters: { level: 'FSB' } }, { id: 'b', filters: { level: null }, at: { after: 'a', sec: [0, 5] } }]), events)
    expect(late.results[1]).toMatchObject({ status: 'fail', detail: expect.stringContaining('15 s after a') })
  })

  it('location windows use the event chainage', () => {
    const events = [ev(0, 10, 'BRAKE', { level: 'FSB' }, { locM: 1500 })]
    expect(evaluate(scenarioWith([{ at: { locM: [1400, 1600] } }]), events).results[0]!.status).toBe('pass')
    expect(evaluate(scenarioWith([{ at: { locM: [0, 1000] } }]), events).results[0]!.status).toBe('fail')
  })

  it('filters support train, dotted paths and numeric ranges', () => {
    const e = ev(0, 1, 'SVK_MA', { restricted: [{ signal: 'S3' }], maM: 140 }, { train: 'L1' })
    expect(matchesFilters(e, { train: 'L1', maM: { gte: 100, lte: 200 } })).toBe(true)
    expect(matchesFilters(e, { 'restricted.0.signal': 'S3' })).toBe(true)
    expect(matchesFilters(e, { maM: { lte: 100 } })).toBe(false)
  })

  it('flags safety events nobody asked for', () => {
    const events = [ev(0, 10, 'BRAKE', { level: 'EB', reason: 'OVERSPEED_EB' })]
    const report = evaluate(scenarioWith([{ event: 'SPAD', expect: 'absent' }]), events)
    expect(report.unexpected).toHaveLength(1)
  })
})
