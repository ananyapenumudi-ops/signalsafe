import { describe, expect, it } from 'vitest'
import { OvkPosition, type TagReading } from '../ovk/position'

const tag = (pair: string, absLocM: number, tin = 201, suffix = 'a'): TagReading => ({ tag: pair + suffix, pair, absLocM, tin })

describe('OVK location, direction and TIN', () => {
  it('keeps direction, location and TIN undefined until two different pairs are read (SRS 7.2, 7.3)', () => {
    const o = new OvkPosition()
    expect(o.onTag(tag('T1', 100))).toEqual([])
    o.onOdometry(3)
    expect(o.onTag(tag('T1', 103, 201, 'b'))).toEqual([]) // same pair: not a second set
    expect(o.direction).toBe('undefined')
    expect(o.absLocM).toBeNull()
    expect(o.tin).toBeNull()
    o.onOdometry(500)
    expect(o.onTag(tag('T2', 600)).map((e) => e.type)).toEqual(['OVK_DIRECTION', 'OVK_TIN'])
    expect(o.direction).toBe('nominal')
    expect(o.tin).toBe(201)
  })

  it('derives Reverse when absolute location decreases (SRS 7.5)', () => {
    const o = new OvkPosition()
    o.onTag(tag('T2', 600))
    o.onOdometry(500)
    o.onTag(tag('T1', 100))
    expect(o.direction).toBe('reverse')
    o.onOdometry(40)
    expect(o.absLocM).toBe(60)
  })

  it('corrects odometry at each tag and judges the error against 5 m + 5% (SRS 3.4.2.4(b))', () => {
    const o = new OvkPosition()
    o.onTag(tag('T1', 0))
    o.onOdometry(1000)
    o.onTag(tag('T2', 1000))
    o.onOdometry(970) // 3% under-read over 1000 m
    expect(o.uncertaintyM).toBeCloseTo(5 + 0.05 * 970)
    expect(o.onTag(tag('T3', 2000))[0]).toMatchObject({ type: 'OVK_LOCATION_CORRECTED', data: { errorM: -30, withinBound: true } })
    expect(o.absLocM).toBe(2000)

    o.onOdometry(800) // 20% under-read: outside the bound
    expect(o.onTag(tag('T4', 3000))[0]).toMatchObject({ type: 'OVK_LOCATION_CORRECTED', data: { errorM: -200, withinBound: false } })
  })

  it('self-deduces TIN changes (SRS 16.6)', () => {
    const o = new OvkPosition()
    o.onTag(tag('T1', 0, 101))
    o.onOdometry(300)
    o.onTag(tag('T2', 300, 101))
    o.onOdometry(700)
    expect(o.onTag(tag('T3', 1000, 102)).find((e) => e.type === 'OVK_TIN')).toEqual({ type: 'OVK_TIN', data: { from: 101, to: 102 } })
  })
})
