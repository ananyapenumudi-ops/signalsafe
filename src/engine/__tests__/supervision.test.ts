import { describe, expect, it } from 'vitest'
import { OvkSupervisor, type OwnPosition } from '../ovk/supervision'
import { P, mps } from '../params'
import type { MaPacket } from '../svk/svk'

const packet = (maM: number, aspect: MaPacket['aspect'] = 'R'): MaPacket => ({
  svk: 'SVK-A',
  train: 'L1',
  signal: 'S1',
  aspect,
  signalDistM: maM,
  nextAspect: null,
  maM,
  eoa: 'S1',
  restricted: [],
})
const at = (absLocM: number, uncertaintyM = 5): OwnPosition => ({ absLocM, uncertaintyM, dir: 1 })

describe('OVK supervision — braking curve', () => {
  it('starts in Staff Responsible and enters Full Supervision on the first MA', () => {
    const s = new OvkSupervisor('absolute')
    expect(s.mode).toBe('SR')
    const ev = s.onMa(packet(1000), 0, 1, 0)
    expect(ev.map((e) => e.type)).toEqual(['OVK_MODE'])
    expect(s.mode).toBe('FS')
  })

  it('enforces the SR ceiling with the service brake', () => {
    const s = new OvkSupervisor('absolute')
    const ev = s.step(0, mps(P('srCeilingKmph') + 5), null, 110)
    expect(ev[0]).toMatchObject({ type: 'BRAKE', data: { level: 'FSB', reason: 'SR_CEILING' } })
  })

  it('measures distance to EOA from the max safe front end (SRS 11.5.1)', () => {
    const s = new OvkSupervisor('absolute')
    s.onMa(packet(500), 1000, 1, 0) // EOA at 1500
    s.step(0, 10, at(1200, 20), 110)
    expect(s.dmi(0).targetDistM).toBe(280) // 1500 − (1200 + 20)
  })

  it('applies FSB just above the curve, EB well above it, and releases below it', () => {
    const s = new OvkSupervisor('absolute')
    s.onMa(packet(400), 0, 1, 0)
    // permitted at d = 400 − 5 − 3: √(2·0.45·392) ≈ 18.8 m/s ≈ 67.6 km/h
    expect(s.step(0, mps(66), at(0), 110)).toEqual([])
    expect(s.step(0.1, mps(71), at(0), 110)[0]).toMatchObject({ type: 'BRAKE', data: { level: 'FSB', reason: 'CURVE' } })
    expect(s.step(0.2, mps(80), at(0), 110)[0]).toMatchObject({ type: 'BRAKE', data: { level: 'EB', reason: 'OVERSPEED_EB' } })
    expect(s.step(0.3, mps(60), at(0), 110)[0]).toMatchObject({ type: 'BRAKE', data: { level: null } })
  })

  it('holds the brake at a stand at the end of authority (no creeping)', () => {
    const s = new OvkSupervisor('absolute')
    s.onMa(packet(10), 0, 1, 0)
    s.step(0, mps(8), at(0), 110) // over the curve → FSB
    expect(s.brake).toBe('FSB')
    s.step(1, 0, at(2), 110)
    expect(s.brake).toBe('FSB')
    s.onMa(packet(800), 2, 1, 2) // MA extends → released
    s.step(2, 0, at(2), 110)
    expect(s.brake).toBeNull()
  })

  it('trips and applies EB if the train passes its end of authority', () => {
    const s = new OvkSupervisor('absolute')
    s.onMa(packet(100), 0, 1, 0)
    const ev = s.step(0, mps(20), at(101), 110)
    expect(ev.map((e) => e.type)).toEqual(['SPAD', 'OVK_MODE', 'BRAKE'])
    expect(s.mode).toBe('TRIP')
    expect(s.brake).toBe('EB')
  })
})

describe('OVK supervision — radio failure (SRS 20.1)', () => {
  function silent(blockType: 'absolute' | 'automatic') {
    const s = new OvkSupervisor(blockType)
    s.onMa(packet(5000, 'G'), 0, 1, 0)
    const log: { t: number; type: string; level?: string | null }[] = []
    for (let i = 1; i <= 600; i++) {
      const t = i / 10
      for (const e of s.step(t, mps(60), at(t * 16.7), 110)) log.push({ t, type: e.type, level: e.type === 'BRAKE' ? e.data.level : undefined })
    }
    return { s, log }
  }

  it('blanks the aspect after 6 s but keeps Full Supervision', () => {
    const { log, s } = silent('absolute')
    expect(log.find((e) => e.type === 'DMI_ASPECT_BLANK')!.t).toBeCloseTo(6.1)
    expect(s.dmi(10).aspect === null).toBe(true)
  })

  it('declares radio failure at 30 s (absolute) / 10 s (automatic), then brakes after 15 s without ack', () => {
    const abs = silent('absolute').log
    expect(abs.find((e) => e.type === 'RADIO_FAILURE')!.t).toBe(30)
    expect(abs.find((e) => e.type === 'BRAKE')).toMatchObject({ t: 45, level: 'FSB' })
    const auto = silent('automatic').log
    expect(auto.find((e) => e.type === 'RADIO_FAILURE')!.t).toBe(10)
  })

  it('an acknowledgement degrades to SR instead of braking, and a new MA resumes FS', () => {
    const s = new OvkSupervisor('absolute')
    s.onMa(packet(5000, 'G'), 0, 1, 0)
    for (let i = 1; i <= 310; i++) s.step(i / 10, mps(20), at(i), 110)
    expect(s.ackPending).toBe(true)
    expect(s.ack(31.5).map((e) => e.type)).toEqual(['ACK', 'OVK_MODE'])
    expect(s.mode).toBe('SR')
    s.onMa(packet(5000, 'G'), 40, 1, 40)
    expect(s.mode).toBe('FS')
    expect(s.dmi(40).radioFailure).toBe(false)
  })
})
