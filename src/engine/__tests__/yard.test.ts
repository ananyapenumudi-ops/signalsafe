import { describe, expect, it } from 'vitest'
import { Scenario } from '../schema'
import { YardModel, checkYard } from '../yard'
import { twoStation } from '../../scenarios/twoStation'

const yard = Scenario.parse(twoStation).yard

describe('YardModel', () => {
  it('follows points set to normal along the main line', () => {
    const y = new YardModel(yard)
    expect(y.buildRoute('A_APP', 'nominal').map((s) => s.track.id)).toEqual(['A_APP', 'A_MAIN', 'BLOCK', 'B_MAIN', 'B_EXIT'])
  })

  it('takes the loop when the facing point is reversed, and trails back to the toe', () => {
    const y = new YardModel(yard)
    y.pointState.set('P1', 'reverse')
    expect(y.buildRoute('A_APP', 'nominal').map((s) => s.track.id).slice(0, 3)).toEqual(['A_APP', 'A_LOOP', 'BLOCK'])
  })

  it('builds routes in the reverse direction', () => {
    const y = new YardModel(yard)
    expect(y.buildRoute('B_EXIT', 'reverse').map((s) => s.track.id)).toEqual(['B_EXIT', 'B_MAIN', 'BLOCK', 'A_MAIN', 'A_APP'])
  })

  it('maps offsets to route distance and back in both directions', () => {
    const y = new YardModel(yard)
    for (const dir of ['nominal', 'reverse'] as const) {
      const route = y.buildRoute('BLOCK', dir)
      const m = YardModel.routeMOf(route[0]!, 700)
      expect(YardModel.locate(route, m).offsetM).toBeCloseTo(700)
    }
  })

  it('only places signals that face the direction of travel', () => {
    const y = new YardModel(yard)
    expect(y.signalsOnRoute(y.buildRoute('A_APP', 'nominal')).map((s) => s.item.id)).toEqual(['S1', 'S3', 'S5', 'S11', 'S13'])
    expect(y.signalsOnRoute(y.buildRoute('B_EXIT', 'reverse'))).toEqual([])
  })
})

describe('checkYard', () => {
  it('accepts the sample yard', () => {
    expect(checkYard(yard)).toEqual([])
  })

  it('flags a tag gap over 1000 m (SRS 3.4.2.6) and an unpaired tag (SRS 3.4.2.2)', () => {
    const broken = { ...yard, tags: yard.tags.filter((t) => t.pair !== 'T06' && t.pair !== 'T07' && t.id !== 'T08b') }
    const msgs = checkYard(broken).map((i) => i.message)
    expect(msgs.some((m) => m.includes('exceeds 1000 m'))).toBe(true)
    expect(msgs.some((m) => m.includes('T08 has 1 tag'))).toBe(true)
  })

  it('flags references to unknown tracks', () => {
    const broken = { ...yard, signals: [...yard.signals, { ...yard.signals[0]!, id: 'SX', track: 'NOPE' }] }
    expect(checkYard(broken).some((i) => i.severity === 'error' && i.ref === 'SX')).toBe(true)
  })
})
